import { TRAIT_KEYS, type SimParams, type Stage, type TraitKey, type Traits } from "../../shared/types";
import { clamp01 } from "./rng";

/**
 * Growing up follows the body's inborn clock (base lifespan); growing old follows how long this life
 * is actually going to last, which medicine, peace and hardship keep changing. Once an elder, always an elder.
 */
export function stageOf(
  age: number,
  baseLifespan: number,
  lifespan: number,
  wasElder: boolean,
  p: Pick<SimParams, "childhoodEnd" | "adolescenceEnd" | "elderhoodStart">,
): Stage {
  if (wasElder) return "elder";
  const f = age / baseLifespan;
  if (f < p.childhoodEnd) return "child";
  if (f < p.adolescenceEnd) return "adolescent";
  return age >= p.elderhoodStart * lifespan ? "elder" : "adult";
}

/** Age at which a given stage begins, for an agent with this lifespan. */
export function stageStartAge(stage: Stage, lifespan: number, p: Pick<SimParams, "childhoodEnd" | "adolescenceEnd" | "elderhoodStart">): number {
  const f = { child: 0, adolescent: p.childhoodEnd, adult: p.adolescenceEnd, elder: p.elderhoodStart }[stage];
  return Math.ceil(f * lifespan);
}

/** How each stage bends the inborn temperament: playful children, bold adolescents, mellow elders. */
const STAGE_SHIFT: Record<Stage, Partial<Traits>> = {
  child: { curiosity: 0.2, aggression: -0.25, caution: -0.1, cooperation: 0.1 },
  adolescent: { curiosity: 0.25, caution: -0.25, aggression: 0.1, cooperation: -0.05 },
  adult: {},
  elder: { aggression: -0.25, caution: 0.2, cooperation: 0.15, curiosity: -0.1, greed: -0.05 },
};

/** How much experience reshapes temperament at each stage. The young are moulded most. */
export const PLASTICITY: Record<Stage, number> = { child: 1, adolescent: 0.6, adult: 0.3, elder: 0.15 };

/** How fast each stage learns from its own experience. Adolescents' creativity makes them the fastest discoverers. */
export const DISCOVERY: Record<Stage, number> = { child: 0.3, adolescent: 1.5, adult: 1, elder: 0.6 };

export const METABOLISM: Record<Stage, number> = { child: 0.7, adolescent: 0.9, adult: 1, elder: 0.8 };

/** Phenotype = genotype + stage of life + accumulated experience + the culture of one's group. Only the genotype is inherited. */
export function phenotype(genotype: Traits, stage: Stage, experience: Traits, culture: Traits): Traits {
  const shift = STAGE_SHIFT[stage];
  const out = {} as Traits;
  for (const k of TRAIT_KEYS) out[k] = clamp01(genotype[k] + (shift[k] ?? 0) + experience[k] + culture[k]);
  return out;
}

export function zeroTraits(): Traits {
  return Object.fromEntries(TRAIT_KEYS.map((k) => [k, 0])) as Traits;
}

/** Lived experiences and how each nudges temperament (before scaling by plasticity). */
export const EXPERIENCES = {
  witnessedKilling: { aggression: 0.03, caution: 0.05, cooperation: -0.02 },
  attacked: { aggression: 0.05, caution: 0.03 },
  fed: { cooperation: 0.02, greed: -0.01 },
  heardSpeech: { curiosity: 0.01, cooperation: 0.01 },
  taught: { curiosity: 0.01 },
  betrayed: { cooperation: -0.08, greed: 0.04, caution: 0.03 },
  honoredTrade: { cooperation: 0.02 },
  bereaved: { caution: 0.04, cooperation: 0.02 },
} satisfies Record<string, Partial<Record<TraitKey, number>>>;
export type Experience = keyof typeof EXPERIENCES;

/** Experience fades slowly; old wounds and kindnesses matter less over time. */
export const EXPERIENCE_DECAY = 0.999;
