// Round 4: the observer names a fact's kind from a fixed list; code decides the weight.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACT_KINDS } from '../../core/enums.js';
import { OBSERVER_SYSTEM } from '../../core/prompts.js';
import { applyDelta, initialState } from '../../core/state.js';
import { validateObservation } from '../../core/validate.js';

const TEXT = 'Sithe is her brother. Ilse glances at the door. Rain drums on the roof. The barman spills the ale. Max owes Ilse ten crowns.';
const CTX = { text: TEXT, names: ['Max', 'Ilse'], tombstones: [], present: [], uncertainIds: [], threadIds: [], clueIds: [], player: 'Max' };
const fact = (f, extra = {}) => ({ fact: f, quote: `${f}.`, certainty: 'stated', ...extra });
const check = (facts) => validateObservation({ summary: 's', facts }, CTX);

test('fact kinds: every major and minor kind maps to its weight', () => {
    for (const [kind, weight] of FACT_KINDS) {
        if (weight === 'dropped') continue;
        const v = check([fact('Sithe is her brother', { kind })]);
        assert.equal(v.delta.facts[0].weight, weight, kind);
        assert.equal(v.delta.facts[0].kind, kind);
    }
    assert.deepEqual(FACT_KINDS.filter(([, w]) => w === 'major').map(([k]) => k),
        ['identity', 'knowledge', 'relationship', 'possession', 'decision', 'promise', 'revelation', 'change']);
    assert.deepEqual(FACT_KINDS.filter(([, w]) => w === 'minor').map(([k]) => k), ['event', 'condition']);
});

test('fact kinds: gestures and scenery are refused with their reason, even if labelled major', () => {
    const v = check([
        fact('Ilse glances at the door', { kind: 'gesture', weight: 'major' }),
        fact('Rain drums on the roof', { kind: 'Scenery' }),
    ]);
    assert.equal(v.delta.facts.length, 0);
    assert.deepEqual(v.rejected.map(r => r.reason), ['not a fact: gesture', 'not a fact: scenery']);
});

test('fact kinds: missing or unknown kind keeps the fact as minor; legacy weight only without a kind', () => {
    const v = check([
        fact('The barman spills the ale'),
        fact('Sithe is her brother', { kind: 'gossip', weight: 'major' }),
        fact('Max owes Ilse ten crowns', { weight: 'major' }),
    ]);
    assert.deepEqual(v.delta.facts.map(f => f.weight), ['minor', 'minor', 'major']);
    assert.equal(v.delta.facts[1].kind, undefined, 'an unknown kind is not stored');
});

test('fact kinds: kind is carried onto the canon item', () => {
    const state = initialState({ player: 'Max' });
    const v = check([fact('Max owes Ilse ten crowns', { kind: 'relationship', witnesses: [] })]);
    applyDelta(state, v, { mid: 'abcdef123456', i: 1 });
    const item = state.canon.find(f => f.fact === 'Max owes Ilse ten crowns');
    assert.equal(item.kind, 'relationship');
    assert.equal(item.weight, 'major');
});

test('observer prompt names the kinds instead of asking for a weight', () => {
    for (const [kind] of FACT_KINDS) assert.match(OBSERVER_SYSTEM, new RegExp(`\\b${kind}\\b`));
    assert.match(OBSERVER_SYSTEM, /"kind": "identity \| knowledge/);
    assert.doesNotMatch(OBSERVER_SYSTEM, /"weight": "major \| minor"/);
    assert.match(OBSERVER_SYSTEM, /code decides/);
});
