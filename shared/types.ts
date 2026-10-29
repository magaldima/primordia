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

export const STAGES = ["child", "adolescent", "adult", "elder"] as const;
export type Stage = (typeof STAGES)[number];

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
  "work",
  "trade",
  "teach",
  "play",
  "farm",
  "emigrate",
  "research",
] as const;
export type Intent = (typeof INTENTS)[number];

/** What each stage of life is allowed to do. */
export const STAGE_INTENTS: Record<Stage, readonly Intent[]> = {
  child: ["play", "rest", "flee"],
  adolescent: ["forage", "explore", "migrate", "attack", "share", "flee", "rest", "rally", "hoard", "work", "trade", "farm", "emigrate", "research"],
  adult: ["forage", "explore", "migrate", "seek_mate", "attack", "share", "flee", "rest", "rally", "hoard", "work", "trade", "teach", "farm", "emigrate", "research"],
  elder: ["teach", "share", "trade", "rest", "rally", "flee", "emigrate", "research"],
};

export const DIRECTIONS = ["north", "south", "east", "west", "none"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const HAZARDS = ["fire", "plague", "drought", "flood", "bounty"] as const;
export type HazardKind = (typeof HAZARDS)[number];

/** Tradeable goods. Rations are stored food; tools boost gathering and farming; medicine cures plague and wounds; weapons win fights. */
export const GOODS = ["rations", "tools", "medicine", "weapons"] as const;
export type Good = (typeof GOODS)[number];
export type Inventory = Record<Good, number>;

/** How an agent plays the prisoner's dilemma at the moment a trade executes. */
export const TRADE_STANCES = ["honest", "cheat", "reciprocal"] as const;
export type TradeStance = (typeof TRADE_STANCES)[number];

/** Domains of knowledge about the world. Each has unbounded levels of understanding. */
export const DOMAINS = ["ecology", "seasons", "medicine", "conflict", "exchange", "kinship"] as const;
export type Domain = (typeof DOMAINS)[number];

/** What an agent's mind (LLM) decides; the instinct layer executes it tick-by-tick. */
export interface Decision {
  id: number;
  thought: string;
  intent: Intent;
  /** Name of another agent the intent is aimed at (mate, attack, share, trade, teach), or "". */
  target: string;
  direction: Direction;
  /** Something said out loud to neighbours, or "". */
  speech: string;
  /** How to behave when a trade comes due. */
  tradeStance: TradeStance;
  /** Something the agent believes it has learned about the world or about meaning, or "". */
  insight: string;
  /** Who to look up to and follow: a neighbour's name, "nobody" to stop following, or "" to keep things as they are. */
  follow: string;
  /** Found a new organization, join one, leave one's own, or do nothing. */
  groupAction: GroupAction;
  /** Name of the group to found or join. */
  groupName: string;
  /** For "found": what the group is for, in the founder's words. */
  groupPurpose: string;
  /** A leader's new rule or instruction for its group, or "". Ignored from non-leaders. */
  decree: string;
  /** A leader's choice of successor (a member's name), or "". Ignored from non-leaders. */
  heir: string;
  /** A leader setting what its organization works toward together; "none" keeps the current aim. */
  groupAim: GroupAim | "none";
  /** For research, the invention to pursue; for war, the rival organization or tribe; for ally, the organization to join with. */
  aimTarget: string;
  /** Matters of faith: found a new religion, convert to one held nearby, renounce one's faith, or nothing. */
  religionAction: "none" | "found" | "convert" | "renounce";
  /** Name of the religion to found or convert to. */
  religionName: string;
  /** For "found": what the new faith teaches about good, evil and what comes after death. */
  doctrine: string;
}

/** What an organization works toward together. */
export const GROUP_AIMS = ["research", "war", "farm", "trade", "peace", "ally"] as const;
export type GroupAim = (typeof GROUP_AIMS)[number];

export const GROUP_ACTIONS = ["none", "found", "join", "leave"] as const;
export type GroupAction = (typeof GROUP_ACTIONS)[number];

/** What an agent knows about its place among others. */
export interface SocialView {
  follows: string;
  followers: number;
  /** Total people who follow it directly or through others. */
  influence: number;
  group: null | {
    name: string;
    purpose: string;
    leader: string;
    youLead: boolean;
    heir: string;
    members: number;
    norms: string[];
    store: string;
    leaderCall: string;
    /** If leadership is contested: who is claiming it, and whom this agent backs. */
    crisis: string;
    /** What the group is working toward together, and how far along. */
    aim: string;
    /** Its place in a larger realm: overlord, vassals, allies. */
    realm: string;
  };
  /** Strongest feelings toward others, warm and cold. */
  bonds: string[];
  nearbyGroups: string[];
}

/** Everything the mind is told about one agent on one think cycle. */
export interface Perception {
  id: number;
  name: string;
  tribe: string;
  stage: Stage;
  creed: string;
  /** The agent's temperament as it is now (phenotype), not as it was born. */
  temperament: Traits;
  age: number;
  /** A rough sense of remaining life; agents know they are mortal but not exactly when they will die. */
  lifeLeft: string;
  /** How its body is holding up: wounds, illness and age. */
  health: string;
  energy: number;
  maxEnergy: number;
  generation: number;
  family: string;
  inventory: Inventory;
  craft: string;
  reputation: string;
  terrainHere: Terrain;
  foodHere: number;
  foodByDirection: Record<Exclude<Direction, "none">, number>;
  dangerByDirection: Record<Exclude<Direction, "none">, string>;
  neighbours: {
    name: string;
    tribe: string;
    stage: Stage;
    relation: string;
    distance: number;
    direction: Direction;
    energy: number;
    temperament: string;
    reputation: string;
    goods: string;
    canMate: boolean;
    /** How well this agent understands them: same tongue, related dialect, or foreign. */
    tongue: string;
  }[];
  heard: string[];
  memory: string[];
  /** What it holds to be true (verified knowledge and unverified beliefs look the same to the agent). */
  knows: string[];
  /** Sayings of its tribe, passed down by elders. */
  sayings: string[];
  /** Inventions it knows how to use. */
  inventions: string[];
  /** What it believes about gods, good and evil, and what comes after death. */
  faith: string;
  /** What it is researching, if anything, and what it could research. */
  research: string;
  literate: boolean;
  /** Its fields, if it farms: how many, and how many are ripe. */
  fields: string;
  social: SocialView;
  allowedIntents: Intent[];
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

/** Classify agents' insights against the world's real rules. */
export interface JudgeRequest {
  model: string;
  insights: { id: number; text: string }[];
  /** Group decrees to rate for how they push members' temperament. */
  norms: { id: number; text: string }[];
}
export type InsightKind = Domain | "meaning" | "none";
export interface JudgeResponse {
  verdicts: { id: number; kind: InsightKind; accurate: boolean }[];
  normEffects: ({ id: number } & Traits)[];
  usage: Usage;
}

/** Everything the historian is shown: a compact digest of the world since its last report. */
export interface HistorianRequest {
  model: string;
  digest: string;
}
export interface Report {
  title: string;
  /** A short name for the age the world is in. */
  era: string;
  narrative: string;
  trends: { label: string; direction: "up" | "down" | "steady"; detail: string }[];
  leaders: { name: string; role: string; assessment: string }[];
  risks: { label: string; likelihood: "low" | "medium" | "high"; detail: string }[];
  opportunities: { label: string; detail: string }[];
  predictions: string[];
  /** How the previous report's predictions turned out ("" for the first report). */
  review: string;
}
export interface HistorianResponse {
  report: Report;
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
    /** Model this tribe thinks with; omitted = the global model. */
    model?: string;
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

/** How a stage of life thinks: "off" = pure instinct; otherwise Claude at that effort, every interval × `every` ticks. */
export interface StageMind {
  effort: Effort | "off";
  every: number;
}

export interface SimParams {
  width: number;
  height: number;
  seed: number;
  /** Agents spawned when no scenario factions are given. */
  initialAgents: number;
  /** Hard limit purely to keep the browser responsive. Births are not capped; scarcity, disease and emigration regulate population. */
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
  /** Stage boundaries as fractions of each agent's lifespan. */
  childhoodEnd: number;
  adolescenceEnd: number;
  elderhoodStart: number;
  /** Ticks an agent must wait between births. */
  reproductionCooldown: number;
  /** Std-dev of gaussian noise applied to inherited traits; also how far creeds drift. */
  mutationRate: number;
  /** How much mastery of medicine can lengthen a life (0.5 = up to +50%). Wounds, sickness and hunger shorten it. */
  longevity: number;
  /** How strongly experiences reshape temperament (phenotype) during a life. 0 = never. */
  plasticity: number;
  /** Damage dealt by an attack, scaled by attacker aggression. */
  attackDamage: number;
  /** How readily ambition turns into open struggle for power (0 = orderly successions, 2 = constant strife). */
  strife: number;
  /** Crafting, goods and trade between agents. */
  economy: boolean;
  /** "instinct" = traits only, free and fast. "hybrid" = Claude sets intents, instinct executes. */
  brain: BrainMode;
  /** Default model; tribes can override it. */
  model: string;
  /** Fraction of agents (0-1) that have a Claude mind at all; the rest run on instinct only. */
  mindShare: number;
  /** Base number of ticks between an agent's thoughts; each stage scales it. */
  thinkInterval: number;
  stageMinds: Record<Stage, StageMind>;
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
  /** The historian writes an era report every N ticks (0 = only on demand). */
  historianEvery: number;
  /** Model the historian writes with, separate from the agents' minds. */
  historianModel: string;
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
  maxAgents: 3000,
  lifespanMin: 160,
  lifespanMax: 260,
  maxEnergy: 100,
  metabolism: 0.9,
  foodRegrowth: 1,
  reproductionCost: 28,
  childhoodEnd: 0.15,
  adolescenceEnd: 0.27,
  elderhoodStart: 0.75,
  reproductionCooldown: 25,
  mutationRate: 0.08,
  longevity: 0.5,
  plasticity: 1,
  attackDamage: 30,
  strife: 1,
  economy: true,
  brain: "instinct",
  model: "claude-haiku-5-5",
  mindShare: 0.5,
  thinkInterval: 20,
  stageMinds: {
    child: { effort: "off", every: 1 },
    adolescent: { effort: "low", every: 1.5 },
    adult: { effort: "medium", every: 1 },
    elder: { effort: "high", every: 0.75 },
  },
  thinkBatchSize: 8,
  maxConcurrentRequests: 4,
  waitForMinds: false,
  llmBreeding: true,
  budgetUsd: 2,
  seasons: true,
  historianEvery: 300,
  historianModel: "claude-sonnet-5-5",
};
