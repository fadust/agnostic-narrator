// Models wrap JSON in prose and fences, and get cut off. Recover what is recoverable; never eval.

/** Close whatever a truncated JSON text left open. */
function repair(src) {
    const stack = [];
    let inStr = false, esc = false, out = '';
    for (const ch of src) {
        out += ch;
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' || ch === ']') stack.pop();
    }
    if (inStr) out += '"';
    out = out.replace(/[,:]\s*$/, m => (m.trim() === ':' ? ': null' : ''));
    // A dangling key with no value: {"a": 1, "b"  ->  drop the key.
    out = out.replace(/,\s*"[^"]*"\s*$/, '');
    while (stack.length) out += stack.pop() === '{' ? '}' : ']';
    return out;
}

/**
 * @returns {{ok: boolean, value?: any, repaired?: boolean, error?: string}}
 */
export function extractJson(raw) {
    let s = String(raw ?? '').trim();
    if (!s) return { ok: false, error: 'empty output' };
    s = s.replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '');
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
    if (fence && fence[1].includes('{')) s = fence[1];
    const start = s.indexOf('{');
    if (start === -1) return { ok: false, error: 'no JSON object found' };
    s = s.slice(start);
    // Cut at the matching close brace when there is one.
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    const candidate = end === -1 ? s : s.slice(0, end + 1);
    const tryParse = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
    let value = tryParse(candidate);
    if (value !== undefined) return { ok: true, value, repaired: false };
    value = tryParse(candidate.replace(/,\s*([}\]])/g, '$1'));
    if (value !== undefined) return { ok: true, value, repaired: true };
    value = tryParse(repair(candidate));
    if (value !== undefined) return { ok: true, value, repaired: true };
    return { ok: false, error: 'unparseable JSON' };
}
