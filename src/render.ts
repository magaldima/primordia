import type { HazardKind, TraitKey } from "../shared/types";
import type { Agent, Engine } from "./sim/engine";
import { TERRAIN } from "./sim/world";

export type ColorMode = "tribe" | TraitKey | "energy" | "age";

const HAZARD_STYLE: Record<HazardKind, string> = {
  fire: "rgba(255, 110, 40, 0.55)",
  plague: "rgba(150, 220, 60, 0.35)",
  drought: "rgba(230, 190, 90, 0.28)",
  flood: "rgba(60, 120, 220, 0.25)",
  bounty: "rgba(255, 255, 160, 0.3)",
};

export interface Overlay {
  /** Cell under the pointer and the brush footprint to preview. */
  hover: { x: number; y: number; size: number } | null;
  selectedId: number | null;
  trails: boolean;
}

export class Renderer {
  cell = 12;
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  /** Fit the board into the canvas's parent element. */
  resize(engine: Engine) {
    const parent = this.canvas.parentElement!;
    const { width, height } = engine.world;
    const dpr = window.devicePixelRatio || 1;
    this.cell = Math.max(4, Math.floor(Math.min(parent.clientWidth / width, parent.clientHeight / height)));
    const w = width * this.cell;
    const h = height * this.cell;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  cellAt(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: Math.floor((clientX - r.left) / this.cell), y: Math.floor((clientY - r.top) / this.cell) };
  }

  draw(engine: Engine, mode: ColorMode, overlay: Overlay) {
    const { ctx, cell } = this;
    const w = engine.world;

    // Terrain shaded by how much food is on it.
    for (let y = 0; y < w.height; y++)
      for (let x = 0; x < w.width; x++) {
        const i = w.idx(x, y);
        const info = TERRAIN[w.terrain[i]];
        const fullness = info.maxFood ? Math.min(1, w.food[i] / info.maxFood) : 1;
        ctx.fillStyle = shade(info.color, 0.45 + 0.55 * fullness);
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }

    for (const h of w.hazards) {
      ctx.fillStyle = HAZARD_STYLE[h.kind];
      ctx.fillRect(h.rect.x * cell, h.rect.y * cell, h.rect.w * cell, h.rect.h * cell);
    }

    // Fading trails in each lineage's colour show territory and movement patterns over time.
    if (overlay.trails)
      for (let i = 0; i < engine.trail.length; i++) {
        const v = engine.trail[i];
        if (v < 0.04) continue;
        ctx.fillStyle = `hsla(${engine.trailHue[i]}, 70%, 60%, ${(v * 0.55).toFixed(3)})`;
        ctx.fillRect((i % w.width) * cell, Math.floor(i / w.width) * cell, cell, cell);
      }

    const r = Math.max(1.5, cell * 0.38);
    for (const a of engine.agents.values()) {
      const cx = a.x * cell + cell / 2;
      const cy = a.y * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = agentColor(a, mode, engine);
      ctx.fill();
      if (cell >= 8) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = a.sick ? "#b6f05a" : "rgba(0,0,0,0.55)";
        ctx.stroke();
      }
      if (a.thinking && cell >= 8) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(cx + r * 0.9, cy - r * 0.9, Math.max(1.5, cell * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Speech bubbles for recent utterances.
    ctx.font = `${Math.max(10, Math.min(13, cell))}px ui-sans-serif, system-ui, sans-serif`;
    for (const a of engine.agents.values()) {
      if (!a.speech || engine.tick - a.speechTick > 12) continue;
      const text = a.speech.length > 40 ? a.speech.slice(0, 38) + "…" : a.speech;
      const tw = ctx.measureText(text).width + 10;
      const bx = Math.min(Math.max(2, a.x * cell + cell / 2 - tw / 2), w.width * cell - tw - 2);
      const by = Math.max(2, a.y * cell - 20);
      ctx.fillStyle = "rgba(15,15,20,0.85)";
      roundRect(ctx, bx, by, tw, 17, 4);
      ctx.fill();
      ctx.fillStyle = "#f0efec";
      ctx.fillText(text, bx + 5, by + 12.5);
    }

    if (overlay.selectedId !== null) {
      const a = engine.agents.get(overlay.selectedId);
      if (a) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(a.x * cell + cell / 2, a.y * cell + cell / 2, r + 4, 0, Math.PI * 2);
        ctx.stroke();
        const t = a.intentTarget !== null ? engine.agents.get(a.intentTarget) : undefined;
        if (t) {
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(a.x * cell + cell / 2, a.y * cell + cell / 2);
          ctx.lineTo(t.x * cell + cell / 2, t.y * cell + cell / 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    if (overlay.hover) {
      const { x, y, size } = overlay.hover;
      const half = Math.floor(size / 2);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect((x - half) * cell + 0.5, (y - half) * cell + 0.5, size * cell - 1, size * cell - 1);
    }
  }
}

export function tribeColor(engine: Engine, tribe: string): string {
  return `hsl(${engine.tribeHues.get(tribe) ?? 0}, 70%, 60%)`;
}

function agentColor(a: Agent, mode: ColorMode, engine: Engine): string {
  if (mode === "tribe") return `hsl(${a.genome.hue}, 72%, 60%)`;
  let v: number;
  if (mode === "energy") v = a.energy / engine.params.maxEnergy;
  else if (mode === "age") v = a.age / a.lifespan;
  else v = a.genome.traits[mode];
  // Sequential single-hue ramp: light (low) to deep (high).
  v = Math.max(0, Math.min(1, v));
  return `hsl(28, ${45 + v * 50}%, ${88 - v * 50}%)`;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
