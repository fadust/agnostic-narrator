// Round 12 (audit map, 22 Nov 2026): A1 commands share the single-flight, A2 no profile for a swiped-away person,
// A3 a scene cut replaces the present list.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState, applyDelta } from '../../core/state.js';
import { validateObservation } from '../../core/validate.js';
import { makeHost, narr, user } from './helpers.mjs';

test('A1: a command waits for a running pass, and a kick during the command runs after it', async () => {
    const chat = [narr('The story opens at the gate of Houshan.'), user('x'), narr('Ji Si waits beneath the arch tonight.')];
    const { director } = makeHost(chat);
    const order = [];
    const pass = director.kick().then(() => order.push('pass'));
    const cmd = director.exclusive(async () => { order.push('command start'); assert.equal(director.running, true); director.kick(); order.push('command end'); return 7; });
    assert.equal(await cmd, 7);
    await pass;
    await director.pass;
    assert.deepEqual(order.slice(0, 3), ['pass', 'command start', 'command end']);
    assert.equal(director.running, false);
    await assert.rejects(director.exclusive(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(director.running, false, 'a failing command frees the slot');
});

test('A3: a scene cut replaces the present list instead of adding to it', () => {
    const s = initialState({ player: 'Max' });
    s.scene.present = ['Elizabeth', 'Dorothy'];
    for (const n of ['Elizabeth', 'Dorothy', 'Vetch']) s.cast[n] = { statuses: [], knows: [], rel: {}, stances: {} };
    const text = 'Across the quarter, Vetch strikes the claim at the registry counter.';
    const v = validateObservation({ summary: 'x', scene: { present: ['Vetch'], cut: true } }, { text, names: ['Max', 'Elizabeth', 'Dorothy', 'Vetch'], player: 'Max', present: ['Elizabeth', 'Dorothy'] });
    assert.equal(v.delta.scene.cut, true);
    applyDelta(s, v, { mid: 'cut00001', i: 1 });
    assert.deepEqual(s.scene.present, ['Vetch']);
    const t = initialState({ player: 'Max' });
    t.scene.present = ['Elizabeth'];
    t.cast.Elizabeth = { statuses: [], knows: [], rel: {}, stances: {} };
    t.cast.Vetch = { statuses: [], knows: [], rel: {}, stances: {} };
    applyDelta(t, validateObservation({ summary: 'x', scene: { present: ['Vetch'] } }, { text: 'Vetch comes in.', names: ['Max', 'Elizabeth', 'Vetch'], player: 'Max', present: ['Elizabeth'] }), { mid: 'cut00002', i: 1 });
    assert.deepEqual(t.scene.present.sort(), ['Elizabeth', 'Vetch'], 'without a cut, silence is not departure');
});
