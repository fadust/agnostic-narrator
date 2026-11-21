// Round 8: the observer put Unconfirmed ids (o-...) and clue ids (b-...-c0) under "threads". The prompt must say
// which list a thread id comes from, and show the threads list even when it is empty.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OBSERVER_SYSTEM, observerPrompt } from '../../core/prompts.js';
import { initialState } from '../../core/state.js';

const stateWith = ({ threads = [] } = {}) => {
    const s = initialState();
    s.meta.player = 'Max';
    s.uncertain.push({ id: 'o-1e99ea-8-1', fact: 'Someone will want the name next.' });
    s.threads.push(...threads);
    s.beats.push({ id: 'b-4976a3-11-0', scene: 's1', goal: 'g', pressure: 'p', intent: 'g', clues: [{ id: 'b-4976a3-11-0-c0', text: 'He asked about one villa.' }] });
    return s;
};
const userOf = (s) => observerPrompt({ state: s, reply: 'r', playerMessage: '', offered: { beat: 'b-4976a3-11-0', clues: ['b-4976a3-11-0-c0'] } })[1].content;

test('round 8: the system text states where a thread id comes from, and that other ids never go there', () => {
    assert.match(OBSERVER_SYSTEM, /"id": "advance and resolve only: a t- id from Open threads"/);
    assert.match(OBSERVER_SYSTEM, /thread ids start with "t-"/);
    assert.match(OBSERVER_SYSTEM, /Ids from Unconfirmed belong only in "confirmed", clue ids only in "clues_found"; neither ever goes in "threads"/);
    assert.match(OBSERVER_SYSTEM, /When Open threads lists none, a thread can only be opened/);
});

test('round 8: with no open threads the section still shows, saying only "open" is possible', () => {
    const u = userOf(stateWith());
    assert.ok(u.includes('## Open threads (the only ids "threads" may advance or resolve)\nnone: a thread can only be opened'), u);
});

test('round 8: each id list is labelled with the one field its ids belong to', () => {
    const u = userOf(stateWith({ threads: [{ id: 't-abc-0', status: 'open', setup: 'Hesk awaits a price.' }, { id: 't-abc-1', status: 'resolved', setup: 'old' }] }));
    const sec = (title) => u.split('## ').find(x => x.startsWith(title)) ?? '';
    assert.ok(sec('Open threads').includes('- t-abc-0: Hesk awaits a price.'));
    assert.ok(!sec('Open threads').includes('t-abc-1'), 'a resolved thread is not offered');
    assert.ok(!/o-1e99ea|b-4976a3/.test(sec('Open threads')), 'no other kind of id sits in the threads list');
    assert.ok(sec('Unconfirmed (ids for "confirmed" only, never "threads")').includes('o-1e99ea-8-1'));
    assert.ok(u.includes('clue on offer (its id is for "clues_found" only): b-4976a3-11-0-c0: He asked about one villa.'));
});

test('round 8: the system text is the same whatever the state (cache)', () => {
    const a = observerPrompt({ state: stateWith(), reply: 'r', playerMessage: '' })[0].content;
    const b = observerPrompt({ state: stateWith({ threads: [{ id: 't-x-0', status: 'open', setup: 's' }] }), reply: 'q', playerMessage: 'm' })[0].content;
    assert.equal(a, b);
});

test('a clue or unconfirmed-fact id sent under threads is filed where it belongs, not refused (live, 21 Nov 2026)', async () => {
    const { validateObservation } = await import('../../core/validate.js');
    const text = 'The broker counts the coins twice. The ledger shows the debt was paid.';
    const v = validateObservation({ threads: [
        { op: 'advance', id: 'b-12ee6d-2-0-c0', text: 'the ledger', quote: 'The ledger shows the debt was paid.' },
        { op: 'resolve', id: 'o-1e99ea-8-1', text: 'debt paid', quote: 'The ledger shows the debt was paid.' },
        { op: 'advance', id: 'x-made-up', text: 'nothing', quote: 'The broker counts the coins twice.' },
    ] }, { text, names: ['Max'], tombstones: [], present: [], uncertainIds: ['o-1e99ea-8-1'], threadIds: ['t-aa-0'], clueIds: ['b-12ee6d-2-0-c0'], player: 'Max', known: '' });
    assert.deepEqual(v.delta.direction.clues_found, ['b-12ee6d-2-0-c0']);
    assert.deepEqual(v.delta.confirmed.map(c => c.id), ['o-1e99ea-8-1']);
    assert.equal(v.delta.threads.length, 0);
    assert.deepEqual(v.rejected.map(r => r.reason ?? r.error ?? r[1] ?? r).filter(r => /unknown thread id/.test(JSON.stringify(r))).length, 1, 'a truly unknown id is still refused');
});
