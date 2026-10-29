import type { TechId } from "../../shared/tech";
import { DOMAINS, type Domain, type InsightKind } from "../../shared/types";

/**
 * Understanding in a domain is a continuous amount of evidence. Level L needs L(L+1)/2 of it, so
 * each truth is harder to reach than the last and there is no ceiling.
 */
export type Understanding = Record<Domain, number>;

export function emptyUnderstanding(): Understanding {
  return Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Understanding;
}

export function levelOf(u: number): number {
  return Math.floor((Math.sqrt(8 * u + 1) - 1) / 2);
}

/** Fraction of the way to the next level. */
export function progressOf(u: number): number {
  const l = levelOf(u);
  const lo = (l * (l + 1)) / 2;
  const hi = ((l + 1) * (l + 2)) / 2;
  return (u - lo) / (hi - lo);
}

/** Survival edge from knowing a domain at level L: 0 at L0, rising with diminishing returns toward 1. */
export function edge(u: number): number {
  return 1 - Math.pow(0.85, levelOf(u));
}

export function totalLevels(u: Understanding): number {
  let n = 0;
  for (const d of DOMAINS) n += levelOf(u[d]);
  return n;
}

/**
 * A belief put into words by a mind: a claim about the world (true or a myth) or a saying about
 * meaning. Agents can't tell which is which; the player can.
 */
export interface Belief {
  text: string;
  kind: Exclude<InsightKind, "none">;
  accurate: boolean;
  author: string;
  tick: number;
}

/** A tribe's codified culture: the understanding its teachers have passed on, and the beliefs it repeats. */
export interface Canon {
  understanding: Understanding;
  beliefs: (Belief & { taught: number })[];
  /** Inventions the tribe's teachers have passed on. */
  techs: Set<TechId>;
}

export function emptyCanon(): Canon {
  return { understanding: emptyUnderstanding(), beliefs: [], techs: new Set() };
}

export function addToCanon(canon: Canon, b: Belief) {
  const existing = canon.beliefs.find((x) => x.text === b.text);
  if (existing) existing.taught++;
  else canon.beliefs.push({ ...b, taught: 1 });
  if (canon.beliefs.length > 40) {
    canon.beliefs.sort((x, y) => y.taught - x.taught);
    canon.beliefs.length = 40;
  }
}
