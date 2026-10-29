# Primordia

An evolutionary "game of life" where every creature is an agent with a survival mandate, a heritable
temperament, and a natural-language **creed** (its personal prompt). Agents forage, mate, fight, share,
migrate and talk; children inherit a blend of their parents' traits and creeds, plus mutation. You
play god: set the laws of nature, paint the land, unleash fire/plague/drought/flood, speak to every
mind at once, or describe a historical scenario and let Claude build the world.

## Run it

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY (optional: instinct mode works without it)
npm run dev               # http://localhost:5173
```

`npm run sim -- 1500 7 bronze` runs a world headless (ticks, seed, optional preset name) to check balance.

## How it works

| Layer | What it does |
|---|---|
| **Genome** (`src/sim/genome.ts`) | Six traits in [0,1] — aggression, cooperation, curiosity, fertility, caution, greed — plus a creed and tribe colour. Children get uniform crossover + gaussian mutation; creeds are spliced locally or blended by Claude. |
| **Instinct** (`src/sim/engine.ts`) | A trait-weighted utility choice of intent every tick. Free, deterministic per seed, and always running. |
| **Mind** (`src/mind.ts`, `server/llm.ts`) | In *Claude minds* mode, each agent consults Claude every N ticks (batched, several agents per request). Claude sees the agent's creed, traits, surroundings, neighbours, memories and anything said nearby, and returns an intent, target, inner thought and optional speech. Instinct carries out the plan tick by tick. |
| **World** (`src/sim/world.ts`) | Terrain with food that regrows by season (faster near water), and timed hazards. |
| **Scenarios** (`src/sim/presets.ts`, `/api/scenario`) | Map regions, factions (creed, traits, spawn area, arrival time) and scheduled events. Three presets ship; Claude generates new ones from a prompt, and they are saved in the browser. |

Selection pressure is real: food is scarce, so temperaments that out-reproduce others take over. Watch it in the
**Charts** tab (average temperament over time, tribe composition) or colour the board by any trait.

## Cost control

Claude calls happen only in *Claude minds* mode. The Minds panel controls the model, how often agents think,
batch size, parallel requests and a **USD budget**. Once the budget is reached, agents fall back to instinct. A rough guide:
cost per tick ≈ (population ÷ think interval ÷ batch size) requests. *Lockstep* makes time wait for every mind
(the most faithful, and the slowest).
