import type { Domain } from "./types";

/** Ticks in a full cycle of seasons. Lives here so the truths below can state it exactly. */
export const SEASON_PERIOD = 240;

/**
 * The real laws of the world, by domain, ordered from shallow to deep. Each level an agent reaches
 * in a domain unlocks the next statement. Understanding is unbounded: past the written levels an
 * agent keeps deepening its mastery (and its survival edge), so there is always more to learn.
 */
export const TRUTHS: Record<Domain, { label: string; truths: string[] }> = {
  ecology: {
    label: "Ecology",
    truths: [
      "Food grows on plains and in forests; deserts and mountains yield little.",
      "Land near water grows food faster than land far from it.",
      "A patch eaten bare regrows slowly; a people that spreads out feeds more mouths.",
      "The bodies of the dead enrich the ground where they fall.",
      "Forests hold the most food of all, but moving through them is tiring.",
    ],
  },
  seasons: {
    label: "Seasons",
    truths: [
      "The world turns warm and cold in a repeating cycle.",
      "Food grows fastest in spring and summer and slowest in autumn and winter.",
      `A full cycle of seasons lasts about ${SEASON_PERIOD} days.`,
      "Rations stored before winter carry a family through the lean months.",
      "Droughts stop food from growing for a long while, then pass.",
    ],
  },
  medicine: {
    label: "Medicine",
    truths: [
      "Sickness passes between people who stand close together.",
      "The sick burn their strength quickly; the well-fed survive it more often.",
      "Keeping apart from the sick protects against plague.",
      "Medicine made from herbs cures the plague.",
      "Sickness runs its course in about forty days.",
    ],
  },
  conflict: {
    label: "Conflict",
    truths: [
      "Whoever strikes another invites a blow in return.",
      "A defender on a mountain or in a forest is hard to wound.",
      "The strong and well-fed hit harder than the weak and hungry.",
      "A killer takes some strength from the one it kills, but fighting costs more than it gives.",
      "Tools make a fighter more dangerous.",
    ],
  },
  exchange: {
    label: "Exchange",
    truths: [
      "What one person has in plenty, another may lack; goods can be traded.",
      "One who cheats in a trade gains once but loses the trust of their tribe.",
      "Those with good reputations find more partners, for trade and for children.",
      "Skill comes from practice: those who keep at one craft grow masters of it.",
      "Tools make gathering food far easier.",
    ],
  },
  kinship: {
    label: "Kinship",
    truths: [
      "Children cannot feed themselves; they live on what parents and kin give them.",
      "Children must stay close to their parents to be nursed.",
      "Elders cannot gather food; a people that feeds its elders keeps their wisdom.",
      "A child takes after both parents, but never exactly.",
      "Every life has a span; what is not taught before death is lost.",
    ],
  },
};

/** Statement for a given level (1-based) in a domain, or a generic deepening past the written ones. */
export function truthAt(domain: Domain, level: number): string {
  const list = TRUTHS[domain].truths;
  return level <= list.length ? list[level - 1] : `A deeper mastery of ${TRUTHS[domain].label.toLowerCase()} (level ${level}).`;
}

/** Ground truth handed to the judge that classifies agents' insights. */
export function worldLawsText(): string {
  return (Object.keys(TRUTHS) as Domain[])
    .map((d) => `${d.toUpperCase()}:\n${TRUTHS[d].truths.map((t) => `- ${t}`).join("\n")}`)
    .join("\n\n");
}
