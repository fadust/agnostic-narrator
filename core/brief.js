// The brief is composed in code from replayed state. It carries the current beat's intent, never the queue.

import { CAPS } from './enums.js';
import { castLine, comparisons, detectAttempt, detectExchange, pcLine } from './social.js';
import { chapters } from './spine.js';
import { wantOf } from './agenda.js';
import { activeBeat } from './state.js';
import { FALLBACK_NOTE } from './text.js';
import { arr, nameKey, roughTokens } from './util.js';

export const BRIEF_TOKEN_CAP = 300;
const LARGE_CAST = 4;
const RETCON_MEMORY = 8;

/** Who has had the least of the recent narration. Code only. */
export function spotlight(state, recentNarration, talkativeness = {}, playerMessage = '') {
    const present = state.scene.present.filter(n => !state.cast[n]?.dead);
    if (present.length < 2) return null;
    const hay = recentNarration.map(t => t.toLowerCase());
    const addressed = nameKey(playerMessage);
    let best = null, bestScore = -Infinity;
    for (const n of present) {
        const key = n.toLowerCase();
        const first = key.split(' ')[0];
        let mentions = 0;
        hay.forEach((t, i) => { if (t.includes(key) || t.includes(first)) mentions += 1 + i / hay.length; });
        const talk = talkativeness[n] ?? 0.5;
        // Quiet lately scores high; the player speaking to someone outweighs it.
        const score = talk * 2 - mentions + (addressed.includes(first) ? 5 : 0);
        if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
}

function pressureLine(state, beat) {
    const last = state.meta.beatLog.slice(-2);
    if (last.length === 2 && last.every(t => t === 'pressure')) return 'ease off (the last two beats were tense)';
    if (beat?.type === 'release' || beat?.type === 'reward') return 'low (a breather)';
    return state.arc?.tension ?? null;
}

/** Recent things a present character does not know, or wrongly believes. */
function watchLines(state) {
    const present = state.scene.present;
    const out = [];
    // Only facts the record marks as secret. Guessing ignorance from who was in the room produced lines like
    // "Bianca does not know: Bianca owns the tavern", which is worse than no line.
    for (const f of [...state.canon].reverse().slice(0, 40)) {
        if (out.length >= 2) break;
        if (!f.secret || f.retired) continue;
        const ignorant = present.filter(n => !arr(f.witnesses).includes(n));
        if (ignorant.length) out.push(`${ignorant.join(', ')} ${ignorant.length > 1 ? 'do' : 'does'} not know: ${f.fact}`);
    }
    for (const n of present) {
        const b = state.cast[n]?.beliefs?.filter(x => !x.true).at(-1);
        if (b && out.length < 3) out.push(`${n} wrongly believes: ${b.believes}`);
    }
    return out;
}

/**
 * @param {object} state Replayed view state.
 * @param {object} [opts]
 * @param {string} [opts.playerMessage] The message being answered, when there is one.
 * @param {string[]} [opts.recentNarration]
 * @param {Record<string, number>} [opts.talkativeness]
 * @param {number} [opts.tokenCap]
 * @returns {{text: string, scan: string, lines: Record<string,string|string[]>, fallback: boolean, offered: {beat: string|null, clues: string[]}}}
 */
export function buildBrief(state, opts = {}) {
    const { playerMessage = '', recentNarration = [], talkativeness = {}, tokenCap = BRIEF_TOKEN_CAP } = opts;
    const offered = { beat: null, clues: [] };
    if (state.meta.turn === 0 && !state.genre) {
        return { text: wrap([`status: ${FALLBACK_NOTE}`]), scan: '', lines: {}, fallback: true, lagging: false, offered };
    }
    // The director has not read the newest reply yet. Slow-moving notes (who, where, how people stand) are still
    // worth having and are marked as behind; anything that steers the scene is held back until it has caught up.
    const lagging = state.meta.lagging;
    const L = {};
    if (lagging) L.status = 'these notes are one reply behind; where the chat differs, the chat is right';
    const sc = state.scene;
    const present = sc.present.filter(n => !state.cast[n]?.dead);
    if (present.length) L.present = present.join(', ');
    if (sc.location.established) L.location = sc.location.value;
    if (sc.time.established) L.time = sc.time.value;
    if (sc.mood) L.mood = sc.mood;
    L.initiative = sc.initiative === 'world' ? 'world (events move without waiting)' : 'player (the scene waits on them)';
    const spot = spotlight(state, recentNarration, talkativeness, playerMessage);
    if (spot) L.spotlight = `${spot} (little attention lately)`;

    const beat = lagging ? null : activeBeat(state);
    if (beat) {
        offered.beat = beat.id;
        // The opening the world offers (the beat's pressure), never its goal. Beats stored before W1 have only intent.
        const opening = beat.pressure || beat.goal || beat.intent;
        L.scene_intent = beat.precondition ? `${opening} (only if: ${beat.precondition})` : opening;
        // Patience: after N replies untouched, the narrator is told once that the opening is still there. Never pressed.
        const nudge = Number(state.meta.nudgeAfter ?? 3);
        if (nudge > 0 && beat.waiting === nudge) L.waiting = 'that opening is still there if the player wants it; let it be noticed once more, lightly, and never press it';
        const clue = arr(beat.clues).find(c => !c.found);
        if (clue) {
            offered.clues.push(clue.id);
            L.clue = `${clue.text}${clue.where ? ` (${clue.where})` : ''} (found only through: ${clue.route})`;
        }
    }
    const pressure = pressureLine(state, beat);
    if (pressure) L.tension = pressure;
    if (sc.initiative === 'world' && !lagging) {
        const scene = state.scenes.find(s => s.id === beat?.scene) ?? state.scenes[0];
        const next = arr(scene?.if_unchallenged)[0];
        if (next) L.world_moves = next;
    }
    const focus = state.scenes.find(s => s.id === beat?.scene)?.focus;
    if (focus && spot && focus[spot]) L.focus = `${spot}: ${focus[spot]}`;

    const loreKeys = [...new Set([...arr(beat?.lore)])].slice(0, 3);
    // Lore keys go to the scan-only text below, never into the visible notes: shown, they read as things to mention.

    // Cast lines. Large casts: full lines for the addressed and the spotlight, band only for the rest.
    const addressed = nameKey(playerMessage);
    // An agenda reaches the narrator only as a want on that character's line, while they are present (M1). Never the
    // trigger, never an action.
    const fullOf = (n) => present.length <= LARGE_CAST || n === spot || state.cast[n]?.main || addressed.includes(n.toLowerCase().split(' ')[0]);
    const castLines = (full, wants) => present.map(n => {
        const line = castLine(state, n, full && fullOf(n));
        const want = wants && line ? wantOf(state, n) : '';
        return want ? `${line}; wants: ${want}` : line;
    }).filter(Boolean);
    const cast = castLines(true, true);
    const pc = pcLine(state);
    if (pc) cast.push(pc);
    if (cast.length) L.cast = cast;

    const exchange = detectExchange(playerMessage);
    if (exchange) {
        const cmp = comparisons(state, exchange.stat);
        L.exchange = cmp.length ? `${exchange.kind}; ${cmp.join('; ')}` : exchange.kind;
    }
    const attempt = detectAttempt(playerMessage, state);
    if (attempt) L.attempt = attempt.line.replace(/^attempt: /, '');

    const watch = watchLines(state);
    if (watch.length) L.watch = watch;

    const turn = state.meta.turn;
    const corrections = state.flags.filter(f => f.kind === 'contradiction' && f.turn === turn).map(f => f.correction);
    if (corrections.length) L.correction = corrections;
    const retcons = state.tombstones.filter(t => turn - t.turn <= RETCON_MEMORY).slice(-3).map(t => t.fact);
    if (retcons.length) L.did_not_happen = retcons;
    const notes = state.notes.filter(n => n.turn === turn).map(n => n.text);
    if (notes.length) L.note = notes;
    const settled = (state.settled ?? []).slice(-4).map(s => s.text);
    if (settled.length) L.settled = settled;
    const instr = state.instructions.filter(n => n.turn === turn && !n.quiet).map(n => n.text);
    if (instr.length) L.player_request = instr;

    // Fit the cap by dropping the least essential lines first. Corrections and intent are never dropped.
    const dropOrder = ['waiting', 'focus', 'world_moves', 'watch', 'time', 'tension', 'spotlight', 'mood', 'clue'];
    let text = wrap(render(L));
    for (const k of dropOrder) {
        if (roughTokens(text) <= tokenCap) break;
        delete L[k];
        text = wrap(render(L));
    }
    // Then the cast lines shorten: short lines that keep their wants (a few words, and what the character lives for),
    // then short lines alone (found live, 19 Nov 2026: wants were the first thing cut).
    for (const [full, wants] of [[false, true], [false, false]]) {
        if (roughTokens(text) <= tokenCap || !Array.isArray(L.cast)) break;
        L.cast = [...castLines(full, wants), ...(pc && (full || wants) ? [pc] : [])];
        text = wrap(render(L));
    }
    const scan = [...present, sc.location.established ? sc.location.value : '', ...loreKeys].filter(Boolean).join('\n');
    return { text, scan, lines: L, fallback: false, lagging, offered };
}

function render(L) {
    const out = [];
    for (const [k, v] of Object.entries(L)) {
        if (Array.isArray(v)) {
            if (k === 'cast') { out.push('cast:'); out.push(...v); }
            else for (const item of v) out.push(`${k}: ${item}`);
        } else if (v) out.push(`${k}: ${v}`);
    }
    return out;
}

const wrap = (lines) => `<director_notes>\n${lines.join('\n')}\n</director_notes>`;

/**
 * Premise, injected cast and summaries: the block that goes before the chat history.
 * @param {object} state
 * @param {object} opts
 * @param {{name: string, people?: string[], full: string, short: string}[]} [opts.cast] Only in swap mode (cast above the limit).
 * @param {number} [opts.firstIncluded] Chat index of the oldest message still in the prompt.
 */
/**
 * Names already in use: the cast (the player character included, the dead included, renamed-away names too, since they
 * may still be in the text) and lore names that read as a proper name. Sorted, capped at 60.
 */
export function takenNames(state, loreNames = []) {
    const out = new Map();
    const add = (n) => {
        const s = String(n ?? '').trim();
        // A proper name: starts with a capital letter, no leading article, at most four words.
        if (!s || !/^\p{Lu}/u.test(s) || /^(the|a|an)\s/i.test(s) || s.split(/\s+/).length > 4) return;
        if (!out.has(s.toLowerCase())) out.set(s.toLowerCase(), s);
    };
    for (const n of Object.keys(state.cast ?? {})) add(n);
    add(state.meta?.player);
    for (const n of Object.keys(state.meta?.renamedCast ?? {})) add(n);
    for (const n of arr(loreNames)) add(n);
    // People the story's own lore has named (dynamic lore drafts of kind "character").
    for (const l of arr(state.lore_drafts)) if (l.kind === 'character') add(arr(l.keys)[0]);
    return [...out.values()].sort((a, b) => a.localeCompare(b)).slice(0, 60);
}

export function buildStoryBlock(state, opts = {}) {
    // memory: 'director' sends the director's summaries and chapters; 'extension' (another extension owns the story's
    // memory and feeds the narrator) sends only the last 2 turns' summaries; 'off' sends none.
    const { cast = [], firstIncluded = 0, tokenCap = 1200, memory = 'director', unsummarised = null, loreNames = [] } = opts;
    const parts = [];
    if (state.premise) parts.push(`Premise: ${state.premise}`);
    if (state.genre) {
        const g = state.genre;
        const bits = [
            g.dominant && `genre: ${[g.dominant, ...arr(g.secondary)].join(' / ')}`,
            g.register && `register: ${g.register}`, g.pov && `point of view: ${g.pov}`, g.tempo && `tempo: ${g.tempo}`,
            g.stakes && `stakes: ${g.stakes}`, g.lethality && `lethality: ${g.lethality}`,
            g.explicit && 'explicit sexual content between adults is part of this story',
            g.pg && 'rating: PG. No explicit sex, no graphic gore, no slurs; danger and death are real but not dwelt on',
            arr(g.priority).length && `when goals conflict, protect in this order: ${g.priority.join(' > ')}`,
            arr(g.promises).length && `promises to keep: ${g.promises.join('; ')}`,
            arr(g.avoid).length && `avoid: ${g.avoid.join('; ')}`,
        ].filter(Boolean);
        if (bits.length) parts.push(`Story profile:\n${bits.map(b => `- ${b}`).join('\n')}`);
    }
    if (cast.length) {
        const present = new Set(state.scene.present);
        // A card is in the scene when any of the people it holds is.
        const isHere = (c) => (c.people ?? [c.name]).some(n => present.has(n));
        const here = cast.filter(isHere).map(c => c.full);
        const away = cast.filter(c => !isHere(c)).map(c => `- ${c.name}: ${c.short}`);
        if (here.length) parts.push(`Characters in the scene:\n${here.join('\n\n')}`);
        if (away.length) parts.push(`Other characters (not in the scene):\n${away.join('\n')}`);
    }
    // Appearance anchors: how those in the scene, and the player character, look. Sent while they are present,
    // so descriptions do not drift from reply to reply.
    const looks = [...state.scene.present.filter(n => !state.cast[n]?.dead), state.meta.player]
        .filter((n, i, all) => n && all.indexOf(n) === i && ['appearance', 'gender', 'race', 'age_group'].some(k => state.cast[n]?.[k]))
        .map(n => {
            const c = state.cast[n];
            const who = [c.gender, c.race, c.age_group].filter(Boolean).join(', ');
            return `- ${n}${who ? ` (${who})` : ''}${c.appearance ? `: ${c.appearance}` : ''}`;
        });
    if (looks.length) parts.push(`How they look (keep it consistent):\n${looks.join('\n')}`);
    // Names already taken (M3), made in code: so a new character never gets a name, or a first name, already in use.
    const taken = takenNames(state, loreNames);
    if (taken.length) parts.push(`Names already in use (never give a new character any of these names or first names): ${taken.join(', ')}`);
    // Concluded milestones only: how each stage of the story turned out. Milestones in progress are never sent.
    const done = memory === 'director' ? chapters(state) : [];
    if (done.length) parts.push(`Chapters so far:\n${done.map(c => `- ${c.title}: ${c.conclusion}`).join('\n')}`);
    // Summaries cover only what has left the prompt, so nothing is told twice.
    // A message hidden by the player has left the prompt too.
    const gone = memory === 'director' ? state.summaries.recent.filter(s => s.i < firstIncluded || s.hidden).map(s => s.text) : [];
    const story = memory === 'director' ? [state.summaries.rolled, ...gone].filter(Boolean) : [];
    // With another extension keeping the memory, that extension feeds the narrator the story so far, and the director
    // adds only its summaries of the last 2 turns: the stretch that extension has not summarised yet.
    // `unsummarised`: chat indices of replies that extension has no summary for. Unknown (null): all of the last 2.
    const pending = Array.isArray(unsummarised) ? new Set(unsummarised.map(Number)) : null;
    const latest = memory === 'extension' ? state.summaries.recent.slice(-2).filter(s => !pending || pending.has(s.i)).map(s => s.text).filter(Boolean) : [];
    if (latest.length) parts.push(`The last turns, in brief:\n${latest.map(t => `- ${t}`).join('\n')}`);
    if (story.length) {
        parts.push(`The story so far:\n${story.join('\n')}`);
        // Summaries are not rewritten after a retcon; the correction rides with them instead.
        const undone = state.tombstones.slice(-5).map(t => `- ${t.fact}`);
        if (undone.length) parts.push(`Disregard, these did not happen:\n${undone.join('\n')}`);
    }
    if (!parts.length) return { text: '', overflow: false };
    let text = `<story_context>\n${parts.join('\n\n')}\n</story_context>`;
    const overflow = roughTokens(text) > tokenCap;
    return { text, overflow, tokens: roughTokens(text) };
}

export { CAPS };
