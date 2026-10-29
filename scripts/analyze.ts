// Summarises exported runs (the "Export run" button, or `npm run sim -- ... --export file.json`).
// One file: how the world changed over time. Several files: how far the worlds diverged from each other.
// Usage: npm run analyze -- run1.json [run2.json ...]
import fs from "node:fs";
import { TRAIT_KEYS } from "../shared/types";
import type { RunExport } from "../src/sim/export";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: npm run analyze -- run1.json [run2.json ...]");
  process.exit(1);
}
const runs = files.map((f) => ({ file: f, run: JSON.parse(fs.readFileSync(f, "utf8")) as RunExport }));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const f2 = (v: number | undefined) => (v === undefined ? "–" : Math.abs(v) >= 10 ? Math.round(v).toString() : v.toFixed(2));

for (const { file, run } of runs) {
  console.log(`\n=== ${file}: ${run.scenario.title}, tick ${run.tick}`);
  const stats = run.stats;
  const step = Math.max(1, Math.floor(stats.length / 8));
  console.log("tick  | pop  | peoples | tongues | trait div | norms | faiths | faithful | inventions | literate | orgs | realm | wars");
  for (let i = 0; i < stats.length; i += step) {
    const s = stats[i];
    console.log(
      [s.tick, s.population, s.tribeCount, s.languages, f2(s.traitDiversity), s.norms, s.religions, pct(s.faithful ?? 0), s.techs, pct(s.literacy ?? 0), s.groups, s.largestRealm, s.wars]
        .map((v) => String(v ?? "–").padEnd(5))
        .join(" | "),
    );
  }
  console.log("tallies:", Object.entries(run.tally).map(([k, v]) => `${k} ${v}`).join(", "));
  const pop = run.population;
  if (pop.length) {
    const mean = Object.fromEntries(TRAIT_KEYS.map((k) => [k, pop.reduce((x, a) => x + a.inborn[k], 0) / pop.length]));
    console.log("inborn temperament now:", TRAIT_KEYS.map((k) => `${k} ${f2(mean[k])}`).join(", "));
  }
  const faiths = run.religions.filter((r) => r.followers > 0).sort((a, b) => b.followers - a.followers).slice(0, 4);
  for (const r of faiths) console.log(`faith: ${r.name} (${r.followers} followers) — ${r.doctrine}`);
  const realms = run.organizations.filter((o) => !o.overlord).sort((a, b) => b.members - a.members).slice(0, 3);
  for (const o of realms) console.log(`organization: ${o.name} (${o.members}${o.war ? `, at war with ${o.war.name}` : ""}${o.aim ? `, aim ${o.aim}` : ""}) norms: ${o.norms.map((n) => n.text).join(" | ")}`);
}

if (runs.length > 1) {
  console.log("\n=== DIVERGENCE BETWEEN WORLDS (final state)");
  const finals = runs.map(({ file, run }) => {
    const pop = run.population;
    const mean = Object.fromEntries(TRAIT_KEYS.map((k) => [k, pop.length ? pop.reduce((x, a) => x + a.inborn[k], 0) / pop.length : 0]));
    return { file, mean, last: run.stats.at(-1)!, inventions: new Set(run.tribes.flatMap((t) => t.inventions)), norms: new Set(run.organizations.flatMap((o) => o.norms.map((n) => n.text))) };
  });
  for (const k of TRAIT_KEYS) {
    const v = finals.map((x) => x.mean[k]);
    console.log(`${k.padEnd(12)} range across worlds ${f2(Math.max(...v) - Math.min(...v))}  (${v.map(f2).join(", ")})`);
  }
  const shared = [...finals[0].inventions].filter((t) => finals.every((x) => x.inventions.has(t)));
  console.log(`inventions shared by every world: ${shared.length}; per world: ${finals.map((x) => x.inventions.size).join(", ")}`);
  const allNorms = new Set(finals.flatMap((x) => [...x.norms]));
  console.log(`distinct norms across all worlds: ${allNorms.size}; held in every world: ${[...allNorms].filter((n) => finals.every((x) => x.norms.has(n))).length}`);
  console.log(`peoples at end: ${finals.map((x) => x.last.tribeCount).join(", ")}; faiths: ${finals.map((x) => x.last.religions).join(", ")}; tongues: ${finals.map((x) => x.last.languages).join(", ")}`);
}
