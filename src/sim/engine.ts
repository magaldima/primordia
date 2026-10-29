import { TECH_IDS, techByName, TECHS, type TechId } from "../../shared/tech";
import { truthAt, TRUTHS } from "../../shared/truths";
import {
  DEFAULT_PARAMS,
  DOMAINS,
  GOODS,
  STAGE_INTENTS,
  STAGES,
  TRAIT_KEYS,
  type Decision,
  type Direction,
  type Domain,
  type Effort,
  type Good,
  type GroupAction,
  type GroupAim,
  type HazardKind,
  type InsightKind,
  type Intent,
  type Inventory,
  type Perception,
  type Rect,
  type ScenarioSpec,
  type SimParams,
  type Stage,
  type Terrain,
  type TradeStance,
  type Traits,
} from "../../shared/types";
import { blendHue, blendTraits, childName, describeTraits, randomName, randomTraits, spliceCreeds, type Genome } from "./genome";
import { addToCanon, edge, emptyCanon, emptyUnderstanding, levelOf, totalLevels, type Belief, type Canon, type Understanding } from "./knowledge";
import { DISCOVERY, EXPERIENCE_DECAY, EXPERIENCES, METABOLISM, phenotype, PLASTICITY, stageOf, stageStartAge, zeroTraits, type Experience } from "./life";
import { clamp01, Rng } from "./rng";
import { inventNorm, mutateNorm, textEffects } from "./culture";
import { DEED_TEXT, emptyLedger, foundReligion, foundSect, judge, sinWeight, type Deed, type Ledger, type Religion } from "./religion";
import { ambition, BOND_DECAY, conformity, cultureShift, emptyStore, groupKind, MAX_BONDS, NORM_TEMPLATES, type Group } from "./social";
import { generateTerrain, TERRAIN, World } from "./world";
import type { AnnalEntry } from "./digest";

export interface Agent {
  id: number;
  name: string;
  tribe: string;
  /** Inherited. Only this is passed to children. */
  genome: Genome;
  /** Temperament as expressed now: genotype + stage + experience. Recomputed every tick. */
  traits: Traits;
  experience: Traits;
  stage: Stage;
  x: number;
  y: number;
  energy: number;
  age: number;
  /** Lifespan the body was born with. Growing up follows this clock. */
  baseLifespan: number;
  /** Lifespan as it now stands: lengthened by medicine, shortened by wear. Recomputed every tick. */
  lifespan: number;
  /** Ticks of life lost to wounds, sickness, hunger and the strain of violence. Heals slowly in good times. */
  wear: number;
  elderSince: number | null;
  /** 0-1: how fragile it has become. Frail elders lose their sway over others. */
  frailty: number;
  generation: number;
  parents: [number, number] | null;
  partner: number | null;
  childIds: number[];
  children: number;
  kills: number;
  lastBirthTick: number;
  sick: number;
  /** Survivors of the plague can't catch it again for a while. */
  immuneUntil: number;
  alive: boolean;
  causeOfDeath?: string;
  diedAt?: number;
  // Economy
  inventory: Inventory;
  skills: Record<Good, number>;
  craft: Good | null;
  workProgress: number;
  /** Food eaten past a full belly, accumulating toward a stored ration. */
  storeProgress: number;
  toolWear: number;
  /** Standing within its own tribe, 0-1. Cheating costs it; honesty slowly earns it back. */
  reputation: number;
  /** Ids of those who cheated this agent. */
  grudges: number[];
  /** Set by the mind; null = decide by temperament. */
  tradeStance: TradeStance | null;
  // Society
  /** Organizations that cast it out, and until when it is barred from returning. */
  exiledFrom: Map<number, number>;
  /** Feelings toward others, -1 (hatred) to 1 (devotion), for the strongest few relationships. */
  bonds: Map<number, number>;
  /** Whom this agent looks up to and follows. */
  follows: number | null;
  /** A mind's choice of whom to follow holds until then; instinct won't override it. */
  followLockedUntil: number;
  followers: number;
  /** Everyone who follows it, directly or through others. */
  influence: number;
  groupId: number | null;
  /** The pull of its group's norms on its temperament. */
  culture: Traits;
  /** Times it has given food to others: what the generous are admired for. */
  gifts: number;
  weaponWear: number;
  // Civilization
  techs: Set<TechId>;
  /** What it is researching and how far along (personal progress; an organization's project is pooled). */
  research: { target: TechId | null; progress: number };
  /** Its tongue: a point in "language space". Close tongues understand each other; contact pulls them together. */
  lang: number[];
  /** Resources it has come across (bit 1 ore, 2 clay, 4 herbs): one can only research what one has materials for. */
  resourcesSeen: number;
  /** Discoveries and completed research: what scholars are honoured for. */
  renown: number;
  /** Its deeds, as its faith (if any) would weigh them. */
  ledger: Ledger;
  religion: number | null;
  /** 0-1: how firmly it believes. */
  faith: number;
  /** The pull of its own creed on its temperament, cached against the creed's text. */
  creedShift: Traits;
  creedFor: string;
  /** Cells it has planted (field indices into the world grid). */
  fields: number[];
  // Knowledge
  understanding: Understanding;
  beliefs: Belief[];
  terrainsSeen: number;
  lastSeason: string;
  // Plans
  intent: Intent;
  intentTarget: number | null;
  intentDir: Direction;
  intentUntil: number;
  /** When it was last hurt (attacked): a reason to reconsider its plans at once. */
  lastHurt: number;
  /** Whether a trade partner was nearby when last checked, and when (re-checked every few ticks). */
  tradeSeen: { tick: number; found: boolean };
  heading: [number, number];
  thought: string;
  thoughtTick: number;
  speech: string;
  speechTick: number;
  memory: string[];
  nextThinkTick: number;
  thinking: boolean;
  creedPending: boolean;
}

export interface LogEntry {
  tick: number;
  kind: "birth" | "death" | "fight" | "share" | "speech" | "world" | "mind" | "system" | "trade" | "insight" | "society" | "invention";
  text: string;
  agentId?: number;
}

export interface StatSample {
  tick: number;
  population: number;
  births: number;
  deaths: number;
  avgEnergy: number;
  maxGeneration: number;
  /** Average inherited temperament (genotype). */
  traits: Traits;
  /** Average expressed temperament (phenotype). */
  expressed: Traits;
  tribes: Record<string, number>;
  stages: Record<Stage, number>;
  /** Average total levels of understanding among the living. */
  knowledge: number;
  /** Highest total canon level of any living tribe. */
  canon: number;
  trades: number;
  betrayals: number;
  avgReputation: number;
  groups: number;
  /** Share of non-children who belong to a group. */
  inGroups: number;
  largestGroup: number;
  /** Share of non-children who follow someone. */
  following: number;
  /** Most people anyone leads, directly or indirectly. */
  topInfluence: number;
  /** Distinct beliefs and norms held among the living: a measure of cultural diversity. */
  ideas: number;
  /** Average lifespan grown-ups can now expect (after medicine and wear). */
  lifeExpectancy: number;
  /** Sum of ages of those who died this tick (divide by deaths for the average). */
  deathAgeSum: number;
  /** Killings this tick: how violent the world is. */
  kills: number;
  avgWear: number;
  /** Share of grown-ups who farm. */
  farmers: number;
  fields: number;
  /** Rations held by everyone plus all common stores. */
  storedFood: number;
  /** Most inventions known by any one tribe's canon. */
  techs: number;
  /** People who left the board this tick. */
  emigrants: number;
  /** Organizations currently torn by a power struggle. */
  crises: number;
  /** Share of grown-ups researching right now. */
  researchers: number;
  /** Share of grown-ups who can read and write. */
  literacy: number;
  languages: number;
  wars: number;
  tribeCount: number;
  /** Average spread of inborn temperament within the population: diversity that selection hasn't erased. */
  traitDiversity: number;
  /** Distinct norms held by all organizations. */
  norms: number;
  religions: number;
  /** Share of grown-ups who hold a faith. */
  faithful: number;
  /** Members (including vassals and allies) of the largest realm. */
  largestRealm: number;
}

/** A birth that needs a creed blended by the mind. The UI layer hands these to Claude. */
export interface BreedJob {
  childId: number;
  parentA: Agent;
  parentB: Agent;
}

const DIRS: Record<Exclude<Direction, "none">, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};
const STEPS: [number, number][] = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

const TRAIL_FADE = 0.97;
/** Ticks an instinct decision holds before being reconsidered (urgent events override it). */
const INSTINCT_HOLD = 3;
/** Intents a leader's followers may take up as a collective call. */
const CALLS: Intent[] = ["migrate", "attack", "rally", "flee", "explore", "work", "emigrate"];
/** Relative worth of goods when agents haggle. */
const VALUE: Record<Good, number> = { rations: 1, tools: 3, medicine: 3, weapons: 4 };
/** Holdings above these count as surplus that can be traded away. */
const KEEP: Record<Good, number> = { rations: 2, tools: 1, medicine: 1, weapons: 1 };
const CAP: Record<Good, number> = { rations: 8, tools: 3, medicine: 3, weapons: 3 };
const RATION_ENERGY = 15;
const TERRAIN_BIT: Record<Terrain, number> = { plains: 1, forest: 2, water: 4, mountain: 8, desert: 16 };

const DEFAULT_CREED =
  "You are alive and wish to stay alive. Find food, avoid danger, and leave descendants who carry your ways forward.";

export class Engine {
  params: SimParams;
  rng: Rng;
  world: World;
  agents = new Map<number, Agent>();
  /** The dead, newest last, kept for lineage lookups. */
  graveyard: Agent[] = [];
  occupancy: Int32Array;
  /** The agent standing on each cell (parallel to occupancy), so neighbour scans avoid a map lookup per hit. */
  cellAgent: (Agent | undefined)[];
  /** Recent presence per cell (1 = here now, fading each tick) and the hue of whoever was last there. */
  trail: Float32Array;
  trailHue: Float32Array;
  tick = 0;
  log: LogEntry[] = [];
  stats: StatSample[] = [];
  worldEvents: { tick: number; text: string }[] = [];
  tribeHues = new Map<string, number>();
  /** Per-tribe model override for minds. */
  tribeModels = new Map<string, string>();
  canons = new Map<string, Canon>();
  /** Lifetime knowledge of the dead, by generation, for the "does each generation know more?" chart. */
  knowledgeByGeneration = new Map<number, { sum: number; n: number }>();
  scenario: ScenarioSpec | null = null;
  pendingBreeds: BreedJob[] = [];
  /** Insights voiced by minds, waiting to be judged against the world's real laws. */
  pendingInsights: { agentId: number; text: string; tick: number }[] = [];
  groups = new Map<number, Group>();
  /** The tongue each tribe started with. */
  languages = new Map<string, number[]>();
  religions = new Map<number, Religion>();
  /** Where the dead believed they were going (belief only: the world has no afterlife). Newest last. */
  hallOfDead: { name: string; tribe: string; religion: string; verdict: "heaven" | "hell" | "uncertain"; realm: string; tick: number; deeds: string }[] = [];
  /** This world's version of the tech tree: requirements and costs vary a little from world to world. */
  techTable = new Map<TechId, { domains: Partial<Record<Domain, number>>; techs: TechId[]; cost: number; needs: number }>();
  /** Important events kept for export (the live log only keeps recent ones). */
  archive: LogEntry[] = [];
  private nextReligionId = 1;
  /** The historian's reports, oldest first. */
  annals: AnnalEntry[] = [];
  /** Decrees waiting to have their effect on temperament judged. */
  pendingNorms: { groupId: number; text: string; tick: number }[] = [];
  private nextGroupId = 1;
  private nextId = 1;
  private births = 0;
  private deaths = 0;
  private deathAgeSum = 0;
  private kills = 0;
  private emigrants = 0;
  /** Everyone who has left the board, for lineage lookups. */
  emigrated = 0;
  /** Running totals of political events (the log only keeps recent entries). */
  tally: Record<string, number> = {};
  private trades = 0;
  private betrayals = 0;
  private scheduled: ScenarioSpec["events"] = [];
  private arrivals: ScenarioSpec["factions"] = [];

  constructor(params: Partial<SimParams> = {}, scenario: ScenarioSpec | null = null) {
    this.params = { ...DEFAULT_PARAMS, ...(scenario?.params ?? {}), ...params };
    // Nested settings are copied so changing one world's never leaks into the defaults or the next world.
    this.params.stageMinds = structuredClone(this.params.stageMinds);
    const p = this.params;
    this.rng = new Rng(p.seed);
    this.world = new World(p.width, p.height, scenario?.baseTerrain ?? "plains");
    this.occupancy = new Int32Array(p.width * p.height);
    this.cellAgent = new Array(p.width * p.height);
    this.trail = new Float32Array(p.width * p.height);
    this.trailHue = new Float32Array(p.width * p.height);
    this.scenario = scenario;
    if (scenario) {
      for (const r of scenario.regions) this.world.paint(r.rect, r.terrain);
      this.world.seedFood();
      this.scheduled = [...scenario.events].sort((a, b) => a.tick - b.tick);
      for (const f of scenario.factions) {
        this.tribeHues.set(f.name, hexToHue(f.color));
        if (f.model) this.tribeModels.set(f.name, f.model);
        if (f.arriveAt > 0) this.arrivals.push(f);
        else this.spawnFaction(f);
      }
      this.arrivals.sort((a, b) => a.arriveAt - b.arriveAt);
      this.logEvent("system", `Scenario: ${scenario.title}. ${scenario.description}`);
    } else {
      generateTerrain(this.world, p.seed);
      const tribes = ["Ash", "Reed", "Stone", "Tide"];
      tribes.forEach((t, i) => this.tribeHues.set(t, (i * 360) / tribes.length + 20));
      for (let i = 0; i < p.initialAgents; i++) this.spawn({ tribe: tribes[i % tribes.length] });
    }
    this.world.placeResources(p.seed);
    this.buildTechTable();
    this.recordStats();
  }

  /** Each world's tree differs a little (requirements ±1, costs ±30%), and some inventions need local materials. */
  private buildTechTable() {
    const rng = new Rng(this.params.seed * 31337 + 11);
    // Bitmasks of materials (1 ore, 2 clay, 4 herbs and reeds): any one suffices. Writing can be on clay or on reed-paper.
    const NEEDS: Partial<Record<TechId, number>> = { metalwork: 1, weaponry: 1, ironworking: 1, storage: 2, writing: 2 | 4, herbalism: 4, surgery: 4 };
    for (const id of TECH_IDS) {
      const t = TECHS[id];
      const domains = Object.fromEntries(Object.entries(t.domains).map(([d, l]) => [d, Math.max(1, l! + (rng.chance(0.3) ? (rng.chance(0.5) ? 1 : -1) : 0))]));
      this.techTable.set(id, { domains, techs: t.techs, cost: Math.round(t.cost * rng.range(0.7, 1.35)), needs: NEEDS[id] ?? 0 });
    }
  }

  /** Inventions this agent could research now, in this world: prerequisites, understanding and materials. */
  frontierFor(a: Agent, level: (d: Domain) => number = (d) => levelOf(a.understanding[d])): TechId[] {
    return TECH_IDS.filter((id) => {
      if (a.techs.has(id)) return false;
      const t = this.techTable.get(id)!;
      return t.techs.every((x) => a.techs.has(x)) && Object.entries(t.domains).every(([d, l]) => level(d as Domain) >= l!) && (!t.needs || (a.resourcesSeen & t.needs) !== 0);
    });
  }

  techCost(id: TechId) {
    return this.techTable.get(id)!.cost;
  }

  // --- Spawning

  spawnFaction(f: ScenarioSpec["factions"][number]) {
    // A lone founder gets exactly the traits it was given and starts as a young adult; crowds vary a little.
    const exact = f.count === 1;
    for (let i = 0; i < f.count; i++)
      this.spawn({
        tribe: f.name,
        creed: f.creed,
        area: f.spawn,
        ...(exact ? { traits: { ...f.traits }, stage: "adult" as Stage, energy: this.params.maxEnergy * 0.7 } : { traits: jitterTraits(f.traits, this.rng) }),
      });
  }

  spawn(opts: { tribe: string; creed?: string; traits?: Traits; area?: Rect; x?: number; y?: number; stage?: Stage; energy?: number }): Agent | null {
    const pos = opts.x !== undefined && opts.y !== undefined ? { x: opts.x, y: opts.y } : this.findFreeCell(opts.area);
    if (!pos || this.occupancy[this.world.idx(pos.x, pos.y)]) return null;
    const p = this.params;
    if (!this.tribeHues.has(opts.tribe)) this.tribeHues.set(opts.tribe, this.rng.range(0, 360));
    const a = this.makeAgent({
      name: randomName(this.rng),
      tribe: opts.tribe,
      genome: { traits: opts.traits ?? randomTraits(this.rng), creed: opts.creed ?? DEFAULT_CREED, hue: this.tribeHues.get(opts.tribe)! },
      x: pos.x,
      y: pos.y,
      energy: opts.energy ?? p.maxEnergy * this.rng.range(0.5, 0.8),
      age: 0,
      generation: 0,
      parents: null,
    });
    // First settlers are of working age: mostly adults, a few adolescents.
    a.age = opts.stage
      ? stageStartAge(opts.stage, a.lifespan, p) + 1
      : Math.round(a.lifespan * this.rng.range(p.childhoodEnd + 0.04, (p.adolescenceEnd + p.elderhoodStart) / 2));
    this.updateSelf(a);
    return a;
  }

  private makeAgent(init: Pick<Agent, "name" | "tribe" | "genome" | "x" | "y" | "energy" | "age" | "generation" | "parents">): Agent {
    const p = this.params;
    const a: Agent = {
      ...init,
      id: this.nextId++,
      traits: { ...init.genome.traits },
      experience: zeroTraits(),
      stage: "child",
      baseLifespan: 0,
      lifespan: Math.round(this.rng.range(p.lifespanMin, p.lifespanMax)),
      wear: 0,
      elderSince: null,
      frailty: 0,
      partner: null,
      childIds: [],
      children: 0,
      kills: 0,
      lastBirthTick: -9999,
      sick: 0,
      immuneUntil: 0,
      alive: true,
      inventory: { rations: 0, tools: 0, medicine: 0, weapons: 0 },
      skills: { rations: 0, tools: 0, medicine: 0, weapons: 0 },
      weaponWear: 0,
      craft: null,
      workProgress: 0,
      storeProgress: 0,
      toolWear: 0,
      reputation: 0.5,
      grudges: [],
      tradeStance: null,
      bonds: new Map(),
      exiledFrom: new Map(),
      follows: null,
      followLockedUntil: 0,
      followers: 0,
      influence: 0,
      groupId: null,
      culture: zeroTraits(),
      gifts: 0,
      techs: new Set(),
      research: { target: null, progress: 0 },
      lang: [],
      resourcesSeen: 0,
      renown: 0,
      ledger: emptyLedger(),
      religion: null,
      faith: 0,
      creedShift: zeroTraits(),
      creedFor: "",
      fields: [],
      understanding: emptyUnderstanding(),
      beliefs: [],
      terrainsSeen: 0,
      lastSeason: this.world.seasonName(this.tick),
      intent: "play",
      intentTarget: null,
      intentDir: "none",
      intentUntil: 0,
      lastHurt: -999,
      tradeSeen: { tick: -999, found: false },
      heading: this.rng.pick(STEPS),
      thought: "",
      thoughtTick: -1,
      speech: "",
      speechTick: -999,
      memory: [],
      nextThinkTick: this.tick + this.rng.int(0, p.thinkInterval),
      thinking: false,
      creedPending: false,
    };
    a.baseLifespan = a.lifespan;
    if (!a.lang.length) a.lang = this.tongueOf(a.tribe).map((v) => v + this.rng.gaussian() * 0.01);
    this.agents.set(a.id, a);
    this.occupancy[this.world.idx(a.x, a.y)] = a.id;
    this.cellAgent[this.world.idx(a.x, a.y)] = a;
    if (!this.canons.has(a.tribe)) this.canons.set(a.tribe, emptyCanon());
    return a;
  }

  private findFreeCell(area?: Rect): { x: number; y: number } | null {
    const w = this.world;
    const r = area ?? { x: 0, y: 0, w: w.width, h: w.height };
    for (let tries = 0; tries < 400; tries++) {
      const x = Math.floor(this.rng.range(Math.max(0, r.x), Math.min(w.width, r.x + r.w)));
      const y = Math.floor(this.rng.range(Math.max(0, r.y), Math.min(w.height, r.y + r.h)));
      if (w.passable(x, y) && !this.occupancy[w.idx(x, y)]) return { x, y };
    }
    return area ? this.findFreeCell() : null;
  }

  // --- Main loop

  step() {
    const p = this.params;
    this.tick++;
    this.births = this.deaths = this.trades = this.betrayals = this.deathAgeSum = this.kills = this.emigrants = 0;

    while (this.scheduled.length && this.scheduled[0].tick <= this.tick) {
      const ev = this.scheduled.shift()!;
      if (ev.kind === "narration") this.narrate(ev.message);
      else this.addHazard(ev.kind, ev.rect, ev.message);
    }
    while (this.arrivals.length && this.arrivals[0].arriveAt <= this.tick) {
      const f = this.arrivals.shift()!;
      this.spawnFaction(f);
      this.narrate(`The ${f.name} arrive.`);
    }

    this.world.updateHazards(this.rng);
    this.world.regrow(this.tick, p.foodRegrowth, p.seasons);
    if (this.world.fieldCount) {
      const drought = this.world.droughtMask();
      this.world.growCrops(this.tick, p.seasons, (i) => drought[i] === 1);
    }

    const order = this.rng.shuffle([...this.agents.values()]);
    for (const a of order) {
      if (!a.alive) continue;
      this.live(a);
    }
    if (this.tick % 10 === 0) {
      this.society();
      this.world.restSoil();
      this.erodeCanons();
      this.governRealms();
    }
    if (this.tick % 50 === 0) {
      this.ethnogenesis();
      this.sectarianism();
    }
    if (this.tick % 25 === 0) this.crowdDisease();
    for (let i = 0; i < this.trail.length; i++) this.trail[i] *= TRAIL_FADE;
    for (const a of this.agents.values()) {
      const i = this.world.idx(a.x, a.y);
      this.trail[i] = 1;
      this.trailHue[i] = a.genome.hue;
    }
    // Tribes that have died out take their canon with them.
    if (this.tick % 25 === 0) {
      const living = new Set([...this.agents.values()].map((a) => a.tribe));
      for (const t of [...this.canons.keys()])
        if (!living.has(t) && !this.arrivals.some((f) => f.name === t)) {
          this.canons.delete(t);
          this.logEvent("system", `The ${t} are gone, and everything they knew is lost with them.`);
        }
    }
    this.recordStats();
  }

  /** Stage and phenotype follow from age and experience. */
  private updateSelf(a: Agent) {
    const prev = a.stage;
    // Medicine lengthens life; wear shortens it. When age reaches it, the agent dies (checked in live()).
    a.lifespan = Math.max(1, Math.round(a.baseLifespan * (1 + this.params.longevity * edge(a.understanding.medicine)) - a.wear));
    a.stage = stageOf(a.age, a.baseLifespan, a.lifespan, a.elderSince !== null, this.params);
    if (a.stage === "elder" && a.elderSince === null) a.elderSince = a.age;
    a.frailty = this.frailtyOf(a);
    for (const k of TRAIT_KEYS) a.experience[k] *= EXPERIENCE_DECAY;
    // One's own creed pulls on temperament too, more so for those who hold to things.
    if (a.creedFor !== a.genome.creed) {
      a.creedFor = a.genome.creed;
      const fx = textEffects(a.genome.creed);
      a.creedShift = Object.fromEntries(TRAIT_KEYS.map((k) => [k, (fx[k] ?? 0) * 0.1])) as Traits;
    }
    const pull = zeroTraits();
    for (const k of TRAIT_KEYS) pull[k] = a.culture[k] + a.creedShift[k] * conformity(a.genome.traits, a.stage === "adolescent");
    a.traits = phenotype(a.genome.traits, a.stage, a.experience, pull);
    const res = this.world.resource[this.world.idx(a.x, a.y)];
    if (res) a.resourcesSeen |= res === 3 ? 4 : res;
    if (prev !== a.stage && a.age > 1) this.onStageChange(a, prev);
  }

  /** Frailty rises through elderhood toward death, and with heavy wear at any age. */
  private frailtyOf(a: Agent): number {
    const worn = Math.min(1, a.wear / (a.baseLifespan * 0.35));
    if (a.elderSince === null) return worn * 0.6;
    const through = (a.age - a.elderSince) / Math.max(1, a.lifespan - a.elderSince);
    return clamp01(through * 0.85 + worn * 0.4);
  }

  /** Lasting harm: wounds, sickness, hunger and witnessed violence all take time off a life. */
  private harm(a: Agent, ticks: number) {
    a.wear += ticks * (1 - 0.5 * edge(a.understanding.medicine));
  }

  /** In good times the body slowly mends; skill in medicine, a healer close by, or medicine itself speed it up. */
  private mend(a: Agent) {
    if (a.wear <= 0 || a.sick || a.energy < this.params.maxEnergy * 0.55) return;
    let rate = 0.03 * (1 + 2 * edge(a.understanding.medicine)) * (this.knows(a, "herbalism") ? 1.5 : 1);
    const healer = this.neighbours(a, 3).find((n) => n.craft === "medicine" && n.stage !== "child" && (n.tribe === a.tribe || (n.groupId !== null && n.groupId === a.groupId)));
    if (healer) rate += 0.04 * (1 + healer.skills.medicine);
    if (a.wear > 15 && a.inventory.medicine > 0 && this.rng.chance(0.02)) {
      a.inventory.medicine--;
      a.wear -= this.knows(a, "surgery") ? 25 : 10;
      this.remember(a, "had wounds treated with medicine");
      this.evidence(a, "medicine", 0.2);
    }
    a.wear = Math.max(0, a.wear - rate);
  }

  private onStageChange(a: Agent, prev: Stage) {
    this.remember(a, `became ${a.stage === "adult" ? "an adult" : a.stage === "elder" ? "an elder" : `an ${a.stage}`}`);
    // A stage change is a new way of seeing the world: think about it soon.
    a.nextThinkTick = Math.min(a.nextThinkTick, this.tick);
    a.intentUntil = 0;
    if (prev === "child")
      for (const pid of a.parents ?? []) {
        const parent = this.agents.get(pid);
        if (parent) this.evidence(parent, "kinship", 0.3);
      }
    if (a.stage === "adolescent" && !a.craft) a.craft = this.inheritedCraft(a);
  }

  private live(a: Agent) {
    const p = this.params;
    a.age++;
    this.updateSelf(a);
    const t = a.traits;

    let burn = p.metabolism * METABOLISM[a.stage] * (0.85 + t.aggression * 0.3);
    const here = this.world.terrainAt(a.x, a.y);
    if (here === "desert") burn += 0.4;
    const season = this.world.seasonName(this.tick);
    if (p.seasons && season === "winter") burn *= 1.1 - 0.25 * edge(a.understanding.seasons) - (this.knows(a, "calendar") ? 0.07 : 0);
    if (season !== a.lastSeason) {
      a.lastSeason = season;
      if (a.stage !== "child" && p.seasons) this.evidence(a, "seasons", 0.25);
    }
    if (!(a.terrainsSeen & TERRAIN_BIT[here])) {
      a.terrainsSeen |= TERRAIN_BIT[here];
      this.evidence(a, "ecology", 0.3);
    }

    for (const h of this.world.hazardsAt(a.x, a.y)) {
      if (h.kind === "fire") burn += 12;
      if (h.kind === "plague" && !a.sick && this.rng.chance(0.15 * (1 - 0.7 * edge(a.understanding.medicine)))) this.infect(a);
    }
    if (a.sick > 0) {
      burn += 1.6;
      a.sick--;
      this.harm(a, 0.25);
      this.evidence(a, "medicine", 0.01);
      if (a.inventory.medicine > 0) {
        a.inventory.medicine--;
        a.sick = 0;
        a.immuneUntil = this.tick + 150;
        this.remember(a, "was cured by medicine");
        this.evidence(a, "medicine", 0.5);
      } else if (a.sick === 0) {
        a.immuneUntil = this.tick + 150;
        this.remember(a, "recovered from the plague");
        this.evidence(a, "medicine", 0.5);
      }
      for (const n of this.neighbours(a, 1.5))
        if (!n.sick && this.rng.chance(0.06 * (1 - n.traits.caution * 0.5) * (1 - 0.7 * edge(n.understanding.medicine)) * (this.knows(n, "sanitation") ? 0.5 : 1))) this.infect(n);
    }

    a.energy -= a.intent === "rest" ? burn * 0.5 : burn;
    if (a.energy < p.maxEnergy * 0.15) this.harm(a, 0.15);
    else this.mend(a);
    // Standing recovers only slowly: a cheat's name follows them.
    a.reputation += (0.5 - a.reputation) * 0.0004;

    // Anyone but a child can eat from their own stores when hungry.
    if (a.stage !== "child" && a.energy < p.maxEnergy * 0.4 && a.inventory.rations > 0) {
      a.inventory.rations--;
      a.energy = Math.min(p.maxEnergy, a.energy + RATION_ENERGY);
    }

    this.spoil(a);
    if (a.stage !== "child" && (this.tick + a.id) % 20 === 0) this.tryInvent(a);
    if (a.energy <= 0) return this.kill(a, a.sick ? "plague" : this.world.hazardsAt(a.x, a.y).some((h) => h.kind === "fire") ? "fire" : "starvation");
    if (a.age >= a.lifespan) return this.kill(a, "old age");

    if (a.stage === "child") this.beCared(a);
    if (a.stage === "elder") {
      this.beHonoured(a);
      // Reflection: an elder keeps distilling a lifetime of experience into understanding, so the
      // longer it lives, the more it has to pass on. Deepens what it already knows; doesn't invent new fields.
      if (a.frailty < 0.85) {
        const known = DOMAINS.filter((d) => a.understanding[d] > 0);
        if (known.length) this.evidence(a, this.rng.pick(known), 0.025 * (1 - a.frailty * 0.5));
      }
    }

    const allowed = STAGE_INTENTS[a.stage];
    if (!allowed.includes(a.intent)) a.intentUntil = 0;
    // Instinct holds a plan for a few ticks, but drops it at once when something urgent happens.
    const urgent =
      (a.energy < p.maxEnergy * 0.3 && a.intent !== "forage" && a.intent !== "hoard" && a.intent !== "farm" && a.intent !== "emigrate" && a.intent !== "rest") ||
      this.tick - a.lastHurt < 2 ||
      this.world.hazardsAt(a.x, a.y).some((h) => h.kind !== "bounty");
    if (this.tick >= a.intentUntil || urgent || (a.intentTarget !== null && !this.agents.get(a.intentTarget)?.alive)) this.chooseInstinct(a);
    this.act(a);
  }

  private infect(a: Agent) {
    if (a.sick || this.tick < a.immuneUntil) return;
    a.sick = 40;
    this.remember(a, "fell sick with plague");
  }

  // --- Childhood and old age: dependence on others

  /** Children are nursed by an adjacent parent, or failing that by kind kin. They also soak up their tribe's canon. */
  private beCared(c: Agent) {
    const p = this.params;
    if (c.energy < p.maxEnergy * 0.85) {
      const adj = this.neighbours(c, 1.5).filter((n) => n.stage !== "child" && n.energy > 35);
      const parent = adj.find((n) => c.parents?.includes(n.id));
      const carer = parent ?? adj.find((n) => n.tribe === c.tribe && this.rng.chance(n.traits.cooperation * 0.6));
      if (carer) {
        if (!parent && this.rng.chance(0.1)) this.deed(carer, "care");
        const amt = (parent ? 3 : 1.5) * (1 + 0.5 * edge(carer.understanding.kinship));
        carer.energy -= amt * 0.8;
        c.energy = Math.min(p.maxEnergy, c.energy + amt);
        this.bond(c, carer, 0.004);
        this.evidence(carer, "kinship", 0.002);
        if (this.rng.chance(0.02)) this.feel(c, "fed");
      }
    }
    const canon = this.canons.get(c.tribe);
    if (canon && this.neighbours(c, 3).some((n) => n.tribe === c.tribe && n.stage !== "child")) {
      const written = canon.techs.has("writing") ? 3 : 1;
      for (const id of canon.techs) if (!c.techs.has(id) && this.rng.chance(0.004 * written)) this.learnTech(c, id);
    }
    if (canon && this.neighbours(c, 3).some((n) => n.tribe === c.tribe && n.stage !== "child"))
      for (const d of DOMAINS)
        if (c.understanding[d] < canon.understanding[d]) c.understanding[d] += 0.004 * PLASTICITY.child * p.plasticity + 0.002;
  }

  /** Elders don't gather; kin who respect them share what they have. */
  private beHonoured(e: Agent) {
    const p = this.params;
    if (e.energy > p.maxEnergy * 0.7) return;
    const giver = this.neighbours(e, 1.5).find(
      (n) => n.tribe === e.tribe && (n.stage === "adult" || n.stage === "adolescent") && n.energy > p.maxEnergy * 0.5 &&
        e.reputation > 0.25 && this.rng.chance(n.traits.cooperation * (0.4 + e.reputation)),
    );
    if (giver) {
      giver.energy -= 2.5;
      e.energy = Math.min(p.maxEnergy, e.energy + 2.5);
      if (this.rng.chance(0.1)) this.deed(giver, "care");
      this.bond(e, giver, 0.03);
      this.bond(giver, e, 0.01);
      if (this.rng.chance(0.02)) this.remember(e, `was fed by ${giver.name}`);
    }
  }

  // --- Instinct: a stage- and temperament-weighted utility choice, cheap enough to run every tick.

  private chooseInstinct(a: Agent) {
    const t = a.traits;
    const p = this.params;
    const hunger = 1 - a.energy / p.maxEnergy;
    const near = this.neighbours(a, 6);
    const strangers = near.filter((n) => (n.tribe !== a.tribe || this.isEnemy(a, n)) && n.stage !== "child" && !this.isKin(a, n));
    const kin = near.filter((n) => n.tribe === a.tribe);
    const danger = this.world.hazardsAt(a.x, a.y).some((h) => h.kind !== "bounty") ||
      strangers.some((s) => s.traits.aggression > 0.65 && s.energy > a.energy && s.stage !== "elder");
    const young = kin.filter((n) => n.stage === "child" || n.stage === "adolescent");
    const ownHungryChild = a.childIds
      .map((id) => this.agents.get(id))
      .find((c) => c && c.stage === "child" && c.energy < p.maxEnergy * 0.55 && this.dist(a, c) <= 10);

    const u: Partial<Record<Intent, number>> = {};
    if (a.stage === "child") {
      u.play = 1;
      if (danger) u.flee = 0.4 + t.caution;
    } else if (a.stage === "elder") {
      u.rest = 0.2;
      u.rally = kin.length ? 0.3 : 0;
      if (young.length) u.teach = 0.6 + t.cooperation * 0.4;
      if (kin.some((k) => k.energy < p.maxEnergy * 0.3) && a.inventory.rations > 0) u.share = t.cooperation * 0.8;
      if (p.economy && this.tradeNearby(a)) u.trade = 0.45;
      if (danger) u.flee = 0.3 + t.caution * 0.9;
      if (hunger > 0.7 && !kin.some((k) => k.energy > p.maxEnergy * 0.5)) u.emigrate = 0.4 + t.curiosity * 0.3;
    } else {
      u.forage = hunger * 1.6 + t.greed * 0.2;
      u.explore = t.curiosity * (a.stage === "adolescent" ? 0.7 : 0.4);
      u.rest = 0.08 + (1 - t.curiosity) * 0.1;
      u.rally = kin.length ? t.cooperation * 0.25 : 0;
      u.hoard = hunger < 0.3 ? t.greed * 0.35 : 0;
      if (p.economy) {
        const autumn = p.seasons && this.world.seasonName(this.tick) === "autumn" ? 0.4 * edge(a.understanding.seasons) : 0;
        u.work = hunger < 0.6 ? 0.45 + Math.min(1, a.craft ? a.skills[a.craft] : 0) * 0.4 + autumn : 0;
        if (this.tradeNearby(a)) u.trade = 0.5 + t.greed * 0.2;
      }
      // When the land can't feed everyone, some leave for whatever lies beyond the edge of the world.
      const crowd = this.neighbours(a, 4).length;
      const scarce = hunger > 0.5 && (crowd >= 10 || !this.bestFoodNear(a, 6));
      if (scarce && a.inventory.rations === 0) u.emigrate = (hunger * 0.8 + crowd * 0.03) * (0.5 + t.curiosity) - a.fields.length * 0.2;
      if (this.knows(a, "agriculture")) {
        const ripe = a.fields.some((i) => this.world.crop[i] >= 1);
        const untended = a.fields.some((i) => this.tick - this.world.tended[i] > 30);
        // Settled temperaments take to farming; the restless keep roaming.
        u.farm = 0.35 + (ripe ? 0.9 : 0) + (untended ? 0.4 : 0) + (a.fields.length < 2 ? 0.25 : 0) + t.caution * 0.2 - t.curiosity * 0.2;
      }
      if (this.canMate(a)) {
        const partner = a.partner !== null ? this.agents.get(a.partner) : undefined;
        u.seek_mate = t.fertility * (a.energy / p.maxEnergy) * 1.2 + 0.1 + (partner && this.canMate(partner) ? 0.2 : 0) + this.zeal(a, "children") * 0.2;
      }
      if (strangers.length) u.attack = (t.aggression * (1 - t.cooperation) * 0.9 + hunger * t.aggression * 0.6 + (a.stage === "adolescent" ? 0.1 : 0)) * (1 - this.restraint(a, "kill"));
      if (ownHungryChild && a.energy > p.maxEnergy * 0.4) u.share = 0.7 + t.cooperation * 0.6;
      else if (kin.some((k) => k.stage !== "child" && k.energy < p.maxEnergy * 0.3) && a.energy > p.maxEnergy * 0.55)
        u.share = t.cooperation * (1 - t.greed) * 0.9 + this.zeal(a, "gift") * 0.3;
      if (a.stage === "adult" && young.length && totalLevels(a.understanding) > 0) u.teach = 0.1 + t.cooperation * 0.2;
      if (danger) u.flee = 0.3 + t.caution * 0.9;
    }

    // Leisure for study: the well-fed, healthy and secure may research.
    if (STAGE_INTENTS[a.stage].includes("research") && this.canResearch(a) && !danger)
      u.research = 0.2 + t.curiosity * 0.6 + (a.stage === "elder" ? 0.2 : 0) + (a.research.progress > 0 ? 0.2 : 0) + (this.knows(a, "writing") ? 0.1 : 0);

    // Answer the leader: loyal, conforming members who understand it take up what it is doing and what the group is for.
    const g = this.group(a);
    const leader = g ? this.leaderOf(g) : undefined;
    let answering: Agent | null = null;
    if (g && leader && leader.id !== a.id) {
      const loyalty = clamp01((a.bonds.get(leader.id) ?? 0) + 0.4) * conformity(a.genome.traits, a.stage === "adolescent") * (0.4 + 0.6 * this.intelligibility(a, leader));
      if (this.dist(a, leader) < 25 && CALLS.includes(leader.intent) && STAGE_INTENTS[a.stage].includes(leader.intent)) {
        u[leader.intent] = (u[leader.intent] ?? 0) + loyalty * 0.9;
        answering = leader;
      }
      const can = (i: Intent) => STAGE_INTENTS[a.stage].includes(i);
      if (g.aim === "research" && can("research") && this.canResearch(a)) u.research = (u.research ?? 0) + loyalty * 0.7;
      if (g.aim === "farm" && can("farm") && this.knows(a, "agriculture")) u.farm = (u.farm ?? 0) + loyalty * 0.6;
      if (g.aim === "trade" && can("work")) u.work = (u.work ?? 0) + loyalty * 0.5;
      if (g.war && can("attack")) {
        // A faith that sanctifies killing the enemy makes holy warriors.
        if (strangers.some((n) => this.isEnemy(a, n))) u.attack = (u.attack ?? 0) + loyalty * 0.9 + t.aggression * 0.3 + this.zeal(a, "warKill") * 0.4;
        else if (can("work") && a.craft === "weapons") u.work = (u.work ?? 0) + loyalty * 0.4;
      }
    }

    let best: Intent = STAGE_INTENTS[a.stage][0];
    let bestScore = -Infinity;
    for (const [k, v] of Object.entries(u) as [Intent, number][]) {
      const s = v + this.rng.next() * 0.15;
      if (s > bestScore) {
        bestScore = s;
        best = k;
      }
    }
    a.intent = best;
    a.intentTarget = best === "share" && ownHungryChild ? ownHungryChild.id : null;
    a.intentDir = "none";
    if (answering && best === answering.intent) {
      a.intentTarget = answering.intentTarget;
      a.intentDir = answering.intentDir;
    }
    a.intentUntil = this.tick + INSTINCT_HOLD;
  }

  // --- Acting on an intent (shared by instinct and mind)

  private act(a: Agent, intent: Intent = a.intent): void {
    const p = this.params;
    const hungry = a.energy < p.maxEnergy * 0.75;
    const forager = a.stage === "adolescent" || a.stage === "adult";
    const canEat = (min: number) => forager && this.world.food[this.world.idx(a.x, a.y)] >= min;
    switch (intent) {
      case "play":
        return this.play(a);
      case "forage": {
        if (canEat(1)) return this.eat(a, 3);
        if (hungry && forager) {
          const field = this.stealableField(a);
          if (field !== null && this.rng.chance((a.traits.greed * (1 - a.traits.cooperation) + (a.energy < p.maxEnergy * 0.25 ? 0.3 : 0)) * (1 - this.restraint(a, "theft")))) return this.harvest(a, field);
        }
        const goal = this.bestFoodNear(a, 4 + Math.round(3 * edge(a.understanding.ecology)));
        return goal ? this.moveToward(a, goal.x, goal.y) : this.wander(a);
      }
      case "hoard":
        if (canEat(0.5)) return this.eat(a, 6);
        return this.act(a, "forage");
      case "explore":
        if (hungry && canEat(2)) return this.eat(a, 2);
        return this.wander(a);
      case "migrate": {
        if (hungry && canEat(2)) return this.eat(a, 2);
        if (a.intentDir === "none") return this.wander(a);
        const [dx, dy] = DIRS[a.intentDir];
        return this.moveToward(a, a.x + dx * 5, a.y + dy * 5);
      }
      case "rest":
        if (hungry && canEat(1)) this.eat(a, 2);
        return;
      case "rally": {
        // Gather around one's leader if one has a group; otherwise around the tribe.
        const g = this.group(a);
        const leader = g ? this.leaderOf(g) : undefined;
        if (leader && leader.id !== a.id) {
          if (this.dist(a, leader) <= 2) return hungry && canEat(1) ? this.eat(a, 2) : undefined;
          return this.moveToward(a, leader.x, leader.y);
        }
        const kin = this.neighbours(a, 10).filter((n) => n.tribe === a.tribe);
        if (!kin.length) return this.wander(a);
        const cx = kin.reduce((s, k) => s + k.x, 0) / kin.length;
        const cy = kin.reduce((s, k) => s + k.y, 0) / kin.length;
        if (Math.hypot(cx - a.x, cy - a.y) < 2) return hungry && canEat(1) ? this.eat(a, 2) : undefined;
        return this.moveToward(a, Math.round(cx), Math.round(cy));
      }
      case "flee": {
        const threats = this.neighbours(a, 5).filter((n) => n.tribe !== a.tribe && n.traits.aggression > 0.5 && n.stage !== "child");
        let vx = 0;
        let vy = 0;
        for (const t of threats) {
          vx += a.x - t.x;
          vy += a.y - t.y;
        }
        for (const h of this.world.hazards) {
          if (h.kind === "bounty") continue;
          const hx = h.rect.x + h.rect.w / 2;
          const hy = h.rect.y + h.rect.h / 2;
          const d = Math.hypot(a.x - hx, a.y - hy);
          if (d < Math.max(h.rect.w, h.rect.h) + 4) {
            vx += ((a.x - hx) / (d + 0.1)) * 4;
            vy += ((a.y - hy) / (d + 0.1)) * 4;
          }
        }
        if (!vx && !vy) return a.stage === "child" ? this.play(a) : this.wander(a);
        return this.moveToward(a, a.x + Math.sign(vx) * 4, a.y + Math.sign(vy) * 4);
      }
      case "seek_mate": {
        if (!this.canMate(a)) return this.act(a, "forage");
        const partner = a.partner !== null ? this.agents.get(a.partner) : undefined;
        const mate = partner && this.canMate(partner) && this.dist(a, partner) < 15
          ? partner
          : this.resolveTarget(a, 8, (n) => this.canMate(n) && (n.partner === null || !this.agents.get(n.partner)));
        if (!mate) return this.wander(a);
        if (this.dist(a, mate) <= 1.5) return this.tryMate(a, mate);
        return this.moveToward(a, mate.x, mate.y);
      }
      case "attack": {
        // Instinct never turns on close family; only a mind's deliberate choice can.
        const foe = this.resolveTarget(a, 6, (n) => ((n.tribe !== a.tribe || this.isEnemy(a, n)) && n.stage !== "child" && !this.isKin(a, n)) || a.intentTarget === n.id, (n) => (this.isEnemy(a, n) ? -50 : 0) + this.dist(a, n));
        if (!foe) return this.act(a, "forage");
        if (this.dist(a, foe) <= 1.5) return this.attack(a, foe);
        return this.moveToward(a, foe.x, foe.y);
      }
      case "share": {
        const friend = this.resolveTarget(a, 8, (n) => n.energy < a.energy - 10, (n) => (n.tribe === a.tribe ? -100 : 0) + (a.childIds.includes(n.id) ? -200 : 0) + n.energy);
        if (!friend || (a.energy < 25 && a.inventory.rations === 0)) return a.stage === "elder" ? this.act(a, "rest") : this.act(a, "forage");
        if (this.dist(a, friend) <= 1.5) return this.share(a, friend);
        return this.moveToward(a, friend.x, friend.y);
      }
      case "work":
        if (!p.economy) return this.act(a, "forage");
        return this.work(a);
      case "trade": {
        if (!p.economy) return this.act(a, "rest");
        const partner = this.findTradePartner(a, this.knows(a, "wheel") ? 20 : 12);
        if (!partner) return this.act(a, a.stage === "elder" ? "rest" : "forage");
        if (this.dist(a, partner.who) <= 1.5) return this.trade(a, partner.who, partner.give, partner.get);
        return this.moveToward(a, partner.who.x, partner.who.y);
      }
      case "teach":
        return this.teach(a);
      case "farm":
        return this.farm(a);
      case "emigrate":
        return this.headForEdge(a);
      case "research":
        return this.research(a);
    }
  }

  private play(c: Agent) {
    // Stay close to a parent (or any grown-up of the tribe) and roam a little around them.
    const guardian =
      (c.parents ?? []).map((id) => this.agents.get(id)).filter((x): x is Agent => !!x).sort((x, y) => this.dist(c, x) - this.dist(c, y))[0] ??
      this.neighbours(c, 8).find((n) => n.tribe === c.tribe && n.stage !== "child");
    if (guardian && this.dist(c, guardian) > 1) return this.moveToward(c, guardian.x, guardian.y);
    if (this.rng.chance(0.3)) this.wander(c);
    if (this.rng.chance(0.01)) this.evidence(c, "ecology", 0.05);
  }

  private resolveTarget(a: Agent, radius: number, ok: (n: Agent) => boolean, score?: (n: Agent) => number): Agent | null {
    if (a.intentTarget !== null) {
      const t = this.agents.get(a.intentTarget);
      if (t?.alive && this.dist(a, t) <= radius * 2) return t;
    }
    const cands = this.neighbours(a, radius).filter(ok);
    if (!cands.length) return null;
    const s = score ?? ((n: Agent) => this.dist(a, n));
    return cands.reduce((b, n) => (s(n) < s(b) ? n : b));
  }

  canMate(a: Agent) {
    const p = this.params;
    return (
      a.stage === "adult" &&
      this.tick - a.lastBirthTick >= p.reproductionCooldown &&
      a.energy > p.reproductionCost + 15 &&
      this.agents.size < p.maxAgents // performance guard only; scarcity is the real limit
    );
  }

  private tryMate(a: Agent, b: Agent) {
    const tb = b.traits;
    const bonded = a.partner === b.id;
    // The partner consents if it also wants to mate, its mind chose this partner, or temperament and reputation allow.
    const willing =
      (b.intent === "seek_mate" && (b.intentTarget === null || b.intentTarget === a.id)) ||
      b.intentTarget === a.id ||
      this.rng.chance(
        tb.fertility * 0.5 + tb.cooperation * 0.2 + (b.tribe === a.tribe ? 0.15 : -0.1) - a.traits.aggression * 0.2 +
          (bonded ? 0.4 : 0) + (a.reputation - 0.5) * 1.0 - (b.grudges.includes(a.id) ? 0.5 : 0),
      );
    if (!willing) {
      this.remember(a, `was rejected by ${b.name}`);
      a.intentTarget = null;
      return;
    }
    this.reproduce(a, b);
  }

  private reproduce(a: Agent, b: Agent) {
    const p = this.params;
    const spot = this.freeAdjacent(a) ?? this.freeAdjacent(b);
    if (!spot) return;
    a.energy -= p.reproductionCost;
    b.energy -= p.reproductionCost;
    a.lastBirthTick = b.lastBirthTick = this.tick;
    a.children++;
    b.children++;
    // Pair bond: first children make partners of the unpartnered (or widowed).
    if (!a.partner || !this.agents.get(a.partner)) a.partner = b.id;
    if (!b.partner || !this.agents.get(b.partner)) b.partner = a.id;
    const traits = blendTraits(a.genome.traits, b.genome.traits, p.mutationRate, this.rng);
    const child = this.makeAgent({
      name: childName(a.name, b.name, this.rng),
      tribe: this.rng.chance(0.5) ? a.tribe : b.tribe,
      genome: {
        traits,
        creed: spliceCreeds(a.genome.creed, b.genome.creed, p.mutationRate, this.rng),
        hue: blendHue(a.genome.hue, b.genome.hue, p.mutationRate, this.rng),
      },
      x: spot.x,
      y: spot.y,
      energy: 22,
      age: 0,
      generation: Math.max(a.generation, b.generation) + 1,
      parents: [a.id, b.id],
    });
    child.lang = a.lang.map((v, k) => (v + b.lang[k]) / 2 + this.rng.gaussian() * 0.03);
    this.converge(a, b, 0.01);
    a.childIds.push(child.id);
    b.childIds.push(child.id);
    for (const parent of [a, b]) {
      this.bond(parent, child, 0.6);
      this.bond(child, parent, 0.6);
    }
    this.bond(a, b, 0.25);
    this.bond(b, a, 0.25);
    this.births++;
    this.deed(a, "children");
    this.deed(b, "children");
    // Children are raised in a parent's faith.
    const believer = [a, b].filter((x) => x.religion !== null).sort((x, y) => y.faith - x.faith)[0];
    if (believer) {
      child.religion = believer.religion;
      child.faith = believer.faith * 0.85;
    }
    this.remember(a, `had a child, ${child.name}, with ${b.name}`);
    this.remember(b, `had a child, ${child.name}, with ${a.name}`);
    this.logEvent("birth", `${child.name} (gen ${child.generation}, ${child.tribe}) born to ${a.name} & ${b.name}`, child.id);
    a.intent = b.intent = "forage";
    a.intentTarget = b.intentTarget = null;
    this.pendingBreeds.push({ childId: child.id, parentA: a, parentB: b });
  }

  private attack(a: Agent, b: Agent) {
    const p = this.params;
    if (a.stage === "child" || a.stage === "elder") return;
    const defense = TERRAIN[this.world.terrainAt(b.x, b.y)].defense + 0.3 * edge(b.understanding.conflict);
    // Weapons matter most; bronze and iron make them deadlier. Tools are a poor substitute.
    const armed = a.inventory.weapons > 0;
    const tools = armed
      ? 1.5 * (this.knows(a, "weaponry") ? 1.4 : 1) * (this.knows(a, "ironworking") ? 1.25 : 1)
      : a.inventory.tools > 0 ? 1.1 : 1;
    const shield = b.inventory.weapons > 0 ? 0.15 : 0;
    // The power of the collective: fellow members fighting nearby make each blow and each defence stronger.
    // Cohesive (cooperative) groups fight together far better than loose ones.
    const allies = (x: Agent) => {
      if (x.groupId === null) return 0;
      const n = Math.min(5, this.neighbours(x, 3).filter((n) => n.groupId === x.groupId && (n.stage === "adult" || n.stage === "adolescent")).length);
      return n * (0.5 + (this.groups.get(x.groupId)?.cohesion ?? 0.5));
    };
    const strength = (0.5 + a.traits.aggression) * (0.5 + a.energy / p.maxEnergy) * tools * (1 + 0.5 * edge(a.understanding.conflict)) * (1 + 0.2 * allies(a));
    const dmg = (p.attackDamage * strength * Math.max(0.1, 1 - defense - shield) * this.rng.range(0.6, 1.2)) / (1 + 0.15 * allies(b));
    if (armed) {
      a.weaponWear += this.knows(a, "ironworking") ? 0.02 : this.knows(a, "metalwork") ? 0.035 : 0.06;
      if (a.weaponWear >= 1) {
        a.weaponWear = 0;
        a.inventory.weapons--;
      }
    } else if (tools > 1) this.wearTools(a);
    b.energy -= dmg;
    this.harm(b, dmg * 0.12 * (this.knows(b, "surgery") ? 0.6 : 1));
    a.energy = Math.min(p.maxEnergy, a.energy + dmg * 0.4) - 2;
    const back = b.stage === "child" ? 0 : p.attackDamage * 0.35 * (0.5 + b.traits.aggression) * this.rng.next();
    a.energy -= back;
    this.harm(a, back * 0.12);
    this.remember(b, `was attacked by ${a.name} of ${a.tribe}`);
    this.remember(a, `attacked ${b.name} of ${b.tribe}`);
    this.feel(b, "attacked");
    b.lastHurt = this.tick;
    this.bond(b, a, -0.3);
    this.evidence(a, "conflict", 0.05);
    this.evidence(b, "conflict", 0.08);
    if (b.intent !== "flee" && b.traits.aggression > 0.4 && (b.stage === "adult" || b.stage === "adolescent")) {
      b.intent = "attack";
      b.intentTarget = a.id;
      b.intentUntil = this.tick + 5;
    }
    if (b.energy <= 0) {
      a.kills++;
      if (this.isEnemy(a, b)) {
        this.count("killed in wars");
        this.deed(a, "warKill");
        const war = this.group(a)?.war;
        if (war) war.kills = (war.kills ?? 0) + 1;
        const eg = b.groupId !== null ? this.groups.get(b.groupId) : undefined;
        if (eg && eg.leaderId === b.id) this.conquer(this.group(a)!, eg, a);
      } else this.deed(a, "kill");
      if (a.groupId !== null && a.groupId === b.groupId && this.groups.get(a.groupId)?.crisis) {
        this.count("killed in power struggles");
        this.logEvent("society", `${a.name} killed ${b.name} in the struggle for ${this.groups.get(a.groupId)!.name}`, a.id);
      }
      this.logEvent("fight", `${a.name} (${a.tribe}) killed ${b.name} (${b.tribe})`, a.id);
      for (const w of this.neighbours(b, 6)) {
        if (w.id === a.id) continue;
        this.feel(w, "witnessedKilling");
        this.harm(w, 1);
        this.evidence(w, "conflict", 0.15);
        // Kin and comrades of the dead hate the killer; the violent may admire it.
        if (w.tribe === b.tribe || (w.groupId !== null && w.groupId === b.groupId) || (w.bonds.get(b.id) ?? 0) > 0.2) this.bond(w, a, -0.25);
        else if (w.traits.aggression > 0.6) this.bond(w, a, 0.05);
        if (this.rng.chance(0.3)) this.remember(w, `saw ${a.name} kill ${b.name}`);
      }
      this.kill(b, `killed by ${a.name}`);
    } else if (this.rng.chance(0.25)) {
      this.logEvent("fight", `${a.name} (${a.tribe}) attacked ${b.name} (${b.tribe})`, a.id);
    }
    if (a.energy <= 0) this.kill(a, `died fighting ${b.name}`);
  }

  private share(a: Agent, b: Agent) {
    // Give stored rations first, then raw energy.
    if (a.inventory.rations > 0 && b.stage !== "child") {
      a.inventory.rations--;
      b.energy = Math.min(this.params.maxEnergy, b.energy + RATION_ENERGY);
    } else {
      const amt = Math.min(15, a.energy - 20);
      if (amt <= 0) return;
      a.energy -= amt;
      b.energy = Math.min(this.params.maxEnergy, b.energy + amt);
    }
    this.converge(a, b, 0.004);
    this.remember(b, `was given food by ${a.name}`);
    this.remember(a, `gave food to ${b.name}`);
    this.feel(b, "fed");
    this.deed(a, b.stage === "child" || b.stage === "elder" || b.sick ? "care" : "gift");
    this.bond(b, a, 0.15);
    this.bond(a, b, 0.05);
    a.gifts++;
    if (a.childIds.includes(b.id)) this.evidence(a, "kinship", 0.01);
    if (this.rng.chance(0.2)) this.logEvent("share", `${a.name} shared food with ${b.name}`, a.id);
    a.intentTarget = null;
  }

  private eat(a: Agent, maxUnits: number) {
    const i = this.world.idx(a.x, a.y);
    const mult = (1 + 0.5 * edge(a.understanding.ecology)) * (a.inventory.tools > 0 ? 1.5 : 1);
    const units = Math.min(this.world.food[i], maxUnits * mult);
    this.world.food[i] -= units;
    const gained = a.energy + units * 5;
    a.energy = Math.min(this.params.maxEnergy, gained);
    // What doesn't fit in the belly is dried and stored.
    if (gained > this.params.maxEnergy && this.params.economy) {
      a.storeProgress += ((gained - this.params.maxEnergy) / RATION_ENERGY) * (a.craft === "rations" ? 1 : 0.6);
      while (a.storeProgress >= 1 && a.inventory.rations < this.rationCap(a)) {
        a.storeProgress -= 1;
        a.inventory.rations++;
      }
    }
    if (a.inventory.tools > 0) this.wearTools(a);
    this.evidence(a, "ecology", this.world.fertile[i] ? 0.008 : 0.004);
  }

  // --- Economy: crafting and trade

  private inheritedCraft(a: Agent): Good {
    const parents = (a.parents ?? []).map((id) => this.findAgent(id)).filter((x): x is Agent => !!x && !!x.craft);
    if (parents.length && this.rng.chance(0.5)) return this.rng.pick(parents).craft!;
    const t = a.traits;
    const weights: [Good, number][] = [
      ["rations", 1 + t.greed],
      ["tools", (0.5 + t.curiosity) * (0.5 + t.aggression)],
      ["medicine", (0.5 + t.caution) * (0.5 + t.cooperation)],
      ["weapons", (0.3 + t.aggression) * (0.3 + t.greed) * 0.8],
    ];
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let r = this.rng.next() * total;
    for (const [g, w] of weights) if ((r -= w) <= 0) return g;
    return "rations";
  }

  /** Work at one's craft: skill grows with practice, which is how specialists emerge. */
  private work(a: Agent) {
    a.craft ??= this.inheritedCraft(a);
    const g = a.craft;
    // Stores full: sell the surplus if anyone wants it, otherwise just feed yourself.
    if (a.inventory[g] >= CAP[g]) return this.act(a, this.findTradePartner(a, 8) ? "trade" : "forage");
    const skill = a.skills[g];
    const near = (ts: Terrain[]) => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (this.world.inBounds(a.x + dx, a.y + dy) && ts.includes(this.world.terrainAt(a.x + dx, a.y + dy))) return true;
      return false;
    };
    if (g === "rations") {
      const i = this.world.idx(a.x, a.y);
      if (this.world.food[i] < 1) {
        const goal = this.bestFoodNear(a, 5);
        return goal ? this.moveToward(a, goal.x, goal.y) : this.wander(a);
      }
      const units = Math.min(this.world.food[i], 3);
      this.world.food[i] -= units;
      a.workProgress += units * 0.3 * (1 + skill);
    } else {
      const sources: Terrain[] = g === "tools" || g === "weapons" ? ["forest", "mountain"] : ["forest", "plains"];
      if (!near(sources)) return this.moveTowardTerrain(a, sources);
      const boost =
        g === "medicine" ? (this.knows(a, "herbalism") ? 2 : 1) :
        g === "weapons" ? (this.knows(a, "metalwork") ? 1.4 : 0.7) * (this.knows(a, "ironworking") ? 1.3 : 1) :
        g === "tools" ? (this.knows(a, "ironworking") ? 1.3 : 1) : 1;
      a.workProgress += 0.06 * (1 + skill * 2) * boost;
    }
    a.energy -= 0.2;
    a.skills[g] = Math.min(3, skill + 0.004 * (1 + edge(a.understanding.exchange)));
    this.evidence(a, "exchange", 0.002);
    while (a.workProgress >= 1 && a.inventory[g] < CAP[g]) {
      a.workProgress -= 1;
      a.inventory[g]++;
      if (g !== "rations" && this.rng.chance(0.3)) this.remember(a, `made ${g === "tools" ? "a tool" : g === "weapons" ? "a weapon" : "medicine"}`);
    }
  }

  private wearTools(a: Agent) {
    a.toolWear += (this.knows(a, "metalwork") ? 0.005 : 0.015) * (this.knows(a, "ironworking") ? 0.5 : 1);
    if (a.toolWear >= 1) {
      a.toolWear = 0;
      a.inventory.tools--;
    }
  }

  private needs(a: Agent): Good[] {
    const out: Good[] = [];
    if (a.inventory.medicine === 0) out.push("medicine");
    if (a.inventory.tools === 0 && a.stage !== "elder") out.push("tools");
    if (a.inventory.rations === 0) out.push("rations");
    const atWar = !!this.group(a)?.war;
    if (a.inventory.weapons === 0 && (a.stage === "adult" || a.stage === "adolescent") && (atWar || a.traits.aggression > 0.55)) out.push("weapons");
    if (a.sick && out.includes("medicine")) out.unshift(out.splice(out.indexOf("medicine"), 1)[0]);
    return out;
  }

  private surplus(a: Agent): Good[] {
    return GOODS.filter((g) => a.inventory[g] > KEEP[g]);
  }

  /** For deciding whether to trade: is a partner around? Re-checked every 5 ticks; the trade itself searches fresh. */
  private tradeNearby(a: Agent): boolean {
    if (this.tick - a.tradeSeen.tick >= 5) a.tradeSeen = { tick: this.tick, found: !!this.findTradePartner(a, 10) };
    return a.tradeSeen.found;
  }

  /** Someone nearby with a surplus of something this agent needs, who needs something it has spare. */
  findTradePartner(a: Agent, r: number): { who: Agent; give: Good; get: Good } | null {
    const mine = this.surplus(a);
    if (!mine.length) return null;
    const wants = this.needs(a);
    if (!wants.length) return null;
    const target = a.intentTarget !== null ? this.agents.get(a.intentTarget) : undefined;
    const cands = target ? [target] : this.neighbours(a, r);
    for (const n of cands) {
      if (n.stage === "child" || a.grudges.includes(n.id)) continue;
      const theirs = this.surplus(n);
      const get = wants.find((g) => theirs.includes(g));
      if (!get) continue;
      const theirNeeds = this.needs(n);
      // With money, anything can pay for anything: no need for the other side to want your goods.
      const give = mine.find((g) => theirNeeds.includes(g) && g !== get) ?? (this.knows(a, "currency") && this.knows(n, "currency") ? mine.find((g) => g !== get) : undefined);
      if (give) return { who: n, give, get };
    }
    return null;
  }

  /**
   * A prisoner's dilemma: both agree to swap, then each privately honours or reneges.
   * Both honour: a fair exchange. One reneges: it keeps its goods and takes the other's.
   * Both renege: nothing changes hands, and both are soured.
   */
  private trade(a: Agent, b: Agent, give: Good, get: Good) {
    const qa = Math.max(1, Math.round(VALUE[get] / VALUE[give]));
    const qb = Math.max(1, Math.round(VALUE[give] / VALUE[get]));
    if (a.inventory[give] - qa < 0 || b.inventory[get] - qb < 0) return;
    const aCheats = this.rng.chance(this.defectChance(a, b));
    const bCheats = this.rng.chance(this.defectChance(b, a));
    // The other party agrees only if it trusts the proposer; knowledge of exchange helps spot a cheat.
    const understood = 0.4 + 0.6 * this.intelligibility(a, b);
    const trust = (a.reputation * (a.tribe === b.tribe ? 1 : 0.7) + b.traits.cooperation * 0.3 - (b.grudges.includes(a.id) ? 0.6 : 0) + 0.2 + (this.knows(b, "mathematics") ? 0.15 : 0)) * understood;
    if (!this.rng.chance(clamp01(trust)) || (aCheats && this.rng.chance(0.5 * edge(b.understanding.exchange)))) {
      a.intentTarget = null;
      a.intentUntil = 0;
      if (this.rng.chance(0.3)) this.remember(a, `was refused a trade by ${b.name}`);
      return;
    }
    this.trades++;
    const label = `${qa} ${give} for ${qb} ${get}`;
    if (!aCheats && !bCheats) {
      a.inventory[give] -= qa;
      b.inventory[give] += qa;
      b.inventory[get] -= qb;
      a.inventory[get] += qb;
      this.bond(a, b, 0.1);
      this.bond(b, a, 0.1);
      this.converge(a, b, 0.008);
      for (const x of [a, b]) {
        x.reputation = Math.min(1, x.reputation + 0.03);
        this.feel(x, "honoredTrade");
        this.evidence(x, "exchange", 0.1);
      }
      this.deed(a, "honest");
      this.deed(b, "honest");
      this.remember(a, `traded ${label} with ${b.name}`);
      this.remember(b, `traded with ${a.name}`);
      if (this.rng.chance(0.15)) this.logEvent("trade", `${a.name} and ${b.name} traded ${label}`, a.id);
    } else if (aCheats !== bCheats) {
      // The cheat keeps its own goods and takes the victim's.
      const [cheat, victim, taken, qty] = aCheats ? [a, b, get, qb] : [b, a, give, qa];
      victim.inventory[taken] -= qty;
      cheat.inventory[taken] += qty;
      this.betrayals++;
      this.punishCheat(cheat, victim);
      victim.grudges = [...victim.grudges.filter((g) => g !== cheat.id), cheat.id].slice(-10);
      this.bond(victim, cheat, -0.5);
      this.feel(victim, "betrayed");
      this.evidence(victim, "exchange", 0.35);
      this.evidence(cheat, "exchange", 0.1);
      this.deed(cheat, "cheat");
      this.remember(victim, `was cheated by ${cheat.name} in a trade`);
      this.remember(cheat, `cheated ${victim.name} in a trade`);
      this.logEvent("trade", `${cheat.name} (${cheat.tribe}) cheated ${victim.name} (${victim.tribe}) in a trade`, cheat.id);
    } else {
      this.betrayals++;
      for (const [x, y] of [[a, b], [b, a]] as const) {
        x.reputation = Math.max(0, x.reputation - 0.03);
        x.grudges = [...x.grudges.filter((g) => g !== y.id), y.id].slice(-10);
        this.bond(x, y, -0.2);
        this.evidence(x, "exchange", 0.15);
      }
      this.remember(a, `tried to cheat ${b.name}, who tried the same`);
      this.remember(b, `tried to cheat ${a.name}, who tried the same`);
    }
    a.intentTarget = null;
    a.intentUntil = 0;
  }

  /** Cheating a tribemate, or being seen cheating by one, costs standing in the tribe. */
  private punishCheat(cheat: Agent, victim: Agent) {
    const witnessed = victim.tribe === cheat.tribe || this.neighbours(cheat, 6).some((n) => n.tribe === cheat.tribe);
    cheat.reputation = Math.max(0, cheat.reputation - (victim.tribe === cheat.tribe ? 0.2 : witnessed ? 0.08 : 0.03));
    for (const w of this.neighbours(cheat, 6)) if (w.tribe === cheat.tribe && w.id !== victim.id) this.bond(w, cheat, -0.12);
  }

  defectChance(a: Agent, partner: Agent): number {
    const grudge = a.grudges.includes(partner.id);
    switch (a.tradeStance) {
      case "honest":
        return 0.03;
      case "cheat":
        return 0.9 * (1 - this.restraint(a, "cheat") * 0.5);
      case "reciprocal":
        return grudge || partner.reputation < 0.35 ? 0.9 : 0.05;
    }
    const t = a.traits;
    let p = t.greed * (1 - t.cooperation) * 0.9;
    if (partner.tribe !== a.tribe) p += 0.15;
    else p -= 0.25 * t.cooperation;
    if (grudge) p += 0.6;
    p *= 1 - this.restraint(a, "cheat");
    if (a.stage === "adolescent") p += 0.1;
    return Math.min(0.95, Math.max(0.02, p));
  }

  // --- Knowledge: discovery, teaching and the canon

  /** Learn from lived experience. Curious minds and adolescents learn fastest. */
  evidence(a: Agent, d: Domain, amount: number) {
    const before = levelOf(a.understanding[d]);
    a.understanding[d] += amount * (0.5 + a.traits.curiosity) * DISCOVERY[a.stage];
    const after = levelOf(a.understanding[d]);
    if (after > before) {
      this.remember(a, `understood: ${truthAt(d, after)}`);
      const canon = this.canons.get(a.tribe);
      if (canon && after > levelOf(canon.understanding[d]) && after <= TRUTHS[d].truths.length)
        this.logEvent("insight", `${a.name} (${a.tribe}) discovered: "${truthAt(d, after)}"`, a.id);
    }
  }

  /** Teach the young nearby; teaching writes the teacher's understanding into the tribe's canon. */
  private teach(t: Agent) {
    const ours = (n: Agent) => n.tribe === t.tribe || (n.groupId !== null && n.groupId === t.groupId);
    const young = this.neighbours(t, 3).filter((n) => ours(n) && n.stage !== "elder");
    if (!young.length) {
      const far = this.neighbours(t, 10).filter((n) => ours(n) && (n.stage === "child" || n.stage === "adolescent"));
      if (far.length) return this.moveToward(t, far[0].x, far[0].y);
      return this.act(t, t.stage === "elder" ? "rest" : "forage");
    }
    const listener = young.sort((x, y) => STAGES.indexOf(x.stage) - STAGES.indexOf(y.stage))[0];
    const canon = this.canons.get(t.tribe) ?? emptyCanon();
    this.canons.set(t.tribe, canon);
    const codify = t.stage === "elder" ? 1 : 0.8;
    for (const d of DOMAINS) canon.understanding[d] = Math.max(canon.understanding[d], t.understanding[d] * codify);
    this.evidence(t, "kinship", 0.005);

    // Adolescents may defy their elders: they reject the lesson and test the world for themselves.
    const defiance = listener.stage === "adolescent" ? (1 - listener.traits.cooperation) * 0.8 : 0;
    if (this.rng.chance(defiance)) {
      this.evidence(listener, this.rng.pick(DOMAINS), 0.05);
      if (this.rng.chance(0.05)) this.logEvent("mind", `${listener.name} defied the teaching of ${t.name}`, listener.id);
      return;
    }
    // Wisdom: the longer a teacher has lived, the better it teaches.
    const avgLife = (this.params.lifespanMin + this.params.lifespanMax) / 2;
    const wisdom = 1 + 0.6 * Math.min(1.5, t.age / avgLife);
    const writing = this.knows(t, "writing") ? 1.6 : 1;
    const understood = this.intelligibility(t, listener);
    this.converge(listener, t, 0.004);
    const rate = 0.08 * PLASTICITY[listener.stage] * this.params.plasticity * (0.5 + t.reputation) * (1 + edge(t.understanding.kinship)) * wisdom * writing * understood;
    for (const id of t.techs) {
      canon.techs.add(id);
      if (!listener.techs.has(id) && this.rng.chance(0.08 * writing * understood)) this.learnTech(listener, id);
    }
    let taughtDomain: Domain | null = null;
    for (const d of DOMAINS) {
      const gap = t.understanding[d] - listener.understanding[d];
      if (gap > 0) {
        listener.understanding[d] += Math.min(gap, rate);
        taughtDomain ??= d;
      }
    }
    if (t.beliefs.length && this.rng.chance(0.2)) {
      const b = this.rng.pick(t.beliefs);
      addToCanon(canon, b);
      if (!listener.beliefs.some((x) => x.text === b.text) && this.rng.chance(PLASTICITY[listener.stage])) this.adoptBelief(listener, b);
    }
    if (this.rng.chance(0.03)) this.feel(listener, "taught");
    if (this.rng.chance(0.1)) this.deed(t, "teach");
    this.spreadFaith(t, listener, understood);
    this.bond(listener, t, 0.03);
    // Lessons spoken aloud show as speech bubbles; only minds' own words go in the chronicle.
    if (taughtDomain && this.tick - t.speechTick > 25 && this.rng.chance(0.08)) {
      const lvl = Math.max(1, levelOf(t.understanding[taughtDomain]));
      t.speech = truthAt(taughtDomain, this.rng.int(1, lvl + 1));
      t.speechTick = this.tick;
    }
  }

  adoptBelief(a: Agent, b: Belief) {
    a.beliefs = [...a.beliefs.filter((x) => x.text !== b.text), b].slice(-6);
  }

  /** Verdict from the judge on an insight a mind put into words. */
  applyInsight(agentId: number, text: string, kind: InsightKind, accurate: boolean) {
    const a = this.agents.get(agentId);
    if (!a || kind === "none") return;
    const belief: Belief = { text, kind, accurate: kind === "meaning" ? false : accurate, author: a.name, tick: this.tick };
    this.adoptBelief(a, belief);
    if (kind !== "meaning" && accurate) {
      // A true insight is a leap of understanding in its domain.
      this.evidence(a, kind, 1.5);
      this.logEvent("insight", `${a.name} (${a.tribe}) realised: "${text}"`, a.id);
    } else if (kind === "meaning") this.logEvent("insight", `${a.name} (${a.tribe}) came to believe: "${text}"`, a.id);
    else this.logEvent("insight", `${a.name} (${a.tribe}) holds a mistaken belief: "${text}"`, a.id);
  }

  // --- Civilization: inventions, farming, property and storage

  knows(a: Agent, t: TechId) {
    return a.techs.has(t);
  }

  /** How many rations one can keep: pots and granaries (Storage) hold far more. */
  rationCap(a: Agent) {
    return this.knows(a, "storage") ? 20 : CAP.rations;
  }

  /** Someone whose understanding runs deep enough (and who has what it builds on) may invent something new. */
  private tryInvent(a: Agent) {
    for (const id of this.frontierFor(a)) {
      // Hands-on experience helps: farmers invent farming tools, crafters metalwork, healers herbalism.
      const practice = id === "herbalism" ? a.skills.medicine : id === "metalwork" ? a.skills.tools : a.fields.length ? 0.5 : 0;
      if (!this.rng.chance(0.002 * (0.5 + a.traits.curiosity) * DISCOVERY[a.stage] * (1 + practice))) continue;
      return this.discover(a, id);
    }
  }

  private learnTech(a: Agent, id: TechId) {
    if (a.techs.has(id)) return;
    a.techs.add(id);
    this.remember(a, `learned ${TECHS[id].name.toLowerCase()}`);
  }

  /** Fields one may harvest freely: one's own, family's, and one's organization's (shared work). */
  private mayHarvest(a: Agent, i: number) {
    const owner = this.world.fieldOwner[i];
    if (!owner || owner === a.id || owner === a.partner || a.childIds.includes(owner) || a.parents?.includes(owner)) return true;
    const o = this.agents.get(owner);
    return !!o && o.groupId !== null && o.groupId === a.groupId;
  }

  private cellOf(i: number) {
    return { x: i % this.world.width, y: Math.floor(i / this.world.width) };
  }

  /** Farm: harvest what's ripe, tend what's growing, plant more if there's room. Farmers settle around their fields. */
  private farm(a: Agent) {
    if (!this.knows(a, "agriculture")) return this.act(a, "forage");
    const w = this.world;
    a.fields = a.fields.filter((i) => w.fieldOwner[i] === a.id);
    const near = (i: number) => this.dist(a, this.cellOf(i)) <= 1;
    const go = (i: number) => {
      const c = this.cellOf(i);
      this.moveToward(a, c.x, c.y);
    };
    const spent = a.fields.find((i) => w.soil[i] < 0.3 && w.crop[i] < 0.5);
    if (spent !== undefined && this.rng.chance(0.2)) {
      w.abandon(spent);
      a.fields = a.fields.filter((i) => i !== spent);
      this.evidence(a, "ecology", 0.1);
    }
    const ripe = a.fields.filter((i) => w.crop[i] >= 1).sort((x, y) => this.dist(a, this.cellOf(x)) - this.dist(a, this.cellOf(y)))[0];
    if (ripe !== undefined) return near(ripe) ? this.harvest(a, ripe) : go(ripe);
    const needy = a.fields.filter((i) => this.tick - w.tended[i] > 30).sort((x, y) => w.tended[x] - w.tended[y])[0];
    if (needy !== undefined) {
      if (!near(needy)) return go(needy);
      w.tended[needy] = this.tick;
      w.crop[needy] = Math.min(1, w.crop[needy] + 0.03);
      a.energy -= 0.3;
      return;
    }
    const maxFields = 3 + Math.round(Math.min(2, a.skills.rations));
    if (a.fields.length < maxFields && a.energy > 30) {
      // Plant beside existing fields if any (a farm), on fertile land if possible.
      const home = a.fields.length ? this.cellOf(a.fields[0]) : a;
      let best = -1;
      let bestScore = -Infinity;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const x = home.x + dx;
          const y = home.y + dy;
          if (!w.inBounds(x, y)) continue;
          const i = w.idx(x, y);
          if (!w.plantable(i)) continue;
          const score = (w.fertile[i] ? 2 : 0) + (w.terrain[i] === "plains" ? 0.5 : 0) - Math.hypot(dx, dy) * 0.3;
          if (score > bestScore) {
            bestScore = score;
            best = i;
          }
        }
      if (best >= 0) {
        if (!near(best)) return go(best);
        w.plant(best, a.id, this.tick, this.knows(a, "irrigation"));
        a.fields.push(best);
        a.energy -= 4;
        this.evidence(a, "ecology", 0.02);
        return;
      }
    }
    // Nothing to do in the fields today: rest near them.
    if (a.fields.length) {
      const c = this.cellOf(a.fields[0]);
      if (this.dist(a, c) > 3) return this.moveToward(a, c.x, c.y);
    }
    return this.act(a, a.energy < this.params.maxEnergy * 0.6 ? "forage" : "rest");
  }

  /** A ripe field feeds the farmer and fills its stores; the plough makes harvests bigger. */
  private harvest(a: Agent, i: number) {
    const w = this.world;
    const owner = w.fieldOwner[i];
    let units = 14 * (this.knows(a, "plough") ? 1.6 : 1) * (this.knows(a, "ironworking") ? 1.2 : 1) * (this.knows(a, "calendar") ? 1.2 : 1) * (a.inventory.tools > 0 ? 1.15 : 1);
    units *= 0.4 + 0.6 * w.soil[i];
    w.exhaust(i);
    w.crop[i] = 0.05;
    w.tended[i] = this.tick;
    a.skills.rations = Math.min(3, a.skills.rations + 0.02);
    this.evidence(a, "seasons", 0.03);
    const eat = Math.min(units, Math.max(0, (this.params.maxEnergy - a.energy) / 5));
    a.energy += eat * 5;
    units -= eat;
    const cap = this.rationCap(a);
    while (units >= 3 && a.inventory.rations < cap) {
      a.inventory.rations++;
      units -= 3;
    }
    if (owner && owner !== a.id && !this.mayHarvest(a, i)) this.theft(a, owner);
  }

  /** Taking crops from a field that isn't yours. The owner, and anyone who saw, remember it. */
  private theft(thief: Agent, ownerId: number) {
    const owner = this.agents.get(ownerId);
    if (owner) {
      this.bond(owner, thief, -0.4);
      owner.grudges = [...owner.grudges.filter((g) => g !== thief.id), thief.id].slice(-10);
      this.remember(owner, `found crops stolen by ${thief.name}`);
    }
    const witnesses = this.neighbours(thief, 6).filter((n) => n.id !== thief.id && n.stage !== "child");
    if (witnesses.some((n) => n.tribe === thief.tribe)) thief.reputation = Math.max(0, thief.reputation - (witnesses.some((n) => this.knows(n, "law")) ? 0.18 : 0.08));
    for (const w of witnesses) if (owner && (w.tribe === owner.tribe || w.groupId === owner.groupId)) this.bond(w, thief, -0.15);
    this.deed(thief, "theft");
    this.remember(thief, `took crops from ${owner?.name ?? "an abandoned field"}`);
    if (this.rng.chance(0.25)) this.logEvent("trade", `${thief.name} (${thief.tribe}) stole crops from ${owner?.name ?? "a field"}${owner ? ` (${owner.tribe})` : ""}`, thief.id);
  }

  /** Hungry and greedy: a ripe field that isn't yours, close at hand. */
  private stealableField(a: Agent): number | null {
    const w = this.world;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = a.x + dx;
        const y = a.y + dy;
        if (!w.inBounds(x, y)) continue;
        const i = w.idx(x, y);
        if (w.fieldOwner[i] && w.crop[i] >= 0.8 && !this.mayHarvest(a, i)) return i;
      }
    return null;
  }

  /** Property passes on at death: to a living partner, else the eldest grown child. */
  private bequeath(a: Agent) {
    if (!a.fields.length) return;
    const heirs = [a.partner, ...a.childIds].map((id) => (id !== null ? this.agents.get(id) : undefined)).filter((h): h is Agent => !!h && h.stage !== "child");
    const heir = heirs[0];
    for (const i of a.fields) {
      if (this.world.fieldOwner[i] !== a.id) continue;
      if (heir) {
        this.world.fieldOwner[i] = heir.id;
        heir.fields.push(i);
      }
    }
    if (heir) this.remember(heir, `inherited ${a.name}'s fields`);
  }

  /** Food rots without pots and granaries. */
  private spoil(a: Agent) {
    if (a.inventory.rations > 0 && !this.knows(a, "storage") && this.rng.chance(0.004 * a.inventory.rations)) a.inventory.rations--;
  }

  // --- Leaving the world, and crowd disease

  /** Head for the nearest edge of the board; on reaching it, leave the known world. */
  private headForEdge(a: Agent) {
    const w = this.world;
    const d = [a.x, w.width - 1 - a.x, a.y, w.height - 1 - a.y];
    const m = Math.min(...d);
    if (m === 0) return this.depart(a);
    const [tx, ty] = [[0, a.y], [w.width - 1, a.y], [a.x, 0], [a.x, w.height - 1]][d.indexOf(m)];
    const before = [a.x, a.y];
    this.moveToward(a, tx, ty);
    if (a.x === before[0] && a.y === before[1]) this.wander(a);
  }

  /** Emigrants leave with their young children, and a partner who's ready to go. They are gone, not dead. */
  private depart(a: Agent) {
    const party = [a];
    for (const n of this.neighbours(a, 3)) {
      if (n.stage === "child" && a.childIds.includes(n.id)) party.push(n);
      else if (n.id === a.partner && (n.intent === "emigrate" || n.energy < this.params.maxEnergy * 0.4)) party.push(n);
    }
    const g = this.group(a);
    for (const x of party) {
      x.alive = false;
      x.causeOfDeath = "emigrated";
      x.diedAt = this.tick;
      this.occupancy[this.world.idx(x.x, x.y)] = 0;
      this.cellAgent[this.world.idx(x.x, x.y)] = undefined;
      this.bequeath(x);
      if (x.groupId !== null) this.leaveGroup(x, "left the world", true);
      this.agents.delete(x.id);
      this.graveyard.push(x);
      this.emigrants++;
      this.emigrated++;
      for (const id of [x.partner, ...(x.parents ?? []), ...x.childIds]) {
        const kin = id !== null ? this.agents.get(id) : undefined;
        if (kin && !party.includes(kin)) this.remember(kin, `saw ${x.name} leave for lands beyond`);
      }
    }
    if (party.length >= 3 || (g && g.leaderId === a.id) || this.rng.chance(0.15))
      this.logEvent("world", `${a.name} (${a.tribe})${party.length > 1 ? ` and ${party.length - 1} others` : ""} left the known world in search of food`, a.id);
  }

  /** Where people are packed together, sickness can break out on its own. */
  private crowdDisease() {
    for (const a of this.agents.values()) {
      if (!this.rng.chance(0.03)) continue;
      const crowd = this.neighbours(a, 3).length;
      if (crowd < 16 || this.world.hazardsAt(a.x, a.y).some((h) => h.kind === "plague")) continue;
      if (!this.rng.chance((0.15 + (crowd - 16) * 0.02) * (this.knows(a, "sanitation") ? 0.3 : 1))) continue;
      this.world.addHazard("plague", { x: a.x - 3, y: a.y - 3, w: 7, h: 7 }, "", 40);
      this.narrate(`Sickness breaks out among the crowded people around ${a.name}.`);
      return;
    }
  }

  // --- Language: tongues drift apart in isolation and blend through contact

  /** A tribe's founding tongue, invented the first time the tribe appears. */
  tongueOf(tribe: string): number[] {
    let t = this.languages.get(tribe);
    if (!t) {
      t = [0, 0, 0, 0].map(() => this.rng.next());
      this.languages.set(tribe, t);
    }
    return t;
  }

  /** 1 = same tongue, ~0.5 = related dialect, near 0 = foreign. */
  intelligibility(a: Agent, b: Agent): number {
    let d = 0;
    for (let k = 0; k < a.lang.length; k++) d += (a.lang[k] - b.lang[k]) ** 2;
    return Math.max(0.05, Math.min(1, 1 - Math.sqrt(d) * 1.8));
  }

  /** Talking together pulls two tongues toward each other. */
  converge(a: Agent, b: Agent, rate: number) {
    for (let k = 0; k < a.lang.length; k++) {
      const mid = (a.lang[k] + b.lang[k]) / 2;
      a.lang[k] += (mid - a.lang[k]) * rate;
      b.lang[k] += (mid - b.lang[k]) * rate;
    }
  }

  tongueWord(a: Agent, b: Agent): string {
    const i = this.intelligibility(a, b);
    return i > 0.8 ? "your tongue" : i > 0.45 ? "a related dialect" : i > 0.2 ? "a foreign tongue you half understand" : "a foreign tongue";
  }

  /** Number of distinct tongues spoken by at least three people (greedy clustering). */
  languageCount(): number {
    const centres: { v: number[]; n: number }[] = [];
    for (const a of this.agents.values()) {
      const c = centres.find((x) => Math.sqrt(x.v.reduce((s, v, k) => s + (v - a.lang[k]) ** 2, 0)) < 0.25);
      if (c) c.n++;
      else centres.push({ v: [...a.lang], n: 1 });
    }
    return centres.filter((c) => c.n >= 3).length;
  }

  // --- Science: research, records and the oral canon

  /** Research needs leisure: a full belly, good health, safety and peace at home. */
  canResearch(a: Agent): boolean {
    if (a.stage === "child" || a.sick || a.frailty > 0.6 || a.energy < this.params.maxEnergy * 0.5) return false;
    if (this.world.hazardsAt(a.x, a.y).some((h) => h.kind !== "bounty")) return false;
    return !this.group(a)?.crisis;
  }

  /** Which invention to work on: the organization's project if it has one, else one suited to one's craft. */
  private researchTarget(a: Agent): TechId | null {
    const g = this.group(a);
    if (g?.project && !a.techs.has(g.project.tech) && this.techTable.get(g.project.tech)!.techs.every((t) => a.techs.has(t))) return g.project.tech;
    const options = this.frontierFor(a);
    if (a.research.target && options.includes(a.research.target)) return a.research.target;
    if (!options.length) return null;
    const affinity: Partial<Record<Good, TechId[]>> = {
      rations: ["agriculture", "storage", "irrigation", "plough", "calendar"],
      tools: ["metalwork", "wheel", "plough", "ironworking"],
      weapons: ["metalwork", "weaponry", "ironworking"],
      medicine: ["herbalism", "surgery", "sanitation"],
    };
    const liked = a.craft ? affinity[a.craft] ?? [] : [];
    const pick = options.find((o) => liked.includes(o) && this.rng.chance(0.7)) ?? this.rng.pick(options);
    a.research = { target: pick, progress: 0 };
    return pick;
  }

  /** Research: slow, collaborative, and the main road to invention. The literate can also learn from records. */
  private research(a: Agent) {
    if (!this.canResearch(a)) return this.act(a, a.stage === "elder" ? "rest" : "forage");
    a.energy -= 0.15;
    const canon = this.canons.get(a.tribe);
    // With writing, the records teach what no living teacher is near to teach.
    if (this.knows(a, "writing") && canon?.techs.has("writing")) {
      const unread = [...canon.techs].filter((t) => !a.techs.has(t));
      if (unread.length && this.rng.chance(0.04)) {
        const t = this.rng.pick(unread);
        this.learnTech(a, t);
        this.remember(a, `learned ${TECHS[t].name.toLowerCase()} from the records`);
        return;
      }
    }
    const target = this.researchTarget(a);
    if (!target) {
      // Nothing new within reach: study deepens understanding instead.
      this.evidence(a, this.rng.pick(DOMAINS), 0.04);
      return;
    }
    const g = this.group(a);
    const pooled = g?.project?.tech === target;
    const colleagues = this.neighbours(a, 4).filter((n) => n.intent === "research" && (n.research.target === target || (pooled && n.groupId === a.groupId))).length;
    const rate =
      0.1 * (0.5 + a.traits.curiosity) * DISCOVERY[a.stage] * (1 + totalLevels(a.understanding) / 20) *
      (this.knows(a, "mathematics") ? 1.5 : 1) * (this.knows(a, "writing") ? 1.2 : 1) * (1 + 0.25 * Math.min(3, colleagues));
    for (const [d] of Object.entries(this.techTable.get(target)!.domains)) this.evidence(a, d as Domain, 0.006);
    if (pooled && g?.project) {
      g.project.progress += rate * (0.7 + 0.6 * g.cohesion);
      if (g.project.progress >= this.techCost(target)) this.completeProject(g, a);
    } else {
      a.research.progress += rate;
      if (a.research.progress >= this.techCost(target)) {
        a.research = { target: null, progress: 0 };
        this.discover(a, target);
      }
    }
  }

  private discover(a: Agent, id: TechId) {
    this.learnTech(a, id);
    // Discoverers are honoured: research is a public good, so the community repays it in standing.
    a.renown++;
    a.reputation = Math.min(1, a.reputation + 0.15);
    const canon = this.canons.get(a.tribe);
    if (!canon?.techs.has(id)) {
      const first = ![...this.canons.values()].some((c) => c.techs.has(id));
      this.logEvent("invention", `${a.name} (${a.tribe}) ${first ? "invented" : "independently discovered"} ${TECHS[id].name.toLowerCase()}: ${TECHS[id].effect}`, a.id);
    }
    canon?.techs.add(id);
  }

  /** A pooled project succeeds: every member nearby (or literate) learns it. */
  private completeProject(g: Group, finisher: Agent) {
    const id = g.project!.tech;
    this.discover(finisher, id);
    for (const mid of g.members) {
      const m = this.agents.get(mid);
      if (m && m.stage !== "child" && (this.dist(m, finisher) <= 20 || this.knows(m, "writing"))) this.learnTech(m, id);
    }
    this.logEvent("society", `${g.name} completed its research into ${TECHS[id].name.toLowerCase()}`, finisher.id);
    this.count("research projects completed");
    g.project = null;
    const leader = this.leaderOf(g);
    if (leader && g.aim === "research") this.setAim(g, leader, "research", "");
  }

  /**
   * Without writing, a tribe's canon is oral: it erodes toward what the living still know, and an
   * invention nobody alive remembers is lost. Writing keeps it whole.
   */
  private erodeCanons() {
    const members = new Map<string, Agent[]>();
    for (const a of this.agents.values()) {
      const l = members.get(a.tribe) ?? [];
      l.push(a);
      members.set(a.tribe, l);
    }
    for (const [tribe, canon] of this.canons) {
      if (canon.techs.has("writing")) continue;
      const living = members.get(tribe) ?? [];
      for (const d of DOMAINS) {
        const best = Math.max(0, ...living.map((a) => a.understanding[d]));
        canon.understanding[d] = Math.max(best, canon.understanding[d] * 0.985);
      }
      for (const t of [...canon.techs])
        if (!living.some((a) => a.techs.has(t)) && this.rng.chance(0.3)) {
          canon.techs.delete(t);
          this.count("inventions forgotten");
          this.logEvent("invention", `The ${tribe} have forgotten ${TECHS[t].name.toLowerCase()}: no one left alive remembers it`);
        }
    }
  }

  // --- Collective action: an organization's aim

  /** Set what the organization works toward. Research picks an invention; war picks an enemy. */
  setAim(g: Group, leader: Agent, aim: GroupAim, target: string) {
    if (aim === "peace") {
      if (g.war) this.logEvent("society", `${leader.name} made peace: ${g.name} is no longer at war with ${g.war.name}`, leader.id);
      g.war = null;
      g.aim = null;
      return;
    }
    if (aim === "research") {
      const members = [...g.members].map((id) => this.agents.get(id)).filter((m): m is Agent => !!m);
      const known = new Set(members.flatMap((m) => [...m.techs]));
      const named = target ? techByName(target) : undefined;
      const options = this.frontierFor(leader, (d) => Math.max(...members.map((m) => levelOf(m.understanding[d]))));
      const tech = named && !leader.techs.has(named) && this.techTable.get(named)!.techs.every((t) => known.has(t)) ? named : options[0];
      if (!tech) return;
      if (g.project?.tech !== tech) g.project = { tech, progress: 0 };
      if (g.aim !== "research" || this.rng.chance(0.3)) this.logEvent("society", `${leader.name} set ${g.name} to research ${TECHS[tech].name.toLowerCase()}`, leader.id);
    } else if (aim === "war") {
      const enemyGroup = target
        ? [...this.groups.values()].find((x) => x.id !== g.id && x.name.toLowerCase() === target.toLowerCase())
        : this.likelyEnemy(g, leader);
      const enemyTribe = !enemyGroup && target && this.canons.has(target) && target !== leader.tribe ? target : null;
      if (!enemyGroup && !enemyTribe) return;
      const name = enemyGroup?.name ?? enemyTribe!;
      if (g.war?.name !== name) {
        g.war = { groupId: enemyGroup?.id ?? null, tribe: enemyTribe, name, since: this.tick };
        this.count("wars");
        this.logEvent("society", `${leader.name} led ${g.name} to war against ${name}`, leader.id);
        if (enemyGroup) {
          const el = this.leaderOf(enemyGroup);
          if (el) for (const id of g.members) { const m = this.agents.get(id); if (m) this.bond(m, el, -0.1); }
        }
      }
    } else if (aim === "ally") {
      const other = target
        ? [...this.groups.values()].find((x) => x.id !== g.id && x.name.toLowerCase() === target.toLowerCase())
        : [...this.groups.values()].find((x) => { const xl = this.leaderOf(x); return x.id !== g.id && xl && (leader.bonds.get(xl.id) ?? 0) > 0.25; });
      const ol = other ? this.leaderOf(other) : undefined;
      // The other side agrees only if its leader doesn't resent ours.
      if (other && ol && (ol.bonds.get(leader.id) ?? 0) > -0.1) this.ally(g, other, leader);
      return;
    } else if (g.aim !== aim) this.logEvent("society", `${leader.name} turned ${g.name} to ${aim === "farm" ? "working the land together" : "trade"}`, leader.id);
    g.aim = aim;
    g.aimSince = this.tick;
  }

  /** The rival an aggrieved, ambitious leader would pick a fight with: a nearby organization it resents. */
  private likelyEnemy(g: Group, leader: Agent): Group | undefined {
    let best: Group | undefined;
    let worst = 0.05;
    for (const x of this.groups.values()) {
      if (x.id === g.id) continue;
      const xl = this.leaderOf(x);
      if (!xl || this.dist(leader, xl) > 25) continue;
      if (this.realmOf(x).id === this.realmOf(g).id) continue;
      const faith = this.religionOf(leader);
      const infidel = faith && xl.religion !== leader.religion ? leader.faith * Math.max(0, faith.code.warKill) * 0.4 : 0;
      const grievance = -(leader.bonds.get(xl.id) ?? 0) + (leader.grudges.includes(xl.id) ? 0.5 : 0) + (xl.tribe !== leader.tribe ? 0.15 : 0) + (x.members.size < g.members.size ? 0.1 : 0) + infidel;
      if (grievance > worst) {
        worst = grievance;
        best = x;
      }
    }
    return best;
  }

  /** Is `n` the enemy of `a`'s organization? */
  isEnemy(a: Agent, n: Agent): boolean {
    const war = this.group(a)?.war;
    if (!war) return false;
    return (war.groupId !== null && n.groupId === war.groupId) || (war.tribe !== null && n.tribe === war.tribe);
  }

  /** Instinct leaders choose an aim from their temperament and their people's situation. */
  private chooseAim(g: Group) {
    const leader = this.leaderOf(g);
    if (!leader || this.thinks(leader)) return;
    const members = [...g.members].map((id) => this.agents.get(id)).filter((m): m is Agent => !!m && m.stage !== "child");
    if (!members.length) return;
    const hunger = members.reduce((s, m) => s + (1 - m.energy / this.params.maxEnergy), 0) / members.length;
    const t = leader.traits;
    const scores: Partial<Record<GroupAim, number>> = {
      research: t.curiosity * 0.8 + (this.knows(leader, "writing") ? 0.3 : 0) + (hunger < 0.4 ? 0.35 : -0.4) + Math.min(0.3, totalLevels(leader.understanding) * 0.03),
      farm: this.knows(leader, "agriculture") ? 0.3 + hunger * 1.2 : 0,
      trade: t.greed * 0.6 + (this.knows(leader, "currency") ? 0.3 : 0),
    };
    const enemy = this.likelyEnemy(g, leader);
    if (enemy) scores.war = ambition(t) * 1.2 + t.aggression * 0.4 + hunger * 0.4 + (members.filter((m) => m.inventory.weapons > 0).length / members.length) * 0.4 - 0.55;
    // Alliance with a friendly neighbour of the same faith or tongue, when not already in a realm.
    if (g.overlordId === null) {
      const friend = [...this.groups.values()].find((x) => {
        const xl = this.leaderOf(x);
        return x.id !== g.id && xl && x.overlordId === null && this.dist(leader, xl) < 20 && (leader.bonds.get(xl.id) ?? 0) > 0.25 &&
          (xl.religion === leader.religion || this.intelligibility(leader, xl) > 0.6);
      });
      if (friend) scores.ally = t.cooperation * 0.8 + (g.war || friend.war ? 0.3 : 0) - ambition(t) * 0.4;
    }
    if (g.war) {
      const enemyGone = g.war.groupId !== null ? !this.groups.has(g.war.groupId) : !this.canons.has(g.war.tribe ?? "");
      if (enemyGone || this.tick - g.war.since > 200 || this.rng.chance((1 - ambition(t)) * 0.15)) return this.setAim(g, leader, "peace", "");
      return;
    }
    const [best, score] = (Object.entries(scores) as [GroupAim, number][]).sort((x, y) => y[1] - x[1])[0];
    const current = g.aim ? scores[g.aim] ?? 0 : 0;
    if (score > 0.4 && (g.aim !== best ? score > current + 0.25 : best === "research" && !g.project)) this.setAim(g, leader, best, "");
  }

  // --- Faith: good and evil, and belief in judgement after death (belief only: the world has no afterlife)

  deed(a: Agent, d: Deed) {
    a.ledger[d]++;
  }

  religionOf(a: Agent): Religion | undefined {
    return a.religion !== null ? this.religions.get(a.religion) : undefined;
  }

  /**
   * How strongly faith holds a believer back from a deed (0 = not at all). Fear of judgement scales
   * with faith; a watchful god is felt even where no one else is looking.
   */
  restraint(a: Agent, d: Deed): number {
    const r = this.religionOf(a);
    if (!r || a.faith < 0.05) return 0;
    return Math.min(0.9, a.faith * Math.min(1, sinWeight(r, d)) * (r.watchful ? 0.85 : 0.55));
  }

  /** How much faith urges a believer toward a deed it calls virtue. */
  zeal(a: Agent, d: Deed): number {
    const r = this.religionOf(a);
    return r ? a.faith * Math.max(0, r.code[d]) : 0;
  }

  /** Someone grieving, ageing and inclined to awe may conceive of gods and a reckoning after death. */
  private maybeFoundReligion(a: Agent) {
    if (a.religion !== null || (a.stage !== "adult" && a.stage !== "elder") || this.religions.size >= 14) return;
    const mourning = a.memory.some((m) => m.includes("mourned") || m.includes("saw") && m.includes("kill"));
    const p = 0.0006 * (a.traits.caution + a.traits.cooperation) * (mourning ? 3 : 1) * (a.stage === "elder" ? 2 : 1);
    if (!this.rng.chance(p)) return;
    this.establishReligion(a);
  }

  /** Large faiths fracture: a charismatic believer with a following of its own founds a sect and takes them along. */
  private sectarianism() {
    const followers = new Map<number, Agent[]>();
    for (const a of this.agents.values()) if (a.religion !== null) followers.set(a.religion, [...(followers.get(a.religion) ?? []), a]);
    for (const [rid, believers] of followers) {
      if (believers.length < 50 || this.religions.size >= 24) continue;
      const parent = this.religions.get(rid)!;
      const reformer = believers.find((b) => b.followers >= 3 && b.faith > 0.6 && (b.stage === "adult" || b.stage === "elder") && this.rng.chance(0.03 * (0.5 + ambition(b.traits))));
      if (!reformer) continue;
      const sect = foundSect(this.nextReligionId++, parent, reformer, this.tick, this.rng);
      this.religions.set(sect.id, sect);
      reformer.religion = sect.id;
      reformer.faith = Math.min(1, reformer.faith + 0.2);
      let n = 1;
      for (const b of believers) if (b.id !== reformer.id && (b.follows === reformer.id || this.leadsTo(b, reformer))) {
        b.religion = sect.id;
        n++;
      }
      this.count("sects");
      this.logEvent("society", `${reformer.name} broke with ${parent.name} and founded ${sect.name}, taking ${n} followers: "${sect.doctrine}"`, reformer.id);
      return;
    }
  }

  establishReligion(a: Agent, name?: string, doctrine?: string): Religion {
    const r = foundReligion(this.nextReligionId++, a, this.tick, this.rng);
    if (name) r.name = name.slice(0, 40);
    if (doctrine) r.doctrine = doctrine.slice(0, 300);
    this.religions.set(r.id, r);
    a.religion = r.id;
    a.faith = 0.9;
    this.count("religions founded");
    this.logEvent("society", `${a.name} (${a.tribe}) founded a faith, ${r.name}: "${r.doctrine}"`, a.id);
    return r;
  }

  /** Teachers pass on their faith with their knowledge; the young and the trusting take it up. */
  private spreadFaith(t: Agent, l: Agent, understood: number) {
    if (t.religion === null || t.religion === l.religion || t.faith < 0.2) return;
    const resist = l.religion !== null ? l.faith : 0;
    if (this.rng.chance(0.06 * PLASTICITY[l.stage] * understood * t.faith * (1 - resist) * (0.5 + l.traits.cooperation))) this.convert(l, t.religion, t.faith * 0.7);
  }

  convert(a: Agent, religionId: number, faith: number) {
    const r = this.religions.get(religionId);
    if (!r) return;
    a.religion = religionId;
    a.faith = Math.min(1, faith);
    this.remember(a, `came to believe in ${r.name}`);
  }

  /** Faith ebbs over time, faster in the curious and the literate; grief, plague survived and fellow believers renew it. */
  private tendFaith(a: Agent) {
    if (a.religion === null) return;
    // Doubt: the curious, the literate and the learned question more.
    a.faith -= 0.001 + 0.006 * (a.traits.curiosity + (this.knows(a, "writing") ? 0.8 : 0)) + 0.0004 * totalLevels(a.understanding);
    // Communion: worshipping among fellow believers renews faith.
    const fellows = this.neighbours(a, 4).filter((n) => n.religion === a.religion).length;
    a.faith += 0.003 * Math.min(4, fellows) * Math.max(0, 1 - a.traits.curiosity * 1.5);
    const g = this.group(a);
    const leader = g ? this.leaderOf(g) : undefined;
    if (leader && leader.religion === a.religion) a.faith += 0.006 * leader.faith * (1 - a.traits.curiosity);
    if (a.memory.at(-1)?.includes("mourned") || a.memory.at(-1)?.includes("recovered from the plague")) a.faith += 0.03;
    a.faith = Math.min(1, a.faith);
    if (a.faith <= 0.02) {
      this.remember(a, `lost faith in ${this.religionOf(a)?.name ?? "the gods"}`);
      a.religion = null;
      a.faith = 0;
    }
  }

  /** At death a believer is judged, by its own faith's code. We record what it believed awaited it. */
  private reckon(a: Agent) {
    const r = this.religionOf(a);
    if (!r || a.faith < 0.15) return;
    const { verdict } = judge(r.code, a.ledger);
    const deeds = (Object.entries(a.ledger) as [Deed, number][]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([d, n]) => `${DEED_TEXT[d]} ×${n}`).join(", ");
    this.hallOfDead.push({ name: a.name, tribe: a.tribe, religion: r.name, verdict, realm: verdict === "heaven" ? r.heaven : verdict === "hell" ? r.hell : "an uncertain fate", tick: this.tick, deeds });
    if (this.hallOfDead.length > 3000) this.hallOfDead.splice(0, 1000);
    this.count(verdict === "heaven" ? "believed bound for heaven" : verdict === "hell" ? "feared bound for hell" : "died uncertain");
    const g = this.group(a);
    if ((g && g.leaderId === a.id) || r.founderId === a.id) this.logEvent("society", `${a.name} died believing they would go to ${verdict === "heaven" ? r.heaven : verdict === "hell" ? r.hell : "an uncertain fate"}`, a.id);
  }

  // --- Ethnogenesis: new peoples

  /** A people born from an old one: new name, its own colour, the old canon as inheritance, and its own tongue. */
  private newPeople(members: Agent[], origin: string, why: string) {
    let name = "";
    for (let tries = 0; tries < 20 && (!name || this.canons.has(name)); tries++) name = `${randomName(this.rng)}${this.rng.pick(["ans", "i", "ar", "ites", "folk", "en"])}`;
    const hue = ((this.tribeHues.get(origin) ?? 0) + this.rng.range(60, 300)) % 360;
    this.tribeHues.set(name, hue);
    const old = this.canons.get(origin);
    this.canons.set(name, old ? { understanding: { ...old.understanding }, beliefs: old.beliefs.map((b) => ({ ...b })), techs: new Set(old.techs) } : emptyCanon());
    const centroid = members[0].lang.map((_, k) => members.reduce((s, m) => s + m.lang[k], 0) / members.length);
    this.languages.set(name, centroid);
    for (const m of members) {
      m.tribe = name;
      m.genome.hue = hue + this.rng.gaussian() * 6;
    }
    this.count("new peoples");
    this.logEvent("society", `A new people emerges: the ${name}, ${members.length} strong, ${why}, no longer counting themselves among the ${origin}`, members[0].id);
  }

  /** Every 50 ticks: long-lived organizations and drifting tongues can become peoples of their own. */
  private ethnogenesis() {
    const byTribe = new Map<string, Agent[]>();
    for (const a of this.agents.values()) {
      const l = byTribe.get(a.tribe) ?? [];
      l.push(a);
      byTribe.set(a.tribe, l);
    }
    const centroid = (xs: Agent[]) => xs[0].lang.map((_, k) => xs.reduce((s, m) => s + m.lang[k], 0) / xs.length);
    const dist = (u: number[], v: number[]) => Math.sqrt(u.reduce((s, x, k) => s + (x - v[k]) ** 2, 0));
    // An old organization whose members have come to speak differently from the rest of their tribe.
    for (const g of this.groups.values()) {
      if (this.tick - g.foundedTick < 200 || g.members.size < 8) continue;
      const members = [...g.members].map((id) => this.agents.get(id)).filter((m): m is Agent => !!m);
      const counts: Record<string, number> = {};
      for (const m of members) counts[m.tribe] = (counts[m.tribe] ?? 0) + 1;
      const [tribe, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
      if (!tribe || n < members.length * 0.7) continue;
      const rest = (byTribe.get(tribe) ?? []).filter((a) => a.groupId !== g.id);
      if (rest.length < 8) continue;
      if (dist(centroid(members), centroid(rest)) > 0.16 && this.rng.chance(0.3)) return this.newPeople(members.filter((m) => m.tribe === tribe), tribe, `the people of ${g.name}`);
    }
    // A cluster within a tribe whose speech has drifted far from the rest.
    for (const [tribe, xs] of byTribe) {
      if (xs.length < 24) continue;
      const c = centroid(xs);
      const far = xs.filter((a) => dist(a.lang, c) > 0.24);
      if (far.length < 8) continue;
      const seed = far[this.rng.int(0, far.length)];
      const cluster = far.filter((a) => dist(a.lang, seed.lang) < 0.2);
      if (cluster.length >= 8 && this.rng.chance(0.3)) return this.newPeople(cluster, tribe, "whose speech had drifted far from their kin's");
    }
  }

  // --- States: conquest, alliance, tribute and revolt

  /** The top of an organization's chain of overlords. */
  realmOf(g: Group): Group {
    let cur = g;
    for (let i = 0; i < 10 && cur.overlordId !== null; i++) {
      const up = this.groups.get(cur.overlordId);
      if (!up) break;
      cur = up;
    }
    return cur;
  }

  /** All organizations under (or allied to) this one, itself included. */
  realmMembers(top: Group): Group[] {
    const out = [top];
    for (let i = 0; i < out.length; i++) for (const x of this.groups.values()) if (x.overlordId === out[i].id && !out.includes(x)) out.push(x);
    return out;
  }

  /** Killing an enemy's leader in war brings its organization under the victor as a tribute-paying vassal. */
  conquer(victor: Group, beaten: Group, by: Agent) {
    if (this.realmOf(beaten).id === this.realmOf(victor).id) return;
    beaten.overlordId = this.realmOf(victor).id;
    beaten.relation = "vassal";
    beaten.war = null;
    if (victor.war?.groupId === beaten.id) victor.war = null;
    for (const x of this.groups.values()) if (x.overlordId === beaten.id) x.overlordId = beaten.overlordId;
    this.count("conquests");
    this.logEvent("society", `${by.name} slew the leader of ${beaten.name}: it now pays tribute to ${this.realmOf(victor).name}`, by.id);
  }

  /** Two organizations join: the smaller stands with the larger as an ally, sharing its wars but paying nothing. */
  private ally(g: Group, other: Group, leader: Agent) {
    const [big, small] = this.realmMembers(this.realmOf(g)).length >= this.realmMembers(this.realmOf(other)).length ? [this.realmOf(g), this.realmOf(other)] : [this.realmOf(other), this.realmOf(g)];
    if (big.id === small.id) return;
    small.overlordId = big.id;
    small.relation = "ally";
    this.count("alliances");
    this.logEvent("society", `${leader.name} joined ${small.name} and ${big.name} in alliance`, leader.id);
  }

  /** Every 10 ticks: vassals pay tribute; realms fight as one; weak overlords face revolt. */
  private governRealms() {
    for (const g of this.groups.values()) {
      if (g.overlordId === null) continue;
      const over = this.groups.get(g.overlordId);
      if (!over) {
        g.overlordId = null;
        g.relation = null;
        continue;
      }
      if (g.relation === "vassal" && g.store.rations >= 2) {
        const tribute = Math.ceil(g.store.rations * 0.25);
        g.store.rations -= tribute;
        over.store.rations += tribute;
      }
      // The realm's wars are everyone's wars.
      if (over.war && !g.war) g.war = { ...over.war };
      const leader = this.leaderOf(g);
      const overLeader = this.leaderOf(over);
      // Revolt: an ambitious vassal leader, stronger than its overlord or with a grudge, throws off the yoke.
      const resentment = (overLeader ? -(leader?.bonds.get(overLeader.id) ?? 0) : 0.3) + (g.members.size > over.members.size * 0.7 ? 0.4 : 0) + (!overLeader || over.crisis ? 0.5 : 0);
      if (leader && g.relation === "vassal" && ambition(leader.traits) > 0.45 && resentment > 0.2 && this.rng.chance(0.03 * this.params.strife * (ambition(leader.traits) + resentment))) {
        g.overlordId = null;
        g.relation = null;
        g.war = { groupId: over.id, tribe: null, name: over.name, since: this.tick };
        this.count("revolts");
        this.logEvent("society", `${leader.name} led ${g.name} in revolt against ${over.name}`, leader.id);
      }
    }
  }

  // --- Society: bonds, following, organizations and leadership

  bond(a: Agent, b: Agent, delta: number) {
    if (a.id === b.id) return;
    const v = Math.max(-1, Math.min(1, (a.bonds.get(b.id) ?? 0) + delta));
    a.bonds.set(b.id, v);
    if (a.bonds.size > MAX_BONDS) {
      let weakest = -1;
      let weakestAbs = Infinity;
      for (const [id, x] of a.bonds)
        if (Math.abs(x) < weakestAbs) {
          weakestAbs = Math.abs(x);
          weakest = id;
        }
      a.bonds.delete(weakest);
    }
  }

  group(a: Agent): Group | undefined {
    return a.groupId !== null ? this.groups.get(a.groupId) : undefined;
  }

  leaderOf(g: Group): Agent | undefined {
    return this.agents.get(g.leaderId);
  }

  /**
   * How much `f` looks up to `x`. Personal feeling counts most; beyond that, each temperament
   * admires something different: the curious admire knowledge, the aggressive strength, the
   * cooperative generosity, and conformists whoever is already popular.
   */
  admiration(f: Agent, x: Agent): number {
    if (f.grudges.includes(x.id)) return -1;
    const t = f.traits;
    const p = this.params;
    const conform = conformity(f.genome.traits, false);
    // Personal feeling dominates; reputation for qualities only matters to those who value them.
    const qualities =
      (totalLevels(x.understanding) / 8) * t.curiosity +
      Math.min(1, x.kills * 0.25) * t.aggression +
      Math.min(1, x.gifts / 10) * t.cooperation +
      Math.log1p(x.followers) * 0.12 * conform +
      Math.min(0.5, x.renown * 0.15) +
      (x.reputation - 0.5) +
      (x.stage === "elder" ? 0.1 : 0) +
      (x.groupId !== null && x.groupId === f.groupId ? 0.15 : 0);
    // Material reasons to follow: someone who can feed you (food, fields, a full common store) matters
    // more the hungrier you are; someone who can protect you matters more the more cautious you are.
    const hunger = 1 - f.energy / p.maxEnergy;
    const g = this.group(x);
    const store = g && g.leaderId === x.id ? g.store.rations / Math.max(1, g.members.size) : 0;
    const provider = Math.min(1, (x.inventory.rations + x.fields.length * 2 + store * 2) / 12) * (0.3 + hunger);
    const protector = Math.min(1, x.kills * 0.2 + (x.energy / p.maxEnergy) * 0.3 + (x.inventory.tools > 0 ? 0.2 : 0)) * t.caution * 0.6;
    // The frail lose their sway, however loved they were.
    const frail = x.frailty > 0.5 ? (x.frailty - 0.5) * 2.4 : 0;
    // Qualities are only appreciated as far as one can understand the other's speech.
    return (f.bonds.get(x.id) ?? 0) * 1.6 + qualities * 0.7 * (0.5 + 0.5 * this.intelligibility(f, x)) + provider * 0.8 + protector - (x.energy < p.maxEnergy * 0.2 ? 0.3 : 0) - frail;
  }

  /** Whether following `x` would make `a` its own leader through the chain. */
  private wouldLoop(a: Agent, x: Agent): boolean {
    let cur: Agent | undefined = x;
    for (let i = 0; i < 30 && cur; i++) {
      if (cur.id === a.id) return true;
      cur = cur.follows !== null ? this.agents.get(cur.follows) : undefined;
    }
    return false;
  }

  /** Instinct's choice of whom to follow: the most admired person it knows, if admired more than it values its independence. */
  private chooseFollow(a: Agent) {
    if (a.stage === "child" || this.tick < a.followLockedUntil) return;
    // Independent spirits (uncooperative, curious, already followed) need more to bow to anyone.
    const independence = 0.85 + (1 - a.traits.cooperation) * 0.6 + a.traits.curiosity * 0.25 + Math.log1p(a.followers) * 0.3;
    const known = new Map<number, Agent>();
    for (const n of this.neighbours(a, 8)) if (n.stage !== "child") known.set(n.id, n);
    for (const id of a.bonds.keys()) {
      const n = this.agents.get(id);
      if (n && n.stage !== "child" && this.dist(a, n) <= 20) known.set(id, n);
    }
    let best: Agent | null = null;
    let bestScore = -Infinity;
    for (const n of known.values()) {
      const s = this.admiration(a, n);
      if (s > bestScore && !this.wouldLoop(a, n)) {
        bestScore = s;
        best = n;
      }
    }
    const current = a.follows !== null ? this.agents.get(a.follows) : undefined;
    const currentScore = current ? this.admiration(a, current) : -Infinity;
    // Loyalty: switch only for someone clearly more admired.
    if (best && bestScore > independence && (!current || bestScore > currentScore + 0.3)) a.follows = best.id;
    else if (current && currentScore < independence * 0.6) a.follows = null;
    if (a.follows !== null && !this.agents.get(a.follows)) a.follows = null;
  }

  /** Instinct keeps an agent in the group of whoever it follows, and lets it walk away from a hated leader. */
  private syncMembership(a: Agent) {
    if (a.stage === "child") return;
    const g = this.group(a);
    const leader = g ? this.leaderOf(g) : undefined;
    if (g && leader && leader.id !== a.id && (a.bonds.get(leader.id) ?? 0) < -0.35) {
      this.leaveGroup(a, `turned against ${leader.name}`);
      return;
    }
    const followed = a.follows !== null ? this.agents.get(a.follows) : undefined;
    const fg = followed ? this.group(followed) : undefined;
    const fl = fg ? this.leaderOf(fg) : undefined;
    const loyal = !!fl && (fl.id === followed!.id || (a.bonds.get(fl.id) ?? 0) > 0 || this.admiration(a, fl) > 0.5);
    if (fg && loyal && fg.id !== a.groupId && this.tick >= a.followLockedUntil && (!g || this.rng.chance(0.15))) this.joinGroup(a, fg);
  }

  foundGroup(a: Agent, name: string, purpose: string, norms: Group["norms"] = [], quiet = false): Group {
    if (a.groupId !== null) this.leaveGroup(a, "to found a new group");
    const g: Group = {
      id: this.nextGroupId++,
      name: name.slice(0, 40) || `${groupKind(a.traits)} of ${a.name}`,
      purpose: purpose.slice(0, 200),
      founderId: a.id,
      leaderId: a.id,
      heirId: null,
      members: new Set([a.id]),
      norms,
      store: emptyStore(),
      foundedTick: this.tick,
      call: null,
      crisis: null,
      aim: null,
      aimSince: this.tick,
      project: null,
      war: null,
      cohesion: a.traits.cooperation,
      overlordId: null,
      relation: null,
      leaders: [{ id: a.id, name: a.name, from: this.tick, how: "founded it" }],
    };
    this.groups.set(g.id, g);
    a.groupId = g.id;
    this.refreshCulture(a);
    if (!quiet) this.logEvent("society", `${a.name} (${a.tribe}) founded ${g.name}${g.purpose ? `: "${g.purpose}"` : ""}`, a.id);
    return g;
  }

  joinGroup(a: Agent, g: Group) {
    if (a.groupId === g.id || (a.exiledFrom.get(g.id) ?? 0) > this.tick) return;
    if (a.groupId !== null) this.leaveGroup(a, `to join ${g.name}`, true);
    g.members.add(a.id);
    a.groupId = g.id;
    this.refreshCulture(a);
    this.remember(a, `joined ${g.name}`);
  }

  leaveGroup(a: Agent, why: string, quiet = false) {
    const g = this.group(a);
    if (!g) return;
    g.members.delete(a.id);
    a.groupId = null;
    this.refreshCulture(a);
    this.remember(a, `left ${g.name}`);
    if (!quiet && g.leaderId !== a.id && this.rng.chance(0.4)) this.logEvent("society", `${a.name} left ${g.name} (${why})`, a.id);
    if (g.heirId === a.id) g.heirId = null;
    if (g.leaderId === a.id) this.succeed(g, `${a.name} left`);
  }

  refreshCulture(a: Agent) {
    const g = this.group(a);
    a.culture = g ? cultureShift(g.norms, conformity(a.genome.traits, a.stage === "adolescent")) : zeroTraits();
  }

  /** Direct followers of each member from within the group. Frail members' followings count for less. */
  private followCounts(g: Group): Map<number, number> {
    const counts = new Map<number, number>();
    for (const id of g.members) {
      const m = this.agents.get(id);
      if (m && m.follows !== null && g.members.has(m.follows)) counts.set(m.follows, (counts.get(m.follows) ?? 0) + 1);
    }
    for (const [id, c] of counts) counts.set(id, c * (1 - (this.agents.get(id)?.frailty ?? 0) * 0.7));
    return counts;
  }

  private setLeader(g: Group, next: Agent, how: string) {
    const prev = this.agents.get(g.leaderId);
    g.leaderId = next.id;
    if (g.heirId === next.id) g.heirId = null;
    g.leaders.push({ id: next.id, name: next.name, from: this.tick, how });
    this.logEvent("society", `${next.name} now leads ${g.name} (${how})`, next.id);
    this.remember(next, `became leader of ${g.name}`);
    // A leader who stepped aside defers to the new one.
    if (prev?.alive && g.members.has(prev.id) && prev.id !== next.id) prev.follows = next.id;
  }

  /**
   * While a leader lives and is hale, loyalty can still shift. A merely more popular member takes over
   * quietly; an ambitious one with a real following may openly challenge, which plunges the group into crisis.
   */
  private chooseLeader(g: Group) {
    const counts = this.followCounts(g);
    const current = this.agents.get(g.leaderId);
    if (!current || !g.members.has(current.id)) return this.succeed(g, "the loss of its leader");
    const currentCount = counts.get(current.id) ?? 0;
    const strife = this.strifeIn(g);
    for (const [id, c] of counts) {
      const m = this.agents.get(id);
      if (!m || m.id === current.id || m.stage === "child" || m.frailty > 0.5) continue;
      const amb = ambition(m.traits);
      const weakness = current.frailty + (0.5 - current.reputation) + (currentCount < 2 ? 0.3 : 0);
      if (amb > 0.5 && c >= Math.max(1, currentCount * 0.5) && this.rng.chance(0.2 * strife * amb * (1 + weakness))) {
        this.count("challenges");
        this.startCrisis(g, `${m.name} challenged ${current.name}`, [current, m]);
        return;
      }
    }
    let best: Agent | null = null;
    let bestCount = -1;
    for (const [id, c] of counts) {
      const m = this.agents.get(id);
      if (m && m.stage !== "child" && c > bestCount) {
        best = m;
        bestCount = c;
      }
    }
    if (best && best.id !== current.id && bestCount >= currentCount + 2) this.setLeader(g, best, `displacing ${current.name}, who had lost the members' loyalty`);
  }

  /**
   * The leader is gone (dead, departed, or too frail). A named heir can take over smoothly, unless an
   * ambitious member with a following contests it; without an heir, anyone ambitious may claim power.
   */
  private succeed(g: Group, reason: string) {
    const counts = this.followCounts(g);
    const heir = g.heirId !== null ? this.agents.get(g.heirId) : undefined;
    const validHeir = heir && g.members.has(heir.id) && heir.frailty < 0.5 ? heir : undefined;
    const pool = [...g.members]
      .map((id) => this.agents.get(id))
      .filter((m): m is Agent => !!m && m.stage !== "child" && m.id !== g.leaderId && m.frailty < 0.6);
    const strife = this.strifeIn(g);
    // Claimants: the ambitious with at least some following (or burning ambition).
    const rivals = pool
      .filter((m) => m.id !== validHeir?.id && ambition(m.traits) > 0.56 - 0.1 * strife && ((counts.get(m.id) ?? 0) >= 1 || ambition(m.traits) > 0.62))
      .sort((x, y) => (counts.get(y.id) ?? 0) + ambition(y.traits) - ((counts.get(x.id) ?? 0) + ambition(x.traits)))
      .slice(0, 3);
    if (validHeir && (!rivals.length || strife === 0)) {
      this.count("smooth successions");
      return this.setLeader(g, validHeir, `the named heir, after ${reason}`);
    }
    if (validHeir) return this.startCrisis(g, `${reason}; ${rivals.map((r) => r.name).join(" and ")} would not accept the heir ${validHeir.name}`, [validHeir, ...rivals]);
    const ranked = pool.sort((x, y) => (counts.get(y.id) ?? 0) - (counts.get(x.id) ?? 0) || y.reputation - x.reputation);
    const claimants = [...new Set([ranked[0], ...rivals].filter((x): x is Agent => !!x))];
    if (!claimants.length) return;
    if (claimants.length === 1 || strife === 0) {
      this.count("uncontested successions");
      return this.setLeader(g, claimants[0], `after ${reason}`);
    }
    this.startCrisis(g, reason, claimants);
  }

  /** Written law makes power change hands by rule, not force: strife is much rarer where most know the law. */
  strifeIn(g: Group): number {
    let lawful = 0;
    for (const id of g.members) if (this.agents.get(id)?.techs.has("law")) lawful++;
    return this.params.strife * (lawful >= g.members.size / 2 ? 0.35 : 1);
  }

  private startCrisis(g: Group, reason: string, claimants: Agent[]) {
    g.crisis = { since: this.tick, claimants: claimants.map((c) => c.id), reason };
    this.count("crises");
    g.leaderId = 0; // no one leads until it is settled
    g.heirId = null;
    this.logEvent("society", `Crisis in ${g.name}: ${claimants.map((c) => c.name).join(" and ")} contend for leadership (${reason})`, claimants[0].id);
    for (const c of claimants) this.remember(c, `claimed leadership of ${g.name}`);
  }

  /** Close family: parents, children, partners and siblings. Few will raise a hand against them, even in a struggle for power. */
  isKin(a: Agent, b: Agent) {
    return (
      a.partner === b.id || b.partner === a.id || a.childIds.includes(b.id) || b.childIds.includes(a.id) ||
      (!!a.parents && !!b.parents && a.parents.some((p) => b.parents!.includes(p)))
    );
  }

  /** Whom a member backs in a power struggle: the claimant it follows (directly or up the chain), else the one it admires most. */
  private sideOf(m: Agent, claimants: Agent[]): Agent | null {
    for (const c of claimants) if (m.id === c.id || m.follows === c.id || this.leadsTo(m, c)) return c;
    let best: Agent | null = null;
    let bestScore = 0.3;
    for (const c of claimants) {
      const s = this.admiration(m, c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  /**
   * A power struggle, every 10 ticks until settled: partisans fight, the store is looted, the cautious
   * flee. It ends when one side has clear backing, a rival falls, or the group exhausts itself.
   */
  private processCrisis(g: Group) {
    const cr = g.crisis!;
    const claimants = cr.claimants.map((id) => this.agents.get(id)).filter((c): c is Agent => !!c && g.members.has(c.id) && c.frailty < 0.85);
    const members = [...g.members].map((id) => this.agents.get(id)).filter((m): m is Agent => !!m && m.stage !== "child");
    if (!claimants.length) {
      g.crisis = null;
      return this.succeed(g, "every claimant fell");
    }
    const sides = new Map<number, Agent[]>(claimants.map((c) => [c.id, []]));
    const neutral: Agent[] = [];
    for (const m of members) {
      const side = this.sideOf(m, claimants);
      if (side) sides.get(side.id)!.push(m);
      else neutral.push(m);
    }
    const strife = this.strifeIn(g);
    // Partisans clash.
    for (const c of claimants) {
      const rival = claimants.filter((r) => r.id !== c.id).sort((x, y) => sides.get(y.id)!.length - sides.get(x.id)!.length)[0];
      if (!rival) continue;
      const restrained = this.isKin(c, rival) || (c.bonds.get(rival.id) ?? 0) > 0.5;
      if ((c.stage === "adult" || c.stage === "adolescent") && !restrained && this.rng.chance(strife * 0.25 * (0.4 + ambition(c.traits)))) {
        c.intent = "attack";
        c.intentTarget = rival.id;
        c.intentUntil = this.tick + 12;
      }
      for (const s of sides.get(c.id)!) {
        if (s.id === c.id || (s.stage !== "adult" && s.stage !== "adolescent") || s.traits.aggression < 0.45) continue;
        if (!this.rng.chance(strife * 0.1 * s.traits.aggression)) continue;
        const foe = this.neighbours(s, 8).find((n) => sides.get(rival.id)!.includes(n) && !this.isKin(s, n) && (s.bonds.get(n.id) ?? 0) < 0.5);
        if (foe) {
          s.intent = "attack";
          s.intentTarget = foe.id;
          s.intentUntil = this.tick + 8;
        }
      }
    }
    if (this.rng.chance(0.3)) {
      const [a, b] = [...sides.entries()].sort((x, y) => y[1].length - x[1].length);
      if (a && b) this.logEvent("society", `Strife in ${g.name}: ${a[1].length} back ${this.agents.get(a[0])?.name}, ${b[1].length} back ${this.agents.get(b[0])?.name}`);
    }
    // With no one in charge, the greedy help themselves to the common store.
    let looted = 0;
    for (const m of members)
      if (m.traits.greed > 0.55 && g.store.rations > 0 && this.rng.chance(0.4 * (1 - this.restraint(m, "loot")))) {
        const take = Math.min(g.store.rations, 2);
        g.store.rations -= take;
        m.inventory.rations += take;
        looted += take;
        this.deed(m, "loot");
      }
    if (looted) this.count("lootings");
    if (looted >= 4) this.logEvent("society", `The common store of ${g.name} was looted (${looted} rations taken)`);
    // The cautious and uncommitted slip away.
    for (const m of neutral)
      if (m.traits.caution > 0.55 && this.rng.chance(0.05 * strife)) this.leaveGroup(m, "fled the strife");

    const total = [...sides.values()].reduce((x, v) => x + v.length, 0);
    const ranked = [...sides.entries()].sort((x, y) => y[1].length - x[1].length);
    const [winnerId, winnerSide] = ranked[0];
    const elapsed = this.tick - cr.since;
    // Power is rarely settled quickly: it takes time to win two-thirds of the group, unless every rival is gone.
    if (claimants.length === 1 || (elapsed >= 20 && winnerSide.length >= Math.max(1, total * 0.66)) || elapsed > 150) {
      const winner = this.agents.get(winnerId)!;
      g.crisis = null;
      this.count("crises resolved");
      this.tally["days of strife"] = (this.tally["days of strife"] ?? 0) + elapsed;
      this.setLeader(g, winner, `prevailed after ${elapsed} days of strife (${cr.reason})`);
      for (const [lid, side] of ranked.slice(1)) {
        const loser = this.agents.get(lid);
        if (!loser || !g.members.has(lid)) continue;
        this.bond(loser, winner, -0.4);
        if (side.length >= Math.max(2, total * 0.25)) {
          // A strong loser walks out with its people.
          const split = this.foundGroup(loser, `${groupKind(loser.traits)} of ${loser.name}`, g.purpose, g.norms.map((n) => ({ ...n })), true);
          for (const m of side) if (m.id !== loser.id && g.members.has(m.id)) this.joinGroup(m, split);
          this.count("schisms");
          this.logEvent("society", `Schism: ${loser.name} refused to bow to ${winner.name} and led ${side.length} away from ${g.name} to found ${split.name}`, loser.id);
        } else if (this.rng.chance(winner.traits.aggression * strife * 0.7)) {
          for (const m of side) if (g.members.has(m.id) && (m.id === loser.id || (m.bonds.get(loser.id) ?? 0) > 0.3)) this.leaveGroup(m, `driven out by ${winner.name}`, true);
          this.count("purges");
          this.logEvent("society", `${winner.name} purged ${loser.name} and ${Math.max(0, side.length - 1)} supporters from ${g.name}`, winner.id);
        } else {
          loser.follows = winner.id;
          this.remember(loser, `submitted to ${winner.name}`);
        }
      }
      this.reform(g, winner);
    }
  }

  /** A new leader whose temperament differs remakes the group's law in its own image. */
  private reform(g: Group, leader: Agent) {
    const own = NORM_TEMPLATES.map((n) => ({ n, w: n.when(leader.traits) })).filter((x) => x.w > 0.6 && !g.norms.some((m) => m.text === x.n.text)).sort((x, y) => y.w - x.w)[0];
    if (!own || !this.rng.chance(0.3 + ambition(leader.traits) * 0.6)) return;
    const old = g.norms.length >= 2 ? g.norms.shift() : undefined;
    g.norms.push({ text: own.n.text, effects: own.n.effects, author: leader.name, tick: this.tick });
    for (const id of g.members) {
      const m = this.agents.get(id);
      if (m) this.refreshCulture(m);
    }
    this.count("reforms");
    this.logEvent("society", old ? `${leader.name} cast aside "${old.text}" and decreed "${own.n.text}" for ${g.name}` : `${leader.name} decreed "${own.n.text}" for ${g.name}`, leader.id);
  }

  /** An ageing leader names an heir; a frail one steps down, and that opens the succession. */
  private planSuccession(g: Group) {
    const leader = this.leaderOf(g);
    if (!leader) return;
    const heir = g.heirId !== null ? this.agents.get(g.heirId) : undefined;
    if (heir && (!g.members.has(heir.id) || heir.frailty > 0.5)) g.heirId = null;
    const ageing = leader.stage === "elder" || leader.frailty > 0.3;
    // Minds name their own heirs; instinct names the member it trusts most among those others follow.
    if (ageing && g.heirId === null && !this.thinks(leader)) {
      const counts = this.followCounts(g);
      const pick = [...g.members]
        .map((id) => this.agents.get(id))
        .filter((m): m is Agent => !!m && m.id !== leader.id && (m.stage === "adult" || m.stage === "adolescent") && m.frailty < 0.3)
        .map((m) => ({ m, score: (leader.bonds.get(m.id) ?? 0) * 1.5 + (counts.get(m.id) ?? 0) * 0.4 + m.reputation + totalLevels(m.understanding) * 0.05 }))
        .sort((x, y) => y.score - x.score)[0]?.m;
      if (pick) this.nameHeir(g, leader, pick);
    }
    if (leader.frailty > 0.65) {
      this.logEvent("society", `${leader.name}, grown frail, stepped down from leading ${g.name}`, leader.id);
      this.succeed(g, `${leader.name} stepped down`);
    }
  }

  nameHeir(g: Group, leader: Agent, heir: Agent) {
    if (g.heirId === heir.id) return;
    g.heirId = heir.id;
    this.bond(heir, leader, 0.2);
    this.remember(heir, `was named heir to ${g.name} by ${leader.name}`);
    this.logEvent("society", `${leader.name} named ${heir.name} heir to ${g.name}`, leader.id);
  }

  private dissolve(g: Group, why: string) {
    for (const id of g.members) {
      const m = this.agents.get(id);
      if (m) {
        m.groupId = null;
        this.refreshCulture(m);
      }
    }
    this.groups.delete(g.id);
    this.logEvent("society", `${g.name} is no more (${why}).`);
  }

  addNorm(g: Group, author: Agent, text: string) {
    text = text.slice(0, 200);
    // Re-affirming an existing norm keeps it (and its judged effect) rather than decreeing it anew.
    if (g.norms.some((n) => n.text.toLowerCase() === text.toLowerCase())) return;
    g.norms = [...g.norms, { text, effects: null, author: author.name, tick: this.tick }].slice(-5);
    this.pendingNorms.push({ groupId: g.id, text, tick: this.tick });
    this.logEvent("society", `${author.name} decreed for ${g.name}: "${text}"`, author.id);
  }

  /** The judge's reading of how a decree pushes temperament. */
  applyNormEffects(groupId: number, text: string, effects: Partial<Traits>) {
    const g = this.groups.get(groupId);
    const n = g?.norms.find((x) => x.text === text);
    if (!g || !n) return;
    n.effects = effects;
    for (const id of g.members) {
      const m = this.agents.get(id);
      if (m) this.refreshCulture(m);
    }
  }

  /** Every 10 ticks: who follows whom, who leads, groups forming and failing, and the shared stores. */
  private society() {
    const all = [...this.agents.values()];
    for (const a of all) {
      for (let k = 0; k < a.lang.length; k++) a.lang[k] += this.rng.gaussian() * 0.006;
      this.tendFaith(a);
      this.maybeFoundReligion(a);
      for (const [id, v] of a.bonds) {
        if (!this.agents.has(id)) a.bonds.delete(id);
        else a.bonds.set(id, v * Math.pow(BOND_DECAY, 10));
      }
      this.chooseFollow(a);
    }
    // Followers and influence (size of the follow tree under each agent).
    for (const a of all) a.followers = a.influence = 0;
    for (const a of all) {
      if (a.follows === null) continue;
      const f = this.agents.get(a.follows);
      if (f) f.followers++;
      const seen = new Set<number>();
      let cur = f;
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        cur.influence++;
        cur = cur.follows !== null ? this.agents.get(cur.follows) : undefined;
      }
    }
    for (const a of all) this.syncMembership(a);

    // Organizations crystallise around anyone with a following of their own.
    for (const a of all) {
      if (a.follows !== null || a.groupId !== null || a.influence < 4 || (a.stage !== "adult" && a.stage !== "elder")) continue;
      const norms = NORM_TEMPLATES.map((n) => ({ n, w: n.when(a.traits) }))
        .filter((x) => x.w > 0.62)
        .sort((x, y) => y.w - x.w)
        .slice(0, 2)
        .map(({ n }) => ({ text: n.text, effects: n.effects, author: a.name, tick: this.tick }));
      const faith = this.religionOf(a);
      const g = faith && a.faith > 0.6
        ? this.foundGroup(a, `Faithful of ${faith.name.replace(/^the Way of /, "")}`, `To live by ${faith.name}`, norms)
        : this.foundGroup(a, `${groupKind(a.traits)} of ${a.name}`, "", norms);
      for (const m of all) if (m.groupId === null && m.stage !== "child" && this.leadsTo(m, a)) this.joinGroup(m, g);
    }

    for (const g of [...this.groups.values()]) {
      for (const id of [...g.members]) if (!this.agents.has(id)) g.members.delete(id);
      if (!g.members.size) {
        this.dissolve(g, "its last member is gone");
        continue;
      }
      const leader = this.agents.get(g.leaderId);
      if (g.crisis) this.processCrisis(g);
      else if (!leader || !g.members.has(g.leaderId)) this.succeed(g, leader ? `${leader.name} left` : "the death of its leader");
      else {
        if (this.tick % 50 === 0) this.chooseAim(g);
        this.planSuccession(g);
        // Stepping down may have opened a succession or crisis; don't judge the old leader's standing as well.
        if (!g.crisis && g.leaderId === leader.id) this.chooseLeader(g);
      }
      this.tendStore(g);
      this.speakTogether(g);
      this.tendCulture(g);
    }
  }

  private leadsTo(a: Agent, leader: Agent): boolean {
    let cur = a.follows !== null ? this.agents.get(a.follows) : undefined;
    for (let i = 0; i < 30 && cur; i++) {
      if (cur.id === leader.id) return true;
      cur = cur.follows !== null ? this.agents.get(cur.follows) : undefined;
    }
    return false;
  }

  /** Cohesion, sanctions against cheats, the leader's faith spreading, and norms that drift and multiply. */
  private tendCulture(g: Group) {
    const members = [...g.members].map((id) => this.agents.get(id)).filter((m): m is Agent => !!m && m.stage !== "child");
    if (!members.length) return;
    g.cohesion = members.reduce((s, m) => s + m.traits.cooperation, 0) / members.length;
    const leader = this.leaderOf(g);
    if (!leader || g.crisis) return;
    // Sanctions: a group that values honesty casts out those known as cheats.
    const honest = leader.traits.cooperation > 0.5 || this.knows(leader, "law") || g.norms.some((n) => n.text.includes("cheat") || n.text.includes("cast out"));
    for (const m of members)
      if (m.id !== leader.id && m.reputation < 0.2 && honest && this.rng.chance(0.3)) {
        this.leaveGroup(m, `cast out by ${leader.name} as a cheat`, true);
        m.exiledFrom.set(g.id, this.tick + 300);
        this.count("cast out");
        if (this.rng.chance(0.2)) this.logEvent("society", `${g.name} cast out ${m.name} for dishonesty`, m.id);
      }
    // The leader's faith spreads through its people.
    if (leader.religion !== null)
      for (const m of members)
        if (m.religion !== leader.religion && this.rng.chance(0.01 * leader.faith * conformity(m.genome.traits, m.stage === "adolescent") * (1 - (m.religion !== null ? m.faith : 0))))
          if (this.rng.chance(1 - m.traits.curiosity)) this.convert(m, leader.religion, leader.faith * 0.6);
    // Culture keeps moving: instinct leaders occasionally coin or reshape a norm.
    if (!this.thinks(leader) && this.rng.chance(0.015 * (0.4 + leader.traits.curiosity))) {
      const base = g.norms.length && this.rng.chance(0.5) ? this.rng.pick(g.norms) : null;
      const next = (base && mutateNorm(base, this.rng, leader.name, this.tick)) || inventNorm(leader.traits, this.rng, leader.name, this.tick);
      if (!g.norms.some((n) => n.text === next.text)) {
        g.norms = [...g.norms.filter((n) => n !== base), next].slice(-5);
        for (const m of members) this.refreshCulture(m);
        this.count("norms coined");
        if (this.rng.chance(0.3)) this.logEvent("society", `${leader.name} taught ${g.name} a new rule: "${next.text}"`, leader.id);
      }
    }
  }

  /** Members' tongues drift toward their leader's: shared organizations become shared language. */
  private speakTogether(g: Group) {
    const leader = this.leaderOf(g);
    if (!leader) return;
    for (const id of g.members) {
      const m = this.agents.get(id);
      if (m && m.id !== leader.id) for (let k = 0; k < m.lang.length; k++) m.lang[k] += (leader.lang[k] - m.lang[k]) * 0.002;
    }
  }

  /** The power of the collective: members pool surplus, the hungry draw on it, and a greedy leader may skim. */
  private tendStore(g: Group) {
    const leader = this.leaderOf(g);
    for (const id of g.members) {
      const m = this.agents.get(id);
      if (!m || m.stage === "child") continue;
      const granary = leader && this.knows(leader, "storage");
      if (m.inventory.rations > KEEP.rations + 1 && g.store.rations < g.members.size * (granary ? 10 : 3) && this.rng.chance(m.traits.cooperation)) {
        m.inventory.rations--;
        g.store.rations++;
      }
    }
    if (g.store.rations > 0 && !(leader && this.knows(leader, "storage")) && this.rng.chance(0.04 * g.store.rations)) g.store.rations--;
    if (g.crisis) return;
    // The common store feeds the hungriest members, children and elders included.
    const hungry = [...g.members]
      .map((id) => this.agents.get(id))
      .filter((m): m is Agent => !!m && m.inventory.rations === 0 && (m.reputation > 0.2 && (m.energy < this.params.maxEnergy * 0.45 || (m.intent === "research" && m.energy < this.params.maxEnergy * 0.65))))
      .sort((x, y) => x.energy - y.energy);
    for (const m of hungry) {
      if (g.store.rations <= 0) break;
      g.store.rations--;
      m.energy = Math.min(this.params.maxEnergy, m.energy + RATION_ENERGY);
      if (leader && leader.id !== m.id) this.bond(m, leader, 0.04);
    }
    if (leader && g.store.rations > 2 && leader.traits.greed > 0.65 && this.rng.chance(leader.traits.greed * 0.3)) {
      g.store.rations--;
      leader.inventory.rations++;
      const witness = this.neighbours(leader, 6).find((n) => g.members.has(n.id));
      if (witness && this.rng.chance(0.5)) {
        leader.reputation = Math.max(0, leader.reputation - 0.05);
        this.bond(witness, leader, -0.15);
        if (this.rng.chance(0.3)) this.logEvent("society", `${witness.name} saw ${leader.name} take from the store of ${g.name}`, leader.id);
      }
    }
  }

  // --- Movement helpers

  private wander(a: Agent) {
    if (this.rng.chance(0.15)) a.heading = this.rng.pick(STEPS);
    const [dx, dy] = a.heading;
    if (!this.tryMove(a, a.x + dx, a.y + dy)) a.heading = this.rng.pick(STEPS);
  }

  private moveToward(a: Agent, gx: number, gy: number) {
    let best: [number, number] | null = null;
    let bestD = Math.hypot(gx - a.x, gy - a.y);
    for (const [dx, dy] of this.rng.shuffle([...STEPS])) {
      const nx = a.x + dx;
      const ny = a.y + dy;
      if (!this.world.passable(nx, ny) || this.occupancy[this.world.idx(nx, ny)]) continue;
      const d = Math.hypot(gx - nx, gy - ny) + TERRAIN[this.world.terrainAt(nx, ny)].moveCost * 0.3;
      if (d < bestD) {
        bestD = d;
        best = [nx, ny];
      }
    }
    if (best) this.tryMove(a, best[0], best[1]);
  }

  private moveTowardTerrain(a: Agent, ts: Terrain[]) {
    for (let r = 2; r <= 8; r += 2)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = a.x + dx;
          const y = a.y + dy;
          if (this.world.inBounds(x, y) && ts.includes(this.world.terrainAt(x, y))) return this.moveToward(a, x, y);
        }
    this.wander(a);
  }

  private tryMove(a: Agent, nx: number, ny: number): boolean {
    const w = this.world;
    if (!w.passable(nx, ny) || this.occupancy[w.idx(nx, ny)]) return false;
    this.occupancy[w.idx(a.x, a.y)] = 0;
    this.cellAgent[w.idx(a.x, a.y)] = undefined;
    a.x = nx;
    a.y = ny;
    this.occupancy[w.idx(nx, ny)] = a.id;
    this.cellAgent[w.idx(nx, ny)] = a;
    a.energy -= TERRAIN[w.terrainAt(nx, ny)].moveCost * (this.knows(a, "wheel") ? 0.5 : 1);
    return true;
  }

  private freeAdjacent(a: Agent): { x: number; y: number } | null {
    for (const [dx, dy] of this.rng.shuffle([...STEPS])) {
      const x = a.x + dx;
      const y = a.y + dy;
      if (this.world.passable(x, y) && !this.occupancy[this.world.idx(x, y)]) return { x, y };
    }
    return null;
  }

  private bestFoodNear(a: Agent, r: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestScore = 0.8;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = a.x + dx;
        const y = a.y + dy;
        if (!this.world.passable(x, y)) continue;
        const i = this.world.idx(x, y);
        if (this.occupancy[i] && this.occupancy[i] !== a.id) continue;
        const s = this.world.food[i] / (1 + Math.hypot(dx, dy) * 0.5);
        if (s > bestScore) {
          bestScore = s;
          best = { x, y };
        }
      }
    return best;
  }

  kill(a: Agent, cause: string) {
    if (!a.alive) return;
    a.alive = false;
    a.causeOfDeath = cause;
    a.diedAt = this.tick;
    this.occupancy[this.world.idx(a.x, a.y)] = 0;
    this.cellAgent[this.world.idx(a.x, a.y)] = undefined;
    // Bodies return some food to the land.
    const i = this.world.idx(a.x, a.y);
    this.world.food[i] = Math.min(TERRAIN[this.world.terrain[i]].maxFood * 1.5, this.world.food[i] + 3);
    this.bequeath(a);
    this.reckon(a);
    this.agents.delete(a.id);
    this.graveyard.push(a);
    if (this.graveyard.length > 3000) this.graveyard.splice(0, 1000);
    const k = this.knowledgeByGeneration.get(a.generation) ?? { sum: 0, n: 0 };
    k.sum += totalLevels(a.understanding);
    k.n++;
    this.knowledgeByGeneration.set(a.generation, k);
    this.deaths++;
    this.deathAgeSum += a.age;
    if (cause.startsWith("killed")) this.kills++;
    for (const id of [a.partner, ...(a.parents ?? []), ...a.childIds]) {
      const kin = id !== null ? this.agents.get(id) : undefined;
      if (kin) {
        this.feel(kin, "bereaved");
        this.remember(kin, `mourned ${a.name}`);
      }
    }
    if (cause !== "starvation" || this.rng.chance(0.2))
      this.logEvent("death", `${a.name} (${a.stage}, ${a.tribe}, age ${a.age}) died: ${cause}`, a.id);
  }

  // --- Queries

  dist(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  /** Everyone within Chebyshev distance r, in row-major order. Bounds are clamped once rather than checked per cell. */
  neighbours(a: Agent, r: number): Agent[] {
    const out: Agent[] = [];
    const R = Math.ceil(r);
    const w = this.world.width;
    const x0 = Math.max(0, a.x - R);
    const x1 = Math.min(w - 1, a.x + R);
    const y0 = Math.max(0, a.y - R);
    const y1 = Math.min(this.world.height - 1, a.y + R);
    const cells = this.cellAgent;
    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const n = cells[row + x];
        if (n !== undefined && n !== a) out.push(n);
      }
    }
    return out;
  }

  findAgent(id: number): Agent | undefined {
    return this.agents.get(id) ?? this.graveyard.find((g) => g.id === id);
  }

  agentAt(x: number, y: number): Agent | undefined {
    if (!this.world.inBounds(x, y)) return undefined;
    return this.cellAgent[this.world.idx(x, y)];
  }

  remember(a: Agent, text: string) {
    a.memory.push(`t${this.tick}: ${text}`);
    if (a.memory.length > 12) a.memory.shift();
  }

  /** An experience reshapes temperament, more so for the young. */
  feel(a: Agent, e: Experience) {
    const k = PLASTICITY[a.stage] * this.params.plasticity;
    for (const [trait, d] of Object.entries(EXPERIENCES[e]) as [keyof Traits, number][])
      a.experience[trait] = Math.max(-0.5, Math.min(0.5, a.experience[trait] + d * k));
  }

  count(what: string) {
    this.tally[what] = (this.tally[what] ?? 0) + 1;
  }

  logEvent(kind: LogEntry["kind"], text: string, agentId?: number) {
    if (kind === "society" || kind === "invention" || kind === "world" || kind === "insight" || kind === "system") {
      this.archive.push({ tick: this.tick, kind, text, agentId });
      if (this.archive.length > 8000) this.archive.splice(0, 2000);
    }
    this.log.push({ tick: this.tick, kind, text, agentId });
    if (this.log.length > 600) this.log.splice(0, 200);
  }

  // --- Player interventions

  narrate(text: string) {
    this.worldEvents.push({ tick: this.tick, text });
    if (this.worldEvents.length > 6) this.worldEvents.shift();
    this.logEvent("world", text);
  }

  addHazard(kind: HazardKind, rect: Rect, message?: string) {
    const msg = message || HAZARD_TEXT[kind];
    this.world.addHazard(kind, rect, msg);
    if (kind === "flood") for (const a of [...this.agents.values()]) if (!this.world.passable(a.x, a.y)) this.kill(a, "drowned");
    this.narrate(msg);
  }

  paintTerrain(rect: Rect, t: Terrain) {
    this.world.paint(rect, t);
    if (!TERRAIN[t].passable) for (const a of [...this.agents.values()]) if (!this.world.passable(a.x, a.y)) this.kill(a, "drowned");
    this.world.recomputeFertility();
  }

  smite(x: number, y: number) {
    const a = this.agentAt(x, y);
    if (a) this.kill(a, "struck down by the heavens");
  }

  // --- Mind interface

  /**
   * Whether this agent consults Claude at all. A stable hash of the id is compared to mindShare, so
   * moving the slider changes who has a mind immediately and the same agents keep theirs.
   */
  hasMind(a: Agent): boolean {
    return ((Math.imul(a.id, 2654435761) >>> 0) / 4294967296) < this.params.mindShare;
  }

  /** Whether an agent thinks with Claude right now: it has a mind and its stage of life thinks. */
  thinks(a: Agent): boolean {
    return this.hasMind(a) && this.params.stageMinds[a.stage].effort !== "off";
  }

  mindCount(): number {
    let n = 0;
    for (const a of this.agents.values()) if (this.thinks(a)) n++;
    return n;
  }

  modelFor(a: Agent): string {
    return this.tribeModels.get(a.tribe) ?? this.params.model;
  }

  effortFor(a: Agent): Effort {
    const e = this.params.stageMinds[a.stage].effort;
    return e === "off" ? "low" : e;
  }

  thinkIntervalFor(a: Agent): number {
    return Math.max(2, Math.round(this.params.thinkInterval * this.params.stageMinds[a.stage].every));
  }

  /** The most overdue agents that should consult their mind now. */
  dueThinkers(): Agent[] {
    const due: Agent[] = [];
    for (const a of this.agents.values()) if (!a.thinking && a.nextThinkTick <= this.tick && this.thinks(a)) due.push(a);
    return due.sort((x, y) => x.nextThinkTick - y.nextThinkTick);
  }

  perceive(a: Agent): Perception {
    const p = this.params;
    const foodByDirection = { north: 0, south: 0, east: 0, west: 0 };
    const dangerByDirection = { north: "", south: "", east: "", west: "" };
    const R = 6;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const x = a.x + dx;
        const y = a.y + dy;
        if (!this.world.inBounds(x, y) || (!dx && !dy)) continue;
        const dir = dirOf(dx, dy);
        if (dir === "none") continue;
        foodByDirection[dir] += this.world.food[this.world.idx(x, y)];
        for (const h of this.world.hazardsAt(x, y))
          if (h.kind !== "bounty" && !dangerByDirection[dir].includes(h.kind)) dangerByDirection[dir] += (dangerByDirection[dir] ? "," : "") + h.kind;
        if (this.world.terrainAt(x, y) === "water" && !dangerByDirection[dir].includes("water") && Math.abs(dx) + Math.abs(dy) <= 2)
          dangerByDirection[dir] += (dangerByDirection[dir] ? "," : "") + "water";
      }
    for (const k of Object.keys(foodByDirection) as (keyof typeof foodByDirection)[]) foodByDirection[k] = Math.round(foodByDirection[k]);

    const relation = (n: Agent) =>
      a.partner === n.id ? "your partner" : a.childIds.includes(n.id) ? "your child" : a.parents?.includes(n.id) ? "your parent" : n.tribe === a.tribe ? "tribemate" : "stranger";
    const neighbours = this.neighbours(a, 7)
      .sort((x, y) => this.dist(a, x) - this.dist(a, y))
      .slice(0, 6)
      .map((n) => ({
        name: n.name,
        tribe: n.tribe,
        stage: n.stage,
        relation: relation(n),
        distance: this.dist(a, n),
        direction: dirOf(n.x - a.x, n.y - a.y),
        energy: Math.round(n.energy),
        temperament: describeTraits(n.traits),
        reputation: a.grudges.includes(n.id) ? "cheated you before" : n.tribe === a.tribe ? repWord(n.reputation) : "unknown",
        goods: this.surplus(n).length ? `has spare ${this.surplus(n).join(", ")}` : "",
        canMate: this.canMate(n),
        tongue: this.tongueWord(a, n),
      }));
    const heard = this.neighbours(a, 8)
      .filter((n) => n.speech && this.tick - n.speechTick < p.thinkInterval)
      .map((n) => (this.intelligibility(a, n) < 0.3 ? `${n.name} (${n.tribe}) said something in a foreign tongue you could not follow` : `${n.name} (${n.stage}, ${n.tribe}): "${n.speech}"`))
      .slice(0, 4);

    // Older minds hold more in mind.
    const depth = { child: 2, adolescent: 4, adult: 6, elder: 9 }[a.stage];
    const knows: string[] = [];
    for (const d of DOMAINS) {
      const l = levelOf(a.understanding[d]);
      for (let i = Math.max(1, l - 1); i <= l; i++) knows.push(truthAt(d, i));
    }
    for (const b of a.beliefs) knows.push(b.text);
    const canon = this.canons.get(a.tribe);
    const sayings = canon ? [...canon.beliefs].sort((x, y) => y.taught - x.taught).slice(0, 4).map((b) => b.text) : [];

    const left = Math.max(0, a.lifespan - a.age) * this.rng.range(0.8, 1.2);
    const partner = a.partner !== null ? this.findAgent(a.partner) : undefined;
    const kids = a.childIds.map((id) => this.findAgent(id)).filter((c): c is Agent => !!c);
    const family = [
      partner ? `partner ${partner.name}${partner.alive ? "" : " (dead)"}` : "",
      kids.length ? `children: ${kids.map((c) => `${c.name} (${c.alive ? c.stage : "dead"})`).join(", ")}` : "",
      a.parents ? `parents: ${a.parents.map((id) => this.findAgent(id)?.name ?? "?").join(" & ")}` : "",
    ].filter(Boolean).join("; ");

    return {
      id: a.id,
      name: a.name,
      tribe: a.tribe,
      stage: a.stage,
      creed: a.genome.creed,
      temperament: roundTraits(a.traits),
      age: a.age,
      lifeLeft: left < 10 ? "death is very near" : `perhaps ${Math.round(left / 10) * 10} more days`,
      health: [
        a.frailty > 0.65 ? "frail" : a.frailty > 0.35 ? "ageing" : "hale",
        a.wear > a.baseLifespan * 0.15 ? "carrying old wounds and sickness" : "",
        a.sick ? "sick" : "",
      ].filter(Boolean).join(", "),
      energy: Math.round(a.energy),
      maxEnergy: p.maxEnergy,
      generation: a.generation,
      family: family || "none",
      inventory: { ...a.inventory },
      craft: a.craft ? `${a.craft} (skill ${a.skills[a.craft].toFixed(1)})` : "none yet",
      reputation: repWord(a.reputation),
      terrainHere: this.world.terrainAt(a.x, a.y),
      foodHere: Math.round(this.world.food[this.world.idx(a.x, a.y)] * 10) / 10,
      foodByDirection,
      dangerByDirection,
      neighbours,
      heard,
      memory: a.memory.slice(-depth),
      knows: knows.slice(-depth * 2),
      sayings,
      inventions: [...a.techs].map((id) => `${TECHS[id].name}: ${TECHS[id].effect}`),
      research: (() => {
        const options = this.frontierFor(a).map((t) => TECHS[t].name);
        const cur = a.research.target ? `${TECHS[a.research.target].name} (${Math.round((a.research.progress / this.techCost(a.research.target)) * 100)}% understood)` : "nothing";
        return `${this.canResearch(a) ? "You have the ease to study." : "You lack the ease to study (hunger, sickness, danger or strife)."} Working on: ${cur}. Within reach: ${options.join(", ") || "nothing new yet"}.`;
      })(),
      literate: this.knows(a, "writing"),
      faith: (() => {
        const r = this.religionOf(a);
        const nearby = [...new Set(this.neighbours(a, 10).map((n) => n.religion).filter((id): id is number => id !== null && id !== a.religion))]
          .map((id) => this.religions.get(id)?.name)
          .filter(Boolean);
        if (!r) return `You hold no faith.${nearby.length ? ` Nearby, some believe in ${nearby.join(", ")}.` : ""}`;
        const { verdict } = judge(r.code, a.ledger);
        const fear = verdict === "heaven" ? `you trust you are bound for ${r.heaven}` : verdict === "hell" ? `you fear you are bound for ${r.hell}` : "you do not know what awaits you";
        return `You believe in ${r.name} (faith ${a.faith.toFixed(1)}): ${r.doctrine} By its measure, ${fear}.${nearby.length ? ` Others nearby believe in ${nearby.join(", ")}.` : ""}`;
      })(),
      fields: a.fields.length
        ? `${a.fields.length} field${a.fields.length === 1 ? "" : "s"}, ${a.fields.filter((i) => this.world.crop[i] >= 1).length} ripe`
        : this.knows(a, "agriculture") ? "none yet (it knows how to plant)" : "none",
      social: this.socialView(a),
      allowedIntents: [...STAGE_INTENTS[a.stage]],
    };
  }

  private socialView(a: Agent): Perception["social"] {
    const g = this.group(a);
    const leader = g ? this.leaderOf(g) : undefined;
    const followed = a.follows !== null ? this.agents.get(a.follows) : undefined;
    const bonds = [...a.bonds.entries()]
      .map(([id, v]) => ({ x: this.agents.get(id), v }))
      .filter((b): b is { x: Agent; v: number } => !!b.x && Math.abs(b.v) > 0.15)
      .sort((x, y) => Math.abs(y.v) - Math.abs(x.v))
      .slice(0, 5)
      .map(({ x, v }) => `${x.name}: ${v > 0.6 ? "devoted to" : v > 0.3 ? "fond of" : v > 0 ? "warm toward" : v > -0.3 ? "wary of" : v > -0.6 ? "dislikes" : "hates"}`);
    const nearbyGroups = [...new Set(this.neighbours(a, 10).map((n) => n.groupId).filter((id): id is number => id !== null && id !== a.groupId))]
      .map((id) => this.groups.get(id))
      .filter((x): x is Group => !!x)
      .slice(0, 3)
      .map((x) => `${x.name} (${x.members.size} members, led by ${this.leaderOf(x)?.name ?? "no one"})${x.purpose ? `: ${x.purpose}` : ""}`);
    return {
      follows: followed ? `${followed.name} (${followed.followers} followers)` : "nobody",
      followers: a.followers,
      influence: a.influence,
      group: g
        ? {
            name: g.name,
            purpose: g.purpose,
            leader: leader?.name ?? "no one",
            youLead: g.leaderId === a.id,
            heir: g.heirId !== null ? this.agents.get(g.heirId)?.name ?? "none named" : "none named",
            members: g.members.size,
            norms: g.norms.map((n) => n.text),
            store: g.store.rations ? `${g.store.rations} rations in the common store` : "the common store is empty",
            leaderCall: leader && leader.id !== a.id && CALLS.includes(leader.intent) ? `${leader.name} is ${leader.intent.replace("_", " ")}${leader.intent === "migrate" ? ` ${leader.intentDir}` : ""}` : "",
            realm: (() => {
              const over = g.overlordId !== null ? this.groups.get(g.overlordId) : undefined;
              const under = [...this.groups.values()].filter((x) => x.overlordId === g.id);
              return [
                over ? `${g.relation === "vassal" ? "pays tribute to" : "allied under"} ${over.name}` : "",
                under.length ? `${under.filter((x) => x.relation === "vassal").length} vassals and ${under.filter((x) => x.relation === "ally").length} allies answer to it` : "",
              ].filter(Boolean).join("; ") || "independent";
            })(),
            aim: g.war
              ? `at war with ${g.war.name} since day ${g.war.since}`
              : g.aim === "research" && g.project
                ? `researching ${TECHS[g.project.tech].name} together (${Math.round((g.project.progress / this.techCost(g.project.tech)) * 100)}% done)`
                : g.aim ?? "nothing in particular",
            crisis: g.crisis
              ? (() => {
                  const cs = g.crisis.claimants.map((id) => this.agents.get(id)).filter((c): c is Agent => !!c);
                  const side = this.sideOf(a, cs);
                  return `Leadership is contested since day ${g.crisis.since} (${g.crisis.reason}). Claimants: ${cs.map((c) => c.name).join(", ")}. ${a.id === side?.id ? "You are a claimant." : side ? `You back ${side.name}.` : "You back no one yet."}`;
                })()
              : "",
          }
        : null,
      bonds,
      nearbyGroups,
    };
  }

  worldSummary(): string {
    const pop = this.agents.size;
    const tribes = this.tribeCounts();
    const top = Object.entries(tribes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t, n]) => `${t} ${n}`)
      .join(", ");
    return `Day ${this.tick}, ${this.world.seasonName(this.tick)}. ${pop} people alive. Tribes: ${top}.` +
      (this.scenario && !this.scenario.locked ? ` Setting: ${this.scenario.title} — ${this.scenario.description}` : "");
  }

  applyDecision(d: Decision) {
    const a = this.agents.get(d.id);
    if (!a) return;
    a.thinking = false;
    const interval = this.thinkIntervalFor(a);
    a.nextThinkTick = this.tick + interval;
    a.thought = d.thought;
    a.thoughtTick = this.tick;
    // A mind can only choose what its stage of life allows.
    const allowed = STAGE_INTENTS[a.stage];
    a.intent = allowed.includes(d.intent) ? d.intent : allowed[0];
    a.intentDir = d.direction;
    a.intentUntil = this.tick + interval;
    a.intentTarget = null;
    a.tradeStance = d.tradeStance ?? null;
    if (d.target) {
      const tgt = this.neighbours(a, 10).find((n) => n.name.toLowerCase() === d.target.toLowerCase());
      if (tgt) a.intentTarget = tgt.id;
    }
    if (d.speech) {
      a.speech = d.speech;
      a.speechTick = this.tick;
      this.logEvent("speech", `${a.name} (${a.stage}): "${d.speech}"`, a.id);
      for (const n of this.neighbours(a, 6)) {
        const i = this.intelligibility(n, a);
        if (this.rng.chance(0.3 * i)) this.feel(n, "heardSpeech");
        this.bond(n, a, 0.02 * i);
        this.converge(n, a, 0.002);
      }
    }
    if (d.insight && a.stage !== "child") this.pendingInsights.push({ agentId: a.id, text: d.insight.slice(0, 200), tick: this.tick });
    if (a.stage !== "child") this.applySocial(a, d.follow ?? "", d.groupAction ?? "none", d.groupName ?? "", d.groupPurpose ?? "", d.decree ?? "", interval);
    const g = this.group(a);
    if (g && g.leaderId === a.id && d.groupAim && d.groupAim !== "none") this.setAim(g, a, d.groupAim, d.aimTarget ?? "");
    if (d.religionAction === "found" && a.stage !== "child") this.establishReligion(a, d.religionName || undefined, d.doctrine || undefined);
    else if (d.religionAction === "convert" && d.religionName) {
      const r = [...this.religions.values()].find((x) => x.name.toLowerCase() === d.religionName.toLowerCase());
      if (r && this.neighbours(a, 12).some((n) => n.religion === r.id)) this.convert(a, r.id, 0.6);
    } else if (d.religionAction === "renounce" && a.religion !== null) {
      this.remember(a, `renounced ${this.religionOf(a)?.name}`);
      a.religion = null;
      a.faith = 0;
    }
    if (d.heir && g && g.leaderId === a.id) {
      const heir = [...g.members].map((id) => this.agents.get(id)).find((m) => m?.name.toLowerCase() === d.heir.toLowerCase());
      if (heir && heir.id !== a.id && heir.stage !== "child") this.nameHeir(g, a, heir);
    }
  }

  /** A mind's free choices about its place among others. */
  private applySocial(a: Agent, follow: string, action: GroupAction, name: string, purpose: string, decree: string, interval: number) {
    if (follow) {
      if (follow.toLowerCase() === "nobody") {
        if (a.follows !== null) this.remember(a, "chose to follow no one");
        a.follows = null;
        a.followLockedUntil = this.tick + interval;
      } else {
        const who =
          this.neighbours(a, 12).find((n) => n.name.toLowerCase() === follow.toLowerCase()) ??
          [...a.bonds.keys()].map((id) => this.agents.get(id)).find((n) => n?.name.toLowerCase() === follow.toLowerCase());
        if (who && who.stage !== "child" && !this.wouldLoop(a, who)) {
          if (a.follows !== who.id) this.remember(a, `chose to follow ${who.name}`);
          a.follows = who.id;
          a.followLockedUntil = this.tick + interval;
        }
      }
    }
    if (action === "found" && name.trim()) {
      const g = this.group(a);
      if (!(g && g.leaderId === a.id && g.name.toLowerCase() === name.trim().toLowerCase())) this.foundGroup(a, name.trim(), purpose.trim());
    } else if (action === "join" && name.trim()) {
      const g = [...this.groups.values()].find(
        (x) => x.name.toLowerCase() === name.trim().toLowerCase() && [...x.members].some((id) => { const m = this.agents.get(id); return m && this.dist(a, m) <= 15; }),
      );
      if (g) {
        this.joinGroup(a, g);
        a.followLockedUntil = this.tick + interval;
      }
    } else if (action === "leave") {
      this.leaveGroup(a, "by choice");
      a.followLockedUntil = this.tick + interval;
    }
    const g = this.group(a);
    if (decree.trim() && g && g.leaderId === a.id) this.addNorm(g, a, decree.trim());
  }

  releaseThinker(id: number) {
    const a = this.agents.get(id);
    if (a) {
      a.thinking = false;
      a.nextThinkTick = this.tick + this.thinkIntervalFor(a);
    }
  }

  // --- Stats

  tribeCounts(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const a of this.agents.values()) c[a.tribe] = (c[a.tribe] ?? 0) + 1;
    return c;
  }

  /** Average lifetime knowledge per generation: the dead, plus the living so far. */
  knowledgeGenerations(): { generation: number; avg: number; n: number }[] {
    const m = new Map<number, { sum: number; n: number }>();
    for (const [g, v] of this.knowledgeByGeneration) m.set(g, { ...v });
    for (const a of this.agents.values()) {
      if (a.stage === "child") continue;
      const v = m.get(a.generation) ?? { sum: 0, n: 0 };
      v.sum += totalLevels(a.understanding);
      v.n++;
      m.set(a.generation, v);
    }
    return [...m.entries()].sort((x, y) => x[0] - y[0]).map(([generation, v]) => ({ generation, avg: v.sum / v.n, n: v.n }));
  }

  private recordStats() {
    const traits = zeroTraits();
    const expressed = zeroTraits();
    const stages = { child: 0, adolescent: 0, adult: 0, elder: 0 };
    let energy = 0;
    let maxGen = 0;
    let knowledge = 0;
    let rep = 0;
    for (const a of this.agents.values()) {
      for (const k of TRAIT_KEYS) {
        traits[k] += a.genome.traits[k];
        expressed[k] += a.traits[k];
      }
      energy += a.energy;
      maxGen = Math.max(maxGen, a.generation);
      stages[a.stage]++;
      knowledge += totalLevels(a.understanding);
      rep += a.reputation;
    }
    const n = this.agents.size || 1;
    for (const k of TRAIT_KEYS) {
      traits[k] /= n;
      expressed[k] /= n;
    }
    let canon = 0;
    for (const c of this.canons.values()) canon = Math.max(canon, totalLevels(c.understanding));
    let grown = 0;
    let inGroups = 0;
    let following = 0;
    let topInfluence = 0;
    const ideas = new Set<string>();
    for (const a of this.agents.values()) {
      for (const b of a.beliefs) ideas.add(b.text);
      if (a.stage === "child") continue;
      grown++;
      if (a.groupId !== null) inGroups++;
      if (a.follows !== null) following++;
      topInfluence = Math.max(topInfluence, a.influence);
    }
    let expectancy = 0;
    let wear = 0;
    let farmers = 0;
    let stored = 0;
    for (const a of this.agents.values()) {
      stored += a.inventory.rations;
      if (a.stage === "child") continue;
      expectancy += a.lifespan;
      wear += a.wear;
      if (a.fields.length) farmers++;
    }
    for (const g of this.groups.values()) stored += g.store.rations;
    let techs = 0;
    for (const c of this.canons.values()) techs = Math.max(techs, c.techs.size);
    let largestGroup = 0;
    for (const g of this.groups.values()) {
      largestGroup = Math.max(largestGroup, g.members.size);
      for (const n of g.norms) ideas.add(n.text);
    }
    this.stats.push({
      tick: this.tick,
      population: this.agents.size,
      births: this.births,
      deaths: this.deaths,
      avgEnergy: energy / n,
      maxGeneration: maxGen,
      traits,
      expressed,
      tribes: this.tribeCounts(),
      stages,
      knowledge: knowledge / n,
      canon,
      trades: this.trades,
      betrayals: this.betrayals,
      avgReputation: rep / n,
      groups: this.groups.size,
      inGroups: grown ? inGroups / grown : 0,
      largestGroup,
      following: grown ? following / grown : 0,
      topInfluence,
      ideas: ideas.size,
      lifeExpectancy: grown ? expectancy / grown : 0,
      deathAgeSum: this.deathAgeSum,
      kills: this.kills,
      avgWear: grown ? wear / grown : 0,
      farmers: grown ? farmers / grown : 0,
      fields: this.world.fieldCount,
      storedFood: stored,
      techs,
      emigrants: this.emigrants,
      crises: [...this.groups.values()].filter((g) => g.crisis).length,
      researchers: grown ? [...this.agents.values()].filter((a) => a.intent === "research").length / grown : 0,
      literacy: grown ? [...this.agents.values()].filter((a) => a.stage !== "child" && a.techs.has("writing")).length / grown : 0,
      languages: this.tick % 10 === 0 || !this.stats.length ? this.languageCount() : this.stats.at(-1)!.languages,
      wars: [...this.groups.values()].filter((g) => g.war).length,
      tribeCount: Object.keys(this.tribeCounts()).length,
      traitDiversity: (() => {
        const all = [...this.agents.values()];
        if (all.length < 2) return 0;
        let sd = 0;
        for (const k of TRAIT_KEYS) {
          const m = all.reduce((x, a) => x + a.genome.traits[k], 0) / all.length;
          sd += Math.sqrt(all.reduce((x, a) => x + (a.genome.traits[k] - m) ** 2, 0) / all.length);
        }
        return sd / TRAIT_KEYS.length;
      })(),
      norms: new Set([...this.groups.values()].flatMap((g) => g.norms.map((n) => n.text))).size,
      religions: new Set([...this.agents.values()].map((a) => a.religion).filter((x) => x !== null)).size,
      faithful: grown ? [...this.agents.values()].filter((a) => a.stage !== "child" && a.religion !== null).length / grown : 0,
      largestRealm: (() => {
        let best = 0;
        for (const g of this.groups.values()) if (g.overlordId === null) best = Math.max(best, this.realmMembers(g).reduce((x, y) => x + y.members.size, 0));
        return best;
      })(),
    });
    if (this.stats.length > 4000) this.stats = this.stats.filter((_, i) => i % 2 === 0);
  }
}

const HAZARD_TEXT: Record<HazardKind, string> = {
  fire: "Wildfire sweeps across the land.",
  plague: "A sickness spreads among the people.",
  drought: "The rains have stopped. A drought begins.",
  flood: "The waters rise and swallow the lowlands.",
  bounty: "The land suddenly overflows with food.",
};

export function repWord(r: number): string {
  return r > 0.75 ? "highly trusted" : r > 0.58 ? "trusted" : r > 0.42 ? "ordinary standing" : r > 0.25 ? "doubted" : "distrusted, known as a cheat";
}

function dirOf(dx: number, dy: number): Direction {
  if (!dx && !dy) return "none";
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "east" : "west") : dy > 0 ? "south" : "north";
}

function roundTraits(t: Traits): Traits {
  return Object.fromEntries(TRAIT_KEYS.map((k) => [k, Math.round(t[k] * 100) / 100])) as Traits;
}

function jitterTraits(t: Traits, rng: Rng): Traits {
  return Object.fromEntries(TRAIT_KEYS.map((k) => [k, clamp01((t[k] ?? 0.5) + rng.gaussian() * 0.06)])) as Traits;
}

export function hexToHue(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}
