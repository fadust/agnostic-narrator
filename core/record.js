// How the Record tab groups what the director holds. Code only; the inspector just draws the result.

import { arr } from './util.js';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where in the text a cast member is first named, by full name or by a first name of three letters or more. */
function firstMention(text, name) {
    let at = -1;
    const forms = [name, name.split(/\s+/)[0]].filter((f, i) => f && (i === 0 || f.length >= 3));
    for (const form of new Set(forms)) {
        const m = new RegExp(`(?<![\\p{L}\\p{N}])${escape(form)}(?![\\p{L}\\p{N}])`, 'iu').exec(text);
        if (m && (at === -1 || m.index < at)) at = m.index;
    }
    return at;
}

/**
 * Split facts into the world's and the cast's. A fact belongs to the cast member it names first; a fact that names
 * nobody in the cast is the world's. Cast groups come main cast first, then by how much is on record about them.
 * @returns {{world: object[], cast: [string, object[]][]}}
 */
export function splitByCast(state, facts) {
    const names = Object.keys(state.cast ?? {});
    const world = [];
    const byName = new Map();
    for (const f of arr(facts)) {
        let who = null, best = Infinity;
        for (const n of names) {
            const at = firstMention(String(f.fact ?? ''), n);
            // Ties go to the longer name, so "Old Tam" wins over a "Tam" that is also in the cast.
            if (at !== -1 && (at < best || (at === best && n.length > who.length))) { best = at; who = n; }
        }
        if (who) (byName.get(who) ?? byName.set(who, []).get(who)).push(f);
        else world.push(f);
    }
    const cast = [...byName.entries()].sort(([a, fa], [b, fb]) =>
        (Number(!!state.cast[b]?.main) - Number(!!state.cast[a]?.main)) || fb.length - fa.length || a.localeCompare(b));
    return { world, cast };
}

/** Turn summaries for the Record tab: the latest `keep` one by one, the older ones as a single block. */
export function summaryView(summaries, keep = 20) {
    const recent = arr(summaries?.recent);
    return { latest: recent.slice(-keep).reverse(), older: recent.slice(0, Math.max(0, recent.length - keep)) };
}
