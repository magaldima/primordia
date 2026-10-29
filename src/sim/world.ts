import type { HazardKind, Rect, Terrain } from "../../shared/types";
import { Rng } from "./rng";

export interface TerrainInfo {
  maxFood: number;
  /** Fraction of maxFood regrown per tick. */
  regrow: number;
  /** Extra energy to step onto this cell. */
  moveCost: number;
  passable: boolean;
  /** Damage reduction for defenders standing here. */
  defense: number;
  color: string;
}

export const TERRAIN: Record<Terrain, TerrainInfo> = {
  plains: { maxFood: 6, regrow: 0.005, moveCost: 0, passable: true, defense: 0, color: "#4f6b3a" },
  forest: { maxFood: 8, regrow: 0.004, moveCost: 0.4, passable: true, defense: 0.2, color: "#2f4d2c" },
  water: { maxFood: 0, regrow: 0, moveCost: 0, passable: false, defense: 0, color: "#24435e" },
  mountain: { maxFood: 2, regrow: 0.003, moveCost: 1.2, passable: true, defense: 0.45, color: "#6b6560" },
  desert: { maxFood: 1.5, regrow: 0.002, moveCost: 0.3, passable: true, defense: 0, color: "#9c8a5a" },
};

export interface Hazard {
  id: number;
  kind: HazardKind;
  rect: Rect;
  ttl: number;
  message: string;
}

/** Seasons swing food regrowth by +/- this fraction over SEASON_PERIOD ticks. */
export const SEASON_AMPLITUDE = 0.45;
export const SEASON_PERIOD = 240;

export class World {
  readonly terrain: Terrain[];
  readonly food: Float32Array;
  /** Cells next to water regrow faster (rivers feed the land). */
  readonly fertile: Uint8Array;
  /** Original terrain under a flood, restored when the flood recedes. */
  private flooded = new Map<number, Terrain>();
  hazards: Hazard[] = [];
  private nextHazardId = 1;

  constructor(readonly width: number, readonly height: number, fill: Terrain = "plains") {
    const n = width * height;
    this.terrain = new Array(n).fill(fill);
    this.food = new Float32Array(n);
    this.fertile = new Uint8Array(n);
  }

  idx(x: number, y: number) {
    return y * this.width + x;
  }
  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  terrainAt(x: number, y: number): Terrain {
    return this.terrain[this.idx(x, y)];
  }
  passable(x: number, y: number) {
    return this.inBounds(x, y) && TERRAIN[this.terrainAt(x, y)].passable;
  }

  paint(rect: Rect, t: Terrain) {
    this.forRect(rect, (i) => {
      this.terrain[i] = t;
      this.food[i] = Math.min(this.food[i], TERRAIN[t].maxFood);
    });
  }

  forRect(rect: Rect, fn: (i: number, x: number, y: number) => void) {
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(this.width, Math.ceil(rect.x + rect.w));
    const y1 = Math.min(this.height, Math.ceil(rect.y + rect.h));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) fn(this.idx(x, y), x, y);
  }

  /** Fill every cell to half of capacity and recompute river fertility. */
  seedFood() {
    for (let i = 0; i < this.food.length; i++) this.food[i] = TERRAIN[this.terrain[i]].maxFood * 0.6;
    this.recomputeFertility();
  }

  recomputeFertility() {
    this.fertile.fill(0);
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        if (this.terrainAt(x, y) === "water") continue;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            if (this.inBounds(x + dx, y + dy) && this.terrainAt(x + dx, y + dy) === "water") this.fertile[this.idx(x, y)] = 1;
      }
  }

  season(tick: number) {
    return 1 + SEASON_AMPLITUDE * Math.sin((2 * Math.PI * tick) / SEASON_PERIOD);
  }

  seasonName(tick: number) {
    const phase = ((tick % SEASON_PERIOD) + SEASON_PERIOD) % SEASON_PERIOD / SEASON_PERIOD;
    return phase < 0.25 ? "spring" : phase < 0.5 ? "summer" : phase < 0.75 ? "autumn" : "winter";
  }

  regrow(tick: number, globalRate: number, seasons = true) {
    const s = (seasons ? this.season(tick) : 1) * globalRate;
    const drought = new Uint8Array(this.food.length);
    for (const h of this.hazards) if (h.kind === "drought") this.forRect(h.rect, (i) => (drought[i] = 1));
    for (let i = 0; i < this.food.length; i++) {
      const info = TERRAIN[this.terrain[i]];
      if (!info.maxFood || drought[i]) continue;
      const r = info.regrow * s * (this.fertile[i] ? 1.6 : 1);
      this.food[i] = Math.min(info.maxFood, this.food[i] + info.maxFood * r);
    }
  }

  addHazard(kind: HazardKind, rect: Rect, message: string, ttl?: number): Hazard {
    const h: Hazard = { id: this.nextHazardId++, kind, rect, message, ttl: ttl ?? DEFAULT_TTL[kind] };
    if (kind === "flood")
      this.forRect(rect, (i) => {
        if (!this.flooded.has(i)) this.flooded.set(i, this.terrain[i]);
        this.terrain[i] = "water";
        this.food[i] = 0;
      });
    if (kind === "bounty")
      this.forRect(rect, (i) => {
        this.food[i] = TERRAIN[this.terrain[i]].maxFood * 2.5;
      });
    this.hazards.push(h);
    if (kind === "flood") this.recomputeFertility();
    return h;
  }

  /** Advance hazard timers; fire spreads through forest and burns food. */
  updateHazards(rng: Rng) {
    const spawned: Hazard[] = [];
    for (const h of this.hazards) {
      h.ttl--;
      if (h.kind === "fire") {
        this.forRect(h.rect, (i) => (this.food[i] = 0));
        if (rng.chance(0.08)) {
          // Spread into adjacent forest.
          const dx = rng.pick([-1, 1]) * rng.int(1, 3);
          const dy = rng.pick([-1, 1]) * rng.int(1, 3);
          const cx = Math.floor(h.rect.x + h.rect.w / 2 + dx * (h.rect.w / 2 + 1));
          const cy = Math.floor(h.rect.y + h.rect.h / 2 + dy * (h.rect.h / 2 + 1));
          if (this.inBounds(cx, cy) && this.terrainAt(cx, cy) === "forest")
            spawned.push({ id: this.nextHazardId++, kind: "fire", rect: { x: cx - 1, y: cy - 1, w: 3, h: 3 }, ttl: Math.max(5, h.ttl - 5), message: "" });
        }
      }
    }
    this.hazards.push(...spawned.slice(0, 2));
    const expired = this.hazards.filter((h) => h.ttl <= 0);
    if (expired.some((h) => h.kind === "flood")) {
      for (const h of expired)
        if (h.kind === "flood")
          this.forRect(h.rect, (i) => {
            const orig = this.flooded.get(i);
            if (orig) {
              this.terrain[i] = orig;
              this.flooded.delete(i);
            }
          });
      this.recomputeFertility();
    }
    this.hazards = this.hazards.filter((h) => h.ttl > 0);
  }

  hazardsAt(x: number, y: number): Hazard[] {
    return this.hazards.filter((h) => x >= h.rect.x && y >= h.rect.y && x < h.rect.x + h.rect.w && y < h.rect.y + h.rect.h);
  }
}

const DEFAULT_TTL: Record<HazardKind, number> = { fire: 30, plague: 90, drought: 160, flood: 80, bounty: 1 };

// --- Procedural terrain

function valueNoise(width: number, height: number, scale: number, rng: Rng): Float32Array {
  const gw = Math.ceil(width / scale) + 2;
  const gh = Math.ceil(height / scale) + 2;
  const grid = Array.from({ length: gw * gh }, () => rng.next());
  const out = new Float32Array(width * height);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const gx = x / scale;
      const gy = y / scale;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = smooth(gx - x0);
      const ty = smooth(gy - y0);
      const v = (ix: number, iy: number) => grid[iy * gw + ix];
      const a = v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx;
      const b = v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx;
      out[y * width + x] = a * (1 - ty) + b * ty;
    }
  return out;
}

export function generateTerrain(world: World, seed: number) {
  const rng = new Rng(seed * 9973 + 17);
  const { width: w, height: h } = world;
  const e1 = valueNoise(w, h, 14, rng);
  const e2 = valueNoise(w, h, 6, rng);
  const m1 = valueNoise(w, h, 11, rng);
  for (let i = 0; i < w * h; i++) {
    const elev = e1[i] * 0.75 + e2[i] * 0.25;
    const moist = m1[i];
    world.terrain[i] =
      elev < 0.26 ? "water" : elev > 0.74 ? "mountain" : moist > 0.62 ? "forest" : moist < 0.28 ? "desert" : "plains";
  }
  world.seedFood();
}
