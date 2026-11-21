// Round 11 (owner, 22 Nov 2026): a person known only by a role is a character once they speak under it or a plan
// centres on them; when their name is revealed the entry moves to it and the role stays as another name.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState, applyDelta } from '../../core/state.js';
import { validateObservation } from '../../core/validate.js';

const reply = 'The hall master: "The commission is yours." He stamps the slip.';

test('a role who speaks under it is introduced without the article; a silent role is not', () => {
    const ctx = { text: reply, names: ['Max'], player: 'Max', present: [] };
    const v = validateObservation({ summary: 'x', cast_changes: [{ who: 'the hall master', change: 'introduced', quote: 'The commission is yours' }] }, ctx);
    assert.deepEqual(v.delta.cast_changes.map(c => c.who), ['Hall master']);
    const quiet = validateObservation({ summary: 'x', cast_changes: [{ who: 'the cobbler', change: 'introduced', quote: 'He stamps the slip' }] }, { ...ctx, text: `${reply} The cobbler watches.` });
    assert.ok(quiet.rejected.some(r => /a role, not a named character/.test(r.reason)));
});

test('a role a queued plan centres on counts too, and "the hall master" resolves to the entry', () => {
    const ctx = { text: 'The hall master frowns at Max.', names: ['Max', 'Hall master'], player: 'Max', present: ['Hall master'], planned: 'the hall master offers a commission' };
    const v = validateObservation({ summary: 'x', relationships: [{ who: 'the hall master', toward: 'Max', axis: 'trust', dir: 'up', weight: 'major', category: 'action', quote: 'The hall master frowns at Max' }] }, ctx);
    assert.equal(v.delta.relationships[0]?.who, 'Hall master');
});

test('a revealed name moves the role character, keeping the role as another name', () => {
    const s = initialState({ player: 'Max' });
    const ctx1 = { text: reply, names: ['Max'], player: 'Max', present: [] };
    applyDelta(s, validateObservation({ summary: 'x', cast_changes: [{ who: 'the hall master', change: 'introduced', quote: 'The commission is yours' }] }, ctx1), { mid: 'aaaa1111', i: 1 });
    assert.ok(s.cast['Hall master']);
    const text2 = 'Hall master Oswin sets down his pen. "Call me Oswin," he says.';
    const ctx2 = { text: text2, names: ['Max', 'Hall master'], player: 'Max', present: ['Hall master'] };
    const v = validateObservation({ summary: 'x', cast_changes: [{ who: 'Hall master', change: 'named', name: 'Oswin', quote: 'Call me Oswin' }] }, ctx2);
    applyDelta(s, v, { mid: 'bbbb2222', i: 3 });
    assert.equal(s.cast['Hall master'], undefined);
    assert.deepEqual(s.cast.Oswin.aliases, ['Hall master']);
    assert.ok(s.scene.present.includes('Oswin'));
});
