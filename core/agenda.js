// Wants (M1, ideas D1 + D3, simplified by the owner on 19 Nov 2026): every cast character may have up to three
// high-level wants, what they live for ("a happy family", "amass a fortune", "to be loved", "keep the inn's silence").
// They are stable: no trigger, no expiry, no observer check. Short-term wants live in the plan's openings instead.
// The spine drafts them for the people the material names; the planner seeds them for others (a few per plan) and
// changes a character's wants only when the story has transformed one (achieved, lost, betrayed), saying why. The
// player edits them on the Cast tab; a character whose wants the player cleared is never given new ones by the planner.
//
// state.agendas = { [name]: { wants: [''], since: turn, by: 'setup' | 'director' | 'player' } }
// The narrator sees them on that character's cast line, only while the character is present.

import { normalise, looksLikeName } from './text.js';
import { arr, clip, isObj, nameKey, str } from './util.js';

export const AGENDA_CAPS = { wants: 3, text: 100, seed: 3, listed: 20 };

/** Up to three wants, each cut short, duplicates dropped. Takes a list, one string, or an old agenda's `want`. */
export function cleanWants(raw) {
    // A model may give "wants" as one string instead of a list; an old agenda has a single "want".
    const list = Array.isArray(raw) ? raw : isObj(raw) ? (Array.isArray(raw.wants) ? raw.wants : [raw.wants ?? raw.want]) : [raw];
    const seen = new Set();
    const out = [];
    for (const w of list) {
        const t = clip(w, AGENDA_CAPS.text);
        if (!t || seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        out.push(t);
        if (out.length >= AGENDA_CAPS.wants) break;
    }
    return out;
}

/** One character's wants as stored, or null when there are none. Accepts the old { want, trigger, expires } shape. */
export function cleanAgenda(raw) {
    const wants = cleanWants(raw);
    return wants.length ? { wants } : null;
}

/** A character's wants (never the player character's, never a dead character's). */
export function wantsOf(state, name) {
    if (!name || name === state.meta?.player || state.cast?.[name]?.pc || state.cast?.[name]?.dead) return [];
    return cleanWants(state.agendas?.[name]);
}

/** The wants as the narrator's cast line shows them, or ''. */
export const wantOf = (state, name) => wantsOf(state, name).join('; ');

/**
 * Resolve a model's name to a character who may have wants: a known cast name (exactly, or the one cast name that
 * shares every word with it), else a proper name the story material uses (every word of it). Never the player.
 */
export function agendaName(who, { cast = [], player = '', material = '' } = {}) {
    const k = nameKey(who);
    if (!k) return '';
    const isPlayer = (n) => {
        const p = nameKey(player);
        if (!p) return false;
        const a = n.split(' '), b = p.split(' ');
        return n === p || a.every(t => b.includes(t)) || b.every(t => a.includes(t));
    };
    if (isPlayer(k)) return '';
    const exact = cast.find(n => nameKey(n) === k);
    if (exact) return exact;
    const tok = k.split(' ');
    const hits = cast.filter(n => { const kt = nameKey(n).split(' '); return tok.every(t => kt.includes(t)) || kt.every(t => tok.includes(t)); });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return '';
    const name = str(who, 60);
    const hay = ` ${normalise(material)} `;
    const n = normalise(name);
    // "Elizabeth Juringen" stands when the material says "the Juringen sisters, Elizabeth and Dorothy" (live, 19 Nov 2026).
    return n && looksLikeName(name) && n.split(' ').every(t => hay.includes(` ${t} `)) ? name : '';
}

/** The spine drafter's wants: for every character it names who is in the cast or the material, one entry each. */
export function validateAgendas(raw, state, material = '') {
    const player = state.meta?.player ?? '';
    const cast = Object.keys(state.cast ?? {}).filter(n => !state.cast[n].pc && !state.cast[n].dead);
    const seen = new Set();
    const out = [];
    for (const it of arr(raw)) {
        if (!isObj(it) || out.length >= AGENDA_CAPS.listed) continue;
        const name = agendaName(it.who ?? it.name ?? it.character, { cast, player, material });
        const a = name && !seen.has(name) ? cleanAgenda(it) : null;
        if (!a) continue;
        seen.add(name);
        out.push({ name, ...a });
    }
    return out;
}

const isCleared = (state, name) => arr(state.meta?.clearedAgendas).includes(name);

/** Characters in the cast with no wants that the planner may give some: main cast, then present, then known most. */
export function seedCandidates(state, n = AGENDA_CAPS.seed) {
    const weight = (k) => { const c = state.cast[k]; return (c.main ? 1000 : 0) + (state.scene?.present?.includes(k) ? 100 : 0) + arr(c.knows).length; };
    return Object.keys(state.cast ?? {})
        .filter(k => !state.cast[k].pc && !state.cast[k].dead && k !== state.meta?.player && !wantsOf(state, k).length && !isCleared(state, k))
        .sort((a, b) => weight(b) - weight(a)).slice(0, n);
}

/**
 * The planner's wants: for a character with none (never one the player cleared), or a change to a character's wants
 * when the story has transformed one, which needs "why" (a few words naming what happened).
 */
export function validateRenewals(raw, state) {
    const player = state.meta?.player ?? '';
    const cast = Object.keys(state.cast ?? {}).filter(n => !state.cast[n].pc && !state.cast[n].dead);
    const seen = new Set();
    const out = [];
    for (const it of arr(raw)) {
        if (!isObj(it) || out.length >= AGENDA_CAPS.listed) continue;
        const name = agendaName(it.who ?? it.name ?? it.character, { cast, player });
        if (!name || seen.has(name)) continue;
        const a = cleanAgenda(it);
        if (!a) continue;
        const why = clip(it.why ?? it.reason, 160);
        if (wantsOf(state, name).length) {
            if (why.split(/\s+/).filter(Boolean).length < 3) continue; // a change needs what the story did
        } else if (isCleared(state, name)) continue;
        seen.add(name);
        out.push({ name, ...a, ...(why ? { why } : {}) });
    }
    return out;
}

/** The 'agendas' op (by setup, with the spine): sets the wants it carries, one entry per character. */
export function applyAgendaOp(state, op) {
    if (op.kind !== 'agendas') return false;
    // Entries of the first agenda design (a single "want" with trigger and expiry) were short-term; they lapse, and the
    // planner gives that character lasting wants instead.
    for (const it of arr(op.value).filter(x => Array.isArray(x?.wants))) {
        const a = cleanAgenda(it);
        const name = str(it?.name, 60);
        // A spine redraft never overwrites wants the player wrote.
        if (a && name && !isCleared(state, name) && state.agendas?.[name]?.by !== 'player') (state.agendas ??= {})[name] = { ...a, since: state.meta.turn, by: op.by ?? 'setup' };
    }
    return true;
}

/** Wants in a plan op. Checked again on replay: a change needs its why; a cleared character gets none. */
export function applyPlanAgendas(state, v) {
    for (const it of arr(v?.agendas).filter(x => Array.isArray(x?.wants))) {
        const name = str(it?.name, 60);
        const a = cleanAgenda(it);
        if (!name || !a || state.cast?.[name]?.pc || state.cast?.[name]?.dead) continue;
        if (wantsOf(state, name).length ? !str(it.why) : isCleared(state, name)) continue;
        (state.agendas ??= {})[name] = { ...a, since: state.meta.turn, by: 'director' };
    }
}

/** A rename moves the wants; a removal drops them. */
export function renameAgenda(state, from, to) {
    if (!state.agendas?.[from]) return;
    if (to && !state.agendas[to]) state.agendas[to] = state.agendas[from];
    delete state.agendas[from];
}

/** For the planner: each character's wants, and who may be given some. */
export function agendaLines(state) {
    const have = Object.keys(state.agendas ?? {}).filter(n => wantsOf(state, n).length).slice(0, AGENDA_CAPS.listed).map(n => {
        const where = state.scene?.present?.includes(n) ? 'in the scene' : 'away from the player';
        return `${n} (${where}): wants ${wantsOf(state, n).join('; ')}`;
    });
    return have.concat(seedCandidates(state).map(n => `${n}: no wants yet (may be given some)`));
}
