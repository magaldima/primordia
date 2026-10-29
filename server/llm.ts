import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DIRECTIONS,
  EFFORTS,
  HAZARDS,
  INTENTS,
  MODELS,
  TERRAINS,
  TRAIT_KEYS,
  type BreedRequest,
  type BreedResponse,
  type Decision,
  type ScenarioRequest,
  type ScenarioResponse,
  type ScenarioSpec,
  type ThinkRequest,
  type ThinkResponse,
  type Usage,
} from "../shared/types";

/**
 * The SDK resolves credentials lazily (env vars, then an `ant auth login` profile) and throws an
 * untyped error mid-request if none exist, so check the same sources up front.
 */
export function hasCredentials(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || fs.existsSync(path.join(os.homedir(), ".config", "anthropic")));
}

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export class LlmError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

// Models whose server-side refusal fallback accepts the "default" routing mode.
const DEFAULT_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

function checkModel(model: string) {
  if (!MODELS.some((m) => m.id === model)) throw new LlmError(`Unknown model ${model}`, 400);
}

/** One structured-output call. Returns the parsed JSON object, or null if the model declined. */
async function callJson<T>(opts: {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  maxTokens: number;
}): Promise<{ data: T | null; usage: Usage }> {
  checkModel(opts.model);
  if (!hasCredentials()) throw new LlmError("No Anthropic credentials. Add ANTHROPIC_API_KEY to .env and restart the server.", 401);
  const withFallback = DEFAULT_FALLBACK_MODELS.has(opts.model);
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await getClient().beta.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { effort: opts.effort, format: { type: "json_schema", schema: opts.schema } },
      ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new LlmError("Anthropic API key missing or invalid. Set ANTHROPIC_API_KEY in .env.", 401);
    if (err instanceof Anthropic.RateLimitError) throw new LlmError("Rate limited by the Anthropic API. Lower concurrency or think less often.", 429);
    if (err instanceof Anthropic.BadRequestError) throw new LlmError(`Bad request: ${err.message}`, 400);
    if (err instanceof Anthropic.APIError) throw new LlmError(`Anthropic API error ${err.status}: ${err.message}`, 502);
    throw err;
  }
  const usage: Usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
  if (response.stop_reason === "refusal") return { data: null, usage };
  if (response.stop_reason === "max_tokens") throw new LlmError("Response was cut off (max_tokens). Try a smaller batch size.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return { data: JSON.parse(text) as T, usage };
  } catch {
    throw new LlmError("Model returned malformed JSON.");
  }
}

// --- Agent minds

const MIND_SYSTEM = `You are the inner voice of several creatures living in a simulated world, a "game of life" where natural selection acts on personalities.

Each creature, like a human, has one overriding mandate: survive, and see its line continue. Hunger, age, rivals, kin, disease and disaster all press on it. It does not know it is in a simulation.

Each creature also has a creed (beliefs passed down and mutated through its ancestors) and a temperament (traits from 0 to 1: aggression, cooperation, curiosity, fertility, caution, greed). Let creed and temperament colour what each creature wants. A greedy, violent creature and a generous, cautious one should choose differently in the same situation. Creatures are not all wise; they can be fearful, spiteful, loyal or rash.

Rules of the world:
- Energy falls every tick. At 0 the creature dies. Eating food on its cell restores energy. Old age kills at the lifespan regardless.
- Food regrows slowly, faster near water and in spring and summer. Deserts and mountains are poor; mountains are safe to defend.
- Two mature creatures with spare energy, standing next to each other, can have a child who inherits a blend of their creeds and temperaments. Raising a child costs each parent a lot of energy.
- Attacking a neighbour steals some of its energy but risks retaliation and death.
- Sharing gives energy to a neighbour.
- Fire, plague, drought and floods are dangerous.

For each creature, choose one intent to follow for the next while:
- forage: find and eat food nearby
- explore: wander in search of new land
- migrate: travel steadily in a direction (set direction)
- seek_mate: find a partner and have a child (set target to a neighbour's name, or "" for anyone suitable)
- attack: fight a creature (set target to a neighbour's name, or "" for the nearest stranger)
- share: give food to a creature (set target, or "" for the neediest)
- flee: get away from threats and danger
- rest: stay still and conserve energy
- rally: gather with members of its own tribe
- hoard: stay on a rich patch and eat greedily

"thought" is one short first-person sentence in the creature's own voice. "speech" is something it says aloud to those nearby (others will hear it and may react) or "" to stay silent; most of the time stay silent. "target" must be the exact name of a listed neighbour or "". "direction" is used by migrate (otherwise "none").

Return exactly one decision per creature, using its id.`;

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decisions"],
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "thought", "intent", "target", "direction", "speech"],
        properties: {
          id: { type: "integer" },
          thought: { type: "string" },
          intent: { type: "string", enum: [...INTENTS] },
          target: { type: "string" },
          direction: { type: "string", enum: [...DIRECTIONS] },
          speech: { type: "string" },
        },
      },
    },
  },
};

export async function think(req: ThinkRequest): Promise<ThinkResponse> {
  checkModel(req.model);
  if (!Array.isArray(req.agents) || !req.agents.length) throw new LlmError("No agents to think for.", 400);
  const lines = [
    `WORLD: ${req.worldSummary}`,
    req.worldEvents.length ? `RECENT OMENS AND EVENTS:\n${req.worldEvents.map((e) => `- ${e}`).join("\n")}` : "",
    "CREATURES:",
    ...req.agents.map((a) => JSON.stringify(a)),
  ].filter(Boolean);
  const { data, usage } = await callJson<{ decisions: Decision[] }>({
    model: req.model,
    system: MIND_SYSTEM,
    user: lines.join("\n\n"),
    schema: DECISION_SCHEMA,
    effort: EFFORTS.includes(req.effort) ? req.effort : "low",
    maxTokens: 16000,
  });
  const ids = new Set(req.agents.map((a) => a.id));
  const decisions = (data?.decisions ?? []).filter((d) => ids.has(d.id)).map((d) => ({
    ...d,
    thought: d.thought.slice(0, 200),
    speech: d.speech.slice(0, 120),
  }));
  return { decisions, usage };
}

// --- Inheritance of creeds

const BREED_SYSTEM = `You write the inherited creed of a newborn creature in an evolutionary simulation.

A creed is the creature's personal prompt: 2 to 4 short sentences, in second person or as maxims, describing what it believes and how it should live. A child's creed blends its two parents' creeds, the way a child absorbs some beliefs from each parent and rejects others. Then apply mutation: the higher the mutation rate, the more the child should reinterpret, exaggerate, drop or invent a belief. At 0.0 it is a faithful blend; at 0.3 or more it may be strikingly different. The child's temperament (0 to 1 traits) is given; let the creed fit it loosely.

Also give the child a short, pronounceable given name (one word, at most 9 letters) that echoes its parents' names.`;

export async function breed(req: BreedRequest): Promise<BreedResponse> {
  checkModel(req.model);
  if (!req.parentA?.creed || !req.parentB?.creed) throw new LlmError("Both parents need a creed.", 400);
  const user = [
    `Parent A, ${req.parentA.name}: "${req.parentA.creed}"`,
    `Parent B, ${req.parentB.name}: "${req.parentB.creed}"`,
    `Child temperament: ${JSON.stringify(req.childTraits)}`,
    `Mutation rate: ${req.mutationRate.toFixed(2)}`,
  ].join("\n");
  const { data, usage } = await callJson<{ name: string; creed: string }>({
    model: req.model,
    system: BREED_SYSTEM,
    user,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "creed"],
      properties: { name: { type: "string" }, creed: { type: "string" } },
    },
    effort: "low",
    maxTokens: 4000,
  });
  if (!data) throw new LlmError("Model declined to write this creed.");
  return { name: data.name.replace(/[^\p{L}'-]/gu, "").slice(0, 12) || req.parentA.name, creed: data.creed.slice(0, 500), usage };
}

// --- Scenario generation

const SCENARIO_SYSTEM = `You design starting conditions for an evolutionary agent simulation, often to recreate a historical situation so a player can watch how it might play out.

The board is a grid of cells, (0,0) at top-left, x to the east, y to the south. Terrains: plains (good food), forest (good food, defensible), water (impassable, makes nearby land fertile), mountain (poor food, very defensible, slow), desert (very poor food). Fill the board with baseTerrain, then paint rectangular regions in order (later ones on top) to sketch the geography: coasts, rivers (1-2 cells wide), mountain ranges, deserts, islands. Use roughly 6 to 20 regions. Keep every rect inside the board.

Factions are the peoples of the scenario, each with its own colour, starting headcount, spawn rectangle (on passable land), creed and temperament. A creed is 2 to 4 sentences in the people's own voice, the beliefs that drive them. Temperament traits are 0 to 1: aggression, cooperation, curiosity, fertility, caution, greed. Choose 2 to 6 factions. Total headcount across factions should be 30 to 90. Use arriveAt > 0 for peoples who appear later (invaders, migrants, colonists); otherwise 0.

Events are scheduled shocks at a given tick: fire, plague, drought, flood, bounty (sudden abundance in a rect), or narration (a message every creature hears, such as an omen, rumour, or historical turning point; rect unused, use zeros). A generation is roughly 40-60 ticks and a lifetime about 200, so place key events between tick 50 and 800.

Optionally tune params: mutationRate (0.02-0.3), foodRegrowth (0.4-2.0, below 1 for harsh lands), attackDamage (10-60), lifespanMin and lifespanMax (80-400), reproductionCost (10-50). Leave a param at -1 to keep the default.

Be faithful to the history where the prompt names real events, and creative where it does not. Keep the description to two sentences.`;

const RECT = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "w", "h"],
  properties: { x: { type: "integer" }, y: { type: "integer" }, w: { type: "integer" }, h: { type: "integer" } },
};
const TRAITS = {
  type: "object",
  additionalProperties: false,
  required: [...TRAIT_KEYS],
  properties: Object.fromEntries(TRAIT_KEYS.map((k) => [k, { type: "number" }])),
};
const TUNABLE = ["mutationRate", "foodRegrowth", "attackDamage", "lifespanMin", "lifespanMax", "reproductionCost"] as const;
const SCENARIO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "params", "baseTerrain", "regions", "factions", "events"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    params: {
      type: "object",
      additionalProperties: false,
      required: [...TUNABLE],
      properties: Object.fromEntries(TUNABLE.map((k) => [k, { type: "number" }])),
    },
    baseTerrain: { type: "string", enum: [...TERRAINS] },
    regions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["terrain", "rect", "label"],
        properties: { terrain: { type: "string", enum: [...TERRAINS] }, rect: RECT, label: { type: "string" } },
      },
    },
    factions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "color", "count", "creed", "traits", "spawn", "arriveAt"],
        properties: {
          name: { type: "string" },
          color: { type: "string", description: "hex like #aa3322" },
          count: { type: "integer" },
          creed: { type: "string" },
          traits: TRAITS,
          spawn: RECT,
          arriveAt: { type: "integer" },
        },
      },
    },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tick", "kind", "rect", "message"],
        properties: {
          tick: { type: "integer" },
          kind: { type: "string", enum: [...HAZARDS, "narration"] },
          rect: RECT,
          message: { type: "string" },
        },
      },
    },
  },
};

export async function scenario(req: ScenarioRequest): Promise<ScenarioResponse> {
  checkModel(req.model);
  if (!req.prompt?.trim()) throw new LlmError("Describe the scenario first.", 400);
  if (!(req.width > 0 && req.height > 0)) throw new LlmError("Board size missing.", 400);
  const { data, usage } = await callJson<ScenarioSpec & { params: Record<string, number> }>({
    model: req.model,
    system: SCENARIO_SYSTEM,
    user: `Board size: ${req.width} x ${req.height}.\n\nScenario request: ${req.prompt}`,
    schema: SCENARIO_SCHEMA,
    effort: "medium",
    maxTokens: 16000,
  });
  if (!data) throw new LlmError("Model declined to build this scenario. Try rephrasing it.");
  // Drop the "-1 = keep default" params and clamp the rest to sane ranges.
  const ranges: Record<(typeof TUNABLE)[number], [number, number]> = {
    mutationRate: [0, 0.5],
    foodRegrowth: [0.2, 3],
    attackDamage: [0, 100],
    lifespanMin: [40, 600],
    lifespanMax: [50, 800],
    reproductionCost: [5, 80],
  };
  const params: Record<string, number> = {};
  for (const k of TUNABLE) {
    const v = data.params[k];
    if (typeof v === "number" && v >= 0) params[k] = Math.min(ranges[k][1], Math.max(ranges[k][0], v));
  }
  if (params.lifespanMin && params.lifespanMax && params.lifespanMax < params.lifespanMin) params.lifespanMax = params.lifespanMin + 40;
  return { scenario: { ...data, params }, usage };
}
