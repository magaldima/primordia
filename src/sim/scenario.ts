import { HAZARDS, TERRAINS, TRAIT_KEYS, type Rect, type ScenarioSpec, type Traits } from "../../shared/types";

/**
 * Claude-generated scenarios are mostly right but not guaranteed to fit the board. Clamp rects,
 * fill missing traits and drop anything unusable so the engine can trust the spec.
 */
export function sanitizeScenario(spec: ScenarioSpec, width: number, height: number): ScenarioSpec {
  const rect = (r: Rect | undefined): Rect => {
    const x = clampInt(r?.x ?? 0, 0, width - 1);
    const y = clampInt(r?.y ?? 0, 0, height - 1);
    return { x, y, w: clampInt(r?.w ?? 1, 1, width - x), h: clampInt(r?.h ?? 1, 1, height - y) };
  };
  const traits = (t: Partial<Traits> | undefined): Traits =>
    Object.fromEntries(TRAIT_KEYS.map((k) => [k, Math.min(1, Math.max(0, Number(t?.[k] ?? 0.5)))])) as Traits;
  return {
    title: String(spec.title || "Untitled world").slice(0, 80),
    description: String(spec.description || "").slice(0, 400),
    params: spec.params ?? {},
    baseTerrain: TERRAINS.includes(spec.baseTerrain) ? spec.baseTerrain : "plains",
    regions: (spec.regions ?? []).filter((r) => TERRAINS.includes(r.terrain)).map((r) => ({ ...r, rect: rect(r.rect) })),
    factions: (spec.factions ?? []).slice(0, 8).map((f, i) => ({
      name: String(f.name || `Tribe ${i + 1}`).slice(0, 32),
      color: /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : "#cccccc",
      count: clampInt(f.count, 1, 60),
      creed: String(f.creed || "").slice(0, 500),
      traits: traits(f.traits),
      spawn: rect(f.spawn),
      arriveAt: clampInt(f.arriveAt ?? 0, 0, 100000),
    })),
    events: (spec.events ?? [])
      .filter((e) => e.kind === "narration" || HAZARDS.includes(e.kind))
      .map((e) => ({ ...e, tick: clampInt(e.tick, 1, 100000), rect: rect(e.rect), message: String(e.message || "").slice(0, 300) })),
  };
}

function clampInt(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));
}
