import { TRAIT_KEYS, type Traits } from "../../shared/types";
import type { Rng } from "./rng";
import type { Norm } from "./social";

/**
 * Words in a creed or norm and the temperament they pull toward. Used to give creeds and norms a
 * behavioural effect in instinct mode; when Claude is on, the judge rates them more carefully.
 */
const LEXICON: [RegExp, Partial<Traits>][] = [
  [/\b(share|give|gift|together|kin|help|feed|generous|common|serve|brother|sister|mercy|forgive)/gi, { cooperation: 1, greed: -0.6 }],
  [/\b(strike|strong|strength|war|fight|blood|conquer|enemy|enemies|take|crush|fear us|spear|sword)/gi, { aggression: 1, caution: -0.3 }],
  [/\b(wander|seek|learn|beyond|new|discover|question|know|study|travel|stars|why)/gi, { curiosity: 1 }],
  [/\b(children|child|many|seed|womb|family|sons|daughters|line|descendants)/gi, { fertility: 1 }],
  [/\b(watch|careful|safe|never|wary|guard|patient|slow|hide|caution|keep close)/gi, { caution: 1 }],
  [/\b(keep|own|mine|hoard|full belly|wealth|gold|store|earn|price|profit|rich)/gi, { greed: 1 }],
  [/\b(peace|gentle|kind|harm no|spare|calm)/gi, { aggression: -1, cooperation: 0.4 }],
];

/** How a piece of text pushes temperament, each trait in [-1, 1]. */
export function textEffects(text: string): Partial<Traits> {
  const out: Partial<Traits> = {};
  for (const [re, eff] of LEXICON) {
    const hits = text.match(re)?.length ?? 0;
    if (!hits) continue;
    for (const [k, v] of Object.entries(eff) as [keyof Traits, number][]) out[k] = (out[k] ?? 0) + v * Math.min(2, hits);
  }
  for (const k of TRAIT_KEYS) if (out[k] !== undefined) out[k] = Math.max(-1, Math.min(1, out[k]! / 2));
  return out;
}

// --- A grammar of norms: openers and rules, each carrying an effect, recombined and mutated without end.

const OPENERS: [string, Partial<Traits>][] = [
  ["Among us,", {}],
  ["Before the elders,", { caution: 0.2, cooperation: 0.2 }],
  ["In hard seasons,", { caution: 0.2 }],
  ["With strangers,", { caution: 0.3 }],
  ["Under the sky,", { curiosity: 0.2 }],
  ["In the fields,", { fertility: 0.1, cooperation: 0.1 }],
  ["In war,", { aggression: 0.3 }],
  ["At the hearth,", { cooperation: 0.2, fertility: 0.2 }],
  ["Before the gods,", { caution: 0.2, cooperation: 0.2 }],
  ["When the stores are full,", { greed: -0.2 }],
];

const RULES: [string, Partial<Traits>][] = [
  ["the first share goes to the hungry.", { cooperation: 0.6, greed: -0.5 }],
  ["what is earned is kept.", { greed: 0.6, cooperation: -0.3 }],
  ["no one strikes first.", { aggression: -0.6 }],
  ["the bold go first and take the most.", { aggression: 0.5, greed: 0.3, caution: -0.4 }],
  ["every child is raised by all.", { cooperation: 0.5, fertility: 0.4 }],
  ["a debt is paid twice over.", { cooperation: 0.4, greed: -0.2 }],
  ["the cheat is cast out.", { cooperation: 0.4, aggression: 0.2 }],
  ["questions are a kind of prayer.", { curiosity: 0.6 }],
  ["silence keeps you safe.", { caution: 0.5, curiosity: -0.3 }],
  ["the stranger is fed, then watched.", { cooperation: 0.3, caution: 0.3 }],
  ["the stranger is driven off.", { aggression: 0.4, cooperation: -0.3 }],
  ["many children honour the dead.", { fertility: 0.6 }],
  ["the land is held in common.", { cooperation: 0.5, greed: -0.6 }],
  ["each tends their own field.", { greed: 0.4, cooperation: -0.2 }],
  ["the old ways are not questioned.", { curiosity: -0.5, caution: 0.3 }],
  ["what is learned is written down for all.", { curiosity: 0.4, cooperation: 0.3 }],
];

export function inventNorm(leader: Traits, rng: Rng, author: string, tick: number): Norm {
  // Rules that suit the leader's temperament are likelier.
  const score = ([, e]: [string, Partial<Traits>]) => 0.2 + TRAIT_KEYS.reduce((s, k) => s + (e[k] ?? 0) * (leader[k] - 0.5), 0) + rng.next() * 0.6;
  const rule = [...RULES].sort((a, b) => score(b) - score(a))[0];
  const opener = rng.pick(OPENERS);
  return combine(opener, rule, author, tick);
}

/** A norm can drift: same rule under a new circumstance, or a new rule under the old circumstance. */
export function mutateNorm(n: Norm, rng: Rng, author: string, tick: number): Norm | null {
  const opener = OPENERS.find(([o]) => n.text.startsWith(o));
  const rule = RULES.find(([r]) => n.text.endsWith(r));
  if (!opener || !rule) return null;
  return rng.chance(0.5) ? combine(rng.pick(OPENERS), rule, author, tick) : combine(opener, rng.pick(RULES), author, tick);
}

function combine(opener: [string, Partial<Traits>], rule: [string, Partial<Traits>], author: string, tick: number): Norm {
  const effects: Partial<Traits> = {};
  for (const k of TRAIT_KEYS) {
    const v = (opener[1][k] ?? 0) + (rule[1][k] ?? 0);
    if (v) effects[k] = Math.max(-1, Math.min(1, v));
  }
  return { text: `${opener[0]} ${rule[0]}`, effects, author, tick };
}
