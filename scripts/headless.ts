// Runs the simulation without a browser, in instinct mode, to check ecosystem balance.
// Usage: npm run sim -- [ticks] [seed] [preset name | petri | random] [--export run.json]
import fs from "node:fs";
import { Engine } from "../src/sim/engine";
import { exportRun } from "../src/sim/export";
import { PETRI_DEFAULTS, petriDish, PRESETS } from "../src/sim/presets";

const ticks = Number(process.argv[2] ?? 1500);
const seed = Number(process.argv[3] ?? 7);
const exportIdx = process.argv.indexOf("--export");
const exportPath = exportIdx > 0 ? process.argv[exportIdx + 1] : null;
const presetName = process.argv[4] && process.argv[4] !== "random" && !process.argv[4].startsWith("--") ? process.argv[4] : undefined;
const preset =
  presetName === "petri"
    ? petriDish({ ...PETRI_DEFAULTS, seed })
    : presetName
      ? PRESETS.find((p) => p.title.toLowerCase().startsWith(presetName.toLowerCase())) ?? null
      : null;
const e = new Engine(preset ? {} : { seed }, preset);
const t0 = performance.now();
let trades = 0;
let betrayals = 0;
let dAge = 0;
let dN = 0;
let kills = 0;
let emig = 0;
for (let i = 0; i < ticks; i++) {
  e.step();
  const s = e.stats.at(-1)!;
  trades += s.trades;
  betrayals += s.betrayals;
  dAge += s.deathAgeSum;
  dN += s.deaths;
  kills += s.kills;
  emig += s.emigrants;
  if (e.tick % 100 === 0) {
    const st = s.stages;
    const tribes = Object.entries(s.tribes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(" ");
    console.log(
      `t${e.tick} pop=${s.population} (c${st.child} a${st.adolescent} A${st.adult} e${st.elder}) gen=${s.maxGeneration} E=${s.avgEnergy.toFixed(0)}` +
        ` know=${s.knowledge.toFixed(1)} canon=${s.canon} trades=${trades} cheat=${trades ? ((betrayals / trades) * 100).toFixed(0) : 0}%` +
        ` | groups=${s.groups} inGroups=${(s.inGroups * 100).toFixed(0)}% largest=${s.largestGroup} following=${(s.following * 100).toFixed(0)}%` +
        ` | lifeExp=${s.lifeExpectancy.toFixed(0)} deathAge=${dN ? (dAge / dN).toFixed(0) : "-"} kills=${kills}` +
        ` | farmers=${(s.farmers * 100).toFixed(0)}% techs=${s.techs} research=${(s.researchers * 100).toFixed(0)}% literate=${(s.literacy * 100).toFixed(0)}% langs=${s.languages} wars=${s.wars} emigrated=${emig} crises=${s.crises} | ${tribes}`,
    );
    trades = betrayals = dAge = dN = kills = emig = 0;
  }
  if (!e.agents.size) {
    console.log(`extinct at t${e.tick}`);
    break;
  }
}
const causes: Record<string, number> = {};
for (const g of e.graveyard) {
  const c = `${g.causeOfDeath!.replace(/ (by|fighting) .*/, "")}/${g.stage}`;
  causes[c] = (causes[c] ?? 0) + 1;
}
console.log("deaths:", Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "));
console.log("knowledge by generation:", e.knowledgeGenerations().filter((g) => g.n >= 3).map((g) => `g${g.generation}:${g.avg.toFixed(1)}`).join(" "));
for (const g of [...e.groups.values()].sort((a, b) => b.members.size - a.members.size).slice(0, 5)) {
  const l = e.agents.get(g.leaderId);
  console.log(`  ${g.name}: ${g.members.size} members, led by ${l?.name} (${l?.stage}, ${l?.followers} followers), ${g.leaders.length} leaders so far, store ${g.store.rations}, norms: ${g.norms.map((n) => n.text).join(" | ")}`);
}
console.log("inventions:", e.log.filter((l) => l.kind === "invention").map((l) => `t${l.tick} ${l.text.replace(/:.*/, "")}`).slice(-14));
for (const [t, c] of e.canons) if (c.techs.size) console.log(`  ${t} know: ${[...c.techs].join(", ")}`);
const soc = e.log.filter((l) => l.kind === "society");
console.log("politics:", JSON.stringify(e.tally));
console.log(`society events: ${soc.length}; last few:`, soc.slice(-5).map((l) => `t${l.tick} ${l.text}`));
console.log(`${((performance.now() - t0) / e.tick).toFixed(2)} ms/tick`);

if (exportPath) {
  fs.writeFileSync(exportPath, JSON.stringify(exportRun(e)));
  console.log(`exported to ${exportPath}`);
}
