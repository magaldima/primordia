import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DIRECTIONS,
  DOMAINS,
  EFFORTS,
  GROUP_ACTIONS,
  GROUP_AIMS,
  HAZARDS,
  INTENTS,
  MODELS,
  TERRAINS,
  TRADE_STANCES,
  TRAIT_KEYS,
  type BreedRequest,
  type BreedResponse,
  type Decision,
  type HistorianRequest,
  type HistorianResponse,
  type Report,
  type JudgeRequest,
  type JudgeResponse,
  type ScenarioRequest,
  type ScenarioResponse,
  type ScenarioSpec,
  type ThinkRequest,
  type ThinkResponse,
  type Usage,
} from "../shared/types";
import { worldLawsText } from "../shared/truths";

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

const MIND_SYSTEM = `You are the inner voice of several creatures living in a simulated world, a "game of life" where natural selection acts on personalities and culture.

Each creature, like a human, wants to survive and to see its line continue. It also seeks the truth: it wants to understand how its world really works and what its life is for. It knows it is mortal and has limited time, so what it learns dies with it unless it is taught to the young. No one ever learns everything; there is always more to discover. It does not know it is in a simulation, and nobody has told it the rules of its world. It knows only what it has experienced, been taught, or worked out, and some of what it believes may be wrong.

Each creature has a creed (beliefs handed down through its ancestors, slightly changed each generation) and a temperament (0 to 1: aggression, cooperation, curiosity, fertility, caution, greed). Temperament shifts with age and with what the creature has lived through. Let creed, temperament, stage of life and experience colour what each creature wants. Creatures are not all wise; they can be fearful, spiteful, loyal, rash, or wrong.

Stages of life:
- child: plays near its parents and lives on what they give it. It mostly absorbs; its thoughts are simple.
- adolescent: bold, curious, restless. It takes risks, questions what elders say, and explores. It cannot yet have children.
- adult: works, trades, raises a family and provides for its partner and children.
- elder: no longer gathers food, fights or has children. It is fed by those who respect it, and its purpose is to pass on what it knows.

Possible intents (each creature may only choose from its own allowedIntents):
- forage: find and eat food nearby
- explore: wander in search of new land and new knowledge
- migrate: travel steadily in a direction (set direction)
- seek_mate: find a partner and have a child (target a neighbour by name, or "" for anyone suitable)
- attack: fight a creature (target, or "" for the nearest stranger)
- share: give food to someone, e.g. a hungry child, partner or elder (target, or "" for the neediest)
- flee: get away from threats and danger
- rest: stay still and conserve strength
- rally: gather with its own tribe
- hoard: stay on a rich patch and eat greedily
- work: practise its craft (making rations, tools or medicine) to have goods to use or trade
- trade: exchange spare goods with someone who has what it needs (target, or "")
- teach: pass what it knows to the young of its tribe
- research: study, experiment and think toward a new invention (only possible when well fed, healthy and safe; faster with colleagues, and an organization can pool its research)
- emigrate: leave the known world for good, walking off the edge of the land with its young children, when this land can no longer feed it (a leader's call to emigrate can become an exodus)
- farm: (only once it knows agriculture) plant, tend and harvest its own fields; crops need tending, ripen with the seasons, and yield far more than wild land
- play: (children) play close to its parents

Creatures are social beings. Each has bonds (warm or cold feelings toward others), may look up to and follow someone, and may belong to an organization. Nobody has told them how to organize. They are free to follow anyone or no one, to found organizations of any kind for any purpose (a band, a council, a school, a guild, a faith, a family alliance, anything), to join or leave them, and to challenge leaders by following someone else. A leader is simply whoever most members follow. Members tend to answer their leader's call, pool food in a common store that feeds the hungry, fight better together, and absorb their group's norms. A leader may issue decrees: new norms or instructions for the group, in its own words. Bodies wear out: wounds, sickness, hunger and the strain of violence shorten a life, while skill in medicine and peaceful, well-fed living lengthen it. As elders grow frail they lose their sway, and followers drift to others. A leader who is ageing may name an heir; a frail leader hands power to its heir, and a group with no heir faces a contested succession that can split it apart. A long life is also a long time to teach. Power is rarely handed over peacefully: when a leader dies, steps down or is challenged, the ambitious may claim leadership and the group falls into a struggle in which partisans fight, the common store is looted and the cautious flee. A struggle ends only when one claimant wins clear backing; losers may walk out with their people, be driven out, or submit, and a new leader may overturn the old norms. In a struggle, choosing whom to follow is choosing a side; attacking a rival claimant or its partisans is how power is seized by force. Let social choices follow from bonds, temperament, creed, needs and what the creature admires; don't organize for the sake of it, and don't refuse to.

Creatures can invent things by research (inventions they know, and those within reach, are listed) and pass them on by teaching. Without writing, what a people knows lives only in memory and fades; inventions nobody alive remembers are lost. With writing, knowledge is kept in records the literate can read. Peoples speak different tongues: those who share a tongue understand each other best, while foreign tongues make teaching, trade and loyalty harder; tongues blend through contact and drift apart in isolation. Organizations can work together on a shared aim: research (pooling progress toward one invention), war (against a named rival organization or tribe), farming, trade, or making peace. Fields belong to whoever planted them and pass to their family at death; anyone may harvest the fields of their family or organization, but taking crops from anyone else's field is theft and is remembered. Without pots and granaries, stored food rots.

Some creatures hold a faith: a belief that gods watch, that some deeds are good and others evil, and that after death each soul goes to a heaven or a hell. Nobody knows whether this is true. Faiths differ in what they call good and evil; they spread by teaching, from parents to children and through organizations, and they split into sects. A believer weighs its deeds against its faith's teaching; a creature may also found a new faith, convert, or lose its faith. New peoples can arise from old ones. Organizations can conquer others (who then pay tribute), ally with them, or revolt against an overlord.

About trade: two creatures agree a swap, but when the moment comes each privately chooses to honour the deal or keep its goods and take the other's. Cheating gains goods once; being caught cheating costs standing in the tribe, and those cheated remember. tradeStance sets how this creature behaves when a trade comes due: "honest", "cheat", or "reciprocal" (honest with those who seem honest, cheats those who cheated it or have a bad name).

Output for each creature:
- thought: one short first-person sentence in its own voice. A child's is simple; an elder's can be deep.
- speech: something said aloud to those nearby (they will hear it) or "". Elders teaching and anyone with something to tell may speak; most of the time, stay silent.
- insight: only if this creature has genuinely noticed or concluded something new about how its world works, or come to a conviction about what life is for, put it in one plain sentence; otherwise "". Base it on what it has experienced. It may turn out to be wrong. Most of the time leave it "".
- follow: the exact name of someone to look up to and follow (a neighbour or someone it has bonds with), "nobody" to stop following, or "" to leave things as they are (the usual case).
- groupAction: "found" (name a new organization in groupName and say what it is for in groupPurpose), "join" (an existing nearby organization, named in groupName), "leave" (its current one), or "none" (the usual case).
- decree: only if it leads its group, a new norm or instruction for its members in one sentence; otherwise "".
- groupAim: only if it leads its group, set what the group works toward together: "research", "war", "farm", "trade" or "peace" (end a war); "none" to keep the current aim (the usual case). aimTarget: for research, the invention to pursue (from what is within reach); for war, the exact name of the rival organization or tribe; otherwise "".
- religionAction: "found" a new faith (give religionName and a doctrine saying what is good, what is evil and what follows death), "convert" to a faith held nearby (give its exact religionName), "renounce" one's faith, or "none" (the usual case). Otherwise religionName and doctrine are "".
- heir: only if it leads its group, the exact name of a member it chooses to succeed it (worth doing once it is ageing or frail, if none is named yet); otherwise "".
- target must be the exact name of a listed neighbour or "". direction is used by migrate (otherwise "none").

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
        required: ["id", "thought", "intent", "target", "direction", "speech", "tradeStance", "insight", "follow", "groupAction", "groupName", "groupPurpose", "decree", "heir", "groupAim", "aimTarget", "religionAction", "religionName", "doctrine"],
        properties: {
          id: { type: "integer" },
          thought: { type: "string" },
          intent: { type: "string", enum: [...INTENTS] },
          target: { type: "string" },
          direction: { type: "string", enum: [...DIRECTIONS] },
          speech: { type: "string" },
          tradeStance: { type: "string", enum: [...TRADE_STANCES] },
          insight: { type: "string" },
          follow: { type: "string" },
          groupAction: { type: "string", enum: [...GROUP_ACTIONS] },
          groupName: { type: "string" },
          groupPurpose: { type: "string" },
          decree: { type: "string" },
          heir: { type: "string" },
          groupAim: { type: "string", enum: ["none", ...GROUP_AIMS] },
          aimTarget: { type: "string" },
          religionAction: { type: "string", enum: ["none", "found", "convert", "renounce"] },
          religionName: { type: "string" },
          doctrine: { type: "string" },
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
    thought: d.thought.slice(0, 240),
    speech: d.speech.slice(0, 140),
    insight: d.insight.slice(0, 200),
    groupName: d.groupName.slice(0, 40),
    groupPurpose: d.groupPurpose.slice(0, 200),
    decree: d.decree.slice(0, 200),
  }));
  return { decisions, usage };
}

// --- Judging insights against the world's real laws

const JUDGE_SYSTEM = `You check claims made by creatures in a simulated world against the world's actual laws, listed below. The creatures have never been told these laws; they are guessing from experience.

For each claim, decide:
- kind: the domain (ecology, seasons, medicine, conflict, exchange, kinship) whose laws the claim is about, if it is a factual claim about how the world works. Use "meaning" if it is a conviction about purpose, value or how one ought to live, which cannot be checked against the laws. Use "none" if it is not really a claim (a feeling, a plan, a greeting, or empty).
- accurate: for a factual claim, true if it agrees with the laws (it may be partial or roughly worded, but must not contradict them or invent effects the laws don't have); false if it is wrong or unsupported. For "meaning" and "none", false.

You will also be given norms: rules or instructions that leaders have decreed for their groups. For each norm, rate how living by it would push a member's temperament on each trait, from -1 (strongly away) to 1 (strongly toward), 0 if unrelated: aggression, cooperation, curiosity, fertility, caution, greed.

THE LAWS OF THE WORLD:
${worldLawsText()}`;

export async function judge(req: JudgeRequest): Promise<JudgeResponse> {
  checkModel(req.model);
  const insights = Array.isArray(req.insights) ? req.insights : [];
  const norms = Array.isArray(req.norms) ? req.norms : [];
  if (!insights.length && !norms.length) throw new LlmError("Nothing to judge.", 400);
  const { data, usage } = await callJson<{ verdicts: JudgeResponse["verdicts"]; normEffects: JudgeResponse["normEffects"] }>({
    model: req.model,
    system: JUDGE_SYSTEM,
    user: [
      "CLAIMS:",
      ...insights.map((i) => JSON.stringify({ id: i.id, claim: i.text })),
      "NORMS:",
      ...norms.map((n) => JSON.stringify({ id: n.id, norm: n.text })),
    ].join("\n"),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["verdicts", "normEffects"],
      properties: {
        verdicts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "accurate"],
            properties: {
              id: { type: "integer" },
              kind: { type: "string", enum: [...DOMAINS, "meaning", "none"] },
              accurate: { type: "boolean" },
            },
          },
        },
        normEffects: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", ...TRAIT_KEYS],
            properties: { id: { type: "integer" }, ...Object.fromEntries(TRAIT_KEYS.map((k) => [k, { type: "number" }])) },
          },
        },
      },
    },
    effort: "low",
    maxTokens: 8000,
  });
  const ids = new Set(insights.map((i) => i.id));
  const normIds = new Set(norms.map((n) => n.id));
  const clampTrait = (v: unknown) => Math.max(-1, Math.min(1, Number(v) || 0));
  return {
    verdicts: (data?.verdicts ?? []).filter((v) => ids.has(v.id)),
    normEffects: (data?.normEffects ?? [])
      .filter((n) => normIds.has(n.id))
      .map((n) => ({ id: n.id, ...Object.fromEntries(TRAIT_KEYS.map((k) => [k, clampTrait(n[k])])) }) as JudgeResponse["normEffects"][number]),
    usage,
  };
}

// --- The historian: periodic analysis of the world

const HISTORIAN_SYSTEM = `You are the historian of a simulated world: an evolutionary "game of life" in which a population of agents is born, grows up, learns, trades, organizes, follows leaders, builds shared culture, fights and dies across generations. Periodically you are given a digest of the world (statistics with their trends, the organizations and their leaders, the state of knowledge and culture, notable events since your last report, and your previous report) and you write the next entry in its annals.

Write as an insightful historian and analyst, not a stenographer. Explain what is happening and why: connect causes to effects across the numbers and the events, notice what is emerging (forms of organization and leadership, collective strategies, cultural drift, the spread of truths and myths, cooperation and betrayal), and say what it means for the world's future. Ground every claim in the digest; name specific agents, groups and tribes. Be concrete and vivid but brief.

- title: a headline for this report.
- era: a short evocative name for the age the world is now in.
- narrative: 2 to 4 short paragraphs (separate them with blank lines): what happened in this period, and the forces shaping it.
- trends: 3 to 6 key movements, each with direction and a one-sentence explanation.
- leaders: up to 4 figures who matter now, their role, and an assessment of their influence or legacy.
- risks: 2 to 4 threats to the world or its peoples, each with a likelihood and why.
- opportunities: 1 to 3 openings that could change the world's course.
- predictions: 2 to 4 concrete, checkable predictions for the next period.
- review: if a previous report is included, a candid sentence or two on which of its predictions came true and which did not; otherwise "".`;

const HISTORIAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "era", "narrative", "trends", "leaders", "risks", "opportunities", "predictions", "review"],
  properties: {
    title: { type: "string" },
    era: { type: "string" },
    narrative: { type: "string" },
    trends: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "direction", "detail"],
        properties: { label: { type: "string" }, direction: { type: "string", enum: ["up", "down", "steady"] }, detail: { type: "string" } },
      },
    },
    leaders: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "assessment"],
        properties: { name: { type: "string" }, role: { type: "string" }, assessment: { type: "string" } },
      },
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "likelihood", "detail"],
        properties: { label: { type: "string" }, likelihood: { type: "string", enum: ["low", "medium", "high"] }, detail: { type: "string" } },
      },
    },
    opportunities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "detail"],
        properties: { label: { type: "string" }, detail: { type: "string" } },
      },
    },
    predictions: { type: "array", items: { type: "string" } },
    review: { type: "string" },
  },
};

export async function historian(req: HistorianRequest): Promise<HistorianResponse> {
  checkModel(req.model);
  if (!req.digest?.trim()) throw new LlmError("Nothing to analyse yet.", 400);
  const { data, usage } = await callJson<Report>({
    model: req.model,
    system: HISTORIAN_SYSTEM,
    user: req.digest.slice(0, 60000),
    schema: HISTORIAN_SCHEMA,
    effort: "medium",
    maxTokens: 16000,
  });
  if (!data) throw new LlmError("The historian declined to write this report.");
  return { report: data, usage };
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
