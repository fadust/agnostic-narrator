// Round 12, A10 (audit map, 22 Nov 2026): the riskiest untested paths, the model call and the tracker's batching.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeCall } from '../../st/call.js';
import { makeHost, narr, user } from './helpers.mjs';

const settings = { profile: 'p1', setTemps: true, tempPlan: 0.8, tempRecord: 0.2 };
/** A fake SillyTavern context whose sendRequest runs `fn(opts, payload, n)` for the n-th request. */
function fakeContext(fn) {
    const sent = [];
    const ctx = { ConnectionManagerRequestService: { sendRequest: async (profile, messages, maxTokens, opts, payload) => { sent.push({ opts, payload }); return fn(opts, payload, sent.length); } } };
    return { ctx, sent };
}
const stream = (...chunks) => async function* () { for (const c of chunks) yield c; };

test('a streamed answer is collected; temperature follows the module', async () => {
    const { ctx, sent } = fakeContext(() => stream({ text: '{"a"' }, { text: '{"a": 1}' }));
    const call = makeCall({ getContext: () => ctx, getSettings: () => settings });
    assert.equal(await call('observer', [], 100), '{"a": 1}');
    assert.equal(sent[0].opts.stream, true);
    assert.equal(sent[0].payload.temperature, 0.2);
    await call('planner-check', [], 100);
    assert.equal(sent[1].payload.temperature, 0.8, 'a check call runs on its parent role');
});

test('a 4xx under streaming is asked once without streaming, and that profile stays off streaming', async () => {
    const { ctx, sent } = fakeContext((opts) => { if (opts.stream) throw new Error('Got response status 400'); return { content: 'ok' }; });
    const call = makeCall({ getContext: () => ctx, getSettings: () => settings });
    assert.equal(await call('observer', [], 100), 'ok');
    assert.deepEqual(sent.map(s => s.opts.stream), [true, false]);
    await call('observer', [], 100);
    assert.equal(sent.at(-1).opts.stream, false);
});

test('a refused temperature is dropped for that profile; a 5xx goes back to the director', async () => {
    const { ctx, sent } = fakeContext((opts, payload) => { if (payload.temperature !== undefined) throw new Error('temperature is not supported'); return { content: 'fine' }; });
    const call = makeCall({ getContext: () => ctx, getSettings: () => settings });
    assert.equal(await call('observer', [], 100), 'fine');
    assert.deepEqual(sent.map(s => s.payload.temperature), [0.2, undefined]);
    await call('observer', [], 100);
    assert.equal(sent.at(-1).payload.temperature, undefined, 'not sent again to that profile');
    const drop = makeCall({ getContext: () => fakeContext(() => { throw new Error('Got response status 502'); }).ctx, getSettings: () => settings });
    await assert.rejects(drop('observer', [], 100), /502/, 'the director backs off a dropped connection');
});

test('a model that thinks away its whole limit is reported as such', async () => {
    const { ctx } = fakeContext(() => stream({ text: '', state: { reasoning: 'hmm…' } }));
    const call = makeCall({ getContext: () => ctx, getSettings: () => settings });
    await assert.rejects(call('tracker', [], 600), /spent its whole answer limit \(600 tokens\) thinking/);
});

test('tracker batches close at 20k characters of reply text, and shrink after a thinking-out', () => {
    const long = (n) => `Reply ${n}. ${'The rain keeps falling on the long road. '.repeat(220)}`; // ~9k characters
    const chat = [];
    for (let i = 0; i < 6; i++) chat.push(narr(long(i)), user(`go ${i}`));
    chat[0].narrator_ops = [{ kind: 'spine', by: 'setup', at: 1, value: {} }];
    const { director } = makeHost(chat, { settings: { trackEvery: 4, backfill: 12 } });
    director.sync();
    const batch = director.nextBatch(false);
    assert.ok(batch, 'a batch is ready');
    assert.equal(batch.length, 2, 'two ~9k replies fit, a third would pass 20k');
    director.trackMax = 1;
    assert.equal(director.nextBatch(false).length, 1);
});

test("A4: a stated fact that someone died marks them dead; another's deed does not", async () => {
    const { initialState, applyDelta } = await import('../../core/state.js');
    const s = initialState({ player: 'Max' });
    for (const n of ['Rulf', 'Brenn']) s.cast[n] = { statuses: [], knows: [], rel: {}, stances: {} };
    s.scene.present = ['Rulf', 'Brenn'];
    const fact = (t) => ({ fact: t, quote: 'q', certainty: 'stated', weight: 'major', witnesses: [] });
    applyDelta(s, { delta: { summary: 'x', facts: [fact('Brenn killed a collector in the alley'), fact('Rulf dies of his wounds before dawn')] }, accepted: 2, rejected: [] }, { mid: 'dead0001', i: 1 });
    assert.equal(s.cast.Rulf.dead, true);
    assert.ok(!s.cast.Brenn.dead);
    assert.deepEqual(s.scene.present, ['Brenn']);
});

test('A5: "you" is the player character only in a second-person story', async () => {
    const { validateObservation } = await import('../../core/validate.js');
    const rel = { who: 'Brenn', toward: 'you', axis: 'trust', dir: 'up', weight: 'minor', category: 'words', quote: 'Brenn nods at the stranger' };
    const base = { text: 'Brenn nods at the stranger.', names: ['Max', 'Brenn'], player: 'Max', present: ['Brenn'] };
    assert.equal(validateObservation({ summary: 'x', relationships: [rel] }, base).delta.relationships.length, 1);
    assert.equal(validateObservation({ summary: 'x', relationships: [rel] }, { ...base, secondPerson: false }).delta.relationships.length, 0);
});

test('A7: only what the player settled reaches the notes and the planner', async () => {
    const { initialState, playerSettled } = await import('../../core/state.js');
    const s = initialState({ player: 'Max' });
    s.settled = [{ id: 'a', text: 'the fee is ten silver', by: 'story' }, { id: 'b', text: 'Max wants nothing in return', by: 'player' }];
    assert.deepEqual(playerSettled(s).map(x => x.id), ['b']);
});
