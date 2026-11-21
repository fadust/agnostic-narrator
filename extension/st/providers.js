// Memory connectors: where the planner reads the story so far when another extension owns memory (settings.memory
// 'extension'). Each connector says whether its extension is there and returns { text, missing?, source }.
// Other extensions may add their own with narratorDirector.registerMemoryProvider({ id, name, available, story }).

const ctx = () => SillyTavern.getContext();

/** A macro's value, or '' when the macro is unknown (SillyTavern then leaves the text as typed). */
function macroText(name) {
    const raw = `{{${name}}}`;
    const out = String(ctx().substituteParams?.(raw) ?? '');
    return out === raw ? '' : out.trim();
}

const providers = new Map();

export function registerMemoryProvider(p) {
    if (!p || typeof p.id !== 'string' || typeof p.story !== 'function') throw new TypeError('a memory provider needs an id and a story()');
    providers.set(p.id, { name: p.id, available: () => true, ...p });
}

// BaiBai Book: its layered record (L0 summaries of each reply, merged upwards into L1, L2, L3), chosen by BaiBai's own
// rule: the highest level that fully covers each stretch. coverage.missingAiFloors lists replies with no valid summary.
registerMemoryProvider({
    id: 'baibai',
    name: 'BaiBai Book',
    available: () => typeof globalThis.STBaiBaiBook?.getHistory === 'function',
    story() {
        const h = globalThis.STBaiBaiBook.getHistory({});
        return { text: String(h?.text ?? ''), missing: Array.isArray(h?.coverage?.missingAiFloors) ? h.coverage.missingAiFloors : [], source: 'BaiBai Book' };
    },
});

// SillyTavern's built-in Summarize extension.
registerMemoryProvider({
    id: 'summarize',
    name: 'SillyTavern Summarize',
    available: () => !!macroText('summary'),
    story: () => ({ text: macroText('summary'), source: 'Summarize' }),
});

/**
 * Chat indices of replies the memory extension has no summary for, or null when it cannot tell. Synchronous: it is
 * read while the narrator's prompt is built. Only BaiBai Book reports this (coverage.missingAiFloors).
 * @param {{memoryProvider?: string}} settings
 */
export function memoryGaps(settings) {
    const choice = settings.memoryProvider || 'auto';
    const bb = providers.get('baibai');
    if (!(choice === 'auto' || choice === 'baibai') || !bb?.available()) return null;
    try {
        const missing = globalThis.STBaiBaiBook.getHistory({})?.coverage?.missingAiFloors;
        return Array.isArray(missing) ? missing : null;
    } catch {
        return null;
    }
}

/** Connector choices for the settings panel: [value, label]. */
export const providerOptions = () => [['auto', 'Automatic'], ...[...providers.values()].map(p => [p.id, p.name]), ['macro', 'A macro, named below']];

/**
 * The record from the chosen connector. 'auto' takes the first available one. 'macro' reads {{name}}.
 * @param {{memoryProvider?: string, memoryMacro?: string}} settings
 */
export async function memoryStory(settings) {
    const choice = settings.memoryProvider || 'auto';
    if (choice === 'macro') {
        const name = String(settings.memoryMacro ?? '').replace(/[{}]/g, '').trim();
        const text = name ? macroText(name) : '';
        return text ? { text, source: `{{${name}}}` } : null;
    }
    const list = choice === 'auto' ? [...providers.values()] : [providers.get(choice)].filter(Boolean);
    for (const p of list) {
        if (!p.available()) continue;
        const r = await p.story();
        if (r?.text) return r;
        // Present but nothing summarised yet (BaiBai writes a reply's summary only after the next reply).
        if (r) return { ...r, text: '', empty: true };
    }
    return null;
}
