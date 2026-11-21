// End-to-end checks against a real SillyTavern with a mock LLM behind it.
// Usage: ST_DIR=/path/to/SillyTavern node tests/e2e/run.mjs
// Starts SillyTavern on a throwaway data root, installs the extension, imports the card and plays through
// the acceptance checks that need the real platform (prompt assembly, World Info, swipes, groups).

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-llm.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ST = process.env.ST_DIR;
if (!ST || !existsSync(join(ST, 'server.js'))) { console.error('Set ST_DIR to a SillyTavern checkout (npm install done).'); process.exit(2); }
const PORT = 8133, MOCK = 8134;
const shots = process.env.SHOTS_DIR;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const results = [];
async function check(name, fn) {
    try { await fn(); results.push([true, name]); console.log(`  ok   ${name}`); }
    catch (e) {
        results.push([false, name, e.message]);
        console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`);
        if (shots) await page.screenshot({ path: join(shots, `fail-${results.length}.png`) }).catch(() => { });
    }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---------------------------------------------------------------- boot
const extDir = join(ST, 'public/scripts/extensions/third-party/narrator-director');
rmSync(extDir, { recursive: true, force: true });
// The extension lives at the repo root (so SillyTavern can install it from the GitHub URL); copy only its own files.
for (const f of ['index.js', 'manifest.json', 'style.css', 'core', 'st']) cpSync(join(root, f), join(extDir, f), { recursive: true });
const dataRoot = mkdtempSync(join(tmpdir(), 'nd-e2e-'));
const mock = await startMock(MOCK);
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
const startServer = () => spawn('node', ['server.js', '--port', String(PORT), '--dataRoot', dataRoot, '--browserLaunchEnabled', 'false'], { cwd: ST, env, stdio: 'ignore' });
const up = async () => { for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return; } catch { /* not yet */ } await sleep(500); } throw new Error('SillyTavern did not start'); };
let server = startServer();
await up();
// First start wrote default settings; point the connection at the mock and restart.
server.kill(); await sleep(1000);
const settingsPath = join(dataRoot, 'default-user/settings.json');
const st = JSON.parse(readFileSync(settingsPath, 'utf8'));
Object.assign(st, { firstRun: false, main_api: 'openai', username: 'Rowan' });
Object.assign(st.oai_settings, { chat_completion_source: 'custom', custom_url: `http://127.0.0.1:${MOCK}/v1`, custom_model: 'mock', stream_openai: false, openai_max_context: 32000 });
// The default context (about 4k) no longer fits the preset, card and notes, and SillyTavern would drop the chat history.
st.power_user.auto_connect = true;
// Other third-party extensions in the checkout (modals, themes, input helpers) would get in the way: run with ours alone.
const thirdParty = join(ST, 'public/scripts/extensions/third-party');
st.extension_settings ??= {};
st.extension_settings.disabledExtensions = readdirSync(thirdParty, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'narrator-director').map(d => `third-party/${d.name}`);
writeFileSync(settingsPath, JSON.stringify(st));
server = startServer();
await up();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && /Narrator Director/.test(m.text())) pageErrors.push(m.text()); });
page.on('dialog', d => d.accept());
page.on('console', m => { if (process.env.VERBOSE) console.log('   >', m.type(), m.text().slice(0, 200)); });
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('close', () => console.log('PAGE CLOSED'));
page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('  (navigated)', f.url()); });
process.on('uncaughtException', (e) => { console.error(e); server.kill(); process.exit(3); });
process.on('unhandledRejection', (e) => { console.error(e); server.kill(); process.exit(3); });
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(() => window.SillyTavern?.getContext && window.narratorDirector && !document.querySelector('#preloader'), null, { timeout: 90000 });
await sleep(2500);

// ---------------------------------------------------------------- helpers
const ev = (fn, arg) => page.evaluate(fn, arg);
const idle = async (timeout = 30000) => {
    await sleep(700);
    await page.waitForFunction(() => window.narratorDirector.idle() && !document.querySelector('#mes_stop:not([style*="display: none"])')?.offsetParent, null, { timeout });
    await sleep(300);
};
const view = (opts) => ev((o) => window.narratorDirector.view(o), opts);
const chatLen = () => ev(() => SillyTavern.getContext().chat.length);
const closePopups = async () => { for (let i = 0; i < 4; i++) { const b = page.locator('dialog[open] .popup-button-ok').last(); if (await b.count()) { await b.click().catch(() => { }); await sleep(400); } else break; } };
async function send(text) {
    const before = await chatLen();
    await ev(() => window.narratorDirector && document.querySelector('#nd-close')?.click()); // the drawer overlaps the send button
    await page.fill('#send_textarea', text);
    await page.click('#send_but');
    await page.waitForFunction((n) => { const c = SillyTavern.getContext().chat; return c.length >= n + 2 && !c.at(-1).is_user; }, before, { timeout: 30000 });
    await idle();
}
const slash = (cmd) => ev((c) => SillyTavern.getContext().executeSlashCommandsWithOptions(c).then(r => r?.pipe ?? ''), cmd);
const narratorCalls = () => mock.log.filter(l => l.kind === 'narrator');
const lastPrompt = () => narratorCalls().at(-1).messages;
// The card's description mentions the tag by name, so a real block is one that opens a message.
const briefOf = (messages) => messages.map(m => String(m.content)).find(t => t.startsWith('<director_notes>\n')) ?? '';
const storyOf = (messages) => flat(messages).match(/<story_context>\n[\s\S]*?<\/story_context>/)?.[0] ?? '';
const flat = (messages) => messages.map(m => `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n');
async function importCard(json, name) {
    return ev(async ({ json, name }) => {
        const c = SillyTavern.getContext();
        const fd = new FormData();
        fd.append('avatar', new File([json], `${name}.json`, { type: 'application/json' }));
        fd.append('file_type', 'json');
        const headers = c.getRequestHeaders(); delete headers['Content-Type'];
        await fetch('/api/characters/import', { method: 'POST', headers, body: fd });
        await c.getCharacters();
    }, { json, name });
}
const post = (url, body) => ev(async ({ url, body }) => {
    const c = SillyTavern.getContext();
    const r = await fetch(url, { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify(body) });
    return r.ok ? r.json().catch(() => ({})) : Promise.reject(new Error(`${url} ${r.status}`));
}, { url, body });
const shot = async (name) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`) }); };

// ---------------------------------------------------------------- solo chat
console.log('Solo chat');
// Use the companion preset's main prompt, so its rating gates are tested in a real prompt.
await ev((main) => { const p = SillyTavern.getContext().chatCompletionSettings.prompts.find(x => x.identifier === 'main'); p.content = main; },
    JSON.parse(readFileSync(join(root, 'dist/Narrator Companion.preset.json'), 'utf8')).prompts.find(p => p.identifier === 'main').content);
await importCard(readFileSync(join(root, 'dist/Narrator.card.json'), 'utf8'), 'Narrator');
await ev(() => {
    const c = SillyTavern.getContext();
    c.powerUserSettings.persona_description = 'Rowan is a wiry courier, fast on their feet, new to the village.';
    // Not awaited: SillyTavern asks whether to import the card's embedded lorebook and waits for the answer.
    c.selectCharacterById(c.characters.findIndex(x => x.name === 'Narrator'));
});
await sleep(2000);
// Decline SillyTavern's offer to import the embedded lorebook: the director must make it work unbound.
for (let i = 0; i < 3; i++) { const no = page.locator('dialog[open] .popup-button-cancel').last(); if (await no.count()) await no.click().catch(() => { }); await sleep(500); }
// A solo chat with no premise waits for the player's first message before drafting the story profile (since 19 Nov).
// Give it the documented solo setup, a scenario, so the profile is drafted at chat start.
await ev(async () => {
    const c = SillyTavern.getContext();
    c.chatMetadata.scenario = 'A fantasy village in a drought year. Someone has poisoned the old well at Greywell, and the courier Rowan has just arrived.';
    await c.saveMetadata();
    await window.narratorDirector.director.kick();
});
await idle();

await check('the director is active only for the narrator card, and the neutral greeting is not read', async () => {
    assert(await ev(() => window.narratorDirector.active()), 'not active');
    assert(mock.log.filter(l => l.kind === 'observer').length === 0, 'observer read the neutral greeting');
});
await check('chat start: the story profile is drafted and mirrored as flags', async () => {
    const s = await view();
    assert(s.genre?.dominant === 'fantasy', `genre ${JSON.stringify(s.genre)}`);
    const vars = await ev(() => SillyTavern.getContext().chatMetadata.variables);
    assert(vars.nar_genre_fantasy === '1' && vars.nar.genre === 'fantasy', JSON.stringify(vars));
});

await send('I walk to the well and look around.');
await check('turn 1: brief sits just before the player message; story block and gated genre craft are in the prompt', async () => {
    const p = lastPrompt();
    const text = flat(p);
    const briefAt = p.findIndex(m => String(m.content).startsWith('<director_notes>\n'));
    const userAt = p.map(m => m.role).lastIndexOf('user');
    assert(briefAt !== -1, 'no brief in prompt');
    assert(briefAt === userAt - 1 && p[briefAt].role === 'system', `brief at ${briefAt}, player at ${userAt}`);
    assert(storyOf(p).includes('genre: fantasy'), 'story block missing');
    assert(text.includes('Fantasy craft:'), 'fantasy craft entry did not fire');
    assert(!text.includes('Horror craft:') && !text.includes('{{if'), 'ungated or unresolved lore');
    assert((text.match(/<director_notes>\n/g) ?? []).length === 1, 'brief sent more than once');
});
await check('the reply is read: quoted facts recorded, the unquoted one rejected, place and cast established', async () => {
    const s = await view();
    assert(s.canon.length >= 2, `canon ${s.canon.length}`);
    assert(!s.canon.some(f => f.fact.includes('cheese')), 'unquoted fact accepted');
    assert(s.meta.rejected >= 1, 'no rejection counted');
    assert(s.scene.location.established && s.scene.location.value === 'the Greywell Square', JSON.stringify(s.scene.location));
    assert(s.scene.present.includes('Mira') && s.cast.Mira, 'Mira not in cast');
});
await check('the planner ran after the first reply; the player profile was derived from the persona', async () => {
    const s = await view();
    assert(s.arc?.goal && s.beats.length === 2, `arc ${!!s.arc} beats ${s.beats.length}`);
    assert(s.cast.Rowan?.pc && s.cast.Rowan.stats, 'no PC profile');
});

mock.control.narration = 'Mira smiles and hands you the bucket at the Greywell Square. Old Tam spits and looks away from the water. A grey film clings to the rim of the bucket.';
await send('I try to outrun Mira to the well.');
await check('turn 2: one intent, never the queue; cast lines in words; lore keys reach World Info only by scan', async () => {
    const text = flat(lastPrompt());
    const brief = briefOf(lastPrompt());
    assert(brief.includes('scene_intent: let the bitter taste'), `no intent in ${brief}`);
    assert(!text.includes('SECRET_SECOND_BEAT'), 'the queue leaked into the prompt');
    assert(/- Mira, toward Rowan: neutral/.test(brief), `no cast line: ${brief}`);
    assert(!/\d/.test(brief.replace(/turn \d+/g, '')), `a number reached the narrator: ${brief}`);
    const scan = await ev(() => window.narratorDirector.brief().scan);
    assert(scan.includes('Mira') && scan.includes('Greywell'), `scan text: ${scan}`);
    assert(!text.includes(scan), 'the scan-only block was sent');
});
await check('/listvar-visible variables hold no beat, clue or belief', async () => {
    const vars = JSON.stringify(await ev(() => SillyTavern.getContext().chatMetadata.variables));
    for (const secret of ['bitter', 'SECRET', 'grey film', 'poisoned', 'miller']) assert(!vars.includes(secret), `${secret} in variables`);
    assert(vars.includes('nar_trust_mira_'), 'no trust band flag');
});

await send('I taste the water.');
await check('dynamic lore: a place mentioned in two accepted replies is loaded into World Info', async () => {
    const book = await ev(() => window.narratorDirector.lorebook());
    assert(book.entries.some(e => e.keys.includes('Greywell Square')), `entries ${JSON.stringify(book.entries.map(e => e.keys))}`);
    await send('I wait.');
    assert(flat(lastPrompt()).includes('the Greywell Square is a place in this story.'), 'dynamic entry not in prompt');
});

await check('the director\'s books exist as real files, so lookups by other extensions do not warn', async () => {
    const names = await ev(() => SillyTavern.getContext().getWorldInfoNames());
    assert(names.includes('Narrator dynamic lore') && names.includes('Narrator baseline'), `world names: ${names}`);
    await ev(() => { window.__warned = 0; const w = toastr.warning; toastr.warning = (...a) => { window.__warned++; return w.apply(toastr, a); }; });
    const dyn = await slash('/wi-get-timed-effect file="Narrator dynamic lore" effect=sticky 900000');
    const base = await slash('/wi-get-timed-effect file="Narrator baseline" effect=sticky 0');
    assert(dyn === 'false' && base === 'false', `results: ${dyn} / ${base}`);
    assert(await ev(() => window.__warned) === 0, 'a lookup warned');
});

await check('swipe: the rejected swipe leaves nothing behind', async () => {
    mock.control.narration = 'Captain Hale rides into the Greywell Square with six riders. The crowd falls silent at once.';
    const before = (await view()).canon.length;
    await ev(() => SillyTavern.getContext().swipe.right());
    await page.waitForFunction(() => SillyTavern.getContext().chat.at(-1).mes.includes('Captain Hale'), null, { timeout: 30000 });
    await idle();
    const s = await view();
    assert(s.canon.some(f => f.fact.includes('Captain Hale rides')), 'new swipe not read');
    const last = await ev(() => SillyTavern.getContext().chat.at(-1).swipes[0]);
    assert(!s.canon.some(f => last.includes(f.fact) && !f.fact.includes('Hale') && f.turn === s.meta.turn), 'old swipe facts remain');
    assert(s.canon.length <= before + 2, 'canon grew by more than the new swipe');
    const prompt = flat(lastPrompt());
    assert(briefOf(lastPrompt()), 'no brief on swipe');
    void prompt;
});

await check('a forced leak is absent from the saved reply and from the next prompt', async () => {
    mock.control.leak = true;
    await send('I greet the captain.');
    mock.control.leak = false;
    const saved = await ev(() => { const m = SillyTavern.getContext().chat.at(-1); return m.mes + JSON.stringify(m.swipes ?? []); });
    assert(!saved.includes('director_notes'), `leak saved: ${saved.slice(0, 120)}`);
    await send('I step back.');
    const assistant = lastPrompt().filter(m => m.role === 'assistant').map(m => m.content).join('\n');
    assert(!assistant.includes('director_notes'), 'leak fed back');
});

await check('a contradiction is flagged and the next brief carries the correction', async () => {
    mock.control.contradict = true;
    await send('I listen.');
    mock.control.contradict = false;
    await send('I ask who spoke.');
    assert(flat(lastPrompt()).includes('correction: Old Tam is dead'), 'no correction in brief');
    await send('I nod.');
    assert(!flat(lastPrompt()).includes('correction:'), 'correction sent twice');
});

await check('deleting the last exchange rolls state back; committed state before it is unchanged', async () => {
    const before = await view();
    await slash('/del 2');
    await idle();
    const after = await view();
    assert(after.meta.turn === before.meta.turn - 1, `turn ${before.meta.turn} -> ${after.meta.turn}`);
    // Repeated sentences are collapsed in canon, so the deleted reply's own trace is its summary.
    assert(after.summaries.recent.length === before.summaries.recent.length - 1 && after.canon.length <= before.canon.length, 'the deleted reply left state behind');
    assert(JSON.stringify(after.canon.slice(0, 3)) === JSON.stringify(before.canon.slice(0, 3)), 'earlier canon changed');
});

await check('/director retcon removes the fact and tells the narrator once per turn until it ages out', async () => {
    const fact = (await view()).canon[0].fact;
    await slash(`/director retcon: ${fact}`);
    const s = await view();
    assert(!s.canon.some(f => f.fact === fact) && s.tombstones.length === 1, `not retconned: ${s.tombstones.length} tombstones`);
    await send('I go on.');
    assert(flat(lastPrompt()).includes('did_not_happen:'), 'narrator not told');
});

await check('impersonate: the prompt carries no director notes', async () => {
    const n = narratorCalls().length;
    await slash('/impersonate await=true go');
    await sleep(1500);
    assert(narratorCalls().length > n, 'no impersonate call seen');
    assert(!briefOf(lastPrompt()) && !storyOf(lastPrompt()), 'notes in impersonate prompt');
    await ev(() => { document.querySelector('#send_textarea').value = ''; });
    await send('I carry on.');
    assert(briefOf(lastPrompt()), 'the brief did not come back after impersonate');
});

await check('summaries stay out while their messages are still in the prompt', async () => {
    const first = await ev(() => window.narratorDirector.firstIncluded());
    assert(Number.isFinite(first) && first <= 1, `firstIncluded ${first}`);
    assert(!storyOf(lastPrompt()).includes('The story so far'), 'summaries duplicated the chat history');
    assert((await view()).summaries.recent.length >= 3, 'no turn summaries recorded');
});

await check('dry runs change nothing: no state, variable or director call', async () => {
    const snap = async () => JSON.stringify([await view(), await ev(() => SillyTavern.getContext().chatMetadata.variables), mock.log.length]);
    const before = await snap();
    for (let i = 0; i < 5; i++) await ev(() => SillyTavern.getContext().generate('normal', {}, true));
    assert(await snap() === before, 'dry run changed something');
});

await check('inspector: the scene form saves a location with a comma, and the edit reaches the narrator as a note', async () => {
    await slash('/director inspect');
    await page.click('#nd-inspector [data-nd-tab="scene"]');
    await page.fill('#nd-body [data-f="location"]', 'the Mill Yard, east side');
    await page.fill('#nd-body [data-f="mood"]', 'tense');
    await page.fill('#nd-body [data-f="add"]', 'Captain Hale');
    assert(await page.textContent('#nd-unsaved') === 'unsaved changes', 'no unsaved marker');
    await shot('inspector-scene');
    await page.click('#nd-body [data-act="save-scene"]');
    const s = await view();
    assert(s.scene.location.value === 'the Mill Yard, east side' && s.scene.mood === 'tense', JSON.stringify(s.scene));
    assert(s.scene.present.includes('Captain Hale') && s.scene.present.includes('Mira'), `present: ${s.scene.present}`);
    await send('I look around the yard.');
    assert(flat(lastPrompt()).includes('note: the record of scene was corrected'), 'no operation note');
});

await check('inspector: every tab renders with nothing folded away, and forms on cast, plan and record work', async () => {
    await slash('/director inspect');
    for (const t of ['now', 'scene', 'cast', 'story', 'plan', 'record', 'log']) {
        await page.click(`#nd-inspector [data-nd-tab="${t}"]`);
        const info = await ev(() => ({ text: document.querySelector('#nd-body').innerText.length, folded: document.querySelectorAll('#nd-body details').length, error: /TypeError|ReferenceError/.test(document.querySelector('#nd-body').innerText) }));
        assert(info.text > 40 && info.folded === 0 && !info.error, `${t}: ${JSON.stringify(info)}`);
        await shot(`inspector-${t}`);
    }
    // Full disclosure: every setting has a control, hints are visible text, and the Log tab shows the whole state.
    const disclosed = await ev(() => {
        const set = document.querySelector('#nd-settings-body');
        const keys = Object.keys(SillyTavern.getContext().extensionSettings.narrator_director);
        const html = set.innerHTML;
        const has = { enabled: '#nd-enabled', profile: '#nd-profile', profiles: '[data-nd-module]', setTemps: '#nd-temps', placement: '#nd-placement', rating: '#nd-rating', greetings: '#nd-greetings', mirrorLore: '#nd-mirror', tokens: '[data-nd-token]', memory: '#nd-memory', memoryProvider: '#nd-memory-provider', memoryMacro: '#nd-memory-macro', stripTags: '#nd-strip' };
        // One-time migration markers are not settings (cadenceEvents: timed re-plans moved to off once, 18 Nov 2026).
        const internal = new Set(['cadenceEvents']);
        const missing = keys.filter(k => !internal.has(k)).filter(k => !(has[k] ? set.querySelector(has[k]) : set.querySelector(`[data-nd-num="${k}"]`)));
        return { missing, tooltips: set.querySelectorAll('[title]').length, hints: set.querySelectorAll('.nd-hint').length, folded: /<details/.test(html) };
    });
    assert(disclosed.missing.length === 0, `settings with no control: ${disclosed.missing}`);
    assert(disclosed.tooltips === 0 && disclosed.hints > 10 && !disclosed.folded, JSON.stringify(disclosed));
    await page.click('#nd-inspector [data-nd-tab="log"]');
    const logText = await page.innerText('#nd-body');
    assert(logText.includes('nar_genre_fantasy = 1') && logText.includes('"lastPlanTurn"'), 'variables or full state not shown');
    await page.click('#nd-inspector [data-nd-tab="record"]');
    assert((await page.innerText('#nd-body')).includes('seen by'), 'witnesses not shown');
    await page.click('#nd-inspector [data-nd-tab="plan"]');
    await page.fill('#nd-beats .nd-beat:first-child [data-f="clues"]', 'a grey film on the bucket | place | the well\na torn ledger page | person | the miller');
    await page.click('#nd-body [data-act="add-scene"]');
    await page.fill('#nd-scenes .nd-scene:last-child [data-f="purpose"]', 'a quiet evening');
    await page.fill('#nd-scenes .nd-scene:last-child [data-f="focus"]', 'Mira: at ease');
    await page.click('#nd-body [data-act="save-scenes"]');
    await page.click('#nd-inspector [data-nd-tab="plan"]');
    await page.fill('#nd-beats .nd-beat:first-child [data-f="clues"]', 'a grey film on the bucket | place | the well\na torn ledger page | person | the miller');
    await page.click('#nd-body [data-act="save-beats"]');
    let planned = await view();
    assert(planned.scenes.some(x => x.purpose === 'a quiet evening' && x.focus.Mira === 'at ease'), 'scene not saved');
    assert(planned.beats.find(b => b.status === 'queued').clues.length === 2, 'clues not saved');
    await page.click('#nd-inspector [data-nd-tab="cast"]');
    await page.fill('#nd-body [data-name="Mira"] [data-f="tells.devoted"]', 'hums while she works beside you');
    await page.fill('#nd-body [data-name="Mira"] [data-f="rel.trust"]', '6');
    await page.fill('#nd-body [data-name="Mira"] [data-f="rel.affection"]', '6');
    await page.fill('#nd-body [data-name="Mira"] [data-f="statuses"]', 'twisted ankle (serious)');
    await page.click('#nd-body [data-name="Mira"] [data-act="save-cast"]');
    let s = await view();
    assert(s.cast.Mira.rel.trust === 6 && s.cast.Mira.statuses[0]?.severity === 'serious', JSON.stringify(s.cast.Mira.rel));
    await page.click('#nd-inspector [data-nd-tab="plan"]');
    await page.click('#nd-body [data-act="add-beat"]');
    await page.fill('#nd-beats .nd-beat:last-child [data-f="pressure"]', 'a stranger asks for water');
    await page.click('#nd-body [data-act="save-beats"]');
    s = await view();
    assert(s.beats.some(b => b.intent === 'a stranger asks for water' && b.status === 'queued'), 'beat not saved');
    await page.click('#nd-inspector [data-nd-tab="record"]');
    const before = s.canon.length;
    await page.click('#nd-body [data-act="retcon"]');
    s = await view();
    assert(s.canon.length === before - 1 && s.tombstones.length >= 1, 'fact not undone');
    await page.click('#nd-close');
    await send('I greet Mira.');
    assert(/- Mira, toward Rowan: devoted \(hums while she works beside you/.test(briefOf(lastPrompt())), `cast line: ${briefOf(lastPrompt())}`);
});

await check('a branch rebuilds its own state from its own messages', async () => {
    const full = await view();
    const state = await ev(async () => {
        const c = SillyTavern.getContext();
        const { replay } = await import('/scripts/extensions/third-party/narrator-director/core/state.js');
        const branch = structuredClone(c.chat.slice(0, 5));
        return replay(branch, { narrator: window.narratorDirector.ref(), setup: { ...c.chatMetadata.narrator_director.setup, player: c.name1 } });
    });
    assert(state.meta.turn === 2 && state.summaries.recent.length < full.summaries.recent.length && state.tombstones.length === 0 && state.scene.mood !== 'tense', `turn ${state.meta.turn}, ${state.tombstones.length} undone`);
});

await check('rating: mature by default (explicit on, lethality high); /director pg turns adult content off in lore and preset', async () => {
    let vars = await ev(() => SillyTavern.getContext().chatMetadata.variables);
    assert(vars.nar_explicit === '1' && vars.nar_lethality_high === '1' && !vars.nar_pg, `defaults: ${JSON.stringify(vars)}`);
    let text = flat(lastPrompt());
    assert(text.includes('Explicit content is part of this story') && text.includes('everyone involved is an adult'), 'explicit entry missing by default');
    assert(text.includes('## 7. Adult Content') && text.includes('for an adult audience') && !text.includes('{{'), 'mature preset sections missing or unresolved');
    await slash('/director pg');
    await send('I sit by the fire.');
    text = flat(lastPrompt());
    vars = await ev(() => SillyTavern.getContext().chatMetadata.variables);
    assert(vars.nar_pg === '1' && !vars.nar_explicit, `pg flags: ${JSON.stringify(vars)}`);
    assert(text.includes('This story is rated PG') && !text.includes('Explicit content is part of this story'), 'PG lore entry not in effect');
    assert(!text.includes('## 7. Adult Content') && !text.includes('for an adult audience') && text.includes('up to the closed door'), 'preset did not switch to PG');
    assert(storyOf(lastPrompt()).includes('rating: PG'), 'story profile line missing');
    await slash('/director pg off');
    await send('I stand up.');
    text = flat(lastPrompt());
    assert(text.includes('## 7. Adult Content') && text.includes('Explicit content is part of this story'), 'mature rating did not come back');
});

await check('disabled: no notes, no flags, card still narrates', async () => {
    await slash('/director off');
    await send('I breathe.');
    const text = flat(lastPrompt());
    assert(!briefOf(lastPrompt()) && !storyOf(lastPrompt()) && !text.includes('Fantasy craft:'), 'director output while disabled');
    const vars = await ev(() => SillyTavern.getContext().chatMetadata.variables);
    assert(!Object.keys(vars).some(k => k.startsWith('nar')), 'flags remain');
    await slash('/director on');
    await idle();
});

await check('a failing part is shown: a toast once, a dot on the menu entry, a banner in the panel; recovery clears them', async () => {
    mock.control.failObserver = true;
    await send('I wait by the well.');
    await sleep(500);
    const shown = await ev(() => ({
        toast: [...document.querySelectorAll('#toast-container .toast-warning')].map(t => t.textContent).join(' | '),
        failing: Object.keys(window.narratorDirector.director.failing),
        dot: document.querySelector('#nd-wand .nd-badge')?.textContent ?? '',
    }));
    assert(/reading replies failed/.test(shown.toast) && /wrong shape/.test(shown.toast), 'toast: ' + shown.toast);
    assert(shown.failing.includes('observer') && shown.dot === '1', JSON.stringify(shown));
    await ev(() => document.querySelector('#nd-wand')?.click());
    await sleep(300);
    const banner = await ev(() => document.querySelector('#nd-body .nd-failing')?.textContent ?? '');
    assert(/reading replies/.test(banner) && /Retry now/.test(banner), 'banner: ' + banner);
    mock.control.failObserver = false;
    await ev(() => window.narratorDirector.director.retry());
    await idle();
    const after = await ev(() => ({ failing: Object.keys(window.narratorDirector.director.failing), dot: !!document.querySelector('#nd-wand .nd-badge'), ok: [...document.querySelectorAll('#toast-container .toast-success')].map(t => t.textContent).join(' | ') }));
    assert(!after.failing.length && !after.dot, JSON.stringify(after));
    assert(/reading replies works again/.test(after.ok), 'no recovery toast: ' + after.ok);
    await ev(() => document.querySelector('#nd-close')?.click());
});
await check('director calls go through a Connection Manager profile when one is chosen', async () => {
    await ev((url) => {
        const c = SillyTavern.getContext();
        (c.extensionSettings.connectionManager.profiles ??= []).push({ id: 'nd-test-profile', name: 'Director (mock)', mode: 'cc', api: 'custom', model: 'mock', 'api-url': url });
        c.extensionSettings.narrator_director.profile = 'nd-test-profile';
    }, `http://127.0.0.1:${MOCK}/v1`);
    const n = mock.log.filter(l => l.kind === 'observer').length;
    await send('I keep walking.');
    assert(mock.log.filter(l => l.kind === 'observer').length === n + 1, 'no observer call through the profile');
    assert(mock.log.filter(l => l.kind === 'observer').at(-1).temperature === 0.2, `observer temperature: ${mock.log.filter(l => l.kind === 'observer').at(-1).temperature}`);
    const errors = await ev(() => window.narratorDirector.director.errors);
    assert(errors.length === 0, JSON.stringify(errors));
    const s = await view();
    assert(!s.meta.lagging, 'the reply was not read');
});

// ---------------------------------------------------------------- group chat
console.log('Group chat');
const castCard = (name, desc, world) => JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: desc, personality: '', scenario: '', first_mes: `${name} greets you from a cast card.`, mes_example: '', alternate_greetings: [], tags: [], extensions: world ? { world } : {} } });
await post('/api/worldinfo/edit', { name: 'MiraBook', data: { entries: { 0: { uid: 0, key: ['heirloom'], keysecondary: [], comment: 'heirloom', content: 'MIRA_LORE: the heirloom is a brass compass.', constant: false, selective: false, order: 100, position: 0, disable: false, probability: 100, useProbability: true, depth: 4 } } } });
await importCard(castCard('Mira', '{{char}} is a sharp-tongued well keeper.', 'MiraBook'), 'Mira');
await importCard(castCard('Old Tam', '{{char}} is a tired ferryman.'), 'Old Tam');
await ev(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/closechat'));
await sleep(800);
await ev(async () => {
    const c = SillyTavern.getContext();
    const av = (n) => c.characters.find(x => x.name === n).avatar;
    const headers = c.getRequestHeaders();
    const r = await fetch('/api/groups/create', { method: 'POST', headers, body: JSON.stringify({ name: 'Greywell', members: [av('Mira'), av('Narrator'), av('Old Tam')], avatar_url: '', allow_self_responses: false, activation_strategy: 0, generation_mode: 0, disabled_members: [], chat_metadata: {}, fav: false, chat_id: String(Date.now()), chats: [String(Date.now())] }) });
    const group = await r.json();
    await c.getCharacters();
    const { getGroups } = await import('/scripts/group-chats.js');
    await getGroups();
    await c.openGroupChat?.(group.id) ?? (await import('/scripts/group-chats.js')).openGroupById(group.id);
});
await sleep(2500);
await closePopups();
await idle();

await check('fresh group chat: the narrator opens with her group greeting; cast greetings are hidden and never read', async () => {
    const msgs = await ev(() => SillyTavern.getContext().chat.map(m => ({ name: m.name, mes: m.mes.slice(0, 40), hidden: !!m.is_system })));
    const nar = msgs.find(m => m.name === 'Narrator');
    assert(nar?.mes.startsWith('*The company is gathered'), `narrator greeting: ${JSON.stringify(msgs)}`);
    assert(msgs.filter(m => m.name !== 'Narrator').every(m => m.hidden), 'cast greeting visible to the prompt');
    assert(mock.log.filter(l => l.kind === 'observer' && flat(l.messages).includes('greets you from a cast card')).length === 0, 'cast greeting was read');
});
await check('group setup: only the narrator is unmuted; a small cast uses join mode', async () => {
    await slash('/director setup');
    await sleep(800);
    const g = await ev(() => { const c = SillyTavern.getContext(); const g = c.groups.find(x => x.id === c.groupId); return { mode: g.generation_mode, muted: g.disabled_members.length }; });
    assert(g.muted === 2 && g.mode === 2, JSON.stringify(g));
});
await check('join mode: only the narrator generates, cast cards are in the prompt, and a muted member\'s lorebook fires', async () => {
    const n = narratorCalls().length;
    await send('I ask Mira about the heirloom.');
    assert(narratorCalls().length === n + 1, `${narratorCalls().length - n} generations`);
    const last = await ev(() => SillyTavern.getContext().chat.at(-1).name);
    assert(last === 'Narrator', `reply by ${last}`);
    const text = flat(lastPrompt());
    assert(text.includes('Mira is a sharp-tongued well keeper') && text.includes('Old Tam is a tired ferryman'), 'cast cards missing');
    assert(text.includes('MIRA_LORE'), 'muted member lore did not fire');
    assert(briefOf(lastPrompt()), 'no brief in group');
});
await check('cast profiles are derived from the cards', async () => {
    const s = await view();
    assert(s.cast.Mira?.stats?.agility === 66 && s.cast.Mira.tells?.warm, JSON.stringify(s.cast.Mira?.stats));
});
await check('cast-size rule: above the limit the group swaps and the director injects the cast; disabling restores join mode', async () => {
    await ev(() => { SillyTavern.getContext().extensionSettings.narrator_director.castLimit = 1; });
    await ev(() => SillyTavern.getContext().eventSource.emit('group_updated'));
    await sleep(1000);
    let mode = await ev(() => { const c = SillyTavern.getContext(); return c.groups.find(x => x.id === c.groupId).generation_mode; });
    assert(mode === 0, `mode ${mode}`);
    // Presence is additive, so Old Tam leaves the scene only when it moves somewhere else.
    mock.control.narration = 'Mira leads you alone into the Mill Yard beyond the houses. Nobody else is in sight this morning.';
    await send('I walk on with Mira.');
    await send('I look at Mira.');
    const text = flat(lastPrompt());
    const story = storyOf(lastPrompt());
    assert(story.includes('Characters in the scene:') && story.includes('[Mira]'), `no injected cast: ${story.slice(0, 300)}`);
    assert(story.includes('Other characters (not in the scene):') && story.includes('- Old Tam: Old Tam in brief.'), 'no short profile for absent cast');
    await slash('/director off');
    await sleep(800);
    mode = await ev(() => { const c = SillyTavern.getContext(); return c.groups.find(x => x.id === c.groupId).generation_mode; });
    assert(mode === 2, `mode after disable ${mode}`);
});

await check('no page errors from the extension', async () => assert(pageErrors.length === 0, pageErrors.join(' | ')));

// ---------------------------------------------------------------- done
await browser.close();
server.kill();
mock.server.close();
rmSync(dataRoot, { recursive: true, force: true });
const failed = results.filter(r => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
