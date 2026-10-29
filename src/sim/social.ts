import type { TechId } from "../../shared/tech";
import { GOODS, TRAIT_KEYS, type GroupAim, type Intent, type Inventory, type Traits } from "../../shared/types";

/**
 * Organizations are deliberately open-ended: a name, a purpose and norms in free text, a leader
 * (whoever most members look up to), a shared store, and the leader's current call to action.
 * What they *are* (a war band, a school, a cult, a guild) is up to the agents.
 */
export interface Group {
  id: number;
  name: string;
  purpose: string;
  founderId: number;
  leaderId: number;
  /** Successor the leader has named, if any. Without one, succession is contested. */
  heirId: number | null;
  members: Set<number>;
  norms: Norm[];
  store: Inventory;
  foundedTick: number;
  /** The leader's current intent, which members may answer. */
  call: { intent: Intent; targetId: number | null; dir: string } | null;
  /** History of who has led it, and how each came to power. */
  leaders: { id: number; name: string; from: number; how: string }[];
  /** A struggle for power in progress: no one leads until it is settled. */
  crisis: { since: number; claimants: number[]; reason: string } | null;
  /** What the members work toward together, set by the leader. */
  aim: GroupAim | null;
  aimSince: number;
  /** Pooled research toward one invention. */
  project: { tech: TechId; progress: number } | null;
  /** The enemy, when at war: another organization, or a whole tribe. */
  war: { groupId: number | null; tribe: string | null; name: string; since: number; kills?: number } | null;
  /** Average cooperativeness of members: cohesive groups fight and work together better. */
  cohesion: number;
  /** In a larger realm: the organization this one pays tribute to (vassal) or stands with (ally). */
  overlordId: number | null;
  relation: "vassal" | "ally" | null;
}

/** The power-hungry: aggressive, greedy and uncooperative. Derived from temperament, not a separate trait. */
export function ambition(t: Traits): number {
  return (t.aggression + t.greed + (1 - t.cooperation)) / 3;
}

/** A rule of the group. Its effect on members' temperament is known for built-in norms and judged for written ones. */
export interface Norm {
  text: string;
  effects: Partial<Traits> | null;
  author: string;
  tick: number;
}

export function emptyStore(): Inventory {
  return Object.fromEntries(GOODS.map((g) => [g, 0])) as Inventory;
}

/** Norms an instinct-driven leader brings, chosen by its own temperament. */
export const NORM_TEMPLATES: { when: (t: Traits) => number; text: string; effects: Partial<Traits> }[] = [
  { when: (t) => t.cooperation, text: "Share the harvest; no member goes hungry.", effects: { cooperation: 0.6, greed: -0.5 } },
  { when: (t) => t.aggression, text: "Strike first, and strike together.", effects: { aggression: 0.6, caution: -0.3 } },
  { when: (t) => t.caution, text: "Keep watch, keep close, take no needless risks.", effects: { caution: 0.6, curiosity: -0.2 } },
  { when: (t) => t.curiosity, text: "Seek what lies beyond the hills and bring back what you learn.", effects: { curiosity: 0.6, caution: -0.2 } },
  { when: (t) => t.greed, text: "Each keeps what each earns.", effects: { greed: 0.5, cooperation: -0.3 } },
  { when: (t) => t.fertility, text: "Many children make a strong people.", effects: { fertility: 0.6 } },
  { when: (t) => 1 - t.aggression, text: "Never be the first to raise a hand.", effects: { aggression: -0.6, cooperation: 0.2 } },
];

/** Names for groups that form by instinct, by the founder's strongest leaning. */
export function groupKind(t: Traits): string {
  const lean = (["aggression", "curiosity", "cooperation", "greed", "caution"] as const).reduce((a, b) => (t[a] >= t[b] ? a : b));
  return { aggression: "War Band", curiosity: "Circle", cooperation: "Kin-Hold", greed: "Company", caution: "Watch" }[lean];
}

/** How much a member takes on its group's culture: conformists most, defiant adolescents least. */
export function conformity(genotype: Traits, adolescent: boolean): number {
  return (0.3 + genotype.cooperation * 0.7) * (adolescent ? 0.5 : 1);
}

/** The temperament shift a set of norms exerts on a member. */
export function cultureShift(norms: Norm[], conform: number): Traits {
  const out = Object.fromEntries(TRAIT_KEYS.map((k) => [k, 0])) as Traits;
  for (const n of norms) if (n.effects) for (const k of TRAIT_KEYS) out[k] += (n.effects[k] ?? 0) * 0.12 * conform;
  for (const k of TRAIT_KEYS) out[k] = Math.max(-0.3, Math.min(0.3, out[k]));
  return out;
}

/** Bonds are kept for the strongest few relationships only. */
export const MAX_BONDS = 14;
export const BOND_DECAY = 0.998;
