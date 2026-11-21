// Live, 19 November 2026: a model that kept returning nothing was retried every 20 seconds without end (62 observer
// calls, ~160k prompt tokens). Empty answers now back off (20 s, 60 s, 180 s) and then count as ordinary failures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeObserver, makeHost, narr, replyOf, user } from './helpers.mjs';

test('empty answers back off three times, then stop retrying until the player asks', async () => {
    const chat = [narr('The story opens at the gate of Houshan.'), user('x'), narr('Ji Si waits beneath the arch tonight.')];
    const { director, state } = makeHost(chat, { script: () => '' });
    const waits = [];
    for (let k = 0; k < 10; k++) {
        director.cool.observer = 0; // the wait has passed
        await director.kick();
        const run = director.emptyRun.observer ?? 0;
        if (run >= 1 && run <= 3) waits.push(director.transientWait(run));
    }
    clearTimeout(director.retryTimer);
    assert.deepEqual(waits.slice(0, 3), [20_000, 60_000, 180_000]);
    const observerCalls = state.calls.filter(c => c.module === 'observer').length;
    // 3 backed-off retries, then 2 counted tries (maxRetries) for each of the two replies; ten passes add no more.
    assert.equal(observerCalls, 3 + 2 * 2);
    assert.ok(director.errors.some(e => /automatic retries stopped/.test(e.error)));
    director.retry();
    assert.deepEqual(director.emptyRun, {}, '"Retry failed calls" starts the count again');
    clearTimeout(director.retryTimer);
});

test('an answer resets the run of empty answers', async () => {
    const chat = [narr('The story opens at the gate of Houshan.'), user('x'), narr('Ji Si waits beneath the arch tonight.')];
    let empty = true;
    const { director } = makeHost(chat, { script: (m, msgs) => (empty ? '' : fakeObserver(replyOf(msgs))) });
    await director.kick();
    assert.equal(director.emptyRun.observer, 1);
    clearTimeout(director.retryTimer);
    director.retryTimer = null;
    director.cool.observer = 0;
    empty = false;
    await director.kick();
    assert.equal(director.emptyRun.observer, undefined);
});

// Live, 21 Nov 2026: a slow planner model was cut at 60 s ("socket hang up") and retried every 90 s without end.
test('a dropped connection backs off like an empty answer, then stops', async () => {
    const chat = [narr('The story opens at the gate of Houshan.'), user('x'), narr('Ji Si waits beneath the arch tonight.')];
    const { director, state } = makeHost(chat, { script: () => { throw new Error('request to https://nano-gpt.com/api/v1/chat/completions failed, reason: socket hang up'); } });
    for (let k = 0; k < 10; k++) { director.cool.observer = 0; await director.kick(); }
    clearTimeout(director.retryTimer);
    assert.equal(state.calls.filter(c => c.module === 'observer').length, 3 + 2 * 2);
    assert.ok(director.errors.some(e => /socket hang up, \d in a row; automatic retries stopped/.test(e.error)));
});

// Audit, 21 Nov 2026: any chat event retried at once, so the waits never happened and retries ended within 2-3 turns.
test('a kick during the wait makes no call', async () => {
    const chat = [narr('The story opens at the gate of Houshan.'), user('x'), narr('Ji Si waits beneath the arch tonight.')];
    const { director, state } = makeHost(chat, { script: () => { throw new Error('Got response status 502'); } });
    await director.kick();
    for (let k = 0; k < 5; k++) await director.kick();
    clearTimeout(director.retryTimer);
    assert.equal(state.calls.filter(c => c.module === 'observer').length, 1);
    assert.ok(director.errors.some(e => /502/.test(e.error)), 'a 502 under streaming counts as a dropped connection');
    assert.equal(director.emptyRun.observer, 1);
});
