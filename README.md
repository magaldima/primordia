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

`npm run sim -- 1500 7 bronze` runs a world headless (ticks, seed, optional preset name, or `random`). Add `--export run.json` to save it.

**Analysing runs.** In the app, **Export run** downloads a JSON file: the full time series, political tallies, the archive of important events, the historian's reports, and snapshots of peoples, organizations, faiths, the Hall of the Dead and every living agent. Then:

```bash
npm run analyze -- run.json              # how one world changed over time
npm run analyze -- a.json b.json c.json  # how far several worlds diverged
```

## How it works

| System | What it does |
|---|---|
| **Genome & phenotype** (`src/sim/genome.ts`, `src/sim/life.ts`) | Six inborn traits in [0,1] (aggression, cooperation, curiosity, fertility, caution, greed) plus a creed. Behaviour uses the **phenotype**: genotype + a shift for the stage of life + accumulated experience (witnessing a killing, being fed, being cheated…). The young are the most malleable. Only the genotype is inherited. |
| **Lifespan & frailty** | Each agent is born with a potential lifespan. The actual one changes over its life: mastery of medicine lengthens it (up to the *Medicine's power over death* law), while lasting **wear** from wounds, plague, hunger and witnessed violence shortens it. Rest, healers and medicine mend wear. Elderhood begins late in the *actual* life, so long lives mean long working years and long elderhoods. Elders keep **reflecting** (deepening what they know) and teach better with age. As they near the end they grow **frail**: admired less, their followers drift away. |
| **Succession** | An ageing leader names an **heir**; a frail one hands power over while it can. With no heir, succession is **contested** and a strong rival may lead a **schism**. Loyalty can also shift to someone else while the leader is still hale. |
| **Stages of life** | **Child**: plays near its parents and is nursed by them; can't forage, fight or mate. **Adolescent**: bold, curious, may defy elders' teaching, and discovers fastest. **Adult**: works, trades, mates (pair bonds) and provides for family. **Elder**: doesn't forage, fight or mate; is fed by kin out of respect, and teaches. |
| **Truth seeking** (`shared/truths.ts`, `src/sim/knowledge.ts`) | Agents are *not* told the rules. They build understanding in six domains (ecology, seasons, medicine, conflict, exchange, kinship) from lived experience. Levels are unbounded and each costs more than the last. Each level is a true statement about the world and gives a real survival edge. Teaching writes knowledge into the **tribe's canon**, which children absorb, so later generations start ahead. The canon is lost if the tribe dies out. |
| **Insights** (`/api/judge`) | Claude minds can voice insights. A judge checks them against the real laws: true ones speed up learning, false ones spread as **myths**, and convictions about purpose become **sayings**. The agents can't tell these apart; the Inspector and Tribes tab show you which is which. |
| **Science** (`shared/tech.ts`) | 16 inventions in a tree: Agriculture, Storage, Irrigation, the Plough, the Calendar, Herbalism, Surgery, Sanitation, Metalwork, Weaponry, Ironworking, the Wheel, Writing, Mathematics, Currency, Law. Each needs understanding in some domains plus the inventions it builds on, and each has real effects. **Research** is an activity for the well fed, healthy and secure. It is faster with colleagues, and organizations can pool it into shared projects. Without **Writing**, a tribe's knowledge is oral: it erodes, and inventions nobody alive remembers are **forgotten**. With Writing it persists, and the literate learn from records alone. |
| **Specialization** | Four crafts: rations, tools, medicine and **weapons**. Skill comes from practice and output from invention (bronze and iron weapons, herbal medicine, iron tools). **Currency** removes the need for both sides of a trade to want each other's goods. |
| **Language** | Each tribe starts with its own tongue. Everyone's speech drifts a little over time, and contact (trade, teaching, marriage, shared organizations) blends tongues, so separated peoples diverge and mingling peoples converge. How well two agents understand each other scales teaching, trade, bonding and loyalty to a leader. |
| **Collective action** | A leader sets its organization's **aim**: research (a pooled project toward one invention), **war** against a named organization or tribe, farming, trade, or peace. Members take it up according to loyalty and how well they understand the leader. **Law** makes successions far more orderly. |
| **Farming** | Planted fields belong to the planter and pass to its family at death. Crops ripen with the seasons and need tending, and harvests are far richer than wild land. Taking another's crops is theft. Without Storage, rations rot. Farmers settle around their fields, and surplus and property feed into leadership (people follow those who can feed and protect them). |
| **Faith** (`src/sim/religion.ts`) | **Belief only: the world has no afterlife.** Every agent keeps a ledger of deeds. Religions arise among the grieving and devout, in different kinds (warrior, ascetic, ancestral, merchant, fertility), each with its own moral code, heaven and hell. Faiths spread through parents, teaching and organizations. Communion with fellow believers renews faith, while curiosity, literacy and learning erode it. Large faiths split into **sects** with reformed codes. Believers are held back from what their faith calls sin (a "watchful god" most of all) and drawn to its virtues, including holy war. At death each believer's ledger is weighed by its own faith, and the **Hall of the Dead** records where it believed it was going. |
| **Peoples** | New peoples emerge (**ethnogenesis**) from long-lived organizations or communities whose speech has drifted from their kin's. They inherit the old canon and gain their own name, colour and tongue. |
| **Realms** | Killing an enemy leader in war **conquers** its organization: it becomes a tribute-paying vassal. Friendly organizations of the same faith or tongue **ally**. Realms fight as one, and resentful vassals **revolt**. |
| **Geography & culture** | Ore, clay and healing herbs lie in regional patches; some inventions need materials an agent has seen, and each world's tech tree varies a little, so peoples take different paths. Creeds and norms shape temperament even in instinct mode, and leaders keep coining and reshaping norms from an open-ended grammar. Cheats are cast out, standing recovers slowly, cohesive groups fight and research better, and discoverers are honoured. |
| **Limits & exodus** | There is no cap on births. Population is held in check by the land: wild food is eaten bare, each harvest wears a field's soil (it recovers only fallow), and sickness breaks out where people crowd together. When the land can't feed them, agents **emigrate**, walking off the edge of the board with their young children; a leader's call can become an exodus. A high hard limit (*Safety limit*, default 3,000) exists only to keep the browser responsive. |
| **Power struggles** | Ambition (aggressive, greedy, uncooperative temperaments) makes succession rough. When a leader dies, steps down or is **challenged**, rival claimants (even against a named heir) plunge the group into **crisis**: no one leads, partisans fight (though rarely their own kin), the common store is looted, and the cautious flee. It ends when one claimant wins two-thirds backing (usually weeks later); strong losers lead **schisms**, weak ones are **purged** or submit, and victors **overturn norms**. The *Strife* law scales all of this, from orderly (0) to brutal (2). |
| **Economy** | Crafts (rations, tools, medicine) improve with practice, so specialists emerge. Trades are a **prisoner's dilemma**: both sides agree, then each secretly honours or reneges. Cheating costs **standing** within the tribe and earns grudges. Low standing means fewer trade partners and mates, and less attention when teaching. |
| **Society** (`src/sim/social.ts`) | Agents form **bonds** through kinship, gifts, teaching, trade, betrayal and violence. Each freely chooses whom to **follow**, by personal feeling and by what its temperament admires (knowledge, strength, generosity or popularity), so different kinds of leaders emerge. **Organizations** have whatever name and purpose their founders give them. They crystallise around anyone with a following, or are founded, joined and left by minds. **Leadership** is simply whoever most members follow, so successions and coups happen on their own. Members answer the leader's call, fight better together, and pool food in a common store that feeds the hungry. Leaders' free-text **decrees** become norms that shift members' temperament (the judge rates each one), so shared culture shapes behaviour. |
| **Annals** (`src/sim/digest.ts`, `/api/historian`) | Every N ticks, or on demand, a historian reads a digest of the world: key numbers and their trends, causes of death, tribes and canon, organizations and leaders, notable events, warning signs, and its own previous report. It writes an era report: narrative, trends, figures of the age, risks, opportunities, and predictions it reviews next time. It runs even when agents are on instinct, at roughly one call per report. |
| **Instinct** (`src/sim/engine.ts`) | A stage- and temperament-weighted utility choice every tick. Free, and deterministic for a given seed. |
| **Minds** (`src/mind.ts`, `server/llm.ts`) | Optional. Agents with a mind consult Claude on a schedule set **per stage of life** (by default children never think, adolescents think shallowly, elders most deeply) and **per tribe model**. Requests are batched by model and effort. |
| **World** (`src/sim/world.ts`) | Terrain with seasonal food regrowth (faster near water) and timed hazards. |
| **Scenarios** (`src/sim/presets.ts`, `/api/scenario`) | Presets, Claude-generated historical scenarios, and the observation-only **Petri dish** (1–4 founders with exact traits, creeds and models). |

The **Charts** tab tracks population by stage, knowledge (the average person vs. the best tribe's canon), knowledge by generation, organization, trust in trades, and inborn temperament over time. Turn on **Ties** above the board to see who follows whom; leaders are ringed in gold.

Press `[` and `]` (or the arrows in the top bar) to hide the side panels and enlarge the board. The bar at the bottom shows spending against your budget, the estimated cost per 100 ticks, requests, tokens and the historian's next report.

## Cost control

Claude calls happen only in *Claude minds* mode. The Minds panel controls the default model, the share of agents with minds, the effort and frequency for each
stage of life, batch size, parallel requests and a **USD budget**. You can assign a different model to each tribe in the Tribes tab. Once the budget is reached, agents fall back to instinct. A rough guide:
cost per tick ≈ (population ÷ think interval ÷ batch size) requests. *Lockstep* makes time wait for every mind
(the most faithful, and the slowest).
