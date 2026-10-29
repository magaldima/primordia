import type { Traits } from "../../shared/types";
import type { Rng } from "./rng";

/**
 * Religion is belief only: the simulation has no afterlife. What exists is what agents believe:
 * that some deeds are good and others evil, and that after death they will be judged. Each
 * religion has its own moral code, so what counts as good differs between peoples, and evolves.
 */

/** Deeds an agent's ledger records. */
export const DEEDS = ["gift", "care", "honest", "teach", "kill", "theft", "cheat", "loot", "warKill", "children"] as const;
export type Deed = (typeof DEEDS)[number];
export type Ledger = Record<Deed, number>;

export function emptyLedger(): Ledger {
  return Object.fromEntries(DEEDS.map((d) => [d, 0])) as Ledger;
}

export const DEED_TEXT: Record<Deed, string> = {
  gift: "giving to others",
  care: "caring for the weak",
  honest: "honest dealing",
  teach: "teaching",
  kill: "killing",
  theft: "theft",
  cheat: "cheating",
  loot: "plundering common stores",
  warKill: "slaying the enemy in war",
  children: "bearing children",
};

export interface Religion {
  id: number;
  name: string;
  founderId: number;
  founderName: string;
  tribe: string;
  founded: number;
  /** How much each deed weighs at judgement: positive is virtue, negative is sin. */
  code: Ledger;
  heaven: string;
  hell: string;
  /** Free-text teaching, written by a mind or composed from the code. */
  doctrine: string;
  /** Whether believers are told the gods watch and punish in this life too (a "big god"). */
  watchful: boolean;
}

const HEAVENS = ["the Green Fields", "the House of the Ancestors", "the Shining Shore", "the Endless Harvest", "the Halls of the Brave", "the Quiet Garden", "the Sky Hearth"];
const HELLS = ["the Cold Pit", "the Hungry Dark", "the Ashlands", "the Silent Shore", "the Pit of Thorns", "the Endless Winter", "the Forgetting"];
const GODS = ["the Watcher", "the Mother", "the Sky Father", "the River", "the Ancestors", "the Flame", "the Hidden One", "the Twins"];

/** A new faith, shaped by its founder's temperament and (lightly) by chance. */
export function foundReligion(id: number, founder: { id: number; name: string; tribe: string; traits: Traits }, tick: number, rng: Rng): Religion {
  const t = founder.traits;
  const j = () => (rng.next() - 0.5) * 1.0;
  // Faiths differ in kind. The founder's temperament makes some likelier, but chance plays its part.
  const archetypes: { w: number; code: Ledger }[] = [
    { // warrior faith: glory in battle, many sons, contempt for weakness
      w: t.aggression + t.fertility * 0.5,
      code: { gift: 0.2, care: 0.1, honest: 0.5, teach: 0.2, kill: -0.3, theft: -0.4, cheat: -0.8, loot: 0.3, warKill: 1.6, children: 1 },
    },
    { // ascetic faith: give everything away, harm nothing, own nothing
      w: t.cooperation + (1 - t.greed),
      code: { gift: 1.5, care: 1.2, honest: 0.8, teach: 0.4, kill: -2, theft: -1.2, cheat: -1, loot: -1.5, warKill: -1.2, children: 0 },
    },
    { // ancestral faith: honour the old, teach the young, keep the line
      w: t.caution + t.cooperation * 0.5,
      code: { gift: 0.5, care: 1.4, honest: 0.6, teach: 1.3, kill: -1.2, theft: -0.8, cheat: -0.8, loot: -0.6, warKill: 0, children: 0.8 },
    },
    { // merchant faith: an honest bargain is holy; theft the worst sin; charity optional
      w: t.greed + t.caution * 0.5,
      code: { gift: 0.1, care: 0.3, honest: 1.6, teach: 0.3, kill: -1, theft: -2, cheat: -2, loot: -1.2, warKill: 0.2, children: 0.3 },
    },
    { // fertility faith: life itself is sacred
      w: t.fertility * 1.2 + t.cooperation * 0.3,
      code: { gift: 0.6, care: 1, honest: 0.3, teach: 0.2, kill: -1.6, theft: -0.6, cheat: -0.5, loot: -0.5, warKill: -0.6, children: 1.8 },
    },
  ];
  const total = archetypes.reduce((s, a) => s + a.w + 0.4, 0);
  let pick = rng.next() * total;
  const base = archetypes.find((a) => (pick -= a.w + 0.4) <= 0) ?? archetypes[0];
  const code = Object.fromEntries(Object.entries(base.code).map(([d, v]) => [d, v + j()])) as Ledger;
  const god = rng.pick(GODS);
  const virtues = (Object.entries(code) as [Deed, number][]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => DEED_TEXT[d]);
  const sins = (Object.entries(code) as [Deed, number][]).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([d]) => DEED_TEXT[d]);
  const heaven = rng.pick(HEAVENS);
  const hell = rng.pick(HELLS);
  return {
    id,
    name: `the Way of ${god.replace(/^the /, "")}`,
    founderId: founder.id,
    founderName: founder.name,
    tribe: founder.tribe,
    founded: tick,
    code,
    heaven,
    hell,
    doctrine: `${god[0].toUpperCase()}${god.slice(1)} sees all. Those who practise ${virtues.join(" and ")} go to ${heaven}; those guilty of ${sins.join(" and ")} fall into ${hell}.`,
    watchful: rng.chance(0.4 + t.caution * 0.4),
  };
}

/** A sect breaks away: same roots, a reformed code, a new name and its own heaven. */
export function foundSect(id: number, parent: Religion, founder: { id: number; name: string; tribe: string }, tick: number, rng: Rng): Religion {
  const code = Object.fromEntries(Object.entries(parent.code).map(([d, v]) => [d, v + (rng.next() - 0.5) * 1.4])) as Ledger;
  // A reformer usually inverts one teaching outright.
  const flip = rng.pick(DEEDS);
  code[flip] = -code[flip];
  const heaven = rng.chance(0.5) ? parent.heaven : rng.pick(HEAVENS);
  const hell = rng.chance(0.5) ? parent.hell : rng.pick(HELLS);
  const virtues = (Object.entries(code) as [Deed, number][]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => DEED_TEXT[d]);
  const sins = (Object.entries(code) as [Deed, number][]).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([d]) => DEED_TEXT[d]);
  return {
    id,
    name: `the ${rng.pick(["Reformed", "True", "Old", "New", "Pure", "Hidden", "Free"])} ${parent.name.replace(/^the /, "")}`,
    founderId: founder.id,
    founderName: founder.name,
    tribe: founder.tribe,
    founded: tick,
    code,
    heaven,
    hell,
    doctrine: `${founder.name} taught that the old faith had strayed: ${virtues.join(" and ")} lead to ${heaven}; ${sins.join(" and ")} lead to ${hell}.`,
    watchful: rng.chance(0.5) ? parent.watchful : !parent.watchful,
  };
}

/** The believer's verdict on a life, by its own faith's code. */
export function judge(code: Ledger, ledger: Ledger): { score: number; verdict: "heaven" | "hell" | "uncertain" } {
  let score = 0;
  for (const d of Object.keys(code) as Deed[]) score += code[d] * Math.min(10, ledger[d]);
  return { score, verdict: score > 1 ? "heaven" : score < -1 ? "hell" : "uncertain" };
}

/** Whether a deed is a sin under this code (how strongly a believer is held back from it). */
export function sinWeight(r: Religion | undefined, d: Deed): number {
  return r ? Math.max(0, -r.code[d]) : 0;
}
