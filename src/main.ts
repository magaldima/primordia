import {
  DEFAULT_PARAMS,
  EFFORTS,
  MODELS,
  TERRAINS,
  TRAIT_KEYS,
  type Effort,
  type HazardKind,
  type ScenarioResponse,
  type ScenarioSpec,
  type SimParams,
  type Terrain,
} from "../shared/types";
import { escapeHtml, TimeChart } from "./charts";
import { Mind, post } from "./mind";
import { Renderer, tribeColor, type ColorMode } from "./render";
import { Engine, hexToHue, type Agent, type LogEntry } from "./sim/engine";
import { describeTraits } from "./sim/genome";
import { PETRI_DEFAULTS, PETRI_FOUNDERS, petriDish, PRESETS, type PetriOptions, type Placement } from "./sim/presets";
import { sanitizeScenario } from "./sim/scenario";
import { TERRAIN } from "./sim/world";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// --- State

/** Mind settings survive "New world"; the laws of nature reset to defaults plus the scenario's overrides. */
const MIND_KEYS = [
  "brain", "model", "effort", "mindShare", "thinkInterval", "thinkBatchSize",
  "maxConcurrentRequests", "waitForMinds", "llmBreeding", "budgetUsd",
] as const;
const MIND_SAVE_KEY = "primordia.mind";
let carried: Partial<SimParams> = { brain: "instinct", ...loadMindSettings() };

/** Mind settings are remembered per browser so cost controls stick between sessions. */
function loadMindSettings(): Partial<SimParams> {
  try {
    const saved = JSON.parse(localStorage.getItem(MIND_SAVE_KEY) ?? "{}");
    if (saved.model && !MODELS.some((m) => m.id === saved.model)) delete saved.model;
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
  for (const k of MIND_KEYS) (carried as Record<string, unknown>)[k] = engine.params[k];
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
  ];
  $("chips").innerHTML = chips.map(([k, v]) => `<span class="chip">${k ? `${k} ` : ""}<b>${v}</b></span>`).join("");
  renderMindStatus();
  renderInspector(false);
  renderLog(false);
  renderCharts();
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
  { key: "reproductionCost", label: "Cost of a child", min: 5, max: 60, step: 1 },
  { key: "maturityAge", label: "Age of maturity", min: 5, max: 120, step: 1 },
  { key: "reproductionCooldown", label: "Birth cooldown", min: 1, max: 120, step: 1 },
  { key: "lifespanMin", label: "Lifespan min", min: 30, max: 600, step: 10 },
  { key: "lifespanMax", label: "Lifespan max", min: 40, max: 800, step: 10 },
  { key: "attackDamage", label: "Attack damage", min: 0, max: 100, step: 1 },
  { key: "maxAgents", label: "Population cap", min: 20, max: 1000, step: 10 },
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
    `<button id="resetRules" class="wide" style="margin-top:10px">Reset to scenario defaults</button>`;
  $<HTMLInputElement>("seasonsChk").onchange = (e) => (engine.params.seasons = (e.target as HTMLInputElement).checked);
  $("resetRules").onclick = () => {
    for (const k of [...RULES.map((r) => r.key), "seasons" as const])
      (engine.params as unknown as Record<string, unknown>)[k] = engine.scenario?.params[k] ?? DEFAULT_PARAMS[k];
    buildRuleControls();
  };
  syncRuleLock();
}
bindKnobs($("ruleControls"), RULES, () => engine.params);

// --- Controls: minds

const MIND_KNOBS: Knob[] = [
  { key: "mindShare", label: "Agents with minds", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: "thinkInterval", label: "Think every", min: 5, max: 200, step: 5, fmt: (v) => `${v} ticks` },
  { key: "thinkBatchSize", label: "Agents per request", min: 1, max: 20, step: 1 },
  { key: "maxConcurrentRequests", label: "Parallel requests", min: 1, max: 16, step: 1 },
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
    <label class="field">Thinking depth
      <select id="effortSel">${EFFORTS.map((x) => `<option value="${x}" ${x === p.effort ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    ${MIND_KNOBS.map((k) => knobHtml(k, p[k.key] as number)).join("")}
    <label class="check"><input type="checkbox" id="lockstep" ${p.waitForMinds ? "checked" : ""}/> Lockstep (time waits for minds)</label>
    <label class="check"><input type="checkbox" id="llmBreed" ${p.llmBreeding ? "checked" : ""}/> Claude writes children's creeds</label>
    <label class="field">Budget (USD) <input type="number" id="budget" min="0" step="0.5" value="${p.budgetUsd}" /></label>`;
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
  if (el.id === "effortSel") p.effort = el.value as Effort;
  if (el.id === "lockstep") p.waitForMinds = el.checked;
  if (el.id === "llmBreed") p.llmBreeding = el.checked;
  if (el.id === "budget") p.budgetUsd = Number(el.value);
  saveMindSettings();
});

function renderMindStatus() {
  const p = engine.params;
  const thinking = [...engine.agents.values()].filter((a) => a.thinking).length;
  const over = !mind.canSpend(engine);
  const est = mind.estimate(engine);
  const minds = engine.mindCount();
  const perAgent = minds ? Math.round(engine.params.thinkInterval) : 0;
  $("mindStatus").innerHTML =
    p.brain === "hybrid"
      ? `<b>${minds}</b> of ${engine.agents.size} agents have minds${minds ? `, each consulting Claude every ~${perAgent} ticks` : ""}.
         The rest of the time, and for everyone else, instinct decides.<br/>
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
      <div class="name"><span class="swatch" style="background:hsl(${a.genome.hue},72%,60%)"></span><span id="insName"></span></div>
      <div class="sub" id="insSub"></div>
      <div id="insLive"></div>
      <h4>Creed${creedEditable() ? ` <span class="hint">(edit to rewrite its beliefs)</span>` : ""}</h4>
      <textarea id="insCreed" rows="4" ${creedEditable() ? "" : "readonly"}></textarea>
      <h4>Temperament</h4>
      <dl id="insTraits"></dl>
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
  $("insName").textContent = a.name;
  const parents = a.parents?.map((id) => engine.findAgent(id)).filter((p): p is Agent => !!p) ?? [];
  $("insSub").innerHTML =
    `${escapeHtml(a.tribe)} · generation ${a.generation}` +
    (parents.length ? ` · child of ${parents.map((p) => `<span class="link" data-agent="${p.id}">${escapeHtml(p.name)}</span>`).join(" & ")}` : "");
  const live = a.alive
    ? `<dl>
        <dt>Energy</dt><dd>${Math.round(a.energy)} / ${engine.params.maxEnergy}<div class="bar"><i style="width:${(a.energy / engine.params.maxEnergy) * 100}%"></i></div></dd>
        <dt>Age</dt><dd>${a.age} / ${a.lifespan}<div class="bar"><i style="width:${(a.age / a.lifespan) * 100}%"></i></div></dd>
        <dt>Doing</dt><dd>${a.intent.replace("_", " ")}${a.intentDir !== "none" && a.intent === "migrate" ? ` ${a.intentDir}` : ""}${a.intentTarget ? ` → ${escapeHtml(engine.findAgent(a.intentTarget)?.name ?? "?")}` : ""}${a.thinking ? " · <i>thinking…</i>" : ""}</dd>
        <dt>Mind</dt><dd>${engine.hasMind(a) ? (engine.params.brain === "hybrid" ? "Claude + instinct" : "Claude (off: instinct mode)") : "instinct only"}</dd>
        <dt>Children</dt><dd>${a.children}${a.kills ? ` · ${a.kills} kills` : ""}${a.sick ? ` · <span style="color:#b6f05a">sick</span>` : ""}</dd>
      </dl>`
    : `<p class="thought" style="border-color:var(--danger)">Died at tick ${a.diedAt}, age ${a.age}: ${escapeHtml(a.causeOfDeath ?? "")}. Left ${a.children} children.</p>`;
  const thought = a.thought ? `<div class="thought">“${escapeHtml(a.thought)}” <span class="hint">t${a.thoughtTick}</span></div>` : "";
  $("insLive").innerHTML = live + thought;
  const creed = $<HTMLTextAreaElement>("insCreed");
  if (document.activeElement !== creed && creed.value !== a.genome.creed) creed.value = a.genome.creed;
  $("insTraits").innerHTML =
    TRAIT_KEYS.map((k) => `<dt>${k}</dt><dd>${a.genome.traits[k].toFixed(2)}<div class="bar"><i style="width:${a.genome.traits[k] * 100}%"></i></div></dd>`).join("") +
    `<dt>in short</dt><dd>${describeTraits(a.genome.traits)}</dd>`;
  $("insMemory").innerHTML = a.memory.length ? a.memory.slice().reverse().map((m) => `<li>${escapeHtml(m)}</li>`).join("") : `<li class="hint">Nothing yet.</li>`;
}

// --- Chronicle

const LOG_KINDS: LogEntry["kind"][] = ["world", "birth", "death", "fight", "share", "speech", "mind", "system"];
const logShow = new Set<LogEntry["kind"]>(["world", "birth", "death", "fight", "speech", "system", "mind"]);
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
const popChart = new TimeChart($<HTMLCanvasElement>("chartPop"), "line");
const traitChart = new TimeChart($<HTMLCanvasElement>("chartTraits"), "line", { yMax: 1, format: (v) => v.toFixed(2) });
const tribeChart = new TimeChart($<HTMLCanvasElement>("chartTribes"), "stack");

function renderCharts() {
  if ($("tab-charts").hidden) return;
  const stats = engine.stats;
  const step = Math.max(1, Math.ceil(stats.length / 300));
  const pts = stats.filter((_, i) => i % step === 0 || i === stats.length - 1);
  const ticks = pts.map((s) => s.tick);
  popChart.set(ticks, [{ label: "Population", color: "#3987e5", values: pts.map((s) => s.population) }]);
  traitChart.set(ticks, TRAIT_KEYS.map((k, i) => ({ label: k, color: TRAIT_COLORS[i], values: pts.map((s) => s.traits[k]) })));
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

// --- Tabs

function selectTab(name: string) {
  for (const b of $("tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.tab === name);
  for (const t of ["inspect", "chronicle", "charts"]) $(`tab-${t}`).hidden = t !== name;
  if (name === "chronicle") renderLog(true);
  if (name === "charts") renderCharts();
}
$("tabs").onclick = (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (b?.dataset.tab) selectTab(b.dataset.tab);
};

$<HTMLInputElement>("trails").onchange = (e) => (showTrails = (e.target as HTMLInputElement).checked);
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
