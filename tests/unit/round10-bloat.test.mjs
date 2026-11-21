// Round 10, Phase 3 (audit, 21 Nov 2026): prompts that grew without end.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState } from '../../core/state.js';
import { planPrompt, observerPrompt, genrePrompt } from '../../core/prompts.js';
import { similarity } from '../../core/util.js';

test('the planner gets full lines for people in play, names for the rest', () => {
    const s = initialState({ player: 'Max' });
    s.genre = { dominant: 'drama' };
    s.arc = { goal: 'g', act: 1, endings: [] };
    const npc = (extra = {}) => ({ rel: {}, stage: 'stranger', profile: 'a long profile text', statuses: [], knows: [], ...extra });
    s.cast = { Max: { pc: true, statuses: [], knows: [] }, Ana: npc(), Bo: npc({ main: true }), Cy: npc(), Di: npc({ dead: true }) };
    s.scene.present = ['Ana'];
    const user = planPrompt({ state: s, loreKeys: [], reason: 'x' })[1].content;
    assert.match(user, /Ana: .*a long profile text/);
    assert.match(user, /Bo \(main cast\): /);
    assert.match(user, /Also in the story, not in play now: Cy, Di \(dead\)/);
    assert.ok(!/Cy: .*a long profile/.test(user), 'no full line for someone not in play');
});

test('a long player message reaches the observer clipped in the middle', () => {
    const s = initialState({ player: 'Max' });
    const long = `START ${'x'.repeat(5000)} END`;
    const user = observerPrompt({ state: s, reply: 'r', playerMessage: long, offered: {} })[1].content;
    assert.match(user, /START x+ \[…\] x+ END/);
    assert.ok(user.length < 4000);
});

test('the genre register describes voice, never length', () => {
    assert.match(genrePrompt({ material: 'm' })[0].content + genrePrompt({ material: 'm' })[1].content, /Never length or sentence length/);
});

test('similarity is unchanged by its cache', () => {
    assert.equal(similarity('the old mill burned', 'the old mill burned'), 1);
    assert.equal(similarity('the old mill burned', 'the old mill burned'), 1);
    assert.equal(similarity('apples', 'pears'), 0);
});

test('view() is cached per chat revision, returns copies, and sees new records', async () => {
    const { makeHost, narr, user } = await import('./helpers.mjs');
    const chat = [narr('Marda hands you the key at the inn.'), user('a'), narr('The inn is quiet tonight.')];
    const { director } = makeHost(chat);
    await director.kick();
    const a = director.view();
    const b = director.view();
    assert.notEqual(a, b, 'a copy each time');
    assert.deepEqual(a, b);
    a.cast.Intruder = {};
    assert.ok(!('Intruder' in director.view().cast), 'changing a copy never reaches the cache');
    director.playerOp({ kind: 'settle', text: 'the key is hers to keep' });
    assert.ok(director.view().settled.some(s => /key is hers/.test(s.text)), 'a new op changes the key');
});
