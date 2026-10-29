import { TECHS } from "../shared/tech";
import { truthAt, TRUTHS } from "../shared/truths";
import {
  DEFAULT_PARAMS,
  DOMAINS,
  EFFORTS,
  MODELS,
  STAGES,
  TERRAINS,
  TRAIT_KEYS,
  type HazardKind,
  type Stage,
  type StageMind,
  type ScenarioResponse,
  type ScenarioSpec,
  type SimParams,
  type Terrain,
} from "../shared/types";
import { escapeHtml, TimeChart } from "./charts";
import { Mind, post } from "./mind";
import { CRAFT_COLORS, groupHue, Renderer, STAGE_COLORS, tribeColor, type ColorMode } from "./render";
import type { AnnalEntry } from "./sim/digest";
import { exportRun } from "./sim/export";
import { DEED_TEXT, judge, type Deed } from "./sim/religion";
import { Engine, hexToHue, repWord, type Agent, type LogEntry } from "./sim/engine";
import { levelOf, progressOf, totalLevels } from "./sim/knowledge";
import { describeTraits } from "./sim/genome";
import { PETRI_DEFAULTS, PETRI_FOUNDERS, petriDish, PRESETS, type PetriOptions, type Placement } from "./sim/presets";
import { sanitizeScenario } from "./sim/scenario";
import { TERRAIN } from "./sim/world";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// --- State

/** Mind settings survive "New world"; the laws of nature reset to defaults plus the scenario's overrides. */
const MIND_KEYS = [
  "brain", "model", "stageMinds", "mindShare", "thinkInterval", "thinkBatchSize",
  "maxConcurrentRequests", "waitForMinds", "llmBreeding", "budgetUsd", "historianEvery", "historianModel",
] as const;
const MIND_SAVE_KEY = "primordia.mind";
let carried: Partial<SimParams> = { brain: "instinct", ...loadMindSettings() };

/** Mind settings are remembered per browser so cost controls stick between sessions. */
function loadMindSettings(): Partial<SimParams> {
  try {
    const saved = JSON.parse(localStorage.getItem(MIND_SAVE_KEY) ?? "{}");
    if (saved.model && !MODELS.some((m) => m.id === saved.model)) delete saved.model;
    if (saved.historianModel && !MODELS.some((m) => m.id === saved.historianModel)) delete saved.historianModel;
    if (saved.stageMinds) saved.stageMinds = { ...structuredClone(DEFAULT_PARAMS.stageMinds), ...saved.stageMinds };
    return Object.fromEntries(MIND_KEYS.filter((k) => k in saved).map((k) => [k, saved[k]]));
  } catch {
    return {};
  }
}
function saveMindSettings() {
  try {
    localStorage.setItem(MIND_SAVE_KEY, JSON.stringify(Object.fromEntries(MIND_KEYS.map((k) => [k, engine.params[k]]))));
  } catch {
    /* storage unavailable */
  }
}

let engine = new Engine({ ...carried }, PRESETS[0]);
let running = false;
let speedIdx = 3;
const SPEEDS = [0.5, 1, 2, 4, 8, 15, 30, 60, Infinity];
let colorMode: ColorMode = "tribe";
let selectedId: number | null = null;
let hover: { x: number; y: number } | null = null;
let hasKey = false;
let showTrails = false;
let showTies = false;
let showResources = false;

type Tool = "inspect" | "terrain" | HazardKind | "smite" | "settle";
let tool: Tool = "inspect";
let brush = 5;
let paintTerrain: Terrain = "forest";
const settle = { name: "Newcomers", color: "#e87ba4", count: 8, creed: "We have come far to find a home. Build, share, and endure." };

const renderer = new Renderer($<HTMLCanvasElement>("board"));
const mind = new Mind((msg) => {
  showBanner(`Minds disabled: ${msg}`);
  syncMindControls();
});

// --- Game loop

let acc = 0;
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (running) {
    const tps = SPEEDS[speedIdx];
    const blocked = () => engine.params.waitForMinds && engine.params.brain === "hybrid" && mind.inflight > 0;
    if (tps === Infinity) {
      const until = performance.now() + 12;
      while (performance.now() < until && !blocked()) tick();
    } else {
      acc += dt * tps;
      let n = 0;
      while (acc >= 1 && n < 8 && !blocked()) {
        tick();
        acc -= 1;
        n++;
      }
      if (blocked()) acc = Math.min(acc, 1);
    }
  }
  renderer.draw(engine, colorMode, {
    hover: hover && tool !== "inspect" ? { ...hover, size: tool === "smite" ? 1 : brush } : null,
    selectedId,
    trails: showTrails,
    ties: showTies,
    resources: showResources,
  });
  updateHud(now);
  requestAnimationFrame(frame);
}

function tick() {
  engine.step();
  if (engine.tick === 1) {
    syncRuleLock();
    renderFounders();
    renderInspector(true);
  }
  mind.pump(engine);
  if (!engine.agents.size && running) {
    setRunning(false);
    engine.logEvent("system", "All life has ended.");
  }
}

function setRunning(v: boolean) {
  running = v;
  $("playBtn").textContent = v ? "❚❚ Pause" : "▶ Play";
}

// --- New game

/** How the current world was started, so Replay / New seed can rebuild it. */
let lastStart: { scenario: ScenarioSpec | null; extra: Partial<SimParams>; petri: PetriOptions | null } = { scenario: null, extra: {}, petri: null };

function startGame(scenario: ScenarioSpec | null, extra: Partial<SimParams> = {}, petri: PetriOptions | null = null) {
  lastStart = { scenario, extra, petri };
  mind.reset();
  for (const k of MIND_KEYS) (carried as Record<string, unknown>)[k] = structuredClone(engine.params[k]);
  engine = new Engine({ ...carried, ...extra }, scenario);
  selectedId = null;
  renderer.resize(engine);
  $("scenarioTitle").textContent = scenario?.title ?? "Random world";
  $("scenarioTitle").title = scenario?.description ?? "";
  buildRuleControls();
  syncMindControls();
  applyLock();
  renderInspector(true);
  renderLog(true);
  setRunning(false);
}

const isLocked = () => !!engine.scenario?.locked;

/** Observation-only worlds hide every intervention; the laws of nature freeze once time starts. */
function applyLock() {
  const locked = isLocked();
  $("godTools").hidden = locked;
  $("godVoice").hidden = locked;
  $("observeNote").hidden = !locked;
  if (locked) {
    tool = "inspect";
    renderTools();
  }
  syncRuleLock();
  renderFounders();
}

function syncRuleLock() {
  const frozen = isLocked() && engine.tick > 0;
  for (const el of $("ruleControls").querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) el.disabled = frozen;
}

/** Creeds can be edited before the first tick; in observation-only worlds they lock after that. */
const creedEditable = () => !isLocked() || engine.tick === 0;

function setCreed(a: Agent, creed: string) {
  a.genome.creed = creed;
  if (engine.tick === 0) {
    // Keep Replay / New seed (and the setup form) in step with edits made before the start.
    const f = lastStart.petri?.founders.find((x) => x.name === a.tribe);
    if (f) f.creed = creed;
    const pf = petri.founders.find((x) => x.name === a.tribe);
    if (pf) pf.creed = creed;
  } else engine.logEvent("world", `The heavens rewrote the beliefs of ${a.name}.`, a.id);
}

function renderFounders() {
  const show = isLocked() && engine.tick === 0;
  $("foundersPanel").hidden = !show;
  if (!show) return;
  $("foundersList").innerHTML = [...engine.agents.values()]
    .map(
      (a) => `<label class="field"><span class="swatch" style="background:hsl(${a.genome.hue},72%,60%)"></span> <b>${escapeHtml(a.name)}</b>
        <span class="hint">· ${describeTraits(a.genome.traits)}</span>
        <textarea rows="4" data-agent-creed="${a.id}">${escapeHtml(a.genome.creed)}</textarea></label>`,
    )
    .join("");
}
$("foundersList").oninput = (e) => {
  const el = e.target as HTMLTextAreaElement;
  const a = engine.agents.get(Number(el.dataset.agentCreed));
  if (a && creedEditable()) setCreed(a, el.value);
};

function replay(newSeed: boolean) {
  const { scenario, extra, petri } = lastStart;
  const seed = newSeed ? Math.floor(Math.random() * 99999) + 1 : undefined;
  if (petri) {
    const o = { ...petri, seed: seed ?? petri.seed };
    startGame(petriDish(o), extra, o);
  } else startGame(scenario, seed ? { ...extra, seed } : extra);
}

// --- Export

$("exportBtn").onclick = () => {
  const data = JSON.stringify(exportRun(engine));
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = (engine.scenario?.title ?? "random-world").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  a.href = url;
  a.download = `primordia-${slug}-t${engine.tick}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// --- Collapsible sidebars

const layout = $("layout");
function setPanels(left: boolean, right: boolean) {
  layout.classList.toggle("no-left", !left);
  layout.classList.toggle("no-right", !right);
  $("toggleLeft").textContent = left ? "⟨" : "⟩";
  $("toggleRight").textContent = right ? "⟩" : "⟨";
  try {
    localStorage.setItem("primordia.panels", JSON.stringify({ left, right }));
  } catch {
    /* storage unavailable */
  }
  // Re-fit the board once the grid has reflowed (and again after the transition).
  requestAnimationFrame(() => renderer.resize(engine));
  setTimeout(() => renderer.resize(engine), 200);
}
const panelsOpen = () => ({ left: !layout.classList.contains("no-left"), right: !layout.classList.contains("no-right") });
$("toggleLeft").onclick = () => setPanels(!panelsOpen().left, panelsOpen().right);
$("toggleRight").onclick = () => setPanels(panelsOpen().left, !panelsOpen().right);
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea, select")) return;
  if (e.key === "[") $("toggleLeft").click();
  if (e.key === "]") $("toggleRight").click();
});
try {
  const saved = JSON.parse(localStorage.getItem("primordia.panels") ?? "{}");
  if (saved.left === false || saved.right === false) setPanels(saved.left !== false, saved.right !== false);
} catch {
  /* storage unavailable */
}

// --- Status bar: costs and minds at a glance

function renderStatusBar() {
  const p = engine.params;
  const label = (id: string) => MODELS.find((m) => m.id === id)?.label.replace("Claude ", "") ?? id;
  const money = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
  const share = p.budgetUsd > 0 ? Math.min(1, mind.spentUsd / p.budgetUsd) : 1;
  const est = mind.estimate(engine);
  const report = mind.reportCost(p.historianModel);
  const lastAnnal = engine.annals.at(-1)?.tick ?? 0;
  const tribeOverrides = new Set(engine.tribeModels.values()).size;
  const items = [
    `<span class="item">Minds <b>${p.brain === "hybrid" ? `${label(p.model)}${tribeOverrides ? ` +${tribeOverrides} tribe model${tribeOverrides > 1 ? "s" : ""}` : ""}` : "off (instinct)"}</b></span>`,
    `<span class="item">Spent <b>${money(mind.spentUsd)}</b><span class="meter ${share >= 1 ? "over" : ""}"><i style="width:${share * 100}%"></i></span>of ${money(p.budgetUsd)}</span>`,
    p.brain === "hybrid" ? `<span class="item">≈ <b>${money(est.usdPer100)}</b> / 100 ticks${est.measured ? "" : " (est.)"}</span>` : "",
    `<span class="item"><b>${mind.requests}</b> requests · <b>${mind.inflight}</b> in flight</span>`,
    `<span class="item">Tokens <b>${(mind.tokens.input / 1000).toFixed(1)}k</b> in · <b>${(mind.tokens.output / 1000).toFixed(1)}k</b> out</span>`,
    `<span class="spacer"></span>`,
    `<span class="item">Historian <b>${label(p.historianModel)}</b> · ${mind.offline ? "offline" : `${money(report.usd)}/report${p.historianEvery ? ` · next ~t${lastAnnal + p.historianEvery}` : " · on demand"}`}${mind.historianBusy ? " · <i>writing…</i>" : ""}</span>`,
    mind.lastError ? `<span class="item err" title="${escapeHtml(mind.lastError)}">⚠ ${escapeHtml(mind.lastError.slice(0, 60))}</span>` : "",
  ];
  $("statusbar").innerHTML = items.filter(Boolean).join("");
}

// --- HUD

let lastHud = 0;
function updateHud(now: number) {
  if (now - lastHud < 250) return;
  lastHud = now;
  const s = engine.stats.at(-1)!;
  const chips = [
    ["Tick", engine.tick],
    ["", engine.world.seasonName(engine.tick)],
    ["Alive", s.population],
    ["Generations", s.maxGeneration],
    ["Tribes", Object.keys(s.tribes).length],
    ["Inventions", s.techs ?? 0],
    ["Peoples", s.tribeCount ?? 0],
    ["Faiths", s.religions ?? 0],
    ["Languages", s.languages ?? 0],
    ["Wars", s.wars ?? 0],
    ["Emigrated", engine.emigrated],
    ["In crisis", s.crises ?? 0],
  ];
  $("chips").innerHTML = chips.map(([k, v]) => `<span class="chip">${k ? `${k} ` : ""}<b>${v}</b></span>`).join("");
  renderMindStatus();
  renderStatusBar();
  renderInspector(false);
  renderLog(false);
  renderCharts();
  renderSociety();
  renderAnnals();
}

function showBanner(msg: string | null) {
  const b = $("banner");
  b.hidden = !msg;
  b.textContent = msg ?? "";
}

// --- Controls: time

$("playBtn").onclick = () => setRunning(!running);
$("stepBtn").onclick = () => {
  setRunning(false);
  tick();
};
$("restartBtn").onclick = () => replay(false);
$("reseedBtn").onclick = () => replay(true);
const speedInput = $<HTMLInputElement>("speed");
const syncSpeed = () => {
  speedIdx = Number(speedInput.value);
  const s = SPEEDS[speedIdx];
  $("speedLabel").textContent = s === Infinity ? "max" : `${s} ticks/s`;
};
speedInput.oninput = syncSpeed;
syncSpeed();

document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea, select")) return;
  if (e.code === "Space") {
    e.preventDefault();
    setRunning(!running);
  }
  if (e.key === "." || e.key === "ArrowRight") tick();
});

// --- Controls: hand of god

const TOOLS: { id: Tool; label: string; tip: string }[] = [
  { id: "inspect", label: "Inspect", tip: "Click an agent to see its mind" },
  { id: "terrain", label: "Terrain", tip: "Paint land, water or mountains" },
  { id: "settle", label: "Settle", tip: "Found a new tribe where you click" },
  { id: "bounty", label: "Bounty", tip: "Sudden abundance of food" },
  { id: "drought", label: "Drought", tip: "Food stops regrowing for a while" },
  { id: "fire", label: "Fire", tip: "Burns food and creatures; spreads through forest" },
  { id: "plague", label: "Plague", tip: "A contagious sickness" },
  { id: "flood", label: "Flood", tip: "Water swallows the land, then recedes" },
  { id: "smite", label: "Smite", tip: "Strike down a single creature" },
];
function renderTools() {
  $("tools").innerHTML = TOOLS.map((t) => `<button data-tool="${t.id}" title="${t.tip}" class="${t.id === tool ? "active" : ""}">${t.label}</button>`).join("");
  const opts = $("toolOptions");
  if (tool === "terrain")
    opts.innerHTML = `<select id="terrainPick">${TERRAINS.map((t) => `<option ${t === paintTerrain ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  else if (tool === "settle")
    opts.innerHTML = `
      <div class="row"><input type="text" id="settleName" value="${escapeHtml(settle.name)}" /><input type="color" id="settleColor" value="${settle.color}" style="width:40px;padding:0" /></div>
      <label class="field">Founders <input type="number" id="settleCount" min="1" max="40" value="${settle.count}" /></label>
      <label class="field">Creed <textarea id="settleCreed" rows="3">${escapeHtml(settle.creed)}</textarea></label>`;
  else opts.innerHTML = "";
}
$("tools").onclick = (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  tool = b.dataset.tool as Tool;
  renderTools();
};
$("toolOptions").oninput = (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "terrainPick") paintTerrain = el.value as Terrain;
  if (el.id === "settleName") settle.name = el.value;
  if (el.id === "settleColor") settle.color = el.value;
  if (el.id === "settleCount") settle.count = Number(el.value);
  if (el.id === "settleCreed") settle.creed = el.value;
};
const brushInput = $<HTMLInputElement>("brush");
const syncBrush = () => {
  brush = Number(brushInput.value);
  $("brushLabel").textContent = `${brush}×${brush}`;
};
brushInput.oninput = syncBrush;
syncBrush();
renderTools();

const board = $<HTMLCanvasElement>("board");
let painting = false;
board.addEventListener("pointerdown", (e) => {
  const c = renderer.cellAt(e.clientX, e.clientY);
  applyTool(c.x, c.y, true);
  painting = tool === "terrain";
  if (painting) board.setPointerCapture(e.pointerId);
});
board.addEventListener("pointermove", (e) => {
  hover = renderer.cellAt(e.clientX, e.clientY);
  if (painting) applyTool(hover.x, hover.y, false);
});
board.addEventListener("pointerup", () => (painting = false));
board.addEventListener("pointerleave", () => (hover = null));

function brushRect(x: number, y: number) {
  const half = Math.floor(brush / 2);
  return { x: x - half, y: y - half, w: brush, h: brush };
}

function applyTool(x: number, y: number, click: boolean) {
  if (!engine.world.inBounds(x, y)) return;
  if (isLocked() && tool !== "inspect") return;
  switch (tool) {
    case "inspect": {
      let best: Agent | undefined;
      let bestD = 2.5;
      for (const a of engine.agents.values()) {
        const d = Math.hypot(a.x - x, a.y - y);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      selectedId = best?.id ?? null;
      renderInspector(true);
      selectTab("inspect");
      break;
    }
    case "terrain":
      engine.paintTerrain(brushRect(x, y), paintTerrain);
      break;
    case "smite":
      if (click) engine.smite(x, y);
      break;
    case "settle":
      if (!click) break;
      if (!engine.tribeHues.has(settle.name)) engine.tribeHues.set(settle.name, hexToHue(settle.color));
      for (let i = 0; i < settle.count; i++)
        engine.spawn({ tribe: settle.name, creed: settle.creed, area: { x: x - 3, y: y - 3, w: 7, h: 7 } });
      engine.narrate(`A new people, the ${settle.name}, have settled the land.`);
      break;
    default:
      if (click) engine.addHazard(tool, brushRect(x, y));
  }
}

$("proclaimBtn").onclick = () => {
  const t = $<HTMLTextAreaElement>("proclaimText");
  if (!t.value.trim()) return;
  engine.narrate(t.value.trim());
  t.value = "";
};

// --- Controls: laws of nature (live)

interface Knob {
  key: keyof SimParams;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
}
const RULES: Knob[] = [
  { key: "foodRegrowth", label: "Food regrowth", min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { key: "metabolism", label: "Metabolism", min: 0.2, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: "mutationRate", label: "Mutation rate", min: 0, max: 0.4, step: 0.01, fmt: (v) => v.toFixed(2) },
  { key: "longevity", label: "Medicine's power over death", min: 0, max: 1.5, step: 0.05, fmt: (v) => `up to +${Math.round(v * 100)}% life` },
  { key: "plasticity", label: "Experience shapes temperament", min: 0, max: 3, step: 0.1, fmt: (v) => `${v.toFixed(1)}×` },
  { key: "reproductionCost", label: "Cost of a child", min: 5, max: 60, step: 1 },
  { key: "reproductionCooldown", label: "Birth cooldown", min: 1, max: 120, step: 1 },
  { key: "childhoodEnd", label: "Childhood ends", min: 0.03, max: 0.4, step: 0.01, fmt: (v) => `${Math.round(v * 100)}% of life` },
  { key: "adolescenceEnd", label: "Adulthood begins", min: 0.05, max: 0.6, step: 0.01, fmt: (v) => `${Math.round(v * 100)}% of life` },
  { key: "elderhoodStart", label: "Elderhood begins", min: 0.4, max: 0.98, step: 0.01, fmt: (v) => `${Math.round(v * 100)}% of life` },
  { key: "lifespanMin", label: "Lifespan min", min: 30, max: 600, step: 10 },
  { key: "lifespanMax", label: "Lifespan max", min: 40, max: 800, step: 10 },
  { key: "attackDamage", label: "Attack damage", min: 0, max: 100, step: 1 },
  { key: "strife", label: "Strife (struggles for power)", min: 0, max: 2, step: 0.1, fmt: (v) => (v === 0 ? "orderly" : `${v.toFixed(1)}×`) },
  { key: "maxAgents", label: "Safety limit (performance only)", min: 200, max: 5000, step: 100 },
];

function knobHtml(k: Knob, value: number) {
  const fmt = k.fmt ?? ((v: number) => String(v));
  return `<label class="slider">${k.label} <span data-out="${k.key}">${fmt(value)}</span>
    <input type="range" data-key="${k.key}" min="${k.min}" max="${k.max}" step="${k.step}" value="${value}" /></label>`;
}

function bindKnobs(container: HTMLElement, knobs: Knob[], target: () => SimParams) {
  container.oninput = (e) => {
    const el = e.target as HTMLInputElement;
    const k = knobs.find((x) => x.key === el.dataset.key);
    if (!k) return;
    const v = Number(el.value);
    (target() as unknown as Record<string, number>)[k.key] = v;
    container.querySelector(`[data-out="${k.key}"]`)!.textContent = (k.fmt ?? String)(v);
  };
}

function buildRuleControls() {
  $("ruleControls").innerHTML =
    RULES.map((k) => knobHtml(k, engine.params[k.key] as number)).join("") +
    `<label class="check"><input type="checkbox" id="seasonsChk" ${engine.params.seasons ? "checked" : ""}/> Seasons</label>` +
    `<label class="check"><input type="checkbox" id="economyChk" ${engine.params.economy ? "checked" : ""}/> Economy (crafts and trade)</label>` +
    `<button id="resetRules" class="wide" style="margin-top:10px">Reset to scenario defaults</button>`;
  $<HTMLInputElement>("seasonsChk").onchange = (e) => (engine.params.seasons = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("economyChk").onchange = (e) => (engine.params.economy = (e.target as HTMLInputElement).checked);
  $("resetRules").onclick = () => {
    for (const k of [...RULES.map((r) => r.key), "seasons" as const, "economy" as const])
      (engine.params as unknown as Record<string, unknown>)[k] = engine.scenario?.params[k] ?? DEFAULT_PARAMS[k];
    buildRuleControls();
  };
  syncRuleLock();
}
bindKnobs($("ruleControls"), RULES, () => engine.params);

// --- Controls: minds

const MIND_KNOBS: Knob[] = [
  { key: "mindShare", label: "Agents with minds", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: "thinkInterval", label: "Base think interval", min: 5, max: 200, step: 5, fmt: (v) => `${v} ticks` },
  { key: "thinkBatchSize", label: "Agents per request", min: 1, max: 20, step: 1 },
  { key: "maxConcurrentRequests", label: "Parallel requests", min: 1, max: 16, step: 1 },
  { key: "historianEvery", label: "Historian reports", min: 0, max: 1000, step: 50, fmt: (v) => (v ? `every ${v} ticks` : "on demand only") },
];

function syncMindControls() {
  const p = engine.params;
  $("mindControls").innerHTML = `
    <label class="field">Brain
      <select id="brainSel">
        <option value="instinct" ${p.brain === "instinct" ? "selected" : ""}>Instinct only (free, fast)</option>
        <option value="hybrid" ${p.brain === "hybrid" ? "selected" : ""}>Claude minds + instinct</option>
      </select></label>
    <label class="field">Model
      <select id="modelSel">${MODELS.map((m) => `<option value="${m.id}" ${m.id === p.model ? "selected" : ""}>${m.label} ($${m.inPerM} / $${m.outPerM} per M tokens)</option>`).join("")}</select></label>
    <h4>Thinking by stage of life</h4>
    <div class="stage-minds">${STAGES.map((st) => stageMindRow(st, p.stageMinds[st])).join("")}</div>
    <p class="hint">Depth is Claude's effort per thought; "every" scales the base interval (lower = more often).</p>
    ${MIND_KNOBS.filter((k) => k.key !== "historianEvery").map((k) => knobHtml(k, p[k.key] as number)).join("")}
    <label class="check"><input type="checkbox" id="lockstep" ${p.waitForMinds ? "checked" : ""}/> Lockstep (time waits for minds)</label>
    <label class="check"><input type="checkbox" id="llmBreed" ${p.llmBreeding ? "checked" : ""}/> Claude writes children's creeds</label>
    <label class="field">Budget (USD) <input type="number" id="budget" min="0" step="0.5" value="${p.budgetUsd}" /></label>
    <h4>Historian</h4>
    <p class="hint">Writes the Annals. Separate from the agents' minds, and runs even when they use instinct only.</p>
    <label class="field">Model
      <select id="historianModelSel">${MODELS.map((m) => `<option value="${m.id}" ${m.id === p.historianModel ? "selected" : ""}>${m.label}</option>`).join("")}</select></label>
    ${knobHtml(MIND_KNOBS.find((k) => k.key === "historianEvery")!, p.historianEvery)}
    <div class="hint" id="historianCost"></div>`;
}
const EVERY = [0.5, 0.75, 1, 1.5, 2, 3];
function stageMindRow(st: Stage, m: StageMind) {
  return `<span class="swatch" style="background:${STAGE_COLORS[st]}"></span><span>${st}</span>
    <select data-stage-effort="${st}">${["off", ...EFFORTS].map((x) => `<option ${x === m.effort ? "selected" : ""}>${x}</option>`).join("")}</select>
    <select data-stage-every="${st}" ${m.effort === "off" ? "disabled" : ""}>${EVERY.map((x) => `<option value="${x}" ${x === m.every ? "selected" : ""}>every ${x}×</option>`).join("")}</select>`;
}
const mindBox = $("mindControls");
bindKnobs(mindBox, MIND_KNOBS, () => engine.params);
mindBox.addEventListener("input", saveMindSettings);
mindBox.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  const p = engine.params;
  if (el.id === "brainSel") {
    p.brain = el.value as SimParams["brain"];
    if (p.brain === "hybrid" && !hasKey) showBanner("No Anthropic credentials found on the server. Add ANTHROPIC_API_KEY to .env and restart.");
    else showBanner(null);
  }
  if (el.id === "modelSel") p.model = el.value;
  if (el.id === "historianModelSel") p.historianModel = el.value;
  if (el.dataset.stageEffort) {
    p.stageMinds[el.dataset.stageEffort as Stage].effort = el.value as StageMind["effort"];
    syncMindControls();
  }
  if (el.dataset.stageEvery) p.stageMinds[el.dataset.stageEvery as Stage].every = Number(el.value);
  if (el.id === "lockstep") p.waitForMinds = el.checked;
  if (el.id === "llmBreed") p.llmBreeding = el.checked;
  if (el.id === "budget") p.budgetUsd = Number(el.value);
  saveMindSettings();
});

function renderMindStatus() {
  const p = engine.params;
  const rc = mind.reportCost(p.historianModel);
  const per = (u: number) => (u < 0.01 ? u.toFixed(4) : u.toFixed(3));
  $("historianCost").innerHTML = mind.offline
    ? "No API key: reports will show the numbers' warning signs only."
    : `≈ $${per(rc.usd)} per report${rc.measured ? " (measured)" : " (estimate)"}${p.historianEvery ? `, ≈ $${per((rc.usd * 1000) / p.historianEvery)} per 1,000 ticks` : ""}`;
  const thinking = [...engine.agents.values()].filter((a) => a.thinking).length;
  const over = !mind.canSpend(engine);
  const est = mind.estimate(engine);
  const minds = engine.mindCount();
  $("mindStatus").innerHTML =
    p.brain === "hybrid"
      ? `<b>${minds}</b> of ${engine.agents.size} agents are thinking with Claude right now (children and anyone without a mind run on instinct).<br/>
         ≈ <b>$${est.usdPer100 < 0.01 ? est.usdPer100.toFixed(4) : est.usdPer100.toFixed(2)}</b> per 100 ticks
         (${Math.round(est.decisionsPer100)} decisions${est.measured ? ", measured" : ", rough estimate"})<br/>
         Spent <b>$${mind.spentUsd.toFixed(3)}</b> of $${p.budgetUsd.toFixed(2)} · ${mind.requests} requests<br/>
         ${mind.inflight} in flight · ${thinking} minds thinking${over ? `<br/><span class="err">Budget reached; running on instinct.</span>` : ""}
         ${mind.lastError ? `<br/><span class="err">${escapeHtml(mind.lastError)}</span>` : ""}`
      : `Agents act on temperament alone. Switch to Claude minds to give them thoughts, speech and plans.`;
}

// --- Inspector

let inspectedId: number | null = null;
function renderInspector(force: boolean) {
  const box = $("tab-inspect");
  if (selectedId === null) {
    if (force || inspectedId !== null)
      box.innerHTML = `<div class="empty">Click a creature on the board to read its mind.<br/>Space to play/pause, → to step.</div>`;
    inspectedId = null;
    return;
  }
  const a = engine.findAgent(selectedId);
  if (!a) return;
  if (force || inspectedId !== a.id) {
    inspectedId = a.id;
    box.innerHTML = `<div class="inspector">
      <div class="name"><span class="swatch" style="background:hsl(${a.genome.hue},72%,60%)"></span><span id="insName"></span><span class="badge" id="insStage"></span></div>
      <div class="sub" id="insSub"></div>
      <div id="insLive"></div>
      <h4>Creed${creedEditable() ? ` <span class="hint">(edit to rewrite its beliefs)</span>` : ""}</h4>
      <textarea id="insCreed" rows="4" ${creedEditable() ? "" : "readonly"}></textarea>
      <h4>Temperament <span class="hint">bar = expressed now · tick = inborn</span></h4>
      <dl id="insTraits"></dl>
      <h4>Among others</h4>
      <dl id="insSocial"></dl>
      <h4>Knowledge</h4>
      <dl id="insKnow"></dl>
      <div id="insBeliefs"></div>
      <h4>Recent memory</h4>
      <ul class="memory" id="insMemory"></ul>
      <div class="row" ${isLocked() ? "hidden" : ""}>
        <button id="insBless">Bless (+40 energy)</button>
        <button id="insSmite">Smite</button>
      </div>
    </div>`;
    const creed = $<HTMLTextAreaElement>("insCreed");
    creed.value = a.genome.creed;
    creed.onchange = () => {
      if (!creedEditable()) return;
      setCreed(a, creed.value);
      renderFounders();
    };
    $("insBless").onclick = () => {
      a.energy = Math.min(engine.params.maxEnergy, a.energy + 40);
      engine.remember(a, "felt a surge of divine strength");
    };
    $("insSmite").onclick = () => engine.kill(a, "struck down by the heavens");
    box.onclick = (e) => {
      const id = (e.target as HTMLElement).dataset.agent;
      if (id) {
        selectedId = Number(id);
        renderInspector(true);
      }
    };
  }
  const link = (id: number | null) => {
    const x = id !== null ? engine.findAgent(id) : undefined;
    return x ? `<span class="link" data-agent="${x.id}">${escapeHtml(x.name)}</span>${x.alive ? "" : " †"}` : "";
  };
  $("insName").textContent = a.name;
  $("insStage").textContent = a.stage;
  $("insStage").style.background = STAGE_COLORS[a.stage];
  $("insSub").innerHTML =
    `${escapeHtml(a.tribe)} · generation ${a.generation}` + (a.parents ? ` · child of ${a.parents.map(link).join(" & ")}` : "");
  const p = engine.params;
  const kids = a.childIds.map(link).filter(Boolean);
  const inv = (["rations", "tools", "medicine"] as const).filter((g) => a.inventory[g]).map((g) => `${a.inventory[g]} ${g}`).join(", ") || "nothing";
  const mindLabel = engine.thinks(a)
    ? `${MODELS.find((m) => m.id === engine.modelFor(a))?.label ?? engine.modelFor(a)}, ${engine.effortFor(a)} effort${p.brain === "hybrid" ? "" : " (instinct mode is on)"}`
    : engine.hasMind(a) ? `instinct for now (${a.stage}s don't think with Claude)` : "instinct only";
  const live = a.alive
    ? `<dl>
        <dt>Energy</dt><dd>${Math.round(a.energy)} / ${p.maxEnergy}<div class="bar"><i style="width:${(a.energy / p.maxEnergy) * 100}%"></i></div></dd>
        <dt>Age</dt><dd>${a.age} of a likely ${a.lifespan} <span class="hint">(born with ${a.baseLifespan}${a.lifespan > a.baseLifespan ? `, +${a.lifespan - a.baseLifespan} from medicine` : ""}${a.wear >= 1 ? `, −${Math.round(a.wear)} from wear` : ""})</span><div class="bar stages">${stageBar(a)}</div></dd>
        <dt>Health</dt><dd>${a.frailty > 0.65 ? "<b>frail</b>" : a.frailty > 0.35 ? "ageing" : "hale"} <span class="hint">frailty ${a.frailty.toFixed(2)}</span><div class="bar"><i style="width:${a.frailty * 100}%;background:var(--danger)"></i></div></dd>
        <dt>Doing</dt><dd>${a.intent.replace("_", " ")}${a.intentDir !== "none" && a.intent === "migrate" ? ` ${a.intentDir}` : ""}${a.intentTarget ? ` → ${link(a.intentTarget)}` : ""}${a.thinking ? " · <i>thinking…</i>" : ""}</dd>
        <dt>Mind</dt><dd>${mindLabel}</dd>
        <dt>Family</dt><dd>${a.partner !== null ? `partner ${link(a.partner)}` : "no partner"}${kids.length ? `<br/>children: ${kids.join(", ")}` : ""}</dd>
        <dt>Craft</dt><dd>${a.craft ? `<span class="swatch" style="background:${CRAFT_COLORS[a.craft]}"></span> ${a.craft}, skill ${a.skills[a.craft].toFixed(2)}` : "none yet"}</dd>
        <dt>Has</dt><dd>${inv}${a.fields.length ? ` · ${a.fields.length} field${a.fields.length === 1 ? "" : "s"} (${a.fields.filter((i) => engine.world.crop[i] >= 1).length} ripe)` : ""}</dd>
        <dt>Inventions</dt><dd>${[...a.techs].map((t) => `<span class="chip-sm" title="${escapeHtml(TECHS[t].effect)}">${TECHS[t].name}</span>`).join("") || "none"}${a.techs.has("writing") ? ` <span class="hint">· literate</span>` : ""}</dd>
        <dt>Research</dt><dd>${a.research.target ? `${TECHS[a.research.target].name} <div class="bar"><i style="width:${Math.min(100, (a.research.progress / TECHS[a.research.target].cost) * 100)}%"></i></div>` : "—"}<span class="hint">${engine.canResearch(a) ? "has the ease to study" : "no ease to study"}</span></dd>
        <dt>Standing</dt><dd>${repWord(a.reputation)} (${a.reputation.toFixed(2)})${a.grudges.length ? ` · cheated by ${a.grudges.slice(-3).map(link).join(", ")}` : ""}${a.tradeStance ? ` · trades ${a.tradeStance === "reciprocal" ? "tit-for-tat" : a.tradeStance === "cheat" ? "dishonestly" : "honestly"}` : ""}</dd>
        <dt>Other</dt><dd>${a.kills ? `${a.kills} kills · ` : ""}${a.sick ? `<span style="color:#b6f05a">sick</span> · ` : ""}${a.children} children</dd>
      </dl>`
    : `<p class="thought" style="border-color:var(--danger)">Died at tick ${a.diedAt}, an ${a.stage} aged ${a.age}: ${escapeHtml(a.causeOfDeath ?? "")}. Left ${a.children} children.</p>`;
  const thought = a.thought ? `<div class="thought">“${escapeHtml(a.thought)}” <span class="hint">t${a.thoughtTick}</span></div>` : "";
  $("insLive").innerHTML = live + thought;
  const creed = $<HTMLTextAreaElement>("insCreed");
  if (document.activeElement !== creed && creed.value !== a.genome.creed) creed.value = a.genome.creed;
  $("insTraits").innerHTML =
    TRAIT_KEYS.map(
      (k) => `<dt>${k}</dt><dd>${a.traits[k].toFixed(2)}<span class="hint"> (born ${a.genome.traits[k].toFixed(2)})</span>
        <div class="bar"><i style="width:${a.traits[k] * 100}%"></i><b style="left:${a.genome.traits[k] * 100}%"></b></div></dd>`,
    ).join("") + `<dt>in short</dt><dd>${describeTraits(a.traits)}</dd>`;
  const g = engine.group(a);
  const feeling = (v: number) => (v > 0.6 ? "devoted" : v > 0.3 ? "fond" : v > 0 ? "warm" : v > -0.3 ? "wary" : v > -0.6 ? "dislikes" : "hates");
  const bonds = [...a.bonds.entries()]
    .filter(([id, v]) => Math.abs(v) > 0.12 && engine.agents.has(id))
    .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
    .slice(0, 6)
    .map(([id, v]) => `${link(id)} <span class="hint">${feeling(v)}</span>`);
  $("insSocial").innerHTML = `
    <dt>Follows</dt><dd>${a.follows !== null ? link(a.follows) : "nobody"}${a.followLockedUntil > engine.tick ? ` <span class="hint">(its own choice)</span>` : ""}</dd>
    <dt>Followers</dt><dd>${a.followers} direct, ${a.influence} in all</dd>
    <dt>Organization</dt><dd>${g ? `<span class="swatch" style="background:hsl(${groupHue(g.id)},65%,58%)"></span> ${escapeHtml(g.name)}${g.leaderId === a.id ? ` <b>(leader)</b>${g.heirId !== null ? ` · heir ${link(g.heirId)}` : " · no heir named"}` : g.heirId === a.id ? " <b>(named heir)</b>" : ""}` : "none"}</dd>
    <dt>Bonds</dt><dd>${bonds.join(", ") || "none strong"}</dd>
    <dt>Culture</dt><dd>${cultureChips(a.culture) || "<span class=\"hint\">no pull from a group</span>"}</dd>
    <dt>Faith</dt><dd>${faithHtml(a)}</dd>
    <dt>Tongue</dt><dd>${(() => { const tl = engine.languages.get(a.tribe); if (!tl) return "—"; const d = Math.sqrt(a.lang.reduce((s, v, k) => s + (v - tl[k]) ** 2, 0)); return d < 0.15 ? `the ${escapeHtml(a.tribe)} tongue` : d < 0.3 ? `a dialect drifting from the ${escapeHtml(a.tribe)} tongue` : "a tongue of its own, far from its people's"; })()}</dd>
    <dt>Materials</dt><dd>${["ore", "clay", "herbs"].filter((_, i) => a.resourcesSeen & (1 << i)).join(", ") || "none seen"}${a.renown ? ` · ${a.renown} discover${a.renown === 1 ? "y" : "ies"}` : ""}</dd>`;
  $("insKnow").innerHTML = DOMAINS.map((d) => {
    const l = levelOf(a.understanding[d]);
    return `<dt>${TRUTHS[d].label}</dt><dd>level ${l}<div class="bar"><i style="width:${progressOf(a.understanding[d]) * 100}%"></i></div>${l ? `<span class="hint">${escapeHtml(truthAt(d, l))}</span>` : ""}</dd>`;
  }).join("");
  $("insBeliefs").innerHTML = a.beliefs.length
    ? `<h4>Beliefs <span class="hint">(it can't tell which are true)</span></h4><ul class="beliefs">${a.beliefs.map(beliefHtml).join("")}</ul>`
    : "";
  $("insMemory").innerHTML = a.memory.length ? a.memory.slice().reverse().map((m) => `<li>${escapeHtml(m)}</li>`).join("") : `<li class="hint">Nothing yet.</li>`;
}

/** Lifespan bar split into the four stages, with a marker at the agent's current age. */
function stageBar(a: Agent) {
  const p = engine.params;
  const bounds = [0, p.childhoodEnd, p.adolescenceEnd, p.elderhoodStart, 1];
  const segs = STAGES.map((st, i) => `<i style="width:${(bounds[i + 1] - bounds[i]) * 100}%;background:${STAGE_COLORS[st]};opacity:.55"></i>`).join("");
  return `${segs}<b style="left:${Math.min(100, (a.age / a.lifespan) * 100)}%"></b>`;
}

function faithHtml(a: Agent) {
  const r = engine.religionOf(a);
  const deeds = (Object.entries(a.ledger) as [Deed, number][]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([d, n]) => `${DEED_TEXT[d]} ×${n}`).join(", ");
  if (!r) return `none${deeds ? `<br/><span class="hint">deeds: ${deeds}</span>` : ""}`;
  const { verdict } = judge(r.code, a.ledger);
  const fate = verdict === "heaven" ? `trusts it is bound for ${r.heaven}` : verdict === "hell" ? `fears it is bound for ${r.hell}` : "uncertain of its fate";
  return `${escapeHtml(r.name)} <span class="hint">faith ${a.faith.toFixed(2)}</span><br/><span class="hint">${fate}${deeds ? ` · deeds: ${deeds}` : ""}</span>`;
}

/** Compact "+coop −greed" style summary of a trait shift. */
function cultureChips(t: Partial<Record<string, number>>, scale = 1) {
  return Object.entries(t)
    .filter(([, v]) => Math.abs((v ?? 0) * scale) >= 0.02)
    .sort((x, y) => Math.abs(y[1]!) - Math.abs(x[1]!))
    .map(([k, v]) => `<span class="chip-sm">${v! > 0 ? "+" : "−"}${k.slice(0, 5)}</span>`)
    .join("");
}

function beliefHtml(b: { text: string; kind: string; accurate: boolean; author: string }) {
  const tag = b.kind === "meaning" ? `<span class="tag meaning">meaning</span>` : b.accurate ? `<span class="tag truth">true · ${b.kind}</span>` : `<span class="tag myth">myth · ${b.kind}</span>`;
  return `<li>${tag} “${escapeHtml(b.text)}” <span class="hint">— ${escapeHtml(b.author)}</span></li>`;
}

// --- Chronicle

const LOG_KINDS: LogEntry["kind"][] = ["world", "invention", "society", "insight", "speech", "birth", "death", "fight", "trade", "share", "mind", "system"];
const logShow = new Set<LogEntry["kind"]>(["world", "invention", "society", "insight", "speech", "birth", "death", "fight", "trade", "system", "mind"]);
$("logFilters").innerHTML = LOG_KINDS.map((k) => `<label><input type="checkbox" data-kind="${k}" ${logShow.has(k) ? "checked" : ""}/>${k}</label>`).join("");
$("logFilters").onchange = (e) => {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.kind as LogEntry["kind"];
  if (el.checked) logShow.add(k);
  else logShow.delete(k);
  renderLog(true);
};
$("log").onclick = (e) => {
  const li = (e.target as HTMLElement).closest("li");
  if (li?.dataset.agent) {
    selectedId = Number(li.dataset.agent);
    selectTab("inspect");
    renderInspector(true);
  }
};
let logSig = "";
function renderLog(force: boolean) {
  if ($("tab-chronicle").hidden && !force) return;
  const sig = `${engine.log.length}:${engine.log.at(-1)?.tick}`;
  if (!force && sig === logSig) return;
  logSig = sig;
  const items = engine.log.filter((l) => logShow.has(l.kind)).slice(-250).reverse();
  $("log").innerHTML = items
    .map((l) => `<li class="${l.kind}" ${l.agentId ? `data-agent="${l.agentId}" style="cursor:pointer"` : ""}><span class="t">t${l.tick}</span>${escapeHtml(l.text)}</li>`)
    .join("");
}

// --- Charts

const TRAIT_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];
const popChart = new TimeChart($<HTMLCanvasElement>("chartPop"), "stack");
const traitChart = new TimeChart($<HTMLCanvasElement>("chartTraits"), "line", { yMax: 1, format: (v) => v.toFixed(2) });
const knowChart = new TimeChart($<HTMLCanvasElement>("chartKnow"), "line", { format: (v) => v.toFixed(1) });
const genChart = new TimeChart($<HTMLCanvasElement>("chartGen"), "line", { format: (v) => v.toFixed(1), xLabel: (g) => `gen ${g}` });
const trustChart = new TimeChart($<HTMLCanvasElement>("chartTrust"), "line", { yMax: 1, format: (v) => `${Math.round(v * 100)}%` });
const tribeChart = new TimeChart($<HTMLCanvasElement>("chartTribes"), "stack");
const civChart = new TimeChart($<HTMLCanvasElement>("chartCiv"), "line", { yMax: 1, format: (v) => `${Math.round(v * 100)}%` });
const divChart = new TimeChart($<HTMLCanvasElement>("chartDiv"), "line");
const lifeChart = new TimeChart($<HTMLCanvasElement>("chartLife"), "line");
const orgChart = new TimeChart($<HTMLCanvasElement>("chartOrg"), "line", { yMax: 1, format: (v) => `${Math.round(v * 100)}%` });

function renderCharts() {
  if ($("tab-charts").hidden) return;
  const stats = engine.stats;
  const step = Math.max(1, Math.ceil(stats.length / 300));
  const idx = stats.map((_, i) => i).filter((i) => i % step === 0 || i === stats.length - 1);
  const pts = idx.map((i) => stats[i]);
  const ticks = pts.map((s) => s.tick);
  popChart.set(ticks, STAGES.map((st) => ({ label: st, color: STAGE_COLORS[st], values: pts.map((s) => s.stages?.[st] ?? 0) })));
  traitChart.set(ticks, TRAIT_KEYS.map((k, i) => ({ label: k, color: TRAIT_COLORS[i], values: pts.map((s) => s.traits[k]) })));
  knowChart.set(ticks, [
    { label: "Average person", color: "#3987e5", values: pts.map((s) => s.knowledge) },
    { label: "Best tribe's canon", color: "#d95926", values: pts.map((s) => s.canon) },
  ]);
  const gens = engine.knowledgeGenerations().filter((g) => g.n >= 2);
  genChart.set(gens.map((g) => g.generation), [{ label: "Lifetime knowledge", color: "#199e70", values: gens.map((g) => g.avg) }]);
  // Age at death averaged over a trailing window, since deaths are lumpy tick to tick.
  let lastAge = 0;
  const deathAge = idx.map((i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 60); j <= i; j++) {
      sum += stats[j].deathAgeSum ?? 0;
      n += stats[j].deaths;
    }
    return n ? (lastAge = sum / n) : lastAge;
  });
  divChart.set(ticks, [
    { label: "Peoples", color: "#3987e5", values: pts.map((s) => s.tribeCount ?? 0) },
    { label: "Faiths", color: "#199e70", values: pts.map((s) => s.religions ?? 0) },
    { label: "Tongues", color: "#c98500", values: pts.map((s) => s.languages ?? 0) },
    { label: "Norms", color: "#d55181", values: pts.map((s) => s.norms ?? 0) },
  ]);
  civChart.set(ticks, [
    { label: "Inventions known (best tribe, of 16)", color: "#3987e5", values: pts.map((s) => (s.techs ?? 0) / 16) },
    { label: "Literate", color: "#199e70", values: pts.map((s) => s.literacy ?? 0) },
    { label: "Farm", color: "#c98500", values: pts.map((s) => s.farmers ?? 0) },
    { label: "Researching", color: "#d55181", values: pts.map((s) => s.researchers ?? 0) },
  ]);
  lifeChart.set(ticks, [
    { label: "Life expectancy", color: "#199e70", values: pts.map((s) => s.lifeExpectancy ?? 0) },
    { label: "Age at death", color: "#d95926", values: deathAge },
  ]);
  orgChart.set(ticks, [
    { label: "In an organization", color: "#d55181", values: pts.map((s) => s.inGroups ?? 0) },
    { label: "Follow someone", color: "#3987e5", values: pts.map((s) => s.following ?? 0) },
    { label: "Largest org's share", color: "#c98500", values: pts.map((s) => (s.population ? (s.largestGroup ?? 0) / s.population : 0)) },
  ]);
  // Honest-trade share over a trailing window of 60 ticks.
  const honest = idx.map((i) => {
    let t = 0;
    let b = 0;
    for (let j = Math.max(0, i - 60); j <= i; j++) {
      t += stats[j].trades ?? 0;
      b += stats[j].betrayals ?? 0;
    }
    return t ? 1 - b / t : NaN;
  });
  let lastHonest = 1;
  trustChart.set(ticks, [
    { label: "Trades honoured", color: "#199e70", values: honest.map((v) => (Number.isNaN(v) ? lastHonest : (lastHonest = v))) },
    { label: "Average standing", color: "#c98500", values: pts.map((s) => s.avgReputation ?? 0.5) },
  ]);
  // Largest tribes by peak size; the rest fold into "Other".
  const peak = new Map<string, number>();
  for (const s of pts) for (const [t, n] of Object.entries(s.tribes)) peak.set(t, Math.max(peak.get(t) ?? 0, n));
  const top = [...peak.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([t]) => t);
  const series = top.map((t) => ({ label: t, color: tribeColor(engine, t), values: pts.map((s) => s.tribes[t] ?? 0) }));
  if (peak.size > top.length)
    series.push({
      label: "Other",
      color: "#6b6a66",
      values: pts.map((s) => Object.entries(s.tribes).reduce((sum, [t, n]) => (top.includes(t) ? sum : sum + n), 0)),
    });
  tribeChart.set(ticks, series);
}

// --- Society: organizations, tribes, models, canon and culture

let lastSociety = 0;
function renderSociety(force = false) {
  const box = $("tab-society");
  if (box.hidden) return;
  if (!force && (performance.now() - lastSociety < 1000 || box.contains(document.activeElement))) return;
  lastSociety = performance.now();
  const counts = engine.tribeCounts();
  const tribes = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (!tribes.length) {
    box.innerHTML = `<div class="empty">No one is left.</div>`;
    return;
  }
  const link = (id: number) => {
    const x = engine.findAgent(id);
    return x ? `<span class="link" data-agent="${x.id}">${escapeHtml(x.name)}</span>` : "?";
  };
  const groups = [...engine.groups.values()].sort((a, b) => b.members.size - a.members.size);
  const orgs = groups.length
    ? groups
        .slice(0, 12)
        .map((g) => {
          const members = [...g.members].map((id) => engine.agents.get(id)).filter((m): m is Agent => !!m);
          const byTribe: Record<string, number> = {};
          for (const m of members) byTribe[m.tribe] = (byTribe[m.tribe] ?? 0) + 1;
          return `<div class="org">
            <div class="tribe-head"><span class="swatch" style="background:hsl(${groupHue(g.id)},65%,58%)"></span><b>${escapeHtml(g.name)}</b>
              <span class="hint">${g.members.size} members · since t${g.foundedTick}</span></div>
            ${g.purpose ? `<div class="purpose">“${escapeHtml(g.purpose)}”</div>` : ""}
            ${g.overlordId !== null ? `<div class="hint">${g.relation === "vassal" ? "Pays tribute to" : "Allied under"} ${escapeHtml(engine.groups.get(g.overlordId)?.name ?? "?")}</div>` : ""}
            ${(() => { const subs = [...engine.groups.values()].filter((x) => x.overlordId === g.id); return subs.length ? `<div class="hint">Rules ${subs.length} (${subs.filter((x) => x.relation === "vassal").length} vassals, ${subs.filter((x) => x.relation === "ally").length} allies)</div>` : ""; })()}
            <div class="hint">${g.war ? `<span class="crisis">⚔ At war with ${escapeHtml(g.war.name)} since t${g.war.since}</span>` : g.aim === "research" && g.project ? `Researching <b>${TECHS[g.project.tech].name}</b> together — ${Math.round((g.project.progress / TECHS[g.project.tech].cost) * 100)}%` : g.aim ? `Aim: ${g.aim}` : "No shared aim"}</div>
            ${g.crisis ? `<div class="crisis">⚔ In crisis since t${g.crisis.since}: ${g.crisis.claimants.map((id) => link(id)).join(" vs ")} — ${escapeHtml(g.crisis.reason)}</div>` : ""}
            <div class="hint">Led by ${g.crisis ? "no one (contested)" : link(g.leaderId)}${(engine.agents.get(g.leaderId)?.frailty ?? 0) > 0.65 ? " (frail)" : ""} · heir ${g.heirId !== null ? link(g.heirId) : "none named"} · store ${g.store.rations} rations ·
              ${Object.entries(byTribe).map(([t, n]) => `${n} ${escapeHtml(t)}`).join(", ")}</div>
            <details><summary>${g.leaders.length} leader${g.leaders.length === 1 ? "" : "s"} so far</summary><ul class="truths">${g.leaders
              .slice(-8)
              .reverse()
              .map((l) => `<li>${link(l.id)} from t${l.from} — ${escapeHtml(l.how)}</li>`)
              .join("")}</ul></details>
            ${g.norms.length ? `<ul class="beliefs">${g.norms.map((n) => `<li>“${escapeHtml(n.text)}” ${n.effects ? cultureChips(n.effects) : `<span class="chip-sm">judging…</span>`} <span class="hint">— ${escapeHtml(n.author)}</span></li>`).join("")}</ul>` : ""}
          </div>`;
        })
        .join("")
    : `<p class="hint">No organizations yet. They form when someone gains a following, or when a mind founds one.</p>`;
  const believers = new Map<number, number>();
  for (const a of engine.agents.values()) if (a.religion !== null) believers.set(a.religion, (believers.get(a.religion) ?? 0) + 1);
  const faiths = [...believers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => {
    const r = engine.religions.get(id)!;
    const dead = engine.hallOfDead.filter((d) => d.religion === r.name);
    return `<div class="org"><div class="tribe-head"><span class="swatch" style="background:hsl(${groupHue(id * 3 + 1)},65%,60%)"></span><b>${escapeHtml(r.name)}</b>
      <span class="hint">${n} believers · founded t${r.founded} by ${escapeHtml(r.founderName)}${r.watchful ? " · a watchful god" : ""}</span></div>
      <div class="purpose">“${escapeHtml(r.doctrine)}”</div>
      <div class="hint">Of its dead, ${dead.filter((d) => d.verdict === "heaven").length} believed they would enter ${escapeHtml(r.heaven)}; ${dead.filter((d) => d.verdict === "hell").length} feared ${escapeHtml(r.hell)}.</div></div>`;
  }).join("");
  const hall = engine.hallOfDead.slice(-12).reverse().map((d) => `<li><b>${escapeHtml(d.name)}</b> <span class="hint">(${escapeHtml(d.tribe)}, t${d.tick})</span> — believed bound for <i>${escapeHtml(d.realm)}</i> <span class="hint">by ${escapeHtml(d.religion)}; ${escapeHtml(d.deeds)}</span></li>`).join("");
  box.innerHTML =
    `<h4 style="margin-top:0">Organizations (${groups.length})</h4>${orgs}` +
    `<h4>Faiths (${believers.size})</h4>${faiths || `<p class="hint">No one holds a faith yet. Faiths arise among the grieving and the devout, and are spread by teaching.</p>`}` +
    (hall ? `<details><summary>Hall of the Dead — what the departed believed awaited them</summary><ul class="truths">${hall}</ul></details>` : "") +
    `<h4>Peoples</h4>` +
    tribes
      .map((t) => {
        const members = [...engine.agents.values()].filter((a) => a.tribe === t);
        const canon = engine.canons.get(t);
        const model = engine.tribeModels.get(t) ?? "";
        const rep = members.reduce((s, a) => s + a.reputation, 0) / members.length;
        const levels = DOMAINS.map((d) => ({ d, l: canon ? levelOf(canon.understanding[d]) : 0 }));
        const truths = levels.flatMap(({ d, l }) => Array.from({ length: Math.min(l, TRUTHS[d].truths.length) }, (_, i) => truthAt(d, i + 1)));
        const beliefs = canon ? [...canon.beliefs].sort((x, y) => y.taught - x.taught).slice(0, 8) : [];
        return `<section class="tribe">
        <div class="tribe-head"><span class="swatch" style="background:${tribeColor(engine, t)}"></span><b>${escapeHtml(t)}</b>
          <span class="hint">${members.length} alive · standing ${rep.toFixed(2)} · canon ${canon ? totalLevels(canon.understanding) : 0}</span></div>
        <label class="field">Thinks with
          <select data-tribe-model="${escapeHtml(t)}"><option value="">Default (${MODELS.find((m) => m.id === engine.params.model)?.label})</option>
          ${MODELS.map((m) => `<option value="${m.id}" ${m.id === model ? "selected" : ""}>${m.label}</option>`).join("")}</select></label>
        <div class="canon-levels">${levels.map(({ d, l }) => `<span title="${TRUTHS[d].label}">${TRUTHS[d].label.slice(0, 4)} <b>${l}</b></span>`).join("")}</div>
        ${canon?.techs.size ? `<div class="hint">Inventions: ${[...canon.techs].map((t) => `<span class="chip-sm" title="${escapeHtml(TECHS[t].effect)}">${TECHS[t].name}</span>`).join("")}</div>` : ""}
        <div class="hint">${members.filter((m) => m.fields.length).length} farm · ${members.reduce((x, m) => x + m.fields.length, 0)} fields</div>
        ${truths.length ? `<details><summary>What the ${escapeHtml(t)} know (${truths.length})</summary><ul class="truths">${truths.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></details>` : ""}
        ${beliefs.length ? `<details open><summary>What they say</summary><ul class="beliefs">${beliefs.map(beliefHtml).join("")}</ul></details>` : ""}
      </section>`;
      })
      .join("");
}
$("tab-society").addEventListener("change", (e) => {
  const el = e.target as HTMLSelectElement;
  const t = el.dataset.tribeModel;
  if (t === undefined) return;
  if (el.value) engine.tribeModels.set(t, el.value);
  else engine.tribeModels.delete(t);
  el.blur();
  renderSociety(true);
});
$("tab-society").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).dataset.agent;
  if (id) {
    selectedId = Number(id);
    selectTab("inspect");
    renderInspector(true);
  }
});

// --- Annals: the historian's periodic analysis, with the numbers behind it

let annalSig = "";
function renderAnnals(force = false) {
  const box = $("tab-annals");
  const p = engine.params;
  const hm = MODELS.find((m) => m.id === p.historianModel)?.label ?? p.historianModel;
  $("annalStatus").textContent = mind.historianBusy
    ? `The historian (${hm}) is writing…`
    : mind.offline
      ? "No API key: reports show the numbers' warning signs only."
      : p.historianEvery
        ? `${hm} · next report around tick ${(engine.annals.at(-1)?.tick ?? 0) + p.historianEvery}.`
        : "Automatic reports are off.";
  if (box.hidden) return;
  const sig = engine.annals.map((x) => `${x.tick}:${x.status}`).join("|");
  if (!force && sig === annalSig) return;
  annalSig = sig;
  const list = $("annals");
  if (!engine.annals.length) {
    list.innerHTML = `<div class="empty">No reports yet.<br/>The historian writes one every ${p.historianEvery || "—"} ticks, or press the button for one now.</div>`;
    return;
  }
  list.innerHTML = [...engine.annals].reverse().map((x, i) => annalHtml(x, engine.annals.length - 1 - i)).join("");
  // Small multiples of the key series up to the report, with its period shaded.
  for (const [i, x] of engine.annals.entries()) {
    const el = document.getElementById(`minis-${i}`);
    if (!el) continue;
    const upTo = engine.stats.filter((s) => s.tick <= x.tick);
    const step = Math.max(1, Math.ceil(upTo.length / 120));
    const pts = upTo.filter((_, j) => j % step === 0 || j === upTo.length - 1);
    const ticks = pts.map((s) => s.tick);
    const minis: [string, string, (s: (typeof pts)[number]) => number, { yMax?: number; format?: (v: number) => string }][] = [
      ["Population", "#3987e5", (s) => s.population, {}],
      ["Knowledge", "#199e70", (s) => s.knowledge, { format: (v) => v.toFixed(1) }],
      ["In organizations", "#d55181", (s) => s.inGroups ?? 0, { yMax: 1, format: (v) => `${Math.round(v * 100)}%` }],
      ["Average standing", "#c98500", (s) => s.avgReputation ?? 0.5, { yMax: 1, format: (v) => v.toFixed(2) }],
    ];
    minis.forEach(([label, color, f, o], k) => {
      const c = el.querySelector<HTMLCanvasElement>(`canvas[data-k="${k}"]`)!;
      new TimeChart(c, "line", { ...o, legend: false, highlightFrom: x.fromTick }).set(ticks, [{ label, color, values: pts.map(f) }]);
    });
  }
}

function annalHtml(x: AnnalEntry, i: number) {
  const r = x.report;
  const arrow = (d: string) => `<span class="arrow ${d}">${d === "up" ? "↑" : d === "down" ? "↓" : "→"}</span>`;
  const minis = `<div class="minis" id="minis-${i}">${["Population", "Knowledge", "In organizations", "Average standing"]
    .map((l, k) => `<div><h6>${l}</h6><div class="chart"><canvas data-k="${k}"></canvas></div></div>`)
    .join("")}</div>`;
  const signals = x.signals.length ? `<h5>Warning signs in the numbers</h5><ul class="signals">${x.signals.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : "";
  if (!r)
    return `<article class="annal"><div class="era">Ticks ${x.fromTick}–${x.tick}</div>
      <h3 class="title">${x.status === "writing" ? "The historian is writing…" : x.status === "error" ? "The historian could not write this report" : "Snapshot"}</h3>
      ${x.error ? `<p class="hint">${escapeHtml(x.error)}</p>` : ""}${minis}${signals}</article>`;
  return `<article class="annal">
    <div class="era">${escapeHtml(r.era)} · ticks ${x.fromTick}–${x.tick}${x.model ? ` · ${escapeHtml(MODELS.find((m) => m.id === x.model)?.label ?? x.model)}` : ""}</div>
    <h3 class="title">${escapeHtml(r.title)}</h3>
    ${minis}
    ${r.narrative.split(/\n\s*\n/).map((para) => `<p>${escapeHtml(para)}</p>`).join("")}
    ${r.review ? `<h5>How the last predictions held up</h5><p class="review">${escapeHtml(r.review)}</p>` : ""}
    <h5>Trends</h5><ul>${r.trends.map((t) => `<li>${arrow(t.direction)}<b>${escapeHtml(t.label)}</b> — ${escapeHtml(t.detail)}</li>`).join("")}</ul>
    ${r.leaders.length ? `<h5>Figures of the age</h5><ul>${r.leaders.map((l) => `<li><b>${agentLinkByName(l.name)}</b>, ${escapeHtml(l.role)} — ${escapeHtml(l.assessment)}</li>`).join("")}</ul>` : ""}
    <h5>Risks</h5><ul>${r.risks.map((k) => `<li><span class="lk ${k.likelihood}">${k.likelihood}</span><b>${escapeHtml(k.label)}</b> — ${escapeHtml(k.detail)}</li>`).join("")}</ul>
    <h5>Opportunities</h5><ul>${r.opportunities.map((o) => `<li><b>${escapeHtml(o.label)}</b> — ${escapeHtml(o.detail)}</li>`).join("")}</ul>
    <h5>Predictions</h5><ul>${r.predictions.map((pr) => `<li>• ${escapeHtml(pr)}</li>`).join("")}</ul>
    ${signals}
  </article>`;
}

/** Names in reports become links when the agent can still be found. */
function agentLinkByName(name: string) {
  const a = [...engine.agents.values()].find((x) => x.name === name) ?? [...engine.graveyard].reverse().find((x) => x.name === name);
  return a ? `<span class="link" data-agent="${a.id}">${escapeHtml(name)}</span>${a.alive ? "" : " †"}` : escapeHtml(name);
}

$("annalNow").onclick = () => {
  mind.writeAnnal(engine);
  renderAnnals(true);
};
$("tab-annals").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).dataset.agent;
  if (id) {
    selectedId = Number(id);
    selectTab("inspect");
    renderInspector(true);
  }
});

// --- Tabs

function selectTab(name: string) {
  for (const b of $("tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.tab === name);
  for (const t of ["inspect", "society", "annals", "chronicle", "charts"]) $(`tab-${t}`).hidden = t !== name;
  if (name === "chronicle") renderLog(true);
  if (name === "charts") renderCharts();
  if (name === "society") renderSociety(true);
  if (name === "annals") renderAnnals(true);
}
$("tabs").onclick = (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (b?.dataset.tab) selectTab(b.dataset.tab);
};

$<HTMLInputElement>("trails").onchange = (e) => (showTrails = (e.target as HTMLInputElement).checked);
$<HTMLInputElement>("resources").onchange = (e) => (showResources = (e.target as HTMLInputElement).checked);
$<HTMLInputElement>("ties").onchange = (e) => (showTies = (e.target as HTMLInputElement).checked);
$<HTMLSelectElement>("colorMode").onchange = (e) => (colorMode = (e.target as HTMLSelectElement).value as ColorMode);

// --- New world dialog

const dialog = $<HTMLDialogElement>("newGame");
$("newGameBtn").onclick = () => {
  setRunning(false);
  renderSaved();
  dialog.showModal();
};
$("ngTabs").onclick = (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b?.dataset.ng) return;
  for (const x of $("ngTabs").querySelectorAll("button")) x.classList.toggle("active", x === b);
  for (const t of ["prompt", "presets", "petri", "random"]) $(`ng-${t}`).hidden = t !== b.dataset.ng;
};

const EXAMPLES = [
  "The fall of the Western Roman Empire, 376–476 AD",
  "Polynesian voyagers settling the Pacific islands",
  "The Black Death arrives in Europe, 1347",
  "Neanderthals and Homo sapiens share Ice Age Europe",
  "The Columbian Exchange, 1492",
  "A utopian commune founded on a fertile island",
];
$("examples").innerHTML = EXAMPLES.map((x) => `<button type="button">${escapeHtml(x)}</button>`).join("");
$("examples").onclick = (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (b) $<HTMLTextAreaElement>("scenarioPrompt").value = b.textContent!;
};

$("generateBtn").onclick = async () => {
  const prompt = $<HTMLTextAreaElement>("scenarioPrompt").value.trim();
  if (!prompt) return;
  const btn = $<HTMLButtonElement>("generateBtn");
  btn.disabled = true;
  $("generateStatus").textContent = "Claude is designing your world… (this can take a minute)";
  $("scenarioPreview").innerHTML = "";
  try {
    const { width, height } = DEFAULT_PARAMS;
    const res = await post<ScenarioResponse>("/api/scenario", { model: engine.params.model, prompt, width, height });
    const spec = sanitizeScenario(res.scenario, width, height);
    spec.params = { ...spec.params, width, height };
    saveScenario(spec);
    $("generateStatus").textContent = "";
    showPreview(spec);
  } catch (err) {
    $("generateStatus").textContent = err instanceof Error ? err.message : String(err);
  } finally {
    btn.disabled = false;
  }
};

function showPreview(spec: ScenarioSpec) {
  const box = $("scenarioPreview");
  box.innerHTML = `<div class="preview">
    <h4 style="margin:0;font-size:15px;color:var(--text)">${escapeHtml(spec.title)}</h4>
    <p class="hint">${escapeHtml(spec.description)}</p>
    <canvas id="miniMap"></canvas>
    <div class="factions">${spec.factions
      .map(
        (f) => `<div class="faction"><span class="swatch" style="background:${f.color}"></span>
          <div><b>${escapeHtml(f.name)}</b> <span class="hint">· ${f.count} people${f.arriveAt ? ` · arrive at tick ${f.arriveAt}` : ""} · ${describeTraits(f.traits)}</span></div>
          <div class="creed">“${escapeHtml(f.creed)}”</div></div>`,
      )
      .join("")}</div>
    ${spec.events.length ? `<b>Fate has planned</b><ul class="events">${spec.events.map((e) => `<li>t${e.tick}: ${e.kind === "narration" ? "" : `<b>${e.kind}</b> — `}${escapeHtml(e.message)}</li>`).join("")}</ul>` : ""}
    <button type="button" class="primary" id="startScenario">Begin</button>
  </div>`;
  drawMiniMap($<HTMLCanvasElement>("miniMap"), spec);
  $("startScenario").onclick = () => {
    dialog.close();
    startGame(spec);
  };
}

function drawMiniMap(canvas: HTMLCanvasElement, spec: ScenarioSpec) {
  const e = new Engine({ ...(spec.params ?? {}), brain: "instinct" }, { ...spec, events: [] });
  const s = 6;
  canvas.width = e.world.width * s;
  canvas.height = e.world.height * s;
  const ctx = canvas.getContext("2d")!;
  for (let y = 0; y < e.world.height; y++)
    for (let x = 0; x < e.world.width; x++) {
      ctx.fillStyle = TERRAIN[e.world.terrainAt(x, y)].color;
      ctx.fillRect(x * s, y * s, s, s);
    }
  for (const a of e.agents.values()) {
    ctx.fillStyle = `hsl(${a.genome.hue},72%,60%)`;
    ctx.fillRect(a.x * s, a.y * s, s, s);
  }
  // Late arrivals are shown as dashed outlines where they will land.
  ctx.setLineDash([4, 3]);
  for (const f of spec.factions.filter((f) => f.arriveAt > 0)) {
    ctx.strokeStyle = f.color;
    ctx.strokeRect(f.spawn.x * s, f.spawn.y * s, f.spawn.w * s, f.spawn.h * s);
  }
}

// Saved scenarios (per browser). Storage can be unavailable, so every access is guarded.
const SAVE_KEY = "primordia.scenarios";
function loadSaved(): ScenarioSpec[] {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function saveScenario(spec: ScenarioSpec) {
  try {
    const list = [spec, ...loadSaved().filter((s) => s.title !== spec.title)].slice(0, 20);
    localStorage.setItem(SAVE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}
function renderSaved() {
  const saved = loadSaved();
  $("savedScenarios").innerHTML = saved.length
    ? `<h4>Your generated worlds</h4><div class="cards">${saved
        .map((s, i) => `<div class="card"><h4>${escapeHtml(s.title)}</h4><p>${escapeHtml(s.description)}</p><button type="button" data-saved="${i}">Preview</button></div>`)
        .join("")}</div>`
    : "";
}
$("savedScenarios").onclick = (e) => {
  const i = (e.target as HTMLElement).dataset.saved;
  if (i !== undefined) showPreview(loadSaved()[Number(i)]);
};

$("presetCards").innerHTML = PRESETS.map(
  (p, i) => `<div class="card"><h4>${escapeHtml(p.title)}</h4><p>${escapeHtml(p.description)}</p>
    <div>${p.factions.map((f) => `<span class="swatch" title="${escapeHtml(f.name)}" style="background:${f.color}"></span>`).join(" ")}</div>
    <button type="button" class="primary" data-preset="${i}">Start</button></div>`,
).join("");
$("presetCards").onclick = (e) => {
  const i = (e.target as HTMLElement).dataset.preset;
  if (i === undefined) return;
  dialog.close();
  startGame(PRESETS[Number(i)]);
};

const RANDOM_KNOBS: Knob[] = [
  { key: "initialAgents", label: "Starting population", min: 4, max: 200, step: 1 },
  { key: "width", label: "Board width", min: 30, max: 160, step: 2 },
  { key: "height", label: "Board height", min: 20, max: 110, step: 2 },
  { key: "seed", label: "Seed", min: 1, max: 999, step: 1 },
];
const randomParams: SimParams = { ...DEFAULT_PARAMS };
$("randomControls").innerHTML = RANDOM_KNOBS.map((k) => knobHtml(k, randomParams[k.key] as number)).join("");
bindKnobs($("randomControls"), RANDOM_KNOBS, () => randomParams);
$("randomStart").onclick = () => {
  dialog.close();
  const { initialAgents, width, height, seed } = randomParams;
  startGame(null, { initialAgents, width, height, seed });
};

// --- Petri dish setup

const petri: PetriOptions = structuredClone({ ...PETRI_DEFAULTS, founders: PETRI_FOUNDERS.map((f) => structuredClone(f)) });
let petriCount = PETRI_DEFAULTS.founders.length;
const PETRI_KNOBS: Knob[] = [
  { key: "width", label: "Box size", min: 10, max: 60, step: 2 },
  { key: "foodRegrowth", label: "Food", min: 0.3, max: 3, step: 0.1, fmt: (v) => `${v.toFixed(1)}×` },
  { key: "mutationRate", label: "Mutation rate", min: 0, max: 0.4, step: 0.01, fmt: (v) => v.toFixed(2) },
];

function renderPetri() {
  const val: Record<string, number> = { width: petri.size, foodRegrowth: petri.food, mutationRate: petri.mutationRate };
  $("petriSettings").innerHTML =
    PETRI_KNOBS.map((k) => knobHtml(k, val[k.key])).join("") +
    `<label class="field">Founders <select id="petriCount">${[1, 2, 3, 4].map((n) => `<option ${n === petriCount ? "selected" : ""}>${n}</option>`).join("")}</select></label>
     <label class="field">Starting placement <select id="petriPlace">${(["center", "corners", "line", "random"] as Placement[])
       .map((p) => `<option ${p === petri.placement ? "selected" : ""}>${p}</option>`)
       .join("")}</select></label>
     <label class="field">Seed <input type="number" id="petriSeed" min="1" value="${petri.seed}" /></label>`;
  $("petriFounders").innerHTML = petri.founders
    .slice(0, petriCount)
    .map(
      (f, i) => `<div class="founder" data-i="${i}">
        <div class="row"><input type="text" data-f="name" value="${escapeHtml(f.name)}" /><input type="color" data-f="color" value="${f.color}" /></div>
        ${TRAIT_KEYS.map((k) => `<label class="slider">${k} <span data-out="${k}">${f.traits[k].toFixed(2)}</span><input type="range" data-trait="${k}" min="0" max="1" step="0.05" value="${f.traits[k]}" /></label>`).join("")}
        <label class="field">Thinks with <select data-f="model"><option value="">Default model</option>${MODELS.map((m) => `<option value="${m.id}" ${m.id === f.model ? "selected" : ""}>${m.label}</option>`).join("")}</select></label>
        <label class="field">Creed <textarea rows="4" data-f="creed" placeholder="What this founder believes and how it should live…">${escapeHtml(f.creed)}</textarea></label>
      </div>`,
    )
    .join("");
}
$("petriSettings").oninput = (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.key === "width") petri.size = Number(el.value);
  if (el.dataset.key === "foodRegrowth") petri.food = Number(el.value);
  if (el.dataset.key === "mutationRate") petri.mutationRate = Number(el.value);
  const k = PETRI_KNOBS.find((x) => x.key === el.dataset.key);
  if (k) el.parentElement!.querySelector("span")!.textContent = (k.fmt ?? String)(Number(el.value));
  if (el.id === "petriSeed") petri.seed = Math.max(1, Number(el.value) || 1);
};
$("petriSettings").onchange = (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.id === "petriCount") {
    petriCount = Number(el.value);
    renderPetri();
  }
  if (el.id === "petriPlace") petri.placement = el.value as Placement;
};
$("petriFounders").oninput = (e) => {
  const el = e.target as HTMLInputElement;
  const f = petri.founders[Number(el.closest<HTMLElement>(".founder")!.dataset.i)];
  const trait = el.dataset.trait as (typeof TRAIT_KEYS)[number] | undefined;
  if (trait) {
    f.traits[trait] = Number(el.value);
    el.parentElement!.querySelector("span")!.textContent = f.traits[trait].toFixed(2);
  }
  if (el.dataset.f === "name") f.name = el.value.trim() || f.name;
  if (el.dataset.f === "color") f.color = el.value;
  if (el.dataset.f === "creed") f.creed = el.value;
  if (el.dataset.f === "model") f.model = el.value;
};
$("petriStart").onclick = () => {
  dialog.close();
  const o: PetriOptions = structuredClone({ ...petri, founders: petri.founders.slice(0, petriCount) });
  startGame(petriDish(o), {}, o);
};
renderPetri();

// --- Boot

window.addEventListener("resize", () => renderer.resize(engine));
fetch("/api/status")
  .then((r) => r.json())
  .then((s) => (hasKey = !!s.hasKey))
  .catch(() => (hasKey = false));

startGame(PRESETS[0]);
requestAnimationFrame(frame);
