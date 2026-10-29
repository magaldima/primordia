import { TRAIT_KEYS, type Traits } from "../../shared/types";
import { clamp01, type Rng } from "./rng";

/** The heritable part of an agent: numeric temperament plus a natural-language creed (its personal prompt). */
export interface Genome {
  traits: Traits;
  creed: string;
  /** Tribe colour, inherited from a parent and drifting slightly each generation. */
  hue: number;
}

export function randomTraits(rng: Rng): Traits {
  const t = {} as Traits;
  for (const k of TRAIT_KEYS) t[k] = clamp01(0.5 + rng.gaussian() * 0.2);
  return t;
}

/** Uniform crossover with gaussian mutation. */
export function blendTraits(a: Traits, b: Traits, mutationRate: number, rng: Rng): Traits {
  const t = {} as Traits;
  for (const k of TRAIT_KEYS) {
    const base = rng.chance(0.5) ? a[k] : b[k];
    const mid = (a[k] + b[k]) / 2;
    // Mostly inherit one parent's gene, partly pulled toward the midpoint.
    t[k] = clamp01(base * 0.7 + mid * 0.3 + rng.gaussian() * mutationRate);
  }
  return t;
}

export function blendHue(a: number, b: number, mutationRate: number, rng: Rng): number {
  const base = rng.chance(0.5) ? a : b;
  return (base + rng.gaussian() * mutationRate * 40 + 360) % 360;
}

/** Short human-readable description of a temperament, used in prompts and the inspector. */
export function describeTraits(t: Traits): string {
  const word = (v: number, lo: string, hi: string) => (v > 0.68 ? hi : v < 0.32 ? lo : "");
  const parts = [
    word(t.aggression, "gentle", "violent"),
    word(t.cooperation, "solitary", "communal"),
    word(t.curiosity, "home-bound", "wandering"),
    word(t.fertility, "celibate", "lustful"),
    word(t.caution, "reckless", "wary"),
    word(t.greed, "generous", "greedy"),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "even-tempered";
}

// --- Offline creed blending: used when Claude breeding is off, over budget, or while the LLM call is in flight.

const MUTATION_PHRASES = [
  "Trust no stranger who comes from the east.",
  "The young must be fed before the old.",
  "Water is sacred; never fight beside it.",
  "Wander, for home is wherever there is food.",
  "Kin before all else.",
  "Strength is the only law.",
  "Share the harvest and the harvest returns.",
  "Remember every wrong done to you.",
  "Seek out those unlike you and learn from them.",
  "Keep a store against the lean times.",
  "Mountains are where the wise go to be safe.",
  "Never be the first to strike.",
  "A full belly is worth more than a crowd of friends.",
  "Leave many children behind you.",
];

function sentences(creed: string): string[] {
  return creed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function spliceCreeds(a: string, b: string, mutationRate: number, rng: Rng): string {
  const sa = sentences(a);
  const sb = sentences(b);
  const out: string[] = [];
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const pick = rng.chance(0.5) ? sa[i] ?? sb[i] : sb[i] ?? sa[i];
    if (pick && !out.includes(pick)) out.push(pick);
  }
  // Mutation: drop a belief and/or adopt a new one.
  if (out.length > 2 && rng.chance(mutationRate * 4)) out.splice(rng.int(0, out.length), 1);
  if (rng.chance(mutationRate * 5)) out.push(rng.pick(MUTATION_PHRASES));
  return out.slice(0, 5).join(" ");
}

// --- Names

const SYLLABLES = ["ka", "ri", "to", "mu", "sel", "an", "or", "vi", "eth", "lo", "dra", "en", "zu", "mi", "ash", "ul", "na", "the", "bo", "ir"];

export function randomName(rng: Rng): string {
  const n = rng.int(2, 4);
  let s = "";
  for (let i = 0; i < n; i++) s += rng.pick(SYLLABLES);
  return s[0].toUpperCase() + s.slice(1);
}

/** Child names splice the front of one parent's name onto the back of the other's. */
export function childName(a: string, b: string, rng: Rng): string {
  const front = a.toLowerCase().slice(0, rng.int(2, Math.min(5, a.length) + 1));
  const back = b.toLowerCase().slice(-rng.int(2, Math.min(4, b.length) + 1));
  let s = front + back;
  if (rng.chance(0.3)) s = front + rng.pick(SYLLABLES);
  s = s.replace(/(.)\1{2,}/g, "$1$1").replace(/([aeiou])[aeiou]{2,}/g, "$1").slice(0, 8);
  return s[0].toUpperCase() + s.slice(1);
}
