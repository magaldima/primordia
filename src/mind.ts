import { MODELS, TRAIT_KEYS, type BreedResponse, type Effort, type HistorianResponse, type JudgeResponse, type ThinkResponse, type Traits, type Usage } from "../shared/types";
import { buildDigest, signals, type AnnalEntry } from "./sim/digest";
import type { Agent, Engine } from "./sim/engine";

/**
 * Bridges the simulation to Claude. Each tick it sends the most overdue agents to /api/think in
 * batches, within the concurrency limit and spend budget. A batch shares one model (the tribe's)
 * and one effort (the stage of life's). Agents keep acting on instinct while a thought is in
 * flight, so the world never stalls (unless the player turns on lockstep). Insights the minds voice
 * are collected and sent to /api/judge to be checked against the world's real laws.
 */
export class Mind {
  inflight = 0;
  breedInflight = 0;
  judgeInflight = 0;
  historianBusy = false;
  /** Set when the server has no credentials; the historian then records only the numeric signals. */
  offline = false;
  /** Measured cost of historian reports per model, for the per-report estimate. */
  private perReport = new Map<string, { usd: number; n: number }>();
  spentUsd = 0;
  tokens = { input: 0, output: 0 };
  requests = 0;
  lastError: string | null = null;
  /** Measured USD per agent-decision and per child creed, per model+effort, for the cost estimate. */
  private perDecision = new Map<string, { usd: number; n: number }>();
  private perBreed = new Map<string, { usd: number; n: number }>();
  /** Bumped on every new game so responses from a previous world are ignored. */
  private epoch = 0;

  constructor(private onFatal: (msg: string) => void) {}

  reset() {
    this.epoch++;
    this.inflight = 0;
    this.breedInflight = 0;
    this.judgeInflight = 0;
    this.historianBusy = false;
    this.lastError = null;
  }

  canSpend(engine: Engine) {
    return this.spentUsd < engine.params.budgetUsd;
  }

  /** Called once per tick. */
  pump(engine: Engine) {
    const p = engine.params;
    // The historian runs whatever the agents think with: it only reads the world.
    const last = engine.annals.at(-1)?.tick ?? 0;
    if (p.historianEvery > 0 && engine.tick - last >= p.historianEvery && !this.historianBusy) this.writeAnnal(engine);
    if (p.brain !== "hybrid" || !this.canSpend(engine)) {
      engine.pendingBreeds.length = 0;
      engine.pendingInsights.length = 0;
      engine.pendingNorms.length = 0;
      return;
    }
    if (this.inflight < p.maxConcurrentRequests) {
      // Group the most overdue thinkers by (model, effort) and send full batches first.
      const groups = new Map<string, Agent[]>();
      for (const a of engine.dueThinkers()) {
        const key = `${engine.modelFor(a)}|${engine.effortFor(a)}`;
        const g = groups.get(key) ?? [];
        if (g.length < p.thinkBatchSize) g.push(a);
        groups.set(key, g);
      }
      for (const [key, batch] of groups) {
        if (this.inflight >= p.maxConcurrentRequests) break;
        const [model, effort] = key.split("|") as [string, Effort];
        for (const a of batch) a.thinking = true;
        this.sendThink(engine, model, effort, batch.map((a) => a.id));
      }
    }
    if (p.llmBreeding) {
      while (engine.pendingBreeds.length && this.breedInflight < 2) this.sendBreed(engine, engine.pendingBreeds.shift()!);
      // Under a baby boom, older births keep their locally spliced creed.
      if (engine.pendingBreeds.length > 12) engine.pendingBreeds.splice(0, engine.pendingBreeds.length - 12);
    } else engine.pendingBreeds.length = 0;
    // Judge insights and decrees in batches: when enough have piled up, or the oldest has waited a while.
    const pi = engine.pendingInsights;
    const pn = engine.pendingNorms;
    const oldest = Math.min(pi[0]?.tick ?? Infinity, pn[0]?.tick ?? Infinity);
    if ((pi.length || pn.length) && this.judgeInflight === 0 && (pi.length + pn.length >= 6 || engine.tick - oldest > 30))
      this.sendJudge(engine, pi.splice(0, 12), pn.splice(0, 8));
  }

  /** Write the next entry of the annals: numeric signals always, the historian's analysis when Claude is available. */
  async writeAnnal(engine: Engine) {
    if (this.historianBusy) return;
    const epoch = this.epoch;
    const prev = engine.annals.at(-1);
    const fromTick = prev?.tick ?? 0;
    const entry: AnnalEntry = { tick: engine.tick, fromTick, report: null, signals: signals(engine, fromTick), status: "writing" };
    engine.annals.push(entry);
    if (this.offline || !this.canSpend(engine)) {
      entry.status = "offline";
      return;
    }
    const previous = [...engine.annals].reverse().find((x) => x.report)?.report ?? null;
    const model = engine.params.historianModel;
    this.historianBusy = true;
    try {
      const res = await post<HistorianResponse>("/api/historian", { model, digest: buildDigest(engine, fromTick, previous) });
      if (epoch !== this.epoch) return;
      this.observe(this.perReport, model, this.track(engine, model, res.usage), 1);
      entry.report = res.report;
      entry.model = model;
      entry.status = "done";
      engine.logEvent("system", `The historian wrote: "${res.report.title}"`);
    } catch (err) {
      if (epoch !== this.epoch) return;
      entry.status = "error";
      entry.error = err instanceof Error ? err.message : String(err);
      if (err instanceof HttpError && err.status === 401) {
        this.offline = true;
        entry.status = "offline";
      }
    } finally {
      if (epoch === this.epoch) this.historianBusy = false;
    }
  }

  private async sendThink(engine: Engine, model: string, effort: Effort, ids: number[]) {
    const epoch = this.epoch;
    this.inflight++;
    const agents = ids.map((id) => engine.agents.get(id)).filter((a) => !!a);
    try {
      const res = await post<ThinkResponse>("/api/think", {
        model,
        effort,
        tick: engine.tick,
        worldSummary: engine.worldSummary(),
        worldEvents: engine.worldEvents.map((e) => e.text),
        agents: agents.map((a) => engine.perceive(a)),
      });
      if (epoch !== this.epoch) return;
      const usd = this.track(engine, model, res.usage);
      this.observe(this.perDecision, `${model}:${effort}`, usd, Math.max(1, agents.length));
      for (const d of res.decisions) engine.applyDecision(d);
      this.lastError = null;
    } catch (err) {
      if (epoch !== this.epoch) return;
      this.fail(engine, err);
    } finally {
      if (epoch === this.epoch) {
        this.inflight--;
        // Anyone the model skipped goes back on the schedule.
        for (const id of ids) if (engine.agents.get(id)?.thinking) engine.releaseThinker(id);
      }
    }
  }

  private async sendBreed(engine: Engine, job: Engine["pendingBreeds"][number]) {
    const epoch = this.epoch;
    const child = engine.agents.get(job.childId);
    if (!child) return;
    const model = engine.modelFor(child);
    this.breedInflight++;
    child.creedPending = true;
    try {
      const res = await post<BreedResponse>("/api/breed", {
        model,
        parentA: { name: job.parentA.name, creed: job.parentA.genome.creed, traits: job.parentA.genome.traits },
        parentB: { name: job.parentB.name, creed: job.parentB.genome.creed, traits: job.parentB.genome.traits },
        childTraits: child.genome.traits,
        mutationRate: engine.params.mutationRate,
      });
      if (epoch !== this.epoch) return;
      this.observe(this.perBreed, model, this.track(engine, model, res.usage), 1);
      child.genome.creed = res.creed;
      if (res.name && res.name !== child.name) {
        engine.logEvent("mind", `${child.name} is now called ${res.name}`, child.id);
        child.name = res.name;
      }
    } catch (err) {
      if (epoch === this.epoch) this.fail(engine, err);
    } finally {
      if (epoch === this.epoch) this.breedInflight--;
      child.creedPending = false;
    }
  }

  private async sendJudge(engine: Engine, batch: Engine["pendingInsights"], norms: Engine["pendingNorms"]) {
    const epoch = this.epoch;
    // The judge runs on the default model: it's checking claims, not playing a tribe.
    const model = engine.params.model;
    this.judgeInflight++;
    try {
      const res = await post<JudgeResponse>("/api/judge", {
        model,
        insights: batch.map((b, i) => ({ id: i, text: b.text })),
        norms: norms.map((n, i) => ({ id: i, text: n.text })),
      });
      if (epoch !== this.epoch) return;
      this.track(engine, model, res.usage);
      for (const v of res.verdicts) {
        const b = batch[v.id];
        if (b) engine.applyInsight(b.agentId, b.text, v.kind, v.accurate);
      }
      for (const ne of res.normEffects ?? []) {
        const n = norms[ne.id];
        if (n) engine.applyNormEffects(n.groupId, n.text, Object.fromEntries(TRAIT_KEYS.map((k) => [k, ne[k]])) as Traits);
      }
    } catch (err) {
      if (epoch === this.epoch) this.fail(engine, err);
    } finally {
      if (epoch === this.epoch) this.judgeInflight--;
    }
  }

  /** Adds a call's cost to the running total and returns that cost. */
  private track(engine: Engine, model: string, u: Usage): number {
    const m = MODELS.find((x) => x.id === model) ?? MODELS[0];
    const wasUnder = this.canSpend(engine);
    this.requests++;
    this.tokens.input += u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
    this.tokens.output += u.outputTokens;
    const usd =
      (u.inputTokens * m.inPerM + u.cacheWriteTokens * m.inPerM * 1.25 + u.cacheReadTokens * m.cacheReadPerM + u.outputTokens * m.outPerM) / 1e6;
    this.spentUsd += usd;
    if (wasUnder && !this.canSpend(engine)) {
      engine.logEvent("system", `Budget of $${engine.params.budgetUsd.toFixed(2)} reached. Minds fall silent; instinct takes over.`);
    }
    return usd;
  }

  private observe(map: Map<string, { usd: number; n: number }>, key: string, usd: number, n: number) {
    const cur = map.get(key) ?? { usd: 0, n: 0 };
    map.set(key, { usd: cur.usd + usd, n: cur.n + n });
  }

  /** USD per historian report on a model: measured once one has been written, else a prior of ~8k tokens in, ~4k out. */
  reportCost(model: string): { usd: number; measured: boolean } {
    const obs = this.perReport.get(model);
    if (obs?.n) return { usd: obs.usd / obs.n, measured: true };
    const m = MODELS.find((x) => x.id === model) ?? MODELS[0];
    return { usd: (8000 * m.inPerM + 4000 * m.outPerM) / 1e6, measured: false };
  }

  /** USD for one agent-decision at this model and effort: measured once we have data, else a prior. */
  private decisionCost(model: string, effort: Effort): number {
    const obs = this.perDecision.get(`${model}:${effort}`);
    if (obs && obs.n >= 16) return obs.usd / obs.n;
    const m = MODELS.find((x) => x.id === model) ?? MODELS[0];
    const out = { low: 320, medium: 700, high: 1500 }[effort];
    return (1400 * m.inPerM + out * m.outPerM) / 1e6;
  }

  /**
   * Estimated USD per 100 ticks at the current settings and population, summing each thinking
   * agent's rate (by stage) times the cost of a decision at its tribe's model and stage's effort.
   */
  estimate(engine: Engine): { usdPer100: number; decisionsPer100: number; measured: boolean } {
    const p = engine.params;
    let usdPer100 = 0;
    let decisionsPer100 = 0;
    let measured = true;
    for (const a of engine.agents.values()) {
      if (!engine.thinks(a)) continue;
      const model = engine.modelFor(a);
      const effort = engine.effortFor(a);
      const rate = 100 / engine.thinkIntervalFor(a);
      decisionsPer100 += rate;
      usdPer100 += rate * this.decisionCost(model, effort);
      if ((this.perDecision.get(`${model}:${effort}`)?.n ?? 0) < 16) measured = false;
    }
    if (p.llmBreeding && decisionsPer100 > 0) {
      const recent = engine.stats.slice(-100);
      const births = (recent.reduce((s, x) => s + x.births, 0) / Math.max(1, recent.length)) * 100;
      const b = this.perBreed.get(p.model);
      const m = MODELS.find((x) => x.id === p.model) ?? MODELS[0];
      usdPer100 += births * (b && b.n >= 4 ? b.usd / b.n : (600 * m.inPerM + 200 * m.outPerM) / 1e6);
    }
    return { usdPer100, decisionsPer100, measured };
  }

  private fail(engine: Engine, err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    this.lastError = msg;
    if (err instanceof HttpError && (err.status === 401 || err.status === 400)) {
      engine.params.brain = "instinct";
      this.onFatal(msg);
    }
  }
}

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(json.error ?? `HTTP ${res.status}`, res.status);
  return json as T;
}
