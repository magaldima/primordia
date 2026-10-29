import {
  DEFAULT_PARAMS,
  TRAIT_KEYS,
  type Decision,
  type Direction,
  type HazardKind,
  type Intent,
  type Perception,
  type Rect,
  type ScenarioSpec,
  type SimParams,
  type Terrain,
  type Traits,
} from "../../shared/types";
import { blendHue, blendTraits, childName, describeTraits, randomName, randomTraits, spliceCreeds, type Genome } from "./genome";
import { clamp01, Rng } from "./rng";
import { generateTerrain, TERRAIN, World } from "./world";

export interface Agent {
  id: number;
  name: string;
  tribe: string;
  genome: Genome;
  x: number;
  y: number;
  energy: number;
  age: number;
  lifespan: number;
  generation: number;
  parents: [number, number] | null;
  children: number;
  kills: number;
  lastBirthTick: number;
  sick: number;
  alive: boolean;
  causeOfDeath?: string;
  diedAt?: number;
  /** Current plan. In instinct mode it's re-chosen every tick; in hybrid mode the mind sets it. */
  intent: Intent;
  intentTarget: number | null;
  intentDir: Direction;
  intentUntil: number;
  heading: [number, number];
  /** Latest inner monologue from the mind, if any. */
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
  kind: "birth" | "death" | "fight" | "share" | "speech" | "world" | "mind" | "system";
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
  traits: Traits;
  tribes: Record<string, number>;
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
  /** Recent presence per cell (1 = here now, fading each tick) and the hue of whoever was last there. */
  trail: Float32Array;
  trailHue: Float32Array;
  tick = 0;
  log: LogEntry[] = [];
  stats: StatSample[] = [];
  worldEvents: { tick: number; text: string }[] = [];
  tribeHues = new Map<string, number>();
  scenario: ScenarioSpec | null = null;
  pendingBreeds: BreedJob[] = [];
  private nextId = 1;
  private birthsThisTick = 0;
  private deathsThisTick = 0;
  private scheduled: ScenarioSpec["events"] = [];
  private arrivals: ScenarioSpec["factions"] = [];

  constructor(params: Partial<SimParams> = {}, scenario: ScenarioSpec | null = null) {
    this.params = { ...DEFAULT_PARAMS, ...(scenario?.params ?? {}), ...params };
    const p = this.params;
    this.rng = new Rng(p.seed);
    this.world = new World(p.width, p.height, scenario?.baseTerrain ?? "plains");
    this.occupancy = new Int32Array(p.width * p.height);
    this.trail = new Float32Array(p.width * p.height);
    this.trailHue = new Float32Array(p.width * p.height);
    this.scenario = scenario;
    if (scenario) {
      for (const r of scenario.regions) this.world.paint(r.rect, r.terrain);
      this.world.seedFood();
      this.scheduled = [...scenario.events].sort((a, b) => a.tick - b.tick);
      for (const f of scenario.factions) {
        this.tribeHues.set(f.name, hexToHue(f.color));
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
    this.recordStats();
  }

  // --- Spawning

  spawnFaction(f: ScenarioSpec["factions"][number]) {
    // A lone founder gets exactly the traits it was given; crowds get a little individual variation.
    const exact = f.count === 1;
    for (let i = 0; i < f.count; i++)
      this.spawn({
        tribe: f.name,
        creed: f.creed,
        area: f.spawn,
        ...(exact
          ? { traits: { ...f.traits }, age: this.params.maturityAge, energy: this.params.maxEnergy * 0.7 }
          : { traits: jitterTraits(f.traits, this.rng) }),
      });
  }

  spawn(opts: { tribe: string; creed?: string; traits?: Traits; area?: Rect; x?: number; y?: number; age?: number; energy?: number }): Agent | null {
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
      age: opts.age ?? this.rng.int(0, p.maturityAge * 2),
      generation: 0,
      parents: null,
    });
    return a;
  }

  private makeAgent(init: Pick<Agent, "name" | "tribe" | "genome" | "x" | "y" | "energy" | "age" | "generation" | "parents">): Agent {
    const p = this.params;
    const a: Agent = {
      ...init,
      id: this.nextId++,
      lifespan: Math.round(this.rng.range(p.lifespanMin, p.lifespanMax)),
      children: 0,
      kills: 0,
      lastBirthTick: -9999,
      sick: 0,
      alive: true,
      intent: "forage",
      intentTarget: null,
      intentDir: "none",
      intentUntil: 0,
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
    this.agents.set(a.id, a);
    this.occupancy[this.world.idx(a.x, a.y)] = a.id;
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
    this.birthsThisTick = 0;
    this.deathsThisTick = 0;

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

    const order = this.rng.shuffle([...this.agents.values()]);
    for (const a of order) {
      if (!a.alive) continue;
      this.live(a);
    }
    for (let i = 0; i < this.trail.length; i++) this.trail[i] *= TRAIL_FADE;
    for (const a of this.agents.values()) {
      const i = this.world.idx(a.x, a.y);
      this.trail[i] = 1;
      this.trailHue[i] = a.genome.hue;
    }
    this.recordStats();
  }

  private live(a: Agent) {
    const p = this.params;
    a.age++;
    let burn = p.metabolism * (0.85 + a.genome.traits.aggression * 0.3);
    if (this.world.terrainAt(a.x, a.y) === "desert") burn += 0.4;

    for (const h of this.world.hazardsAt(a.x, a.y)) {
      if (h.kind === "fire") burn += 12;
      if (h.kind === "plague" && !a.sick && this.rng.chance(0.15)) this.infect(a);
    }
    if (a.sick > 0) {
      burn += 1.6;
      a.sick--;
      // Contagion.
      for (const n of this.neighbours(a, 1.5)) if (!n.sick && this.rng.chance(0.06 * (1 - n.genome.traits.caution * 0.5))) this.infect(n);
    }

    if (a.intent !== "rest") a.energy -= burn;
    else a.energy -= burn * 0.5;

    if (a.energy <= 0) return this.kill(a, a.sick ? "plague" : this.world.hazardsAt(a.x, a.y).some((h) => h.kind === "fire") ? "fire" : "starvation");
    if (a.age >= a.lifespan) return this.kill(a, "old age");

    if (this.tick >= a.intentUntil || a.intentTarget !== null && !this.agents.get(a.intentTarget)?.alive) this.chooseInstinct(a);
    this.act(a);
  }

  private infect(a: Agent) {
    a.sick = 40;
    this.remember(a, "fell sick with plague");
  }

  // --- Instinct: a trait-weighted utility choice, cheap enough to run every tick for every agent.

  private chooseInstinct(a: Agent) {
    const t = a.genome.traits;
    const p = this.params;
    const hunger = 1 - a.energy / p.maxEnergy;
    const near = this.neighbours(a, 5);
    const strangers = near.filter((n) => n.tribe !== a.tribe);
    const kin = near.filter((n) => n.tribe === a.tribe);
    const danger = this.world.hazardsAt(a.x, a.y).some((h) => h.kind !== "bounty") ||
      strangers.some((s) => s.genome.traits.aggression > 0.65 && s.energy > a.energy);

    const u: Partial<Record<Intent, number>> = {
      forage: hunger * 1.6 + t.greed * 0.2,
      explore: t.curiosity * 0.45,
      rest: 0.08 + (1 - t.curiosity) * 0.1,
      rally: kin.length ? t.cooperation * 0.25 : 0,
      hoard: hunger < 0.3 ? t.greed * 0.35 : 0,
    };
    if (this.canMate(a)) u.seek_mate = t.fertility * (a.energy / p.maxEnergy) * 1.2 + 0.1;
    if (strangers.length) u.attack = t.aggression * (1 - t.cooperation) * 0.9 + hunger * t.aggression * 0.6;
    if (kin.some((k) => k.energy < p.maxEnergy * 0.3) && a.energy > p.maxEnergy * 0.55) u.share = t.cooperation * (1 - t.greed) * 0.9;
    if (danger) u.flee = 0.3 + t.caution * 0.9;

    let best: Intent = "forage";
    let bestScore = -Infinity;
    for (const [k, v] of Object.entries(u) as [Intent, number][]) {
      const s = v + this.rng.next() * 0.15;
      if (s > bestScore) {
        bestScore = s;
        best = k;
      }
    }
    a.intent = best;
    a.intentTarget = null;
    a.intentDir = "none";
    a.intentUntil = this.tick + 1;
  }

  // --- Acting on an intent (shared by instinct and mind)

  private act(a: Agent, intent: Intent = a.intent): void {
    const p = this.params;
    const hungry = a.energy < p.maxEnergy * 0.75;
    switch (intent) {
      case "forage": {
        if (this.world.food[this.world.idx(a.x, a.y)] >= 1) return this.eat(a, 3);
        const goal = this.bestFoodNear(a, 4);
        return goal ? this.moveToward(a, goal.x, goal.y) : this.wander(a);
      }
      case "hoard":
        if (this.world.food[this.world.idx(a.x, a.y)] >= 0.5) return this.eat(a, 6);
        return this.act(a, "forage");
      case "explore":
        if (hungry && this.world.food[this.world.idx(a.x, a.y)] >= 2) return this.eat(a, 2);
        return this.wander(a);
      case "migrate": {
        if (hungry && this.world.food[this.world.idx(a.x, a.y)] >= 2) return this.eat(a, 2);
        if (a.intentDir === "none") return this.wander(a);
        const [dx, dy] = DIRS[a.intentDir];
        return this.moveToward(a, a.x + dx * 5, a.y + dy * 5);
      }
      case "rest":
        if (this.world.food[this.world.idx(a.x, a.y)] >= 1 && hungry) this.eat(a, 2);
        return;
      case "rally": {
        const kin = this.neighbours(a, 10).filter((n) => n.tribe === a.tribe);
        if (!kin.length) return this.wander(a);
        const cx = kin.reduce((s, k) => s + k.x, 0) / kin.length;
        const cy = kin.reduce((s, k) => s + k.y, 0) / kin.length;
        if (Math.hypot(cx - a.x, cy - a.y) < 2) return hungry ? this.eat(a, 2) : undefined;
        return this.moveToward(a, Math.round(cx), Math.round(cy));
      }
      case "flee": {
        const threats = this.neighbours(a, 5).filter((n) => n.tribe !== a.tribe && n.genome.traits.aggression > 0.5);
        const hz = this.world.hazards.filter((h) => h.kind !== "bounty");
        let vx = 0;
        let vy = 0;
        for (const t of threats) {
          vx += a.x - t.x;
          vy += a.y - t.y;
        }
        for (const h of hz) {
          const hx = h.rect.x + h.rect.w / 2;
          const hy = h.rect.y + h.rect.h / 2;
          const d = Math.hypot(a.x - hx, a.y - hy);
          if (d < Math.max(h.rect.w, h.rect.h) + 4) {
            vx += (a.x - hx) / (d + 0.1) * 4;
            vy += (a.y - hy) / (d + 0.1) * 4;
          }
        }
        if (!vx && !vy) return this.wander(a);
        return this.moveToward(a, a.x + Math.sign(vx) * 4, a.y + Math.sign(vy) * 4);
      }
      case "seek_mate": {
        if (!this.canMate(a)) return this.act(a, "forage");
        const mate = this.resolveTarget(a, 8, (n) => this.canMate(n));
        if (!mate) return this.wander(a);
        if (this.dist(a, mate) <= 1.5) return this.tryMate(a, mate);
        return this.moveToward(a, mate.x, mate.y);
      }
      case "attack": {
        const foe = this.resolveTarget(a, 6, (n) => n.tribe !== a.tribe || a.intentTarget === n.id);
        if (!foe) return this.act(a, "forage");
        if (this.dist(a, foe) <= 1.5) return this.attack(a, foe);
        return this.moveToward(a, foe.x, foe.y);
      }
      case "share": {
        const friend = this.resolveTarget(a, 6, (n) => n.energy < a.energy - 10, (n) => (n.tribe === a.tribe ? -100 : 0) + n.energy);
        if (!friend || a.energy < 25) return this.act(a, "forage");
        if (this.dist(a, friend) <= 1.5) return this.share(a, friend);
        return this.moveToward(a, friend.x, friend.y);
      }
    }
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
      a.age >= p.maturityAge &&
      this.tick - a.lastBirthTick >= p.reproductionCooldown &&
      a.energy > p.reproductionCost + 15 &&
      this.agents.size < p.maxAgents
    );
  }

  private tryMate(a: Agent, b: Agent) {
    const tb = b.genome.traits;
    // The partner consents if it also wants to mate, its mind chose this partner, or temperament allows.
    const willing =
      (b.intent === "seek_mate" && (b.intentTarget === null || b.intentTarget === a.id)) ||
      b.intentTarget === a.id ||
      this.rng.chance(tb.fertility * 0.5 + tb.cooperation * 0.2 + (b.tribe === a.tribe ? 0.15 : -0.1) - a.genome.traits.aggression * 0.2);
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
      energy: p.reproductionCost * 1.6,
      age: 0,
      generation: Math.max(a.generation, b.generation) + 1,
      parents: [a.id, b.id],
    });
    this.birthsThisTick++;
    this.remember(a, `had a child, ${child.name}, with ${b.name}`);
    this.remember(b, `had a child, ${child.name}, with ${a.name}`);
    this.logEvent("birth", `${child.name} (gen ${child.generation}, ${child.tribe}) born to ${a.name} & ${b.name}`, child.id);
    a.intent = b.intent = "forage";
    a.intentTarget = b.intentTarget = null;
    this.pendingBreeds.push({ childId: child.id, parentA: a, parentB: b });
  }

  private attack(a: Agent, b: Agent) {
    const p = this.params;
    const defense = TERRAIN[this.world.terrainAt(b.x, b.y)].defense;
    const strength = (0.5 + a.genome.traits.aggression) * (0.5 + a.energy / p.maxEnergy);
    const dmg = p.attackDamage * strength * (1 - defense) * this.rng.range(0.6, 1.2);
    b.energy -= dmg;
    a.energy = Math.min(p.maxEnergy, a.energy + dmg * 0.4) - 2;
    // Retaliation.
    const back = p.attackDamage * 0.35 * (0.5 + b.genome.traits.aggression) * this.rng.next();
    a.energy -= back;
    this.remember(b, `was attacked by ${a.name} of ${a.tribe}`);
    this.remember(a, `attacked ${b.name} of ${b.tribe}`);
    if (b.intent !== "flee" && b.genome.traits.aggression > 0.4) {
      b.intent = "attack";
      b.intentTarget = a.id;
      b.intentUntil = this.tick + 5;
    }
    if (b.energy <= 0) {
      a.kills++;
      this.logEvent("fight", `${a.name} (${a.tribe}) killed ${b.name} (${b.tribe})`, a.id);
      this.kill(b, `killed by ${a.name}`);
    } else if (this.rng.chance(0.25)) {
      this.logEvent("fight", `${a.name} (${a.tribe}) attacked ${b.name} (${b.tribe})`, a.id);
    }
    if (a.energy <= 0) this.kill(a, `died fighting ${b.name}`);
  }

  private share(a: Agent, b: Agent) {
    const amt = Math.min(15, a.energy - 20);
    if (amt <= 0) return;
    a.energy -= amt;
    b.energy = Math.min(this.params.maxEnergy, b.energy + amt);
    this.remember(b, `was given food by ${a.name}`);
    this.remember(a, `gave food to ${b.name}`);
    if (this.rng.chance(0.3)) this.logEvent("share", `${a.name} shared food with ${b.name}`, a.id);
    a.intentTarget = null;
  }

  private eat(a: Agent, maxUnits: number) {
    const i = this.world.idx(a.x, a.y);
    const units = Math.min(this.world.food[i], maxUnits);
    this.world.food[i] -= units;
    a.energy = Math.min(this.params.maxEnergy, a.energy + units * 5);
  }

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

  private tryMove(a: Agent, nx: number, ny: number): boolean {
    const w = this.world;
    if (!w.passable(nx, ny) || this.occupancy[w.idx(nx, ny)]) return false;
    this.occupancy[w.idx(a.x, a.y)] = 0;
    a.x = nx;
    a.y = ny;
    this.occupancy[w.idx(nx, ny)] = a.id;
    a.energy -= TERRAIN[w.terrainAt(nx, ny)].moveCost;
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
    // Bodies return some food to the land.
    const i = this.world.idx(a.x, a.y);
    this.world.food[i] = Math.min(TERRAIN[this.world.terrain[i]].maxFood * 1.5, this.world.food[i] + 3);
    this.agents.delete(a.id);
    this.graveyard.push(a);
    if (this.graveyard.length > 3000) this.graveyard.splice(0, 1000);
    this.deathsThisTick++;
    if (cause !== "starvation" || this.rng.chance(0.2))
      this.logEvent("death", `${a.name} (${a.tribe}, age ${a.age}) died: ${cause}`, a.id);
  }

  // --- Queries

  dist(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  neighbours(a: Agent, r: number): Agent[] {
    const out: Agent[] = [];
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        if (!dx && !dy) continue;
        const x = a.x + dx;
        const y = a.y + dy;
        if (!this.world.inBounds(x, y)) continue;
        const id = this.occupancy[this.world.idx(x, y)];
        if (id) {
          const n = this.agents.get(id);
          if (n) out.push(n);
        }
      }
    return out;
  }

  findAgent(id: number): Agent | undefined {
    return this.agents.get(id) ?? this.graveyard.find((g) => g.id === id);
  }

  agentAt(x: number, y: number): Agent | undefined {
    if (!this.world.inBounds(x, y)) return undefined;
    const id = this.occupancy[this.world.idx(x, y)];
    return id ? this.agents.get(id) : undefined;
  }

  remember(a: Agent, text: string) {
    a.memory.push(`t${this.tick}: ${text}`);
    if (a.memory.length > 8) a.memory.shift();
  }

  logEvent(kind: LogEntry["kind"], text: string, agentId?: number) {
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

  mindCount(): number {
    let n = 0;
    for (const a of this.agents.values()) if (this.hasMind(a)) n++;
    return n;
  }

  /** The most overdue agents that should consult their mind now. */
  dueThinkers(limit: number): Agent[] {
    const due: Agent[] = [];
    for (const a of this.agents.values()) if (!a.thinking && a.nextThinkTick <= this.tick && this.hasMind(a)) due.push(a);
    return due.sort((x, y) => x.nextThinkTick - y.nextThinkTick).slice(0, limit);
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
    const neighbours = this.neighbours(a, 7)
      .sort((x, y) => this.dist(a, x) - this.dist(a, y))
      .slice(0, 6)
      .map((n) => ({
        name: n.name,
        tribe: n.tribe,
        distance: this.dist(a, n),
        direction: dirOf(n.x - a.x, n.y - a.y),
        energy: Math.round(n.energy),
        age: n.age,
        temperament: describeTraits(n.genome.traits),
        canMate: this.canMate(n),
      }));
    const heard = this.neighbours(a, 8)
      .filter((n) => n.speech && this.tick - n.speechTick < p.thinkInterval)
      .map((n) => `${n.name} (${n.tribe}): "${n.speech}"`)
      .slice(0, 4);
    return {
      id: a.id,
      name: a.name,
      tribe: a.tribe,
      creed: a.genome.creed,
      traits: roundTraits(a.genome.traits),
      age: a.age,
      lifespan: a.lifespan,
      energy: Math.round(a.energy),
      maxEnergy: p.maxEnergy,
      generation: a.generation,
      children: a.children,
      terrainHere: this.world.terrainAt(a.x, a.y),
      foodHere: Math.round(this.world.food[this.world.idx(a.x, a.y)] * 10) / 10,
      foodByDirection,
      dangerByDirection,
      neighbours,
      heard,
      memory: a.memory.slice(-5),
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
    return `Tick ${this.tick}, ${this.world.seasonName(this.tick)}. ${pop} people alive. Tribes: ${top}.` +
      (this.scenario ? ` Setting: ${this.scenario.title} — ${this.scenario.description}` : "");
  }

  applyDecision(d: Decision) {
    const a = this.agents.get(d.id);
    if (!a) return;
    a.thinking = false;
    a.nextThinkTick = this.tick + this.params.thinkInterval;
    a.thought = d.thought;
    a.thoughtTick = this.tick;
    a.intent = d.intent;
    a.intentDir = d.direction;
    a.intentUntil = this.tick + this.params.thinkInterval;
    a.intentTarget = null;
    if (d.target) {
      const tgt = this.neighbours(a, 10).find((n) => n.name.toLowerCase() === d.target.toLowerCase());
      if (tgt) a.intentTarget = tgt.id;
    }
    if (d.speech) {
      a.speech = d.speech;
      a.speechTick = this.tick;
      this.logEvent("speech", `${a.name}: "${d.speech}"`, a.id);
    }
  }

  releaseThinker(id: number) {
    const a = this.agents.get(id);
    if (a) {
      a.thinking = false;
      a.nextThinkTick = this.tick + this.params.thinkInterval;
    }
  }

  // --- Stats

  tribeCounts(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const a of this.agents.values()) c[a.tribe] = (c[a.tribe] ?? 0) + 1;
    return c;
  }

  private recordStats() {
    const traits = Object.fromEntries(TRAIT_KEYS.map((k) => [k, 0])) as Traits;
    let energy = 0;
    let maxGen = 0;
    for (const a of this.agents.values()) {
      for (const k of TRAIT_KEYS) traits[k] += a.genome.traits[k];
      energy += a.energy;
      maxGen = Math.max(maxGen, a.generation);
    }
    const n = this.agents.size || 1;
    for (const k of TRAIT_KEYS) traits[k] /= n;
    this.stats.push({
      tick: this.tick,
      population: this.agents.size,
      births: this.birthsThisTick,
      deaths: this.deathsThisTick,
      avgEnergy: energy / n,
      maxGeneration: maxGen,
      traits,
      tribes: this.tribeCounts(),
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
