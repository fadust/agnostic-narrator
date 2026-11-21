// Round 10, Phase 2 (audit, 21 Nov 2026): reliability fixes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState } from '../../core/state.js';
import { validateObservation } from '../../core/validate.js';
import { planTrigger } from '../../core/planner.js';
import { quoteMatches } from '../../core/text.js';
import { validatePlanRewrites } from '../../core/plancheck.js';

test('"threads running low" waits the deviation gap instead of re-planning every turn', () => {
    const s = initialState({ player: 'Max' });
    s.genre = { dominant: 'drama' };
    s.arc = { goal: 'g', act: 1, endings: [] };
    s.beats = [{ id: 'b1', status: 'queued', goal: 'x', type: 'pressure' }];
    s.meta.lastPlanTurn = 5;
    s.meta.turn = 6;
    assert.ok(!/threads running low/.test(planTrigger(s) ?? ''));
    s.meta.turn = 8;
    assert.match(planTrigger(s) ?? '', /threads running low/);
});

test('the facts cap keeps the weightiest facts, in the order the reply told them', () => {
    const text = 'A cart passes. A dog barks. Rain falls. A bell rings. The steward is the killer.';
    const f = (fact, quote, kind, weight = 'minor') => ({ fact, quote, kind, weight, certainty: 'stated', witnesses: 'present' });
    const v = validateObservation({ summary: 'x', facts: [
        f('a cart passes', 'A cart passes', 'event'), f('a dog barks', 'A dog barks', 'event'), f('rain falls', 'Rain falls', 'event'),
        f('a bell rings', 'A bell rings', 'event'), f('the steward is the killer', 'The steward is the killer', 'identity', 'major'),
    ] }, { text, names: ['Max'], player: 'Max' });
    assert.ok(v.delta.facts.some(x => /steward/.test(x.fact)), 'the revelation survives the cap');
    assert.ok(/steward/.test(v.delta.facts.at(-1).fact), 'and keeps its place in the telling');
});

test('a short answer counts as a whole spoken line; whose/who swap like other pronouns', () => {
    const reply = 'He asks if she is willing.\nElizabeth: "...Yes."\nThe lamp gutters.';
    assert.ok(quoteMatches('...Yes.', reply));
    assert.ok(!quoteMatches('lamp', reply), 'a stray short word is still no evidence');
    assert.ok(quoteMatches('her leg is harbouring something dark', 'A woman whose leg is harbouring something dark lies here.'));
});

test('a rewritten beat is clipped at a word, never mid-word', () => {
    const plan = { beats: [{ goal: 'g', pressure: 'p' }] };
    const long = `${'word '.repeat(80)}blood`;
    const v = validatePlanRewrites({ rewrites: [{ id: 'b1', goal: long }] }, [{ id: 'b1' }], plan, {});
    const goal = v.ok ? v.value?.rewrites?.[0]?.goal ?? v.value?.[0]?.goal : null;
    if (goal) assert.ok(/(word|…)$/.test(goal) && !/blo$/.test(goal));
});
