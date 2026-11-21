# Agnostic Narrator

A genre-agnostic narrator for SillyTavern, run by two models. A **narrator card** writes the story. A **director extension** keeps the record, plans ahead and gives the narrator one short note each turn. The chat shows only narration.

Built and tested against SillyTavern 1.19.0. No other extension is required.

## What you get

- **One narrator for any story.** She has no house style; genre, voice and pace come from your cards and lore.
- **A record that follows the chat.** Swipe, edit, delete or branch, and the director's state follows, because it is rebuilt from the chat's own messages.
- **Facts with evidence.** A change is recorded only if the director can quote the narrator's reply for it.
- **Planning without railroading.** The narrator sees one intent with a condition, never the plan, and your message always comes first.
- **A content rating.** Mature by default; `/director pg` turns adult content off for a story.
- **An inspector.** Seven plain tabs with forms: see and change the scene, the cast, the story profile, the plan and the record, and read what each director call was sent and answered.

## Quick start

1. In SillyTavern, open **Extensions → Install extension**, paste `https://github.com/fadust/agnostic-narrator` and install.
2. Import `dist/Narrator.card.json` as a character and allow its regex scripts.
3. Import `dist/Narrator Companion.preset.json` and select it.
4. Open a chat with the Narrator and say where the story begins.

For a cast of character cards, make a group with the Narrator and run `/director setup`.

Full steps, including a separate model for the director: [docs/installation.md](docs/installation.md).

## Documentation

| Document | For |
| --- | --- |
| [Installation](docs/installation.md) | Installing, choosing models and temperatures, updating, removing |
| [Playing](docs/playing.md) | Solo and group play, the content rating, talking to the director, the inspector |
| [Reference](docs/reference.md) | Every command, setting, note line, variable and file |
| [Active rules](docs/rules.md) | The exact rules each model is given. Generated from source |
| [How it works](docs/how-it-works.md) | The design: records, replay, the turn, the notes, lore, planning |
| [Troubleshooting](docs/troubleshooting.md) | Symptoms, causes and fixes |
| [Development](docs/development.md) | Layout, tests, the fixture suite, changing rules |
| [Integration notes](docs/integration-notes.md) | Working alongside other extensions: findings, and what is planned |
| [Design review](docs/design-review.md) | How the build departs from the original plan, and why |
| [Changelog](CHANGELOG.md) | What changed, newest first |

## What is in the box

| Part | Path | Purpose |
| --- | --- | --- |
| Director extension | repo root (`manifest.json`, `index.js`, `core/`, `st/`) | Record, memory, continuity, planning, notes, dynamic lore, inspector, `/director` |
| Narrator card | `dist/Narrator.card.json` | Identity and rules, craft entries, regex scripts that strip leaked notes |
| Companion preset | `dist/Narrator Companion.preset.json` | Content stance and prose craft; follows the story's rating |
| Quick replies | `dist/Narrator Director.quickreplies.json` | Buttons for common commands |
| Fixture suite | `fixtures/`, `tools/fixtures.mjs` | Tests a director model before you rely on it |

## Status

Version 0.2.0. 221 unit tests and 29 end-to-end checks pass. The end-to-end checks (`ST_DIR=<SillyTavern checkout> npm run e2e`, needs Playwright) run a real SillyTavern with a scripted stand-in for the models.

**No real model has been through the test suite yet.** Run the fixture suite on your director model before relying on it: [docs/development.md](docs/development.md#the-fixture-suite).

## Licence

[MIT](LICENSE). Free to use, change, share and build on, including commercially. The only condition is that the copyright and licence notice stay with copies of the code.
