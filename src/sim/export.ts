import { TECHS } from "../../shared/tech";
import { DOMAINS, TRAIT_KEYS } from "../../shared/types";
import type { Engine } from "./engine";
import { levelOf, totalLevels } from "./knowledge";
import { judge } from "./religion";

export const EXPORT_VERSION = 1;

/**
 * A complete, JSON-serialisable record of a run for offline analysis: the full time series, the
 * running tallies, the archive of important events, the historian's reports, and snapshots of
 * peoples, organizations, faiths, the dead and the living. Read it with `npm run analyze -- file.json`.
 */
export function exportRun(e: Engine) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const traitsOf = (t: Record<string, number>) => Object.fromEntries(TRAIT_KEYS.map((k) => [k, r2(t[k])]));
  const counts = e.tribeCounts();
  const religionFollowers = new Map<number, number>();
  for (const a of e.agents.values()) if (a.religion !== null) religionFollowers.set(a.religion, (religionFollowers.get(a.religion) ?? 0) + 1);
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    tick: e.tick,
    scenario: e.scenario ? { title: e.scenario.title, description: e.scenario.description, locked: !!e.scenario.locked } : { title: "Random world", description: "" },
    params: e.params,
    tally: e.tally,
    emigrated: e.emigrated,
    stats: e.stats,
    events: e.archive,
    annals: e.annals.map((a) => ({ fromTick: a.fromTick, tick: a.tick, model: a.model, signals: a.signals, report: a.report })),
    knowledgeByGeneration: e.knowledgeGenerations(),
    techTable: Object.fromEntries([...e.techTable].map(([id, t]) => [id, { name: TECHS[id].name, ...t }])),
    tribes: [...e.canons.entries()].map(([name, c]) => ({
      name,
      alive: counts[name] ?? 0,
      canon: Object.fromEntries(DOMAINS.map((d) => [d, levelOf(c.understanding[d])])),
      inventions: [...c.techs],
      sayings: [...c.beliefs].sort((x, y) => y.taught - x.taught).slice(0, 10).map((b) => ({ text: b.text, kind: b.kind, accurate: b.accurate, taught: b.taught })),
      language: e.languages.get(name)?.map(r2),
    })),
    organizations: [...e.groups.values()].map((g) => ({
      id: g.id,
      name: g.name,
      purpose: g.purpose,
      founded: g.foundedTick,
      members: g.members.size,
      leader: e.agents.get(g.leaderId)?.name ?? null,
      crisis: g.crisis ? { since: g.crisis.since, reason: g.crisis.reason } : null,
      aim: g.aim,
      project: g.project,
      war: g.war,
      overlord: g.overlordId !== null ? e.groups.get(g.overlordId)?.name ?? null : null,
      relation: g.relation,
      cohesion: r2(g.cohesion),
      store: g.store,
      norms: g.norms.map((n) => ({ text: n.text, effects: n.effects, author: n.author, tick: n.tick })),
      leaders: g.leaders.slice(-12),
    })),
    religions: [...e.religions.values()].map((r) => ({
      ...r,
      followers: religionFollowers.get(r.id) ?? 0,
      heaven: { name: r.heaven, believedEntered: e.hallOfDead.filter((d) => d.religion === r.name && d.verdict === "heaven").length },
      hell: { name: r.hell, feared: e.hallOfDead.filter((d) => d.religion === r.name && d.verdict === "hell").length },
    })),
    hallOfDead: e.hallOfDead.slice(-600),
    population: [...e.agents.values()].map((a) => ({
      id: a.id,
      name: a.name,
      tribe: a.tribe,
      stage: a.stage,
      age: a.age,
      lifespan: a.lifespan,
      generation: a.generation,
      inborn: traitsOf(a.genome.traits),
      expressed: traitsOf(a.traits),
      creed: a.genome.creed,
      religion: a.religion !== null ? e.religions.get(a.religion)?.name ?? null : null,
      faith: r2(a.faith),
      expects: a.religion !== null ? judge(e.religions.get(a.religion)!.code, a.ledger).verdict : null,
      organization: a.groupId !== null ? e.groups.get(a.groupId)?.name ?? null : null,
      follows: a.follows,
      followers: a.followers,
      reputation: r2(a.reputation),
      craft: a.craft,
      inventions: [...a.techs],
      knowledge: totalLevels(a.understanding),
      ledger: a.ledger,
      fields: a.fields.length,
    })),
  };
}

export type RunExport = ReturnType<typeof exportRun>;
