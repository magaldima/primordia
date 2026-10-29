import type { Good, HazardKind, Stage, TraitKey } from "../shared/types";
import type { Agent, Engine } from "./sim/engine";
import { totalLevels } from "./sim/knowledge";
import { TERRAIN } from "./sim/world";

export type ColorMode = "tribe" | TraitKey | "energy" | "age" | "stage" | "reputation" | "knowledge" | "craft" | "group" | "religion";

/** Categorical colours (reference palette, dark steps) for life stages and crafts. */
export const STAGE_COLORS: Record<Stage, string> = { child: "#199e70", adolescent: "#c98500", adult: "#3987e5", elder: "#d55181" };
/** Three hues pass every colour-vision pairing on the board; weapon-makers are told apart by shape (a pale diamond) instead. */
export const CRAFT_COLORS: Record<Good, string> = { rations: "#d95926", tools: "#3987e5", medicine: "#199e70", weapons: "#f0efec" };
const STAGE_SIZE: Record<Stage, number> = { child: 0.24, adolescent: 0.32, adult: 0.38, elder: 0.38 };

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
  ties: boolean;
  resources: boolean;
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

    // Fields: tilled rows, green while growing and gold when ripe.
    if (w.fieldCount)
      for (let i = 0; i < w.fieldOwner.length; i++) {
        if (!w.fieldOwner[i]) continue;
        const x = (i % w.width) * cell;
        const y = Math.floor(i / w.width) * cell;
        const c = w.crop[i];
        ctx.fillStyle = `hsl(${105 - c * 60}, ${45 + c * 25}%, ${26 + c * 22}%)`;
        ctx.fillRect(x, y, cell, cell);
        if (cell >= 8) {
          ctx.fillStyle = "rgba(40,28,10,0.45)";
          for (let r = 1; r < 4; r++) ctx.fillRect(x, y + (r * cell) / 4, cell, 1);
        }
      }

    // Resources: small marks so regional advantages (ore, clay, herbs) are visible.
    if (overlay.resources)
      for (let i = 0; i < w.resource.length; i++) {
        const r = w.resource[i];
        if (!r) continue;
        ctx.fillStyle = r === 1 ? "#c9c7c2" : r === 2 ? "#c98a4a" : "#7fd08a";
        const s = Math.max(2, cell * 0.28);
        ctx.fillRect((i % w.width) * cell + (cell - s) / 2, Math.floor(i / w.width) * cell + (cell - s) / 2, s, s);
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

    // Ties: a line from each follower to whom it follows, coloured by the follower's organization.
    if (overlay.ties) {
      ctx.lineWidth = 1;
      for (const a of engine.agents.values()) {
        if (a.follows === null) continue;
        const f = engine.agents.get(a.follows);
        if (!f) continue;
        ctx.strokeStyle = a.groupId !== null ? `hsla(${groupHue(a.groupId)}, 70%, 65%, 0.55)` : "rgba(240,239,236,0.25)";
        ctx.beginPath();
        ctx.moveTo(a.x * cell + cell / 2, a.y * cell + cell / 2);
        ctx.lineTo(f.x * cell + cell / 2, f.y * cell + cell / 2);
        ctx.stroke();
      }
    }

    for (const a of engine.agents.values()) {
      const cx = a.x * cell + cell / 2;
      const cy = a.y * cell + cell / 2;
      const ra = Math.max(1.2, cell * STAGE_SIZE[a.stage]);
      ctx.beginPath();
      if (mode === "craft" && a.craft === "weapons") {
        ctx.moveTo(cx, cy - ra * 1.25);
        ctx.lineTo(cx + ra * 1.25, cy);
        ctx.lineTo(cx, cy + ra * 1.25);
        ctx.lineTo(cx - ra * 1.25, cy);
        ctx.closePath();
      } else ctx.arc(cx, cy, ra, 0, Math.PI * 2);
      ctx.fillStyle = agentColor(a, mode, engine);
      ctx.globalAlpha = a.frailty > 0.65 ? 0.55 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (cell >= 8) {
        // Elders wear a pale ring; the sick a green one.
        ctx.lineWidth = a.stage === "elder" ? 1.5 : 1;
        ctx.strokeStyle = a.sick ? "#b6f05a" : a.stage === "elder" ? "rgba(240,239,236,0.85)" : "rgba(0,0,0,0.55)";
        ctx.stroke();
      }
      // Leaders of organizations wear a gold ring.
      const g = a.groupId !== null ? engine.groups.get(a.groupId) : undefined;
      if (g?.crisis && g.crisis.claimants.includes(a.id) && (overlay.ties || mode === "group")) {
        ctx.strokeStyle = "#e66767";
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.arc(cx, cy, ra + 2.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (g && g.leaderId === a.id && (overlay.ties || mode === "group")) {
        ctx.strokeStyle = "#e0b84f";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, ra + 2.5, 0, Math.PI * 2);
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
  if (mode === "stage") return STAGE_COLORS[a.stage];
  if (mode === "craft") return a.craft ? CRAFT_COLORS[a.craft] : "#6b6a66";
  if (mode === "group") return a.groupId !== null ? `hsl(${groupHue(a.groupId)}, 65%, 58%)` : "#6b6a66";
  if (mode === "religion") return a.religion !== null ? `hsla(${groupHue(a.religion * 3 + 1)}, 65%, 60%, ${0.35 + a.faith * 0.65})` : "#6b6a66";
  let v: number;
  if (mode === "energy") v = a.energy / engine.params.maxEnergy;
  else if (mode === "age") v = a.age / a.lifespan;
  else if (mode === "reputation") v = a.reputation;
  else if (mode === "knowledge") v = totalLevels(a.understanding) / 15;
  // Trait modes show the expressed temperament (phenotype).
  else v = a.traits[mode];
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

/** A stable, well-spread hue per organization (golden-angle steps). */
export function groupHue(id: number): number {
  return (id * 137.508) % 360;
}
