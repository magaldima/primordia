// Runs the simulation without a browser, in instinct mode, to check ecosystem balance.
// Usage: npm run sim -- [ticks] [seed]
import { Engine } from "../src/sim/engine";
import { PETRI_DEFAULTS, petriDish, PRESETS } from "../src/sim/presets";

const ticks = Number(process.argv[2] ?? 1500);
const seed = Number(process.argv[3] ?? 7);
const presetName = process.argv[4];
const preset =
  presetName === "petri"
    ? petriDish({ ...PETRI_DEFAULTS, seed })
    : presetName
      ? PRESETS.find((p) => p.title.toLowerCase().startsWith(presetName.toLowerCase())) ?? null
      : null;
const e = new Engine(preset ? {} : { seed }, preset);
const t0 = performance.now();
for (let i = 0; i < ticks; i++) {
  e.step();
  if (e.tick % 100 === 0) {
    const s = e.stats.at(-1)!;
    const tr = Object.entries(s.traits).map(([k, v]) => `${k.slice(0, 4)}=${v.toFixed(2)}`).join(" ");
    const tribes = Object.entries(s.tribes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(" ");
    console.log(`t${e.tick} pop=${s.population} gen=${s.maxGeneration} E=${s.avgEnergy.toFixed(0)} | ${tr} | ${tribes}`);
  }
  if (!e.agents.size) {
    console.log(`extinct at t${e.tick}`);
    break;
  }
}
const causes: Record<string, number> = {};
for (const g of e.graveyard) {
  const c = g.causeOfDeath!.replace(/ (by|fighting) .*/, "");
  causes[c] = (causes[c] ?? 0) + 1;
}
console.log("deaths:", causes, `| ${((performance.now() - t0) / e.tick).toFixed(2)} ms/tick`);
