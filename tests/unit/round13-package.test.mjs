// Round 13 (package audit, 22 Nov 2026): streaming guard, plan ids after a reload, one save per pass.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState, applyOp } from '../../core/state.js';
import { makeHost, narr, user } from './helpers.mjs';

test('P1: the newest reply is not read while the narrator is still writing it', () => {
    const chat = [user('x'), narr('Ji Si waits beneath the arch tonight, half writ')];
    const { director, host } = makeHost(chat);
    host.generating = () => true;
    director.sync();
    assert.equal(director.nextUnread(), null);
    host.generating = () => false;
    assert.equal(director.nextUnread()?.i, 1);
});

test('plan ids never repeat, even when a plan number does', () => {
    const s = initialState({ player: 'Max' });
    s.genre = { dominant: 'drama' };
    applyOp(s, { kind: 'plan', by: 'director', seq: 0, value: { beats: [{ scene: 's1', goal: 'a', type: 'reveal' }] } }, { mid: 'same0000' }, []);
    s.beats[0].status = 'complete';
    applyOp(s, { kind: 'plan', by: 'director', seq: 0, value: { beats: [{ scene: 's1', goal: 'b', type: 'reveal' }] } }, { mid: 'same0000' }, []);
    const ids = s.beats.map(b => b.id);
    assert.equal(new Set(ids).size, ids.length, ids.join(' '));
});

test('a background pass saves the chat once at its end, not after every step', async () => {
    const chat = [narr('The story opens at the gate of Houshan.'), user('x'), narr('Ji Si waits beneath the arch tonight.'), user('y'), narr('The bell rings twice over the yard.')];
    const { director, state } = makeHost(chat);
    const before = state.saves;
    await director.kick();
    assert.ok(state.saves - before <= 2, `saves in one pass: ${state.saves - before}`);
});
