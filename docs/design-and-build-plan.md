# Agnostic Narrator — Design and Build Plan

Nov 1, 2026

## Purpose and scope

The system is a genre-agnostic SillyTavern narrator run by two models in tandem: a narrator card that writes the story, and a director extension that holds state, plans and continuity. The chat shows only narration. Everything else lives in the extension.

The narrator reads whatever story material is loaded (character cards, world lorebooks), adopts its genre, and runs a long-form story with planned beats. The design draws on the Chinese card Jixia Zhuan (structured side output, summaries in place of history, code-owned state) and on six SillyTavern projects whose patterns are listed in Borrowed ideas. It copies no game layer.

**In scope**

- One narrator card that works with any story material, in solo or group chats
- One director extension, working with Tavern Helper and regex: state, memory summaries, continuity, planning, genre profile, injection, dynamic lorebook
- A minimal inspector for reading and editing state, plus a direct channel to the director
- A clean SillyTavern install as the target platform; any community extension added must meet the dependency criteria

**Out of scope**

- Game UI, dice, stats, shops, maps or any front-end client
- Authoring of story cards or world lorebooks (those stay as written)
- Community extensions that fail the dependency criteria

## Design principles

Nine principles govern every component. Each is stated once; components below apply them rather than restate them.

1. **The narrator narrates, the director administers.** The narrator owns the moment: prose, dialogue, how characters react. The director owns truth and the future: canon, world state, beliefs, the plan.
2. **The player's latest action beats the plan.** The narrator follows the player. The director reconciles afterwards and re-plans.
3. **Model proposes, code disposes.** The director's models output coarse, enumerated changes with evidence. Extension code validates, applies and clamps them. No model edits state directly.
4. **Fact, plan and belief never share a container.** Canon holds what happened. Beats hold what might happen. Each character's knowledge holds what they believe, true or not.
5. **Need-to-know.** Every reader gets a declared slice of context. The narrator sees the current intent, never the full plan. Each director module sees only what its job needs; the extractor never sees the plan.
6. **Authored material stays untouched.** Story cards and world lorebooks are read, never written. All runtime writes go to per-message records, chat metadata or a chat-bound dynamic lorebook.
7. **Nothing counts until accepted.** The latest reply's changes are provisional. Swiping or deleting it discards them. They commit when the player replies, and only committed changes reach the dynamic lorebook.
8. **Graceful degradation.** Without the extension, the card still works as a plain narrator. When the director is slow or fails, the story carries on.
9. **Clean install first.** The target is a fresh SillyTavern with built-in features only. A community extension is added only when it meets the dependency criteria, or as a recorded exception; otherwise the job is built into the director.

## Architecture overview

The narrator model and the director's models share one story through three channels: the reply, the brief, and World Info.

&#91;embedded content: architecture · narrator, eleven director modules, three channels\]

Only the narrator writes to the chat. The director reads each reply, holds its changes as provisional until you reply, and answers with one short brief. Both lorebooks reach the narrator through World Info, triggered in part by the brief's own words.

## Component specs

The system is one narrator card, one director with eleven modules, and two storage layers: per-message records and chat metadata. A fixture suite for testing director models ships separately as a dev tool.

### Narrator card

The card holds identity and function only. Prose craft lives in the preset; genre craft lives in the narrator's baseline lorebook.

| Field | Content |
| --- | --- |
| Description | Identity, authority, cast interpretation, player boundary, notes handling, content boundaries, output rule |
| Personality | Empty. Her register comes from the genre profile, not a fixed voice |
| Scenario | Empty. The story material supplies it |
| First message | Solo opening: a neutral opener that hands over to the story's opening scene, or to a drafted opening |
| Group-only greeting | Group opening, in the CCv3 `group_only_greetings` field, read by the Group Greetings extension in group chats |
| Example dialogues | Empty, so no example voice competes with the genre profile |
| Bound lorebook | The baseline book: genre craft entries, each gated by `{{if}}` on a genre variable the director sets |
| Regex scripts | Strip leaked director text from saved replies and displayed reasoning, and hide it while streaming |

The description covers, once each:

- She is a storyteller outside the world unless given an in-world role.
- Joined cards describe separate characters. Their traits, histories and speech stay with each character.
- Not every present character speaks. Only those with a real contribution do.
- The player's actions, words, decisions and thoughts are the player's. A turn ends on a moment that needs the player.
- `<director_notes>` are guidance about the world. Never quoted, mentioned or referred to in prose.
- The content-boundary block, carried over from Jixia Zhuan unchanged in substance: unclear age is treated as underage.

### Group setup

Only the narrator is unmuted; the cast stays muted, so only she generates. How the cast reaches her depends on its size, because SillyTavern can send every member's card or only unmuted members' cards, never a chosen subset (`group-chats.js` 553).

| Cast size (narrator excluded) | Group mode | Who sends the cast | What the narrator gets |
| --- | --- | --- | --- |
| Up to the limit (default 4) | Join, including muted members | SillyTavern | Every cast card, `{{char}}` resolved per card |
| Above the limit | Swap (her card only), set by the extension | The extension | Full cards for characters present, short profiles for the rest, no example dialogues |

The extension re-checks the size when members are added or removed, and restores join mode when it is disabled, so the cast reaches the narrator either way.

**Greetings.** A fresh group chat posts the greeting of every member that has one, muted members included (`group-chats.js` 283–300). An extension can only replace a greeting, never suppress it: SillyTavern ignores an empty replacement (589–592). So cast cards used in a narrator group have empty greetings. The narrator card keeps its solo opening as its normal greeting and its group opening as a group-only greeting, which the Group Greetings extension posts instead in group chats. One narrator card then serves both. The extractor ignores any greeting not from the narrator.

**Macros.** The card uses `{{groupNotMuted}}` rather than `{{group}}`, which lists muted members as present.

### Director extension

Each module runs on a connection profile chosen in settings. By default all modules share one director profile; any module can use its own model and API. Calls go through the built-in Connection Manager and include that profile's own preset and instruct template, never the narrator's. Calls on one profile run one at a time; calls on different profiles run in parallel. The narrator model never sees a director prompt, and no director call sees the extension's own injections. The director's World Info scans are dry runs, so they advance no sticky or cooldown timers.

| Module | Kind | Runs | Reads | Writes |
| --- | --- | --- | --- | --- |
| Extractor | Model | After every reply | Latest reply, scene, cast, canon; never the plan | Provisional delta with quotes, turn summary, lore drafts |
| Summariser | Model | Every N turns | Older turn summaries | Rolled-up summary |
| Continuity checker | Model | After every reply | Delta, canon, beliefs | Corrections, flags |
| Spotlight scorer | Code | After every reply | Recent messages, present cast, talkativeness | Spotlight ranking |
| Brief writer | Model | After every reply | State, next beat, open clues, corrections, spotlight | `<director_notes>` for the next turn |
| Planner | Model | Every N turns, on deviation, at act boundaries, on request | State, summaries, arc | Scenes, beats, clues, endings, payoff |
| Genre profiler | Model | Chat start, on demand | Cards, scenario, active lore | Genre profile |
| Opening drafter | Model | Chat start, when no opening fits | Genre profile, chosen premise | Draft opening, premise |
| Profile generator | Model | When a card changes | One character card | Short character profile |
| Lore promoter | Code | When a reply commits | Committed lore drafts | Dynamic lorebook entries |
| Inspector and channel | Interface | On demand | Everything | Edits, retcons, player instructions |

### State model

Everything that changes during play is logged on a message, and current state is rebuilt from those logs. Chat metadata holds only the chat's integrity ID, the message ID index, setup values and a cache. Keys are ASCII.

**Per-message record** (`extra.narrator`, for the reply on screen)

```json
{
  "mid": "uuid",
  "status": "provisional | pending | committed",
  "delta": {"canon": [], "uncertain": [], "cast": {}, "threads": [], "scene": {}, "clues_found": []},
  "summary": "",
  "lore_drafts": [{"keys": [], "text": "", "supersedes": null, "quote": ""}],
  "planner": null,
  "profile_change": null,
  "retcons": [],
  "raw": "kept for the latest 20 messages only"
}
```

**Rebuilt state** (what modules read, each within its declared slice)

```json
{
  "genre": {"dominant": "", "secondary": [], "register": "", "pov": "", "priority": [], "stakes": "", "lethality": "", "tempo": "", "promises": [], "avoid": []},
  "premise": "",
  "arc": {"goal": "", "act": 1, "tension": "low",
          "payoff": {"name": "", "act": 3, "hooks": [{"text": "", "planted": false}]},
          "endings": [{"title": "", "outcomes": {"Name": ""}}]},
  "scenes": [{"id": "", "purpose": "", "if_unchallenged": [], "choice_points": [], "focus": {"Name": "emotional target"}}],
  "beats": [{"id": "", "scene": "", "intent": "", "precondition": "", "type": "pressure", "required": true, "status": "queued | complete | skipped",
             "clues": [{"id": "", "text": "", "route": "place | person | news | investigation", "where": "", "found": false}]}],
  "threads": [{"id": "", "status": "open", "setup": "", "payoff": "", "source": "mid"}],
  "scene": {"location": {"value": "", "established": false}, "time": {"value": "", "established": false},
            "present": [], "mood": "", "initiative": "player | world"},
  "cast": {"Name": {"stage": "guarded", "trust": "neutral", "tension": "none", "evidence": [],
                    "knows": [{"fact": "", "via": "present | told", "source": "mid"}], "profile": ""}},
  "canon": [{"fact": "", "quote": "", "source": "mid"}],
  "uncertain": [{"fact": "", "quote": "", "source": "mid"}],
  "summaries": {"recent": [{"text": "", "source": "mid"}], "rolled": ""},
  "tombstones": [{"fact": "", "source": "mid"}]
}
```

- **Provisional, pending, committed.** The latest reply's record is provisional. When a new swipe or regenerate starts, the record is cleared, because SillyTavern carries unknown `extra` keys into the new swipe; the new swipe then gets its own. A swipe is a rejection, so nothing from a rejected swipe is kept: swiping back to an earlier swipe clears the data SillyTavern restores with it and re-extracts that reply. When the player sends a message, the previous reply commits. If its extraction has not finished, the reply is marked pending and its delta commits when it arrives.
- **Logged per message.** Planner output, profile changes and retcon tombstones are recorded on the message that was latest when they were made. Replay and branches therefore see exactly the plan and retcons that existed at that point.
- **Stable message IDs.** SillyTavern has no stable message ID. The extension writes a UUID into each message's data and detects deletes by diffing its own index. Provenance uses that ID, never the position.
- **Branches.** The extension stores the chat's `integrity` ID. A different integrity ID on load means a branch or checkpoint: state is rebuilt from the branch's own messages and the dynamic lorebook is forked. Renaming a chat keeps the integrity ID, so it is not mistaken for a branch.
- **Provenance and quotes.** Every canon entry, discovery and lore draft records its source message and the exact quote behind it.
- **Established flags.** Location, time and similar fields stay unknown until the narration states them; they never take a default.
- **Rebuild by replay.** Current state = setup values plus every message's logged record, in order. Recomputed after a delete, edit, retcon or branch; cached otherwise. Changes are applied in memory and saved once. The chat variables mirrored from state are recomputed at the same time.
- **Hidden messages.** A hidden message leaves the prompt but not the story: its committed record stays, and re-extraction skips it.
- **Enums only for changes.** `stage`, `trust`, `tension`, thread `status`, beat `status` and `arc.tension` move by enumerated steps. A relationship stage moves one step only on evidence from two different categories.
- **Append-only canon.** Deltas only add to `canon`. Entries leave only by the player's edit, delete or retcon.

### Injection

The extension places its blocks where SillyTavern's prompt order makes sense of them. The premise, any injected cast and the summaries go before the chat history, in story order. The brief goes in chat at depth 1, system role, just before the player's latest message, so the player's action is the last thing the narrator reads (principle 2). Nothing is injected into impersonate or quiet generations, and dry runs change no state. When no brief is ready, a fixed note takes its place: the director is pending, so narrate from the chat.

```
<director_notes>
present: Ji Si, Qiantang Jun
location: Houshan
mood: uneasy calm
initiative: world
spotlight: Qiantang Jun
scene_intent: let the debt to the merchant surface naturally
pressure: low (last two scenes were tense)
clue: a creditor's seal on the gate (route open: place)
lore: merchant guild, Houshan gate
watch: Qiantang Jun does not know about the letter
correction: (only when the checker found one)
</director_notes>
```

The brief stays under about 300 tokens and carries the current beat's intent only, never the queue. Present names, the location and up to three named lore keys trigger story lore through World Info. Summaries cover only messages that have already left the prompt, before `{{firstIncludedMessageId}}`. All injected blocks together stay within a measured token cap, because SillyTavern trims chat history to fit but never trims injections.

**Notes in the brief.** Two kinds of note ride in the brief, each sent once. An operation note reports a state change made outside the story, such as an inspector edit, a `/director` state edit or a retcon, so the narrator reflects it without naming the tool. An outcome record carries a result the director settled itself, such as an off-screen event: who, what and the result. The narrator renders it in words, never numbers. Both patterns come from 天书江湖录.

**Brief placement.** The extension registers a `{{director_notes}}` macro that returns the current brief. The companion preset places it in its own prompt entry, in chat at depth 1, system role. For Claude and Gemini, whose converters turn every system message after the first into a user turn (`src/prompt-converters.js` 232, 432–462), the preset puts that entry in the system prompt instead, so the brief cannot merge with the player's message. If the active preset has no entry with the macro, the extension injects the brief at depth 1 itself. The card tells the narrator that `<director_notes>` never come from the player.

**Lore triggers.** World Info scans the brief through a scan-only prompt: an extension prompt with position none and scan on. World Info reads every scan-enabled extension prompt (`world-info.js` 4718–4724), but SillyTavern places none with position none in the prompt. So the brief's names, location and lore keys trigger story lore, and the brief is still sent once. This prompt is the only scanned block.

**Variables.** Public state (genre, register, mood, location, present cast, scene tension, each NPC's trust toward the player) is mirrored into one chat variable, `nar`. Card text and lore content read it with Tavern Helper's macros: `{{get_chat_variable::nar.mood}}` for one field, `{{format_chat_variable::nar}}` for a YAML block. Those macros run on the finished prompt (`panel/render/macro_like.ts` 105–113), after SillyTavern resolves `{{if}}` and after the World Info scan. So gating uses flat flags read by `{{if}}`: one per genre (`nar_genre_fantasy`) and one per band of public state (`nar_trust_jisi_high`, `nar_tension_high`). The extension computes the bands, so lore needs no EJS. Private state (beats, unopened clues, beliefs) is never mirrored, because any macro or `/listvar` can read variables.

### Dynamic lorebook

The director writes established facts into one chat-bound lorebook per playthrough, and nowhere else.

- **Commit point.** The extractor drafts lore entries, with quotes, in the provisional record. When the reply commits, the lore promoter copies the drafts into the book. Commit needs no model call.
- **Contents.** New characters, places, items, events, and changed world state. Never beats, plans or beliefs. The book is not bound as chat lore: the extension adds its entries when World Info loads, so the chat-lore slot stays free for the player.
- **Provenance and cleanup.** Each entry records its source message. Deleting that message removes the entry, or restores the previous version if the message only updated it.
- **Branches.** A branch gets its own copy of the book, holding only entries whose source messages exist in the branch.
- **Overrides.** A changed authored fact gets a superseding entry with the same keys, inserted after the authored one, worded as current state. An inclusion group with override is the cleaner option if a one-time group setting on the authored entry is acceptable.
- **Discipline.** Create only for things that recur or clearly matter. Update owned entries by ID rather than add near-duplicates. Cap entry length and new entries per pass. Recursion off.

### Genre profile

The profiler reads the joined cards, the scenario and active lore at chat start and fills the `genre` block: dominant and secondary genres, register, point of view, a priority order for what to protect when goals conflict, stakes, lethality, tempo, promises and things to avoid. The player confirms or edits it before the first scene. A blend can have its own genre entry. When the material has no suitable opening, the opening drafter writes one from the profile and a premise the player picks; the premise then stays in view every turn. A re-run is available when a new card joins or the story turns, and each change is logged on the latest message.

### Planner

The planner keeps a short horizon and plans possibilities, not a script. Arc setup is built in small calls (premise and opposing forces, characters, scenes, endings), then checked by a validation pass. Every planner output is logged on the latest message.

- **Arc.** One goal, the current act, one signature payoff with two or three setup hooks, and two or three possible endings. No ending is settled before the final act.
- **Scenes.** Each planned scene lists what happens if nobody intervenes, its choice points, and an emotional target per focus character. When the brief's initiative is world, the next of those events moves forward.
- **Beats.** Intent plus precondition, never a scripted event. Example: "If the player enters the city, a debt they cannot ignore surfaces." Each beat is required or optional; skipping an optional beat costs nothing. Types rotate: after two pressure beats the next is release or reward.
- **Clues.** A beat may carry clues, each offered only while its route (place, person, news or investigation) is open.
- **Triggers.** Every N turns (default 6), on deviation, at an act boundary, after a skipped required beat, or on request.
- **Deviation.** When the player goes off-plan, the plan bends. No beat is forced back.
- **Suggest mode.** Opt-in and off by default: the player picks the next beat from three to six candidates.

### Stats and social

Stats and relationships shape how characters act. They never reach the narrator as numbers, and nothing is rolled. Code turns them into words before each turn, and the narrator portrays them. The same rules hold for the player character and every NPC.

- **Scale.** The genre profile sets which stats matter and what they mean. The default follows NPC Codex: seven attributes, an untrained human at 30, and ranks that place a character's best attribute in a band (E 30–39, D 40–49, C 50–59, B 60–69, A 70–84, S 85–100, beyond for the very few). A slice-of-life story may track social stats only.
- **Starting values.** The profile generator derives each character's stats once, from the card or the persona: race and profession as modifiers on the human baseline, cached per world, and a rank band for the best attribute.
- **Changes.** Stats change only on narrated evidence, in small steps, with quotes. Temporary statuses (injury, poison, exhaustion, fear) worsen when untreated and ease with treatment. Code never kills a character.
- **Stats to words.** Before each turn the director writes a cast card per character: relationship band and tells, what the NPC will do unprompted, one phrase per stand-out stat, comparisons with everyone present, and any status. Examples: "quick and hard to track; quicker than the guard"; "normally heavy-handed, now weakened by venom". The feed below picks which lines reach the narrator.
- **The player character.** The PC has the same stats, and a cast card with an envelope: what is easy, a strain and beyond the PC in this world, from the genre scale. When the player attempts something opposed, code compares the stats and gives a tier: trivial, a strain, risky, or beyond. For an unopposed task, the narrator judges against the envelope. A strain succeeds at a cost; beyond fails or needs help. The player chooses what to attempt; the stats shape how it goes.
- **Relationships.** Each NPC holds trust, affection, desire and tension toward the player, moved by the weight of the evidence. Scores fall into bands: hostile, wary, neutral, warm, devoted. A band reaches the narrator as behaviour through the character's temperament: that character's own tells per band, drafted from the card, or a temperament table when the card gives none. NPCs also hold stances toward each other, changed only when both are present.
- **Identity first.** A relationship tints behaviour; it never replaces personality. Trust is not obedience, affection is not devotion, and tension does not imply jealousy. Wording stays within its band.
- **Consistency.** The continuity checker flags narration that contradicts stats, such as a slower guard catching a faster runner, and the next brief corrects it.

**The feed.** It runs in two steps, so it can react to the player's message without a wait.

1. **After each reply, in the background.** The brief writer prepares the brief and a cast card for every character present or likely to appear. These are the model calls, as before.
2. **When the player sends, in code.** SillyTavern adds the player's message to the chat, runs generate interceptors, and only then scans World Info (`script.js` 4453, 4564, 4635). The director's interceptor reads the message and finishes the brief in milliseconds. Stand-out ability lines for present characters always go in, whatever the exchange, because leaving one out costs more than its few tokens. In a large cast, full lines go to characters the player addresses and the spotlight pick; the rest get their relationship band only. The planner's scene type sets the order of lines, and the player's message adjusts it. An attempt tier is emitted only when the action, the named opponent and the stat that applies are all clear; otherwise no tier is sent, and the narrator judges against the PC envelope. A missing tier is a safe failure; a wrong one is not. Then it writes the brief behind `{{director_notes}}` and the scan-only prompt. It runs on send, swipe and regenerate, and skips quiet and impersonate generations and dry runs.

The brief after "Rowan vaults the wall and runs for the gate":

```text
<director_notes>
scene_intent: the debt to the merchant surfaces
cast:
- Ji Si, toward Rowan: warm (teases instead of praising; stays close); left arm injured
- Guard captain, toward Rowan: wary (polite, closed, watches before answering)
exchange: physical
- Rowan: quick and hard to track; quicker than the captain; the captain hits harder
attempt: vault and run, a strain for Rowan (high wall); outpacing the guards is easy
</director_notes>
```

The card states once that cast lines are established fact, and that the attempt tier limits the outcome, not the wording.

### Extraction rules

The extractor records only what the narration states, and never sees the plan. Every change carries an exact quote from the visible reply, never from its reasoning; code checks the quote after normalising whitespace, punctuation and markup, and rejects a change whose quote is missing. Belief changes use presence evidence instead: who was in the scene when the line was spoken. Implied or ambiguous facts go to `uncertain` until a later scene confirms them. Greetings not posted by the narrator, hidden messages and the extension's own posts are not read as narration. Values are normalised ("same", "n/a"), unknown keys are rejected, and per-pass caps apply. On a parse failure the previous state stands and the raw output is logged. The inspector shows the rejection rate, so an over-strict quote rule is visible early.

### Memory and summaries

The director owns memory on a clean install. The extractor's call also returns a short summary of the reply, which commits with the delta. Every N turns the summariser rolls older summaries into one. Summaries are injected before the chat history and cover only messages that have left the prompt, so nothing is told twice. If a community memory extension later meets the criteria, the summariser is switched off rather than run beside it.

### Rollback and retcon

Every correction works through provenance: the director finds what a message produced and removes it.

| Case | Handling |
| --- | --- |
| Rewrite your last message | Delete the reply (provisional, discarded), edit your message, regenerate. Committed state is untouched |
| Delete several steps back | Rebuild state by replay; remove or revert lorebook entries and summaries from the deleted messages; re-plan |
| Branch from an earlier message | Rebuild state from the branch's own messages; fork the dynamic lorebook; plans and tombstones made after the branch point are absent |
| Retcon via `/director` | Remove the named facts by provenance; log tombstones on the latest message; rewrite affected summaries; brief says "did not happen" until the source messages leave context |
| Retcon via OOC in chat | The extractor recognises it and applies the same steps; the OOC message is then hidden from the prompt and kept out of summaries |

Tombstones stop a retconned fact from returning if an old message is ever re-extracted after an edit.

### Inspector and director channel

A small drawer shows current state, the latest brief, continuity flags, the quote rejection rate, and the exact prompt and raw output of each module's last call. Every field is editable. `/director` sends free-text instructions without breaking the scene; `/director scene:`, `/director beats:` and `/director rewrite:` adjust the scene, queue beats, or redo the latest reply as a new swipe. Any director output can be revised with an instruction. Shortcuts (re-run the profile, force a re-plan, dump state) are also offered as a built-in Quick Reply set.

### Degradation

Without the extension the card runs as a plain narrator: no tracked state, no brief, no dynamic lore. The genre variables are empty, so genre entries stay off, and nothing in the card depends on `<director_notes>` being present. Disabling the extension restores the group's join mode, so the cast cards still reach the narrator. Without Tavern Helper, the card's character script does not run, the extension refuses to start (PLT-07), and the card still narrates. The leak-stripping regex ships with the card and works either way.

## Turn lifecycle

The director works after each reply, while the player reads and types, so it adds no wait before narration.

**A normal turn**

1. The player sends a message.
2. The extension commits the previous reply: its delta, summary and lore drafts. If that reply's extraction has not finished, it is marked pending and commits when its delta arrives. The lore promoter copies committed lore drafts into the dynamic lorebook. No model call.
3. A generate interceptor finishes the brief in code from the prepared cast cards and the player's message (see Stats and social), and sets the scan-only prompt before World Info scans. The premise, any injected cast and the summaries go before the chat history; the brief (or the fallback note) goes where the preset places it.
4. The narrator generates. The chat shows only narration.
5. The extractor reads the visible reply and stores a provisional delta, summary and lore drafts, each change with its quote.
6. The continuity checker and spotlight scorer run; if a trigger fired, the planner runs too. Calls on different profiles run in parallel.
7. The brief writer prepares the next brief and the cast cards from the results, and the mirrored chat variables are updated.

**Other events**

| Event | Extension response |
| --- | --- |
| New swipe or regenerate starts | Clear the reply's record before generation, then extract the new swipe |
| Swipe back to an older swipe | Clear the data restored with it and re-extract the reply, as for a new swipe |
| Continue | The reply changed, so discard its provisional record and re-extract it |
| Generation stopped | Extract the partial reply as usual; a later continue re-extracts it |
| Edit the latest reply | Re-extract it |
| Reply changes while the director is working on it | The stale result is discarded and the call re-runs on the current text |
| Player sends before the director finishes | The reply is marked pending and commits when its delta arrives; the narrator gets the fallback note |
| Delete the latest reply | Discard the provisional record; nothing else changes |
| Group regenerate | SillyTavern deletes the reply and generates a new one, so this is a delete followed by a new reply |
| Delete committed messages | Replay state; remove their lorebook entries and summaries by provenance; re-plan |
| Edit a committed message | Re-extract it; replace its committed record; replay |
| Hide or unhide a message | Its committed record stays; it leaves or rejoins the prompt only |
| Retcon | As in Rollback and retcon |
| Branch or checkpoint | Detected by a new integrity ID: rebuild state from the branch's messages; fork the dynamic lorebook |
| Chat renamed | Same integrity ID, so nothing to rebuild |
| Chat changed | Load that chat's state, dynamic lorebook and brief; recompute variables |
| Fresh group chat | Greetings not from the narrator are ignored by the extractor; the cast-size rule sets the group mode |
| Member added or removed | Re-check the cast-size rule and switch group mode if needed |
| Impersonate or quiet generation | No premise, cast, summary or brief is injected |
| Dry run (prompt itemization, token counts) | Ignored: no state change, no director call, no World Info timer change |
| The extension posts a message | Tagged as an extension post; it triggers no commit; the extractor reads it by a fixed rule |
| Director call fails | Keep the last good state and brief; log the raw output; flag in the inspector |
| Player instruction via channel | Planner run or state edit as requested; rewrite the brief |

Step 2 is bookkeeping only. Every model call happens after the reply is on screen, so none delays narration.

## Platform baseline and dependencies

The target is a clean SillyTavern install. The design uses built-in features only; a community extension takes over a director job only if it meets every criterion below.

**Built-in features used:** group chats (join and swap modes), World Info, macros and chat variables for `{{if}}` gating, the Quick Reply extension, connection profiles for the director modules, and the extension API for prompt injection, events and per-message data. The built-in Summarize stays off, because the director already writes summaries.

**Delivery.** Three layers, each with its own jobs. The extension is the core: state and replay, events, director calls through Connection Manager, the World Info hook, group mode switching, `/director` and the inspector. It keeps running whatever preset or card is active, which a preset or character script does not. Tavern Helper carries the card-side logic, in a character script inside the narrator card: `nar` defaults, a warning when the director is missing, greeting selection. It also gives the extension its variable, lorebook and macro APIs. Regex scripts bound to the card strip leaked director text, hide markup and clean old history in the prompt; the director applies the same patterns to reply text before extraction and quote checks. `sillytavern-utils-lib` (MIT) is bundled for `buildPrompt` (DIR-08).

**Lore in group chats.** SillyTavern loads a character's bound lorebook only for the member that is generating (`world-info.js` 4475). With only the narrator generating, the muted members' books would never load. The extension adds them, together with its dynamic lorebook, at the point where World Info gathers its entries (`world-info.js` 4604). This relies on internal behaviour, so the tested SillyTavern version is pinned. Full requirements, with source references: Extension requirements

**Dependency criteria.** A community extension is adopted only if it:

1. Does one job the director would otherwise build, and no other component owns that job.
2. Never writes authored lorebooks or cards; any lorebook it writes is one it created.
3. Works in group chats.
4. Handles swipe, delete and edit correctly, or keeps no story state at all.
5. Loads no remote code at runtime and never executes model output as code.
6. Has readable source and a licence that allows use and, if needed, a fork.

Candidates are judged on function and storage safety, not popularity or maturity.

**Recorded exceptions.** Tavern Helper is required by the narrator card and the extension, and fails criterion 5: its script frames load Vue from a CDN at runtime. It is admitted because you trust it, and its version is pinned. The extension's own code still loads nothing remote (PLT-04). Group Greetings, SillyTavern's own optional extension, is used only through card data: it posts the narrator card's group-only greeting. Without it, the narrator posts her solo greeting in groups too, and nothing else changes. Story Orchestrator was weighed as a replacement for the director and not adopted.

| Job | Default owner | Can move to a community extension |
| --- | --- | --- |
| Story state, beats, beliefs, brief | Director | No. Core of the design |
| Memory and summaries | Director summariser | Yes, if it meets the criteria and rolls back by message |
| Dynamic lorebook | Director | No |
| Prose craft | Companion preset shipped with the card | Any preset the player prefers; without the brief entry, the extension injects the brief itself |
| Genre craft | Narrator's baseline lorebook | No |
| Off-screen world events | Director planner | Yes, but only as input to the planner |

A clean install has no tuned preset, so the companion preset is adapted from an existing one. Its prose craft is kept. Output blocks, status panels and trackers are removed, because the chat shows only narration. It adds one prompt entry that places the brief (see Injection). The card holds no prose craft.

## Risks and mitigations

The two highest risks are over-direction and the two models drifting into two different stories. Both show up in the inspector first.

| Risk | Sign | Mitigation |
| --- | --- | --- |
| Over-direction | NPCs steer every scene to the same outcome; player feels railroaded | Brief carries intent only; initiative alternates; tie-break rule in the card; brief cap |
| Two stories | Canon lists facts the narration never showed | Quote-checked extraction; `uncertain` bucket; periodic canon review in the inspector |
| Quote rule too strict | Real events are rejected; canon stays thin | Normalised matching; presence evidence for beliefs; rejection rate in the inspector; acceptance threshold |
| Brief read as the player | On Claude or Gemini the narrator answers the notes as if the player wrote them | Per-backend brief placement; card rule; acceptance test per backend |
| Genre convergence | Different story material comes out in one house voice | Personality and examples empty; profile with priority order confirmed per chat; genre entries per genre |
| Plan leakage | Prose foreshadows heavily or names future events | Narrator sees one beat; plans never in a lorebook, a chat variable or a director context |
| Leaks fed back | Leaked notes stay in saved replies and teach the model to leak | Strip from the saved reply and displayed reasoning, not only the display |
| Private state in variables | A macro or `/listvar` shows beats or beliefs | Only public state is mirrored into variables |
| Director slower than the player | The next reply arrives before the brief | Pending commit; fallback note; parallel calls across profiles |
| Stale state | State describes a reply that no longer exists | Record cleared at swipe start; provisional until accepted; stale results discarded; replay on delete |
| Dry-run side effects | Prompt itemization changes state or advances World Info timers | All handlers ignore dry runs; director scans are dry runs |
| Branch errors | A branch shares a lorebook or inherits later plans | Integrity ID check; rebuild from the branch's messages; acceptance test |
| Group mode left switched | The group stays in swap mode after the extension is removed | Restore join mode on disable; inspector shows the current mode |
| Joined-card bleed | Traits or speech migrate between characters | Join prefix and suffix per card; `{{char}}` resolves per card in both paths |
| Greeting flood | A fresh group chat opens with every cast greeting | Empty cast greetings; narrator group greeting via Group Greetings; extractor ignores the rest |
| Lore budget overflow | Lore stops activating quietly | Scan only the brief; injection token cap; overflow shown in the inspector |
| Token cost of a large cast | Prompt balloons with cast cards | Above the cast-size limit: full cards for characters present, short profiles for the rest |
| Lorebook bloat | Dynamic book fills with one-off details | Recurrence threshold; update by ID; length and per-pass caps |
| Suggest-mode spoilers | The player sees where the story is heading | Opt-in, off by default |
| Director failure | API error or malformed output | Keep last good state; finish cut-off output; log raw output; flag in inspector |
| SillyTavern or dependency update | Muted members' lore stops loading, swipe data handling changes, or a chosen dependency changes | Pin tested versions; re-run the phase 0 and 0b checks after each update |

## Build plan

Nine phases, each closed by a gate. Phase 0 is done. Gate 0b chose the path: our own director extension, working with Tavern Helper and regex. Phase 3 starts with the fixture suite, so director prompts are tested from the first day. Every requirement in the Extension requirements tab belongs to one phase.

&#91;embedded content: build plan · 9 phases, each closed by a gate\]

Building our own keeps the phases as they were. Gate 0b now proves the Tavern Helper parts before phase 2 builds on them.

**Deliverables by phase**

- [x] Phase 0 · Verify platform: six capabilities checked against SillyTavern 1.19.0 (see Platform findings)
- [ ] Phase 0b · Prove the Tavern Helper parts and the interceptor: the narrator card's character script runs in a group where only the narrator generates; Tavern Helper's variable macros read the `nar` object in card text and lore content; a `{{director_notes}}` macro placed in a preset entry resolves, in chat and in the system prompt; the scan-only prompt triggers lore without appearing in the prompt; the generate interceptor finishes the brief and the scan-only prompt before the World Info scan on send, swipe and regenerate.
- [ ] Phase 1 · Narrator card and preset: card with solo and group-only greetings, the card's Tavern Helper character script, companion preset adapted from an existing preset with the brief entry, content-boundary block, leak-stripping regex, group setup notes, CNT-05
- [ ] Phase 2 · State plumbing: PLT-06, PLT-07, MSG-01 to MSG-13, INJ-01 to INJ-04, INJ-06 to INJ-08, INJ-10, LOR-01, UI-01, UI-02, UI-07, UI-09, NFR-03, NFR-08
- [ ] Phase 3 · Director core: fixture suite first (NFR-06), then DIR-01 to DIR-08, DIR-10 to DIR-16, MOD-01 to MOD-04, MOD-11, MOD-12, MOD-14, MOD-16, MOD-17, MOD-24, MOD-33, MOD-34, INJ-09, INJ-11, INJ-12, LOR-07, LOR-08, NFR-01
- [ ] Phase 4 · Genre and framing: MOD-05, MOD-15, MOD-18, MOD-25, MOD-26, MOD-28, MOD-29, INJ-05, CNT-01 to CNT-04 for the three test genres
- [ ] Phase 5 · Planner and player controls: MOD-06, MOD-10, MOD-13, MOD-19 to MOD-23, MOD-27, MOD-30 to MOD-32, MOD-35, DIR-09, UI-03, UI-04, UI-08, UI-10
- [ ] Phase 6 · Dynamic lorebook: MOD-07 to MOD-09, LOR-02 to LOR-06, lorebook fork on branch (MSG-10), NFR-05
- [ ] Phase 7 · Harden and release: UI-06, NFR-02, NFR-04, PLT-05, README and repository

## Test plan

The agnostic claim passes when three deliberately different stories come out in three distinct registers and pacing styles from the same card.

| Story | Genre | What it tests |
| --- | --- | --- |
| Party-based fantasy | Fantasy adventure | Several companions in one scene, who speaks and when, travel and combat pacing, joined-card bleed |
| Slice of life | Cozy, low stakes | Restraint: no invented danger, slow tempo, small beats that still go somewhere |
| Survival game | Survival, scarcity | Resource pressure and lethal stakes, consequences without railroading the player |

Each story runs twice: as a group chat with the narrator unmuted and the cast muted, and as a solo narrator card with the cast in a lorebook. The party-based fantasy uses six cast members, so it tests the swap path above the cast-size limit; the other two use three or fewer, so they test SillyTavern's join path.

**Build order.** Solo first. Then a group with two cast cards, which tests join mode. Then the six-member party, which tests swap mode.

**Acceptance checks**

- [ ] Same card, three stories: a reader who has not seen the setup names the right story for at least 13 of 15 replies (five per story)
- [ ] Fixture suite: the chosen director model passes at 90% or better, with no forbidden output, before phase 3 closes
- [ ] Quote rule: fewer than 1 in 10 extracted changes rejected over 20 turns, and each rejection is visible in the inspector
- [ ] Swipe three times on one reply: only the active swipe's changes apply, and none reach the lorebook
- [ ] Swipe, then send at once: the commit carries the new swipe's changes, never the rejected one's
- [ ] Continue a reply, and stop one mid-generation: each is re-extracted, and the earlier provisional record is gone
- [ ] Edit a reply while the director is processing it: the stale result is discarded
- [ ] Send before the director finishes: the reply is marked pending, then commits when its delta arrives
- [ ] Delete the latest reply and rewrite your message: earlier committed state is unchanged
- [ ] Delete three messages back: their state, summaries and lorebook entries are gone
- [ ] Group regenerate: behaves as a delete followed by a new reply
- [ ] Branch from an earlier message: the branch has its own dynamic lorebook, and its state and plan match the branch point
- [ ] Rename a chat: nothing is rebuilt and the dynamic lorebook stays
- [ ] Retcon a fact via `/director`, then edit an old message: the fact does not return
- [ ] A recorded change whose quote is not in the reply is rejected
- [ ] Impersonate: the prompt carries no director notes
- [ ] Open prompt itemization ten times: no state, variable or World Info timer changes
- [ ] `/listvar`: no beat, unopened clue or belief appears
- [ ] Claude and Gemini backends: over ten turns the narrator never answers the brief as if the player wrote it
- [ ] A forced leak of `<director_notes>`: it is absent from the saved reply and from the next prompt
- [ ] A planned beat is pre-empted by the player: narrator follows the player, planner re-plans within one turn
- [ ] Ten turns: no beat or future event named in prose
- [ ] A deliberate contradiction (a dead NPC speaks): checker flags it, the next brief corrects it
- [ ] Dynamic lorebook after 30 turns: no duplicates, no plans, no beliefs
- [ ] Lore budget: an overflow is shown in the inspector
- [ ] Extension disabled: card still narrates cleanly, no genre entry fires, and the group is back in join mode
- [ ] Fresh group chat: only the narrator's group greeting appears, and the extractor records nothing from other greetings
- [ ] Cast-size rule: three members use join mode with no injected cast; six use swap mode with full cards for those present and profiles for the rest; adding a fourth and fifth member switches modes
- [ ] Group chat with narrator unmuted and cast muted: only the narrator generates, and a muted member's lorebook entries fire when their keys appear
- [ ] Solo chat: each story also runs as a solo narrator card with its cast in a lorebook
- [ ] Stats and relationships over 20 turns: no number from either appears in prose, and a faster character is never outrun by a slower one without a stated reason
- [ ] An attempt beyond the PC's ability lands as a failure or at a cost, never as a free success

## Platform findings and open decisions

Phase 0 is complete. The six assumptions were checked against SillyTavern 1.19.0 source (`release` branch, commit `06bde93`). Five hold; one does not, and has a built-in workaround. Eight unplanned findings turned up across two reviews of the source, and all are handled in the design.

**Findings**

| Assumption or finding | Result | Design consequence |
| --- | --- | --- |
| Per-message data saved with the chat | Holds. Message data is stored per swipe and restored on swipe | Swiping back restores old data, so the extension clears it and re-extracts |
| Stable message ID | Does not hold. Deletes splice the chat and report only its new length | Extension writes its own UUIDs and diffs to find deletes |
| Message and chat events | Holds | Payloads are thin; the extension keeps its own index |
| Injection with depth, role and scan | Holds, with a filter for generation types | Brief skipped for impersonate and quiet generations |
| Separate director model | Holds, through the built-in Connection Manager. A call applies the chosen profile's own preset and instruct template | Each director profile carries its own low-temperature preset |
| Chat lorebook from an extension | Holds, but chat lore is a single slot | Dynamic book loaded through the World Info hook instead |
| Muted members' lorebooks (unplanned) | Do not load: only the generating member's books do | Extension adds them through the same hook |
| Branch metadata (unplanned) | A branch copies the whole chat metadata and gets a new integrity ID; a rename keeps it | Integrity ID check; per-message logs; lorebook fork |
| Swipe data (unplanned) | A new swipe keeps unknown `extra` keys from the previous swipe | Record cleared when a swipe starts |
| Group card joining (unplanned) | All members or only unmuted ones, never a subset | Cast-size rule: join up to the limit, swap plus injection above it |
| Group greetings (unplanned) | A fresh group chat posts every member's greeting; extensions can replace one but not suppress it | Empty cast greetings; narrator group greeting via Group Greetings |
| System messages (unplanned) | Claude and Gemini converters turn later system messages into user turns | Per-backend brief placement |
| Dry runs (unplanned) | Prompt itemization runs generations flagged as dry runs; real World Info scans advance timers | Handlers ignore dry runs; director scans are dry runs |
| Injection trimming (unplanned) | SillyTavern trims history, never injections | Summaries only for messages that left the prompt; injection token cap |

**Open decisions**

- [x] Decided: build our own director. Story Orchestrator is not adopted
- [x] Decided: a native extension, working with Tavern Helper and regex, not a Tavern Helper script alone
- [x] Decided: sillytavern-utils-lib is MIT, so it is used, with a dry-run World Info scan (DIR-08)
- [ ] Genre craft content: StoryMode's 43 story types, credited, or our own (CNT-03)
- [x] Decided: solo first, then a group with two cast cards
- [ ] Planner cadence default: 6 turns, or event-driven only
- [ ] Override method for changed authored facts: superseding entry only, or a one-time inclusion group on authored entries
- [ ] Memory: director summariser only, or a community extension that meets the criteria
- [x] Decided: adapt an existing preset for the companion preset, rather than write a new one
- [x] Decided: banded lore text uses flags the extension writes, not EJS from ST-Prompt-Template
- [ ] Which existing preset to adapt for the companion preset
- [ ] Director model and narrator model for the first build
- [ ] Extension name and whether it is published as a public repository
