// Types shared by the browser simulation and the Node server that talks to Claude.

export const TRAIT_KEYS = [
  "aggression",
  "cooperation",
  "curiosity",
  "fertility",
  "caution",
  "greed",
] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];
export type Traits = Record<TraitKey, number>; // each in [0, 1]

export const TERRAINS = ["plains", "forest", "water", "mountain", "desert"] as const;
export type Terrain = (typeof TERRAINS)[number];

export const INTENTS = [
  "forage",
  "explore",
  "migrate",
  "seek_mate",
  "attack",
  "share",
  "flee",
  "rest",
  "rally",
  "hoard",
] as const;
export type Intent = (typeof INTENTS)[number];

export const DIRECTIONS = ["north", "south", "east", "west", "none"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const HAZARDS = ["fire", "plague", "drought", "flood", "bounty"] as const;
export type HazardKind = (typeof HAZARDS)[number];

/** What an agent's mind (LLM) decides; the instinct layer executes it tick-by-tick. */
export interface Decision {
  id: number;
  thought: string;
  intent: Intent;
  /** Name of another agent the intent is aimed at (mate, attack, share), or "". */
  target: string;
  direction: Direction;
  /** Something said out loud to neighbours, or "". */
  speech: string;
}

/** Everything the mind is told about one agent on one think cycle. */
export interface Perception {
  id: number;
  name: string;
  tribe: string;
  creed: string;
  traits: Traits;
  age: number;
  lifespan: number;
  energy: number;
  maxEnergy: number;
  generation: number;
  children: number;
  terrainHere: Terrain;
  foodHere: number;
  /** Best food nearby, by direction. */
  foodByDirection: Record<Exclude<Direction, "none">, number>;
  dangerByDirection: Record<Exclude<Direction, "none">, string>;
  neighbours: {
    name: string;
    tribe: string;
    distance: number;
    direction: Direction;
    energy: number;
    age: number;
    temperament: string;
    canMate: boolean;
  }[];
  heard: string[];
  memory: string[];
}

export type Effort = "low" | "medium" | "high";
export const EFFORTS: Effort[] = ["low", "medium", "high"];

export interface ThinkRequest {
  model: string;
  effort: Effort;
  tick: number;
  worldSummary: string;
  /** Recent player-issued narration ("A comet appears in the sky"). */
  worldEvents: string[];
  agents: Perception[];
}
export interface ThinkResponse {
  decisions: Decision[];
  usage: Usage;
}

export interface BreedRequest {
  model: string;
  parentA: { name: string; creed: string; traits: Traits };
  parentB: { name: string; creed: string; traits: Traits };
  childTraits: Traits;
  mutationRate: number;
}
export interface BreedResponse {
  name: string;
  creed: string;
  usage: Usage;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A playable starting setup. Built-in presets and Claude-generated scenarios share this shape. */
export interface ScenarioSpec {
  title: string;
  description: string;
  params: Partial<SimParams>;
  /** Base terrain fill; regions are painted on top in order. */
  baseTerrain: Terrain;
  regions: { terrain: Terrain; rect: Rect; label: string }[];
  factions: {
    name: string;
    color: string;
    count: number;
    creed: string;
    traits: Traits;
    spawn: Rect;
    /** Tick at which this faction appears (0 = present from the start). Lets scenarios stage invasions and migrations. */
    arriveAt: number;
  }[];
  events: {
    tick: number;
    kind: HazardKind | "narration";
    rect: Rect;
    message: string;
  }[];
  /** Observation-only world: the player sets initial conditions, then can't intervene. */
  locked?: boolean;
}

export interface ScenarioRequest {
  model: string;
  prompt: string;
  width: number;
  height: number;
}
export interface ScenarioResponse {
  scenario: ScenarioSpec;
  usage: Usage;
}

export type BrainMode = "instinct" | "hybrid";

export interface SimParams {
  width: number;
  height: number;
  seed: number;
  /** Agents spawned when no scenario factions are given. */
  initialAgents: number;
  maxAgents: number;
  lifespanMin: number;
  lifespanMax: number;
  maxEnergy: number;
  /** Energy burned per tick just by living. */
  metabolism: number;
  /** Multiplier on how fast food regrows everywhere. */
  foodRegrowth: number;
  /** Energy each parent spends to produce a child. */
  reproductionCost: number;
  /** Minimum age (ticks) before an agent can reproduce. */
  maturityAge: number;
  /** Ticks an agent must wait between births. */
  reproductionCooldown: number;
  /** Std-dev of gaussian noise applied to inherited traits; also how far creeds drift. */
  mutationRate: number;
  /** Damage dealt by an attack, scaled by attacker aggression. */
  attackDamage: number;
  /** "instinct" = traits only, free and fast. "hybrid" = Claude sets intents, instinct executes. */
  brain: BrainMode;
  model: string;
  /** Fraction of agents (0-1) that have a Claude mind at all; the rest run on instinct only. */
  mindShare: number;
  /** Each agent with a mind consults it roughly every N ticks. */
  thinkInterval: number;
  /** How hard Claude thinks per call. Higher costs more output tokens. */
  effort: Effort;
  /** Agents per Claude request. */
  thinkBatchSize: number;
  maxConcurrentRequests: number;
  /** Lockstep: the clock waits for outstanding thoughts before advancing (slower, but every mind keeps up). */
  waitForMinds: boolean;
  /** Let Claude write each child's blended creed (otherwise a local splice-and-mutate). */
  llmBreeding: boolean;
  /** Hard stop on spend: hybrid falls back to instinct once estimated USD exceeds this. */
  budgetUsd: number;
  /** Seasonal swing in food regrowth. Off makes the environment constant. */
  seasons: boolean;
}

export const MODELS: { id: string; label: string; inPerM: number; outPerM: number; cacheReadPerM: number }[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", inPerM: 4, outPerM: 20, cacheReadPerM: 0.2 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inPerM: 2, outPerM: 10, cacheReadPerM: 0.2 },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", inPerM: 0.1, outPerM: 0.5, cacheReadPerM: 0.01 },
];

export const DEFAULT_PARAMS: SimParams = {
  width: 72,
  height: 48,
  seed: 7,
  initialAgents: 40,
  maxAgents: 300,
  lifespanMin: 160,
  lifespanMax: 260,
  maxEnergy: 100,
  metabolism: 0.9,
  foodRegrowth: 1,
  reproductionCost: 28,
  maturityAge: 30,
  reproductionCooldown: 25,
  mutationRate: 0.08,
  attackDamage: 30,
  brain: "instinct",
  model: "claude-haiku-5-5",
  mindShare: 0.5,
  thinkInterval: 20,
  effort: "low",
  thinkBatchSize: 8,
  maxConcurrentRequests: 4,
  waitForMinds: false,
  llmBreeding: true,
  budgetUsd: 2,
  seasons: true,
};
