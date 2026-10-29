import type { ScenarioSpec, Traits } from "../../shared/types";
import { Rng } from "./rng";

const t = (aggression: number, cooperation: number, curiosity: number, fertility: number, caution: number, greed: number): Traits => ({
  aggression,
  cooperation,
  curiosity,
  fertility,
  caution,
  greed,
});

/** Hand-written starting worlds that work without an API key. Coordinates assume the default 72x48 board. */
export const PRESETS: ScenarioSpec[] = [
  {
    title: "Twin Rivers",
    description: "Two river valleys separated by desert. Farmers in the fertile east, herders in the west, raiders in the hills.",
    params: {},
    baseTerrain: "desert",
    regions: [
      { terrain: "plains", rect: { x: 4, y: 4, w: 24, h: 40 }, label: "western steppe" },
      { terrain: "water", rect: { x: 14, y: 0, w: 2, h: 48 }, label: "west river" },
      { terrain: "plains", rect: { x: 44, y: 4, w: 24, h: 40 }, label: "eastern valley" },
      { terrain: "forest", rect: { x: 58, y: 6, w: 8, h: 14 }, label: "eastern woods" },
      { terrain: "water", rect: { x: 54, y: 0, w: 2, h: 48 }, label: "east river" },
      { terrain: "mountain", rect: { x: 30, y: 0, w: 12, h: 12 }, label: "northern hills" },
      { terrain: "plains", rect: { x: 33, y: 2, w: 6, h: 6 }, label: "hill pastures" },
    ],
    factions: [
      {
        name: "Valley Farmers",
        color: "#e0b84f",
        count: 18,
        creed: "The river gives to those who stay and tend it. Feed your neighbours and they will defend you. Children are the harvest of a good life.",
        traits: t(0.2, 0.8, 0.25, 0.7, 0.6, 0.3),
        spawn: { x: 44, y: 10, w: 20, h: 30 },
        arriveAt: 0,
      },
      {
        name: "Steppe Herders",
        color: "#5fa8d3",
        count: 14,
        creed: "Keep moving; grass grows where you are not. Trust kin, test strangers. Take what is left unguarded.",
        traits: t(0.5, 0.5, 0.75, 0.5, 0.4, 0.55),
        spawn: { x: 4, y: 8, w: 22, h: 32 },
        arriveAt: 0,
      },
      {
        name: "Hill Raiders",
        color: "#d0573f",
        count: 8,
        creed: "The strong eat first. The valleys are fat and soft. Strike fast, retreat to the high places.",
        traits: t(0.85, 0.35, 0.5, 0.45, 0.35, 0.8),
        spawn: { x: 31, y: 1, w: 10, h: 9 },
        arriveAt: 0,
      },
    ],
    events: [
      { tick: 300, kind: "drought", rect: { x: 40, y: 0, w: 32, h: 48 }, message: "The eastern river runs low. Drought grips the valley." },
    ],
  },
  {
    title: "Archipelago",
    description: "A scatter of islands. Populations cut off from each other drift apart, as on the Galápagos.",
    params: { mutationRate: 0.12 },
    baseTerrain: "water",
    regions: [
      { terrain: "plains", rect: { x: 4, y: 4, w: 16, h: 14 }, label: "north-west isle" },
      { terrain: "forest", rect: { x: 8, y: 7, w: 6, h: 6 }, label: "north-west grove" },
      { terrain: "plains", rect: { x: 30, y: 18, w: 14, h: 12 }, label: "central isle" },
      { terrain: "mountain", rect: { x: 35, y: 21, w: 4, h: 4 }, label: "central peak" },
      { terrain: "forest", rect: { x: 52, y: 4, w: 15, h: 12 }, label: "north-east isle" },
      { terrain: "desert", rect: { x: 6, y: 32, w: 14, h: 12 }, label: "south-west isle" },
      { terrain: "plains", rect: { x: 9, y: 35, w: 7, h: 6 }, label: "south-west oasis" },
      { terrain: "plains", rect: { x: 52, y: 32, w: 14, h: 12 }, label: "south-east isle" },
    ],
    factions: [
      { name: "Northwesters", color: "#7fc97f", count: 8, creed: "The island is enough. Grow, and grow together.", traits: t(0.4, 0.6, 0.4, 0.6, 0.5, 0.4), spawn: { x: 4, y: 4, w: 16, h: 14 }, arriveAt: 0 },
      { name: "Centrals", color: "#beaed4", count: 8, creed: "The island is enough. Grow, and grow together.", traits: t(0.4, 0.6, 0.4, 0.6, 0.5, 0.4), spawn: { x: 30, y: 18, w: 14, h: 12 }, arriveAt: 0 },
      { name: "Woodlanders", color: "#fdc086", count: 8, creed: "The island is enough. Grow, and grow together.", traits: t(0.4, 0.6, 0.4, 0.6, 0.5, 0.4), spawn: { x: 52, y: 4, w: 15, h: 12 }, arriveAt: 0 },
      { name: "Dunefolk", color: "#f0e442", count: 8, creed: "The island is enough. Grow, and grow together.", traits: t(0.4, 0.6, 0.4, 0.6, 0.5, 0.4), spawn: { x: 6, y: 32, w: 14, h: 12 }, arriveAt: 0 },
      { name: "Southeasters", color: "#386cb0", count: 8, creed: "The island is enough. Grow, and grow together.", traits: t(0.4, 0.6, 0.4, 0.6, 0.5, 0.4), spawn: { x: 52, y: 32, w: 14, h: 12 }, arriveAt: 0 },
    ],
    events: [],
  },
  {
    title: "Bronze Age Collapse",
    description:
      "c. 1177 BC. Interlinked palace kingdoms around an inland sea face drought, earthquake and famine, then the arrival of the Sea Peoples.",
    params: {},
    baseTerrain: "plains",
    regions: [
      { terrain: "water", rect: { x: 18, y: 18, w: 36, h: 14 }, label: "the Great Sea" },
      { terrain: "mountain", rect: { x: 0, y: 0, w: 72, h: 4 }, label: "northern ranges" },
      { terrain: "desert", rect: { x: 0, y: 40, w: 72, h: 8 }, label: "southern desert" },
      { terrain: "forest", rect: { x: 2, y: 6, w: 14, h: 10 }, label: "Mycenaean hills" },
      { terrain: "mountain", rect: { x: 54, y: 4, w: 16, h: 10 }, label: "Anatolian plateau" },
      { terrain: "water", rect: { x: 40, y: 34, w: 2, h: 14 }, label: "the Nile" },
    ],
    factions: [
      { name: "Mycenaeans", color: "#4e9bd6", count: 10, creed: "The palace provides and the palace commands. Trade binds the kingdoms; honour binds the warriors.", traits: t(0.5, 0.65, 0.5, 0.55, 0.45, 0.5), spawn: { x: 2, y: 5, w: 14, h: 12 }, arriveAt: 0 },
      { name: "Hittites", color: "#c46a3a", count: 10, creed: "Iron, law and treaty. Keep your word to allies and your fortresses stocked.", traits: t(0.55, 0.6, 0.35, 0.55, 0.6, 0.5), spawn: { x: 54, y: 4, w: 16, h: 12 }, arriveAt: 0 },
      { name: "Egyptians", color: "#e3c565", count: 14, creed: "The river is eternal and so is Pharaoh. Store grain against the lean years. Outsiders are a threat to order.", traits: t(0.35, 0.75, 0.2, 0.65, 0.7, 0.45), spawn: { x: 34, y: 33, w: 14, h: 7 }, arriveAt: 0 },
      { name: "Canaanites", color: "#9b6dc6", count: 8, creed: "We are the go-between. Sell to all sides and side with whoever is winning.", traits: t(0.3, 0.55, 0.65, 0.6, 0.5, 0.65), spawn: { x: 56, y: 18, w: 14, h: 14 }, arriveAt: 0 },
      {
        name: "Sea Peoples",
        color: "#2ec4b6",
        count: 14,
        creed: "Our homes are gone. Take land, take grain, take whatever lets the clan survive another winter.",
        traits: t(0.85, 0.7, 0.7, 0.6, 0.25, 0.75),
        spawn: { x: 18, y: 14, w: 36, h: 4 },
        arriveAt: 210,
      },
    ],
    events: [
      { tick: 120, kind: "drought", rect: { x: 0, y: 0, w: 72, h: 18 }, message: "Years without rain. The northern harvests fail." },
      { tick: 200, kind: "narration", rect: { x: 0, y: 0, w: 0, h: 0 }, message: "Strange ships are seen on the horizon. Refugees speak of burning cities." },
      { tick: 220, kind: "fire", rect: { x: 4, y: 8, w: 6, h: 5 }, message: "The palaces of the west are burning." },
      { tick: 260, kind: "plague", rect: { x: 52, y: 4, w: 18, h: 14 }, message: "Pestilence breaks out in the Hittite cities." },
    ],
  },
];

// --- Petri dish: a Conway-style sandbox where only the initial conditions vary.

export interface Founder {
  name: string;
  color: string;
  creed: string;
  traits: Traits;
}

export type Placement = "center" | "corners" | "line" | "random";

export interface PetriOptions {
  size: number;
  founders: Founder[];
  placement: Placement;
  /** Food regrowth multiplier: how many mouths the box can feed. */
  food: number;
  mutationRate: number;
  seed: number;
}

export const PETRI_FOUNDERS: Founder[] = [
  { name: "Alpha", color: "#3987e5", creed: "Survive. Eat when hungry, have children when you can.", traits: t(0.5, 0.5, 0.5, 0.5, 0.5, 0.5) },
  { name: "Beta", color: "#d95926", creed: "Survive. Eat when hungry, have children when you can.", traits: t(0.5, 0.5, 0.5, 0.5, 0.5, 0.5) },
  { name: "Gamma", color: "#199e70", creed: "Survive. Eat when hungry, have children when you can.", traits: t(0.5, 0.5, 0.5, 0.5, 0.5, 0.5) },
  { name: "Delta", color: "#c98500", creed: "Survive. Eat when hungry, have children when you can.", traits: t(0.5, 0.5, 0.5, 0.5, 0.5, 0.5) },
];

export const PETRI_DEFAULTS: PetriOptions = {
  size: 24,
  founders: PETRI_FOUNDERS.slice(0, 2),
  placement: "center",
  food: 1,
  mutationRate: 0.08,
  seed: 1,
};

/** Where each founder starts, as a 1x1 spawn rect so placement is exact. */
function placements(n: number, size: number, mode: Placement, seed: number): { x: number; y: number }[] {
  const c = Math.floor(size / 2);
  const m = 2;
  switch (mode) {
    case "center":
      return [[c - 1, c - 1], [c, c - 1], [c - 1, c], [c, c]].slice(0, n).map(([x, y]) => ({ x, y }));
    case "corners":
      return [[m, m], [size - 1 - m, size - 1 - m], [size - 1 - m, m], [m, size - 1 - m]].slice(0, n).map(([x, y]) => ({ x, y }));
    case "line":
      return Array.from({ length: n }, (_, i) => ({ x: Math.round(((i + 1) * size) / (n + 1)), y: c }));
    case "random": {
      const rng = new Rng(seed * 31 + 5);
      const out: { x: number; y: number }[] = [];
      while (out.length < n) {
        const p = { x: rng.int(0, size), y: rng.int(0, size) };
        if (!out.some((q) => q.x === p.x && q.y === p.y)) out.push(p);
      }
      return out;
    }
  }
}

export function petriDish(o: PetriOptions): ScenarioSpec {
  const spots = placements(o.founders.length, o.size, o.placement, o.seed);
  return {
    title: `Petri dish · ${o.founders.length} founder${o.founders.length === 1 ? "" : "s"}`,
    description: `A ${o.size}×${o.size} box of even grassland with no seasons, disasters or intervention. Only the founders differ.`,
    params: {
      width: o.size,
      height: o.size,
      seed: o.seed,
      seasons: false,
      foodRegrowth: o.food,
      mutationRate: o.mutationRate,
      maxAgents: Math.max(20, Math.round(o.size * o.size * 0.5)),
    },
    baseTerrain: "plains",
    regions: [],
    // Each founder is its own lineage so you can watch which one's descendants spread.
    factions: o.founders.map((f, i) => ({
      name: f.name,
      color: f.color,
      count: 1,
      creed: f.creed,
      traits: f.traits,
      spawn: { x: spots[i].x, y: spots[i].y, w: 1, h: 1 },
      arriveAt: 0,
    })),
    events: [],
    locked: true,
  };
}
