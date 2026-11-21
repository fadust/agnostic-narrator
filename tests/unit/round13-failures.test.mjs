// Round 13 (package audit P6, 22 Nov 2026): failures reach the player once, recoveries too, with a hint.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failureHint, moduleLabel } from '../../core/failures.js';
import { makeHost, narr, user, fakeObserver, replyOf } from './helpers.mjs';

test('a failing part is reported once, and again when it works', async () => {
    const chat = [narr('The story opens at the gate of Houshan.'), user('x'), narr('Ji Si waits beneath the arch tonight.')];
    let broken = true;
    const { director, host } = makeHost(chat, { script: (m, msgs) => (m === 'observer' && broken ? 'not json at all' : fakeObserver(replyOf(msgs))) });
    const seen = [];
    host.failed = (module, entry, first) => seen.push([module, entry ? 'fail' : 'ok', first]);
    await director.kick();
    await director.kick();
    const fails = seen.filter(s => s[0] === 'observer' && s[1] === 'fail');
    assert.ok(fails.length >= 2 && fails[0][2] === true && fails.slice(1).every(f => f[2] === false), 'first failure flagged once');
    assert.ok(director.failing.observer);
    broken = false;
    director.retry();
    await director.pass;
    assert.equal(director.failing.observer, undefined);
});

test('hints say what to do', () => {
    assert.match(failureHint('observer: the model spent its whole answer limit (600 tokens) thinking'), /raise the limit/);
    assert.match(failureHint('Got response status 502'), /retries after 20 s/);
    assert.match(failureHint('Got response status 401'), /key, model and quota/);
    assert.match(failureHint('planner: no JSON object found'), /wrong shape/);
    assert.equal(moduleLabel('observer'), 'reading replies');
});
