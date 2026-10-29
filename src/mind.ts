import { MODELS, type BreedResponse, type ThinkResponse, type Usage } from "../shared/types";
import type { Engine } from "./sim/engine";

/**
 * Bridges the simulation to Claude. Each tick it sends the most overdue agents to /api/think in
 * batches, within the concurrency limit and spend budget. Agents keep acting on instinct while a
 * thought is in flight, so the world never stalls (unless the player turns on lockstep).
 */
export class Mind {
  inflight = 0;
  breedInflight = 0;
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
    this.lastError = null;
  }

  canSpend(engine: Engine) {
    return this.spentUsd < engine.params.budgetUsd;
  }

  /** Called once per tick. */
  pump(engine: Engine) {
    const p = engine.params;
    if (p.brain !== "hybrid" || !this.canSpend(engine)) {
      engine.pendingBreeds.length = 0;
      return;
    }
    while (this.inflight < p.maxConcurrentRequests) {
      const batch = engine.dueThinkers(p.thinkBatchSize);
      if (!batch.length) break;
      for (const a of batch) a.thinking = true;
      this.sendThink(engine, batch.map((a) => a.id));
    }
    if (p.llmBreeding) {
      while (engine.pendingBreeds.length && this.breedInflight < 2) this.sendBreed(engine, engine.pendingBreeds.shift()!);
      // Under a baby boom, older births keep their locally spliced creed.
      if (engine.pendingBreeds.length > 12) engine.pendingBreeds.splice(0, engine.pendingBreeds.length - 12);
    } else engine.pendingBreeds.length = 0;
  }

  private async sendThink(engine: Engine, ids: number[]) {
    const epoch = this.epoch;
    this.inflight++;
    const agents = ids.map((id) => engine.agents.get(id)).filter((a) => !!a);
    try {
      const res = await post<ThinkResponse>("/api/think", {
        model: engine.params.model,
        effort: engine.params.effort,
        tick: engine.tick,
        worldSummary: engine.worldSummary(),
        worldEvents: engine.worldEvents.map((e) => e.text),
        agents: agents.map((a) => engine.perceive(a)),
      });
      if (epoch !== this.epoch) return;
      const usd = this.track(engine, res.usage);
      this.observe(this.perDecision, engine, usd, Math.max(1, agents.length));
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
    this.breedInflight++;
    child.creedPending = true;
    try {
      const res = await post<BreedResponse>("/api/breed", {
        model: engine.params.model,
        parentA: { name: job.parentA.name, creed: job.parentA.genome.creed, traits: job.parentA.genome.traits },
        parentB: { name: job.parentB.name, creed: job.parentB.genome.creed, traits: job.parentB.genome.traits },
        childTraits: child.genome.traits,
        mutationRate: engine.params.mutationRate,
      });
      if (epoch !== this.epoch) return;
      this.observe(this.perBreed, engine, this.track(engine, res.usage), 1);
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

  /** Adds a call's cost to the running total and returns that cost. */
  private track(engine: Engine, u: Usage): number {
    const m = MODELS.find((x) => x.id === engine.params.model) ?? MODELS[0];
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

  private observe(map: Map<string, { usd: number; n: number }>, engine: Engine, usd: number, n: number) {
    const key = `${engine.params.model}:${engine.params.effort}`;
    const cur = map.get(key) ?? { usd: 0, n: 0 };
    map.set(key, { usd: cur.usd + usd, n: cur.n + n });
  }

  /**
   * Estimated USD per 100 ticks at the current settings and population. Uses measured cost per
   * decision once a few calls have come back, otherwise a rough prior of ~1100 input and
   * (effort-dependent) output tokens per agent-decision.
   */
  estimate(engine: Engine): { usdPer100: number; decisionsPer100: number; measured: boolean } {
    const p = engine.params;
    const m = MODELS.find((x) => x.id === p.model) ?? MODELS[0];
    const key = `${p.model}:${p.effort}`;
    const obs = this.perDecision.get(key);
    const measured = !!obs && obs.n >= 16;
    const outPrior = { low: 320, medium: 700, high: 1500 }[p.effort];
    const perDecision = measured ? obs!.usd / obs!.n : (1100 * m.inPerM + outPrior * m.outPerM) / 1e6;
    const decisionsPer100 = (engine.mindCount() / p.thinkInterval) * 100;
    let usdPer100 = decisionsPer100 * perDecision;
    if (p.llmBreeding) {
      const recent = engine.stats.slice(-100);
      const births = (recent.reduce((s, x) => s + x.births, 0) / Math.max(1, recent.length)) * 100;
      const b = this.perBreed.get(key);
      const perBreed = b && b.n >= 4 ? b.usd / b.n : (400 * m.inPerM + outPrior * 0.6 * m.outPerM) / 1e6;
      usdPer100 += births * perBreed;
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
