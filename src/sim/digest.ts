import { TECHS } from "../../shared/tech";
import { truthAt, TRUTHS } from "../../shared/truths";
import { DOMAINS, STAGES, TRAIT_KEYS, type Report } from "../../shared/types";
import { repWord, type Agent, type Engine, type StatSample } from "./engine";
import { describeTraits } from "./genome";
import { levelOf, totalLevels } from "./knowledge";

export interface AnnalEntry {
  tick: number;
  fromTick: number;
  report: Report | null;
  /** Early-warning signals computed from the numbers alone; shown even without the historian. */
  signals: string[];
  status: "writing" | "done" | "offline" | "error";
  error?: string;
  /** Model that wrote the report. */
  model?: string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmt = (v: number) => (Math.abs(v) >= 10 ? Math.round(v).toString() : v.toFixed(2));

/** Sum of a per-tick count over a window of stats samples. */
function total(samples: StatSample[], key: "births" | "deaths" | "trades" | "betrayals") {
  return samples.reduce((s, x) => s + (x[key] ?? 0), 0);
}

function sampleAt(stats: StatSample[], tick: number): StatSample {
  return stats.find((s) => s.tick >= tick) ?? stats[0];
}

/** Heuristic early warnings, comparing now with the start of the period. */
export function signals(e: Engine, fromTick: number): string[] {
  const stats = e.stats;
  const now = stats.at(-1)!;
  const then = sampleAt(stats, fromTick);
  const period = stats.filter((s) => s.tick > fromTick);
  const out: string[] = [];
  const popChange = then.population ? (now.population - then.population) / then.population : 0;
  if (now.population === 0) return ["All life has ended."];
  if (popChange < -0.25) out.push(`Population fell ${pct(-popChange)} this period.`);
  if (popChange > 0.5) out.push(`Population boomed ${pct(popChange)} this period.`);
  const emigrants = period.reduce((x, s) => x + (s.emigrants ?? 0), 0);
  if (emigrants >= 10) out.push(`${emigrants} people left the known world this period: the land is not feeding everyone.`);
  const crises = [...e.groups.values()].filter((g) => g.crisis);
  if (crises.length) out.push(`${crises.length} organization${crises.length === 1 ? " is" : "s are"} torn by power struggles: ${crises.slice(0, 3).map((g) => g.name).join(", ")}.`);
  const avgSoil = (() => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < e.world.fieldOwner.length; i++) if (e.world.fieldOwner[i]) { sum += e.world.soil[i]; n++; }
    return n ? sum / n : 1;
  })();
  if (avgSoil < 0.5) out.push(`The fields are worn out (soil health ${pct(avgSoil)}).`);
  if (now.avgEnergy < then.avgEnergy - 10 || now.avgEnergy < 40) out.push(`Hunger is rising (average energy ${Math.round(now.avgEnergy)}).`);
  if (now.stages.elder > now.stages.adult) out.push("Elders outnumber adults: an ageing society with few providers.");
  if (now.stages.child < now.population * 0.08) out.push("Very few children are being born or surviving.");
  const t = total(period, "trades");
  const honest = t ? 1 - total(period, "betrayals") / t : 1;
  if (t >= 10 && honest < 0.6) out.push(`Trust is collapsing: only ${pct(honest)} of trades were honoured.`);
  if (now.knowledge <= then.knowledge && fromTick > 0) out.push("Knowledge has stopped growing.");
  if (now.population && now.largestGroup / now.population > 0.6) out.push("One organization holds most of the world.");
  if (now.groups >= 8 && now.largestGroup < now.population * 0.2) out.push("Society is fragmented into many small groups.");
  if (now.following < 0.2) out.push("Few follow anyone: a world of independents.");
  for (const [tribe, n] of Object.entries(now.tribes)) if (n <= 4 && (then.tribes[tribe] ?? 0) > n) out.push(`The ${tribe} are near extinction (${n} left).`);
  for (const tribe of Object.keys(then.tribes)) if (!now.tribes[tribe]) out.push(`The ${tribe} died out.`);
  const myths = new Set([...e.agents.values()].flatMap((a) => a.beliefs.filter((b) => !b.accurate && b.kind !== "meaning").map((b) => b.text)));
  if (myths.size >= 3) out.push(`${myths.size} mistaken beliefs are in circulation.`);
  if (e.world.hazards.some((h) => h.kind === "plague")) out.push("Plague is active.");
  if (e.world.hazards.some((h) => h.kind === "drought")) out.push("Drought is active.");
  return out;
}

function profile(e: Engine, a: Agent): string {
  const g = e.group(a);
  const lv = DOMAINS.map((d) => `${TRUTHS[d].label.slice(0, 4)} ${levelOf(a.understanding[d])}`).join(", ");
  return (
    `${a.name} (${a.stage}${a.frailty > 0.65 ? ", frail" : ""}, age ${a.age} of a likely ${a.lifespan}, ${a.tribe}${g ? `, ${g.leaderId === a.id ? "leads" : "member of"} ${g.name}` : ""}): ` +
    `${describeTraits(a.traits)}; ${a.followers} direct followers, ${a.influence} total; ${repWord(a.reputation)}; ` +
    `${a.kills} kills, ${a.gifts} gifts, ${a.children} children; knowledge [${lv}]` +
    `${a.craft ? `; ${a.craft}-maker` : ""}${a.thought ? `; recently thought: "${a.thought}"` : ""}. Creed: "${a.genome.creed.slice(0, 160)}"`
  );
}

/** The historian's briefing: everything it needs to analyse the period since its last report. */
export function buildDigest(e: Engine, fromTick: number, previous: Report | null): string {
  const stats = e.stats;
  const now = stats.at(-1)!;
  const then = sampleAt(stats, fromTick);
  const mid = sampleAt(stats, Math.round((fromTick + e.tick) / 2));
  const period = stats.filter((s) => s.tick > fromTick);
  const lines: string[] = [];
  const push = (...xs: string[]) => lines.push(...xs);

  push(
    `WORLD: ${e.scenario?.title ?? "A random world"}${e.scenario?.description ? ` — ${e.scenario.description}` : ""}`,
    `Now: tick ${e.tick} (${e.world.seasonName(e.tick)}). This report covers ticks ${fromTick}–${e.tick}. A lifetime is ${e.params.lifespanMin}–${e.params.lifespanMax} ticks; a generation roughly ${Math.round(((e.params.lifespanMin + e.params.lifespanMax) / 2) * e.params.adolescenceEnd + e.params.reproductionCooldown)}.`,
    `Agents decide by ${e.params.brain === "hybrid" ? `instinct plus Claude minds (${pct(e.params.mindShare)} have minds)` : "instinct alone (temperament-driven)"}.${e.scenario?.locked ? " This is an observation-only experiment: no outside intervention." : ""}`,
    "",
    "KEY NUMBERS (start of period → middle → now):",
  );
  const row = (label: string, f: (s: StatSample) => number, show = fmt) => push(`- ${label}: ${show(f(then))} → ${show(f(mid))} → ${show(f(now))}`);
  row("Population", (s) => s.population);
  const plural = { child: "children", adolescent: "adolescents", adult: "adults", elder: "elders" } as const;
  push(`- By stage now: ${STAGES.map((st) => `${now.stages[st]} ${plural[st]}`).join(", ")}`);
  row("Average energy (food security, of 100)", (s) => s.avgEnergy);
  push(`- Births / deaths this period: ${total(period, "births")} / ${total(period, "deaths")}. Deepest generation: ${now.maxGeneration}.`);
  row("Life expectancy of grown-ups (ticks)", (s) => s.lifeExpectancy ?? 0);
  const deaths = total(period, "deaths");
  const deathAge = period.reduce((x, s) => x + (s.deathAgeSum ?? 0), 0);
  const killings = period.reduce((x, s) => x + (s.kills ?? 0), 0);
  push(`- Average age at death this period: ${deaths ? Math.round(deathAge / deaths) : "—"} (inborn potential is ${e.params.lifespanMin}–${e.params.lifespanMax}). Killings: ${killings}.`);
  push(`- Left the known world this period: ${period.reduce((x, s) => x + (s.emigrants ?? 0), 0)} (all time: ${e.emigrated}).`);
  row("Share of grown-ups who farm", (s) => s.farmers ?? 0, pct);
  row("Fields under cultivation", (s) => s.fields ?? 0);
  row("Food in storage (rations held plus common stores)", (s) => s.storedFood ?? 0);
  row("Inventions known by the most advanced tribe (of 16)", (s) => s.techs ?? 0);
  row("Share of grown-ups researching", (s) => s.researchers ?? 0, pct);
  row("Share of grown-ups who can read and write", (s) => s.literacy ?? 0, pct);
  row("Distinct languages spoken", (s) => s.languages ?? 0);
  row("Organizations at war", (s) => s.wars ?? 0);
  row("Peoples (tribes) alive", (s) => s.tribeCount ?? 0);
  row("Living faiths", (s) => s.religions ?? 0);
  row("Share of grown-ups who hold a faith", (s) => s.faithful ?? 0, pct);
  row("Largest realm (members incl. vassals and allies)", (s) => s.largestRealm ?? 0);
  row("Diversity of inborn temperament (spread)", (s) => s.traitDiversity ?? 0);
  row("Distinct norms in organizations", (s) => s.norms ?? 0);
  row("Knowledge of the average person (levels)", (s) => s.knowledge);
  row("Best tribe's canon (levels)", (s) => s.canon);
  const t = total(period, "trades");
  push(`- Trades this period: ${t}, of which ${pct(t ? 1 - total(period, "betrayals") / t : 1)} were honoured by both sides.`);
  row("Average standing (0-1)", (s) => s.avgReputation);
  row("Organizations", (s) => s.groups);
  row("Share of grown-ups in an organization", (s) => s.inGroups, pct);
  row("Largest organization (members)", (s) => s.largestGroup);
  row("Share of grown-ups who follow someone", (s) => s.following, pct);
  row("Largest following (direct + indirect)", (s) => s.topInfluence);
  row("Distinct ideas in circulation (beliefs and norms)", (s) => s.ideas);
  push(`- Inborn temperament drift: ${TRAIT_KEYS.map((k) => `${k} ${fmt(then.traits[k])}→${fmt(now.traits[k])}`).join(", ")}`);
  push(`- Expressed temperament now (after age, experience and culture): ${TRAIT_KEYS.map((k) => `${k} ${fmt(now.expressed[k])}`).join(", ")}`);

  const dead = e.graveyard.filter((g) => (g.diedAt ?? 0) > fromTick);
  const causes: Record<string, number> = {};
  for (const d of dead) {
    const c = `${(d.causeOfDeath ?? "").replace(/ (by|fighting) .*/, "")} (${d.stage})`;
    causes[c] = (causes[c] ?? 0) + 1;
  }
  push(`- Causes of death: ${Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);

  push("", "TRIBES:");
  for (const [tribe, n] of Object.entries(now.tribes).sort((a, b) => b[1] - a[1])) {
    const canon = e.canons.get(tribe);
    const levels = canon ? DOMAINS.map((d) => `${TRUTHS[d].label} ${levelOf(canon.understanding[d])}`).join(", ") : "none";
    const sayings = canon ? [...canon.beliefs].sort((x, y) => y.taught - x.taught).slice(0, 4) : [];
    push(
      `- ${tribe}: ${then.tribes[tribe] ?? 0} → ${n}. Canon: ${levels}.` +
        (sayings.length ? ` Repeated sayings: ${sayings.map((b) => `"${b.text}" [${b.kind === "meaning" ? "meaning" : b.accurate ? "true" : "MYTH"}]`).join("; ")}` : ""),
    );
  }
  for (const [tribe] of Object.entries(now.tribes)) {
    const techs = [...(e.canons.get(tribe)?.techs ?? [])].map((t) => TECHS[t].name);
    if (techs.length) push(`- ${tribe} know: ${techs.join(", ")}.`);
  }
  const deepest = DOMAINS.map((d) => ({ d, l: Math.max(0, ...[...e.canons.values()].map((c) => levelOf(c.understanding[d]))) })).filter((x) => x.l > 0);
  if (deepest.length) push(`- Deepest truths anyone has codified: ${deepest.map(({ d, l }) => `"${truthAt(d, l)}"`).join(" ")}`);

  const groups = [...e.groups.values()].sort((a, b) => b.members.size - a.members.size).slice(0, 8);
  push("", `ORGANIZATIONS (${e.groups.size} in all, largest first):`);
  if (!groups.length) push("- None.");
  for (const g of groups) {
    const leader = e.leaderOf(g);
    const members = [...g.members].map((id) => e.agents.get(id)).filter((m): m is Agent => !!m);
    const tribes: Record<string, number> = {};
    for (const m of members) tribes[m.tribe] = (tribes[m.tribe] ?? 0) + 1;
    const aim = g.war ? `AT WAR with ${g.war.name} since t${g.war.since}` : g.aim === "research" && g.project ? `researching ${TECHS[g.project.tech].name} (${Math.round((g.project.progress / TECHS[g.project.tech].cost) * 100)}%)` : g.aim ?? "no shared aim";
    push(`- ${g.name}: aim — ${aim}.`);
    push(
      `- ${g.name} (founded t${g.foundedTick}${g.purpose ? `, purpose: "${g.purpose}"` : ""}): ${g.members.size} members (${Object.entries(tribes).map(([k, v]) => `${v} ${k}`).join(", ")}); ` +
        `common store ${g.store.rations} rations; ${g.leaders.length} leaders so far (recent: ${g.leaders.slice(-3).map((l) => `${l.name} from t${l.from}, ${l.how}`).join("; ")}). ` +
        `Named heir: ${g.heirId !== null ? e.agents.get(g.heirId)?.name ?? "none" : "none"}. ` +
        `Norms: ${g.norms.map((n) => `"${n.text}"`).join(" ") || "none"}.`,
    );
    if (leader) push(`  Leader: ${profile(e, leader)}`);
  }

  const faiths = new Map<number, number>();
  for (const a of e.agents.values()) if (a.religion !== null) faiths.set(a.religion, (faiths.get(a.religion) ?? 0) + 1);
  if (faiths.size) {
    push("", "FAITHS (belief only: what the living hold, and where the dead believed they were going):");
    for (const [id, n] of [...faiths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      const r = e.religions.get(id)!;
      const dead = e.hallOfDead.filter((d) => d.religion === r.name && d.tick > fromTick);
      push(`- ${r.name} (founded t${r.founded} by ${r.founderName}, ${n} believers${r.watchful ? ", a watchful god" : ""}): "${r.doctrine}" Of its dead this period: ${dead.filter((d) => d.verdict === "heaven").length} believed bound for ${r.heaven}, ${dead.filter((d) => d.verdict === "hell").length} feared ${r.hell}.`);
    }
  }
  const realms = [...e.groups.values()].filter((g) => g.overlordId === null && [...e.groups.values()].some((x) => x.overlordId === g.id));
  if (realms.length) {
    push("", "REALMS:");
    for (const g of realms.slice(0, 5)) {
      const subs = e.realmMembers(g).slice(1);
      push(`- ${g.name} rules ${subs.filter((x) => x.relation === "vassal").map((x) => x.name).join(", ") || "no vassals"}${subs.some((x) => x.relation === "ally") ? `; allies: ${subs.filter((x) => x.relation === "ally").map((x) => x.name).join(", ")}` : ""}.`);
    }
  }
  const struggles = [...e.groups.values()].filter((g) => g.crisis);
  if (struggles.length) {
    push("", "POWER STRUGGLES UNDER WAY:");
    for (const g of struggles) {
      const cs = g.crisis!.claimants.map((id) => e.agents.get(id)).filter((c): c is Agent => !!c);
      push(`- ${g.name} since t${g.crisis!.since} (${g.crisis!.reason}): ${cs.map((c) => profile(e, c)).join(" | VERSUS | ")}`);
    }
  }
  push("", `POLITICS SO FAR (running totals): ${Object.entries(e.tally).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`);

  const influential = [...e.agents.values()].filter((a) => a.influence > 0).sort((a, b) => b.influence - a.influence).slice(0, 6);
  push("", "MOST INFLUENTIAL INDIVIDUALS:");
  for (const a of influential) push(`- ${profile(e, a)}`);
  const knowing = [...e.agents.values()].sort((a, b) => totalLevels(b.understanding) - totalLevels(a.understanding)).slice(0, 2);
  for (const a of knowing) if (!influential.includes(a)) push(`- (most knowledgeable) ${profile(e, a)}`);

  const events = e.log.filter((l) => l.tick > fromTick);
  const important = events.filter((l) => ["society", "world", "insight", "system", "invention"].includes(l.kind) || (l.kind === "trade" && l.text.includes("stole")));
  const kills = events.filter((l) => l.kind === "fight" && l.text.includes("killed"));
  const cheats = events.filter((l) => l.kind === "trade" && l.text.includes("cheated"));
  push("", `NOTABLE EVENTS THIS PERIOD (${important.length} shown; also ${kills.length} killings and ${cheats.length} reported cheats):`);
  for (const l of important.slice(-70)) push(`- t${l.tick} ${l.text}`);
  for (const l of kills.slice(-8)) push(`- t${l.tick} ${l.text}`);
  const speech = events.filter((l) => l.kind === "speech").slice(-10);
  if (speech.length) push("", "THINGS SAID ALOUD RECENTLY:", ...speech.map((l) => `- t${l.tick} ${l.text}`));

  const sig = signals(e, fromTick);
  if (sig.length) push("", "WARNING SIGNS FROM THE NUMBERS:", ...sig.map((x) => `- ${x}`));

  if (previous)
    push(
      "",
      "YOUR PREVIOUS REPORT:",
      `Title: ${previous.title} (era: ${previous.era})`,
      `Risks you named: ${previous.risks.map((r) => `${r.label} (${r.likelihood})`).join("; ")}`,
      `Your predictions: ${previous.predictions.map((p) => `"${p}"`).join(" ")}`,
    );
  return lines.join("\n");
}
