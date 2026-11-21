# Plan: ideas round (A4, A6, B1–B3, C3–C5, C7)

**Built 18 November 2026:** W0–W5, with 141 unit tests passing and a clean build. W1+W3 and W5 were built by agents and reviewed. Not yet run live in B. Implementation notes: beats store `goal`, `pressure` and `intent` (a copy of the goal, for old records). The check calls are named `tracker-check` and `planner-check` and use the parent role's profile. A plan whose beats are all dropped is not logged, and the planner rests for 90 s. The "stakes" part of the genre flag is left to the prompt; code checks the avoid list, lethality and rating.

Written 18 November 2026 at the owner's request. Open questions go to the owner one at a time before the part they affect is built.

## Constraints the owner set

- **Minimum wait time** (most important). The narrator's path stays as it is: notes are composed in code, with no model call. Every new call runs in the background after the reply, like the observer.
- **Token efficient.** Code checks first. A model call runs only when code finds something to check.
- **Don't rush the role-play.** Nothing new may push an event onto the page sooner than today.
- **Merge what overlaps,** so that no two parts fight each other or the director.
- **The plan is a theme ride** (owner, 18 Nov 2026): it offers the player a ride they may jump on or not, like a choose-your-own-adventure. Every beat is an opening the player can take or leave. Leaving it is a valid choice, never something to correct. The plan follows the story's genre profile, and no plan may fight it.

What that changes below:

- W1: the `pressure` text is an **opening**: something the world offers, which the player may take up or pass by. It is never a demand that must be answered.
- W2: a nudge says the opening **is still there**, once. It never escalates. A beat the player passes by (preempted) is dropped without pressing, as today.
- W3: a further flag, **fights the genre**. A beat that touches the profile's "avoid" list, or goes past its lethality, stakes or rating, is rewritten. When the rewrite fails, the beat is dropped.

## The ideas merged into five pieces of work

| Work | Ideas merged | Why they belong together |
| --- | --- | --- |
| **W1. Beats as pressure** | B1, B2, C3 | All three are about how a beat is worded and reaches the narrator. One change to the beat's format serves all three |
| **W2. One patience ladder** | B3, C5, the existing beat retirement | All three answer "nothing is moving": nudge first, re-plan later, retire last. One counter, so they never fire in the wrong order or twice |
| **W3. Plan check** | C4, C7, the existing spine check pass | One shape: code flags, refuses what is certain, and makes one cheap rewrite call only when there are flags. The spine check and the plan check share that code |
| **W4. Second check before "met"** | A4 | Stays inside the tracker step, so it is replay-safe and stored with the batch |
| **W5. Skipped milestones** | A6 | Code only, in spine state |
| **W0. Observer first in the queue** | (wait time) | Keeps the next turn's notes fresh when the new calls share a connection profile |

## W0. Observer first in the queue (wait time)

Today every call on one connection profile waits in a single line. A re-plan, a tracker call, and now the new check calls could sit ahead of the next observer call. The notes would then be "one reply behind" and carry nothing that steers.

- In `model()`, an observer call goes ahead of calls that are queued but not yet started. A call already running is never interrupted.
- Cost: nothing. Effect: the observer, which is what the next turn's notes depend on, never waits behind background planning.

## W1. Beats as pressure (B1, B2, C3)

**Today:** `scene_intent` hands the narrator the outcome ("Piet tells Max where the captain drinks…"), sometimes copied from a spine criterion. The narrator forces it within a reply or two (StoryArc's finding; seen in B).

**Change:** each beat has two texts.

| Field | Who reads it | Content |
| --- | --- | --- |
| `goal` | Planner, observer (to judge "complete" / "advanced"), inspector | What counts as the beat landing. The current `intent`, renamed |
| `pressure` | Narrator, in the notes | A force in the world, true now, which the narrator lets act: "Piet is eager to talk to any stranger who pays". Never the outcome, never tone or narration advice (B2) |
| `reach` (C3) | Folded into `pressure`, no extra field | How the force reaches the player wherever they are: a messenger, a rumour, a person arriving. A beat can work off-screen and slip to a later scene without being lost |

- Planner rules gain three lines. A beat states what is true in the world, never how to narrate. A beat may slip to a later scene. It says how it reaches the player when they are elsewhere.
- Notes: the `scene_intent` line carries `pressure` (with its precondition); the goal never reaches the narrator. The card's explanation of the line changes: "a force acting in the scene. Let it act; never resolve it on the story's behalf."
- Old beats with no `pressure` fall back to `intent`, so existing chats keep working.
- Cost: about 30 more output tokens per beat in a plan. The notes stay the same length.
- Card change: yes, the explanation of one line. Rebuild, then replace the card in B (and in A when the owner says so).

## W2. One patience ladder (B3, C5, retirement)

**Today:** a beat that does not land is retired after being offered 5 times (8 if required). The planner re-plans every 6 turns regardless, on deviation, or when the queue runs out. Nothing notices a scene that has stalled.

**One counter per beat, one per scene:**

| Step | When | What happens |
| --- | --- | --- |
| Nudge (B3) | The queued beat has been offered **N** turns (setting, default 3) and came back "untouched" each time. "Preempted" (the player went elsewhere) resets the count: that is the player choosing, not stalling | The notes add one line, once: `waiting: <pressure> has gone unanswered; let it be felt once more, without resolving it`. Never an event, never the goal |
| Stall re-plan (C5) | **M** replies in a row (setting, default 5) record nothing new: no fact, no thread, no beat movement, no spine reading other than "aside" | Re-plan with the reason "stalled". The prompt says to bring something small to where the player already is and never cut the scene short (same rule as drifting). Gate: not while a player direction from the last few turns asks for quiet or slowness. The planner already reads the player's directions; the reason line tells it they win |
| Threads running low (C5) | Fewer than 2 open threads, and the queue is down to its last beat | Re-plan with the reason "threads running low", folded into the existing "queue empty" trigger rather than a new one |
| Retire | Offered N + 2 times (N + 5 if required) | As today: skipped, and the planner is asked again. With N = 3 this keeps today's 5 and 8 |

- Order is guaranteed: nudge at N, retire at N + 2, and stall at M > N by default. Only one re-plan per pass (already so). A stall re-plan, like every re-plan, never ends a scene.
- Fit with the spine's drifting trigger: drifting is judged when a scene closes, stall within a scene. If both are due, the planner runs once.
- Cost: code only. A stall re-plan can replace a cadence re-plan (question 3).

## W3. Plan check (C4, C7, the spine check)

**Today:** the spine has a check pass: code flags, one cheap rewrite call. Plans have no check: the planner copied criterion m2-c2 word for word, filed scenery as a "reveal", wrote "choice" beats that offered no choice, and 3 of 41 beats assumed the player's action.

**Code flags on every new plan** (no model call):

| Flag | Code test | Action |
| --- | --- | --- |
| Scripts the player | `goal` or `pressure` starts with the player character's name, "the player" or "you" followed by an action, or says the player agrees, decides or accepts | Rewrite |
| Copies a criterion | High word overlap between `pressure` and any open spine criterion | Rewrite (the goal may name the criterion; the pressure may not) |
| Hollow "choice" | Type `choice` with no alternative in the text (no "or", no "either", no second option) | Retype as `pressure` in code |
| Name clash (C7) | A new proper name too close to a cast or lore name (same first name, or one edit apart) | Rewrite |
| Past date (C4) | A precondition tied to a time already passed | Drop the precondition in code |

- Only when a flag needs a rewrite: **one** cheap call for all flagged beats, by id, on the planner's profile. This reuses the spine check's code and its rule that a rewrite which still trips its flag is refused. If the call fails, a flagged beat that scripts the player is dropped. The others stay as drafted.
- C7's "triggers that give away secrets" is left out: the narrator is allowed to know secrets; the notes' `watch` line handles who does not.
- Cost: zero for a clean plan; one small call otherwise.

## W4. Second check before "met" (A4)

- Inside `track()`, after validation: collect the marks that would count ("met" with evidence "occurred" or "shown"). If there are none, no call.
- Otherwise **one** call for the whole batch, on the tracker's profile. For each mark: the criterion, its quote with the sentence before and after, and the checked speaker. Answer: confirm or reject, with a reason in a few words.
- A rejected mark is moved to the batch's refused list ("check: …"), shown on the Log tab. The criterion stays open.
- Stored in the same `rec.track`, so a swipe or edit drops it together with the batch.
- Note on question 1 (the speaker check, left as it is): the checker *sees* the speaker as context, but code does not reject on a mismatch. Say if that is unwanted.
- Cost: rare. Marks that count are few per story, and they go in one call per batch.

## W5. Skipped milestones (A6)

- When a later milestone concludes (or its turning point "happened") while an earlier one is still open, the earlier one becomes **skipped**: no conclusion call, no chapter, its open criteria leave the tracker and the planner.
- The Plan tab shows it as skipped. It can be reopened by hand.
- Cost: code only. It saves calls, because a skipped milestone is never concluded.

## Order of work

1. W0 and W4 (tracker side; no card change).
2. W1 and W3 together (both touch the beat format and planner prompt), then the card line.
3. W2 (needs W1's `pressure` for the nudge text).
4. W5.
5. Tests per part, `npm run build`, docs (`reference.md`, `how-it-works.md`, `playing.md`, changelog, and the two mismatches found earlier), then a live run in B.

## Settings added

| Setting | Default | Control text |
| --- | --- | --- |
| Nudge a waiting beat after N turns | 3 | 0 = never nudge. Retiring follows two turns later (five later for required beats) |
| Re-plan when nothing changes for N replies | 5 | 0 = off |

## Open questions for the owner (one at a time)

1. **W1, card line:** keep the line's name `scene_intent` with the new content and new card explanation, or rename it (for example `pressure_in_scene`)? Recommendation: keep the name; only the content and the card text change. **Answer 18 Nov 2026: keep the name.**
2. **W2, push strength:** besides N, a setting for how hard beats push (passive / proactive / assertive, as in merged_world_tracker)? Recommendation: no, the N settings are enough; a strength dial risks rushing. **Answer 18 Nov 2026: no, N is enough.**
3. **W2 vs cadence:** with the stall trigger in place, should "Re-plan every N turns" default to 0 (events only)? Recommendation: yes. It saves the largest call, and stall, drift, deviation and an empty queue cover the real needs. **Answer 18 Nov 2026: yes, default 0.**
4. **W4, checker failure:** if the check call fails or times out, keep the marks (as today) or hold them back until the next batch? Recommendation: keep them, as the spine check pass does; a failed check must not stall the spine. **Answer 18 Nov 2026: keep the marks.**
5. **W5:** should a skipped milestone get a one-line chapter for the narrator ("passed over")? Recommendation: no chapter; the story already moved past it. **Answer 18 Nov 2026: no chapter.**
6. **W3:** if the rewrite call fails, should a beat that scripts the player be dropped? Recommendation: yes. Such a beat is worse than none. **Answer 18 Nov 2026: drop it** (this also covers beats that fight the genre).

All six answered 18 Nov 2026. Ready to build in the order above.

---

# Plan: themes D, E, F (19 November 2026)

Assessed against what is built. Merged into M1–M4 plus one question (F2). Already built: F3, F7, mostly F8. Covered elsewhere or of little value: D2, D4, F4, F5, F9.

| Work | Ideas | Summary |
| --- | --- | --- |
| M1. Characters with their own purpose | D1 + D3 | Agendas for up to 10 important characters (owner raised it from 3, 19 Nov 2026); wants in the cast lines, never actions; off-screen moves through the planner's outcomes, on a reply-count clock |
| M2. Who knows what (light) | E1 + E2 | The observer records who was told what by whom |
| M3. Names already taken | E3 | A code-made list of names in use, in the block before the chat history |
| M4. Lean prompts | F1 + F6 | Dormant threads leave the planner's prompt; the story block is trimmed by priority |

## Answers

1. **M1, 19 Nov 2026: build.** Agendas live on the **Cast tab**, in each character's section. Results go to Record as now, unconfirmed until narrated. Each agenda has three parts: what they want, what sets them moving, and when it expires. All three are **rooted in the character's description, the lorebook and their place in the story**. Build note: they are drafted with the spine, which reads the card descriptions, the world notes and the player's opening move. The planner renews one only when it is fulfilled or expires, given that character's profile and place in the story.
2. **M2, 19 Nov 2026: skip.**
3. **M3, 19 Nov 2026: build.**
4. **M4, 19 Nov 2026: F1 only** (dormant threads leave the planner's prompt and wake when their people, place or key word return; dormancy count as a setting, default 12 replies, 0 = off). F6, trimming the story block, is not built.
5. **F2, 19 Nov 2026: keep "newest wins".** No conflict flag.
7. **M1 redesign, 19 Nov 2026 (supersedes the agenda shape above): high-level wants, at most 3 per character, for every cast character.** Wants are life-level ("a happy family", "amass a fortune", "to be loved", "keep the inn's silence"), stable, and may support or pull against each other (owner, 19 Nov 2026: either way). There is no trigger, no expiry, no observer check and no limit on how many characters have them. The spine drafts them for the people the material names; the planner seeds them for others (a few per plan) and changes them only when the story transforms one (achieved, lost, betrayed). They are never given back to a character whose wants the player cleared. The narrator sees them on the cast line while the character is present. Short-term wants stay in the openings.
6. **M1 seeding, 19 Nov 2026: yes, the planner seeds.** In its existing call it may give an agenda to an important character who has none, while fewer than 3 are active. Never to a character whose agenda the player cleared.

To build: M1, M3, F1.
