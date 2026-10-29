import type { Domain } from "./types";

export const TECH_IDS = [
  "agriculture",
  "storage",
  "irrigation",
  "plough",
  "calendar",
  "herbalism",
  "surgery",
  "sanitation",
  "metalwork",
  "weaponry",
  "ironworking",
  "wheel",
  "writing",
  "mathematics",
  "currency",
  "law",
] as const;
export type TechId = (typeof TECH_IDS)[number];

/**
 * Inventions. Each needs understanding in some domains and the inventions it builds on; then it
 * must be researched (by the well-fed, healthy and secure, faster together) or, rarely, stumbled on.
 * Once known it is taught, kept in a tribe's canon, and (with writing) can be read from the records.
 */
export const TECHS: Record<TechId, { name: string; effect: string; domains: Partial<Record<Domain, number>>; techs: TechId[]; cost: number }> = {
  agriculture: { name: "Agriculture", effect: "Plant crops in fields that yield far more than wild land, if tended.", domains: { ecology: 2, seasons: 2 }, techs: [], cost: 8 },
  storage: { name: "Storage", effect: "Pots and granaries: rations no longer spoil, and far more can be kept.", domains: { seasons: 2 }, techs: ["agriculture"], cost: 8 },
  irrigation: { name: "Irrigation", effect: "Channels water to fields: crops grow faster, especially near rivers.", domains: { ecology: 3 }, techs: ["agriculture"], cost: 12 },
  plough: { name: "The plough", effect: "Turns more earth with less toil: much bigger harvests.", domains: { exchange: 2 }, techs: ["agriculture"], cost: 12 },
  calendar: { name: "The calendar", effect: "Reckoning the seasons: crops are sown at the right time and winters are prepared for.", domains: { seasons: 3 }, techs: ["writing", "agriculture"], cost: 18 },
  herbalism: { name: "Herbalism", effect: "Knowing which plants heal: medicine is made twice as fast and wounds mend sooner.", domains: { medicine: 2 }, techs: [], cost: 8 },
  surgery: { name: "Surgery", effect: "Setting bones and closing wounds: injuries do less lasting harm and medicine heals far more.", domains: { medicine: 3, conflict: 2 }, techs: ["herbalism", "metalwork"], cost: 20 },
  sanitation: { name: "Sanitation", effect: "Clean water and the separation of the sick: crowds breed far less plague.", domains: { medicine: 2 }, techs: ["herbalism", "writing"], cost: 18 },
  metalwork: { name: "Metalwork", effect: "Smelting copper and bronze: tools last far longer and metal weapons can be made.", domains: { conflict: 2, exchange: 2 }, techs: [], cost: 12 },
  weaponry: { name: "Weaponry", effect: "Bronze swords, spears and shields: weapons strike much harder.", domains: { conflict: 3 }, techs: ["metalwork"], cost: 14 },
  ironworking: { name: "Ironworking", effect: "Iron is harder and plentiful: better tools, weapons and ploughs for all.", domains: { exchange: 3, conflict: 3 }, techs: ["metalwork", "weaponry"], cost: 24 },
  wheel: { name: "The wheel", effect: "Carts and wheels: travel over rough land is easier and trade reaches further.", domains: { exchange: 2 }, techs: ["metalwork"], cost: 14 },
  writing: { name: "Writing", effect: "Marks that keep words: a tribe's knowledge no longer fades, teaching is faster, and the literate can learn from records alone.", domains: { exchange: 2, kinship: 2 }, techs: ["storage"], cost: 16 },
  mathematics: { name: "Mathematics", effect: "Number and measure: research goes much faster and trades are fairly reckoned.", domains: { exchange: 3 }, techs: ["writing"], cost: 22 },
  currency: { name: "Currency", effect: "Money: anything can be bought with anything, so trade no longer needs both sides to want each other's goods.", domains: { exchange: 3 }, techs: ["mathematics"], cost: 18 },
  law: { name: "Law", effect: "Written law: successions are orderly, theft is punished harder, and leaders are bound by rules.", domains: { kinship: 3 }, techs: ["writing"], cost: 20 },
};

/** Inventions an agent could work on now: prerequisites met, not yet known. */
export function frontier(known: Set<TechId>, level: (d: Domain) => number): TechId[] {
  return TECH_IDS.filter(
    (id) => !known.has(id) && TECHS[id].techs.every((t) => known.has(t)) && Object.entries(TECHS[id].domains).every(([d, l]) => level(d as Domain) >= l!),
  );
}

export function techByName(name: string): TechId | undefined {
  const n = name.trim().toLowerCase().replace(/^the /, "");
  return TECH_IDS.find((id) => id === n || TECHS[id].name.toLowerCase().replace(/^the /, "") === n);
}
