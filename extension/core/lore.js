// The dynamic lorebook is derived, not stored: committed lore drafts in, entries out.
// Deleting a message or branching the chat changes the drafts, so the book follows without any cleanup code.

import { CAPS } from './enums.js';
import { normalise } from './text.js';
import { arr, nameKey, slug } from './util.js';

// A plain file-safe name: the book is mirrored to a real lorebook file so other tools can look its entries up.
const canonical = (k) => nameKey(k).replace(/^(the|a|an) /, '');

export const DYNAMIC_WORLD = 'Narrator dynamic lore';

/**
 * @param {object[]} drafts state.lore_drafts
 * @param {string[]} narrationTexts Committed narration texts, for the recurrence check.
 * @param {object} [opts]
 * @param {number} [opts.recurrence=2] How many committed replies must mention a thing before it earns an entry.
 * @param {string[]} [opts.exclude] Names that already have a character card.
 * @returns {{entries: object[], waiting: object[]}}
 */
export function buildLorebook(drafts, narrationTexts, opts = {}) {
    const { recurrence = 2 } = opts;
    const hay = narrationTexts.map(normalise);
    const { exclude = [] } = opts;
    const skip = new Set(exclude.map(canonical));
    const all = [];
    for (const d of arr(drafts)) {
        if (!d.committed) continue; // nothing counts until accepted
        const keys = d.keys.map(canonical);
        // A character who has a card is already described by it; a second description would only compete.
        if (d.kind === 'character' && keys.some(k => skip.has(k))) continue;
        const primary = canonical(d.supersedes || d.keys[0]);
        // "the Blue Lantern" and "Blue Lantern tavern, Blue Lantern" are one place: match on any shared key.
        const cur = all.find(e => e.primary === primary || keys.some(k => e.keyset.has(k)));
        if (cur) {
            // Update the entry we own rather than add a near-duplicate; the previous text is kept as history.
            cur.history.push({ text: cur.text, source: cur.source });
            cur.text = d.text;
            cur.source = d.source;
            cur.turn = d.turn;
            cur.keys = [...new Set([...cur.keys, ...d.keys])].slice(0, CAPS.loreKeys);
            for (const k of keys) cur.keyset.add(k);
            cur.updates++;
            if (d.supersedes) cur.supersedes = d.supersedes;
        } else {
            all.push({
                id: `dyn-${slug(primary)}`, primary, keys: [...d.keys], keyset: new Set(keys), text: d.text, kind: d.kind,
                source: d.source, turn: d.turn, supersedes: d.supersedes ?? null, history: [], updates: 1,
            });
        }
    }
    const byKey = new Map(all.map(({ keyset, ...e }) => [e.primary, e]));
    const entries = [], waiting = [];
    for (const e of byKey.values()) {
        const needle = normalise(e.primary);
        const mentions = hay.filter(t => t.includes(needle)).length;
        // Changed world state and events matter at once; people, places and things must recur first.
        const now = e.supersedes || e.kind === 'event' || e.kind === 'world' || e.updates >= 2 || mentions >= recurrence;
        (now ? entries : waiting).push({ ...e, mentions });
    }
    return { entries, waiting };
}

/** A SillyTavern World Info entry for one dynamic entry. Recursion is off both ways. */
export function toWorldInfoEntry(e, n) {
    return {
        uid: 900000 + n,
        world: DYNAMIC_WORLD,
        key: e.keys,
        keysecondary: [],
        comment: `${e.id} (from the story)`,
        content: e.supersedes ? `[Current state, replacing earlier lore on ${e.supersedes}] ${e.text}` : e.text,
        constant: false,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: true,
        // Lower order is inserted earlier; a high order places an override after the authored entry it updates.
        order: e.supersedes ? 990 : 900,
        position: 1,
        disable: false,
        ignoreBudget: false,
        excludeRecursion: true,
        preventRecursion: true,
        matchPersonaDescription: false, matchCharacterDescription: false, matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false, matchScenario: false, matchCreatorNotes: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: true,
        depth: 4,
        outletName: '',
        group: '', groupOverride: false, groupWeight: 100,
        scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null,
        automationId: '', role: 0,
        sticky: null, cooldown: null, delay: null,
        characterFilterNames: [], characterFilterTags: [], characterFilterExclude: false,
        triggers: [],
        displayIndex: n,
        extensions: {},
    };
}
