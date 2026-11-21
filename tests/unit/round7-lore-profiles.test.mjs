// Live, 21 November 2026: Janus and Bianca, written up as characters in an authored lorebook ("Cast & Setting"), were
// introduced by the story but never got starting stats, because only character cards and the persona were profiled.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loreCards } from '../../core/director.js';
import { initialState } from '../../core/state.js';
import { fakeObserver, makeHost, narr, replyOf, user } from './helpers.mjs';

const JANUS = 'Janus is an 18-year-old member of Max\'s household, quick, light-footed and shameless.';
const BIANCA = 'Bianca is a 42-year-old housekeeper, nearly two meters tall, the household\'s guardian.';
const VILLA = 'The villa on the upper terrace. Its household: Janus, Bianca and the stable boy.';

test('a story character described by a lorebook entry is profiled from it, once', async () => {
    const chat = [narr('Janus drops from the eaves and Bianca fills the doorway.'), user('a')];
    chat[0].narrator_ops = [
        { at: 1, by: 'setup', kind: 'profile', name: 'Elizabeth & Dorothy', value: { people: [{ name: 'Elizabeth', summary: 'A widow.', stats: { will: 60 } }, { name: 'Dorothy', summary: 'Her daughter.' }] }, cardHash: 'x' },
    ];
    // The story introduces them: the observer's cast_changes leave cast members with no stats.
    const { director, host } = makeHost(chat, {
        script: (m, msgs) => ({ ...fakeObserver(replyOf(msgs)), cast_changes: /Janus drops/.test(replyOf(msgs)) ? [
            { who: 'Janus', change: 'introduced', quote: 'Janus drops from the eaves' },
            { who: 'Bianca', change: 'introduced', quote: 'Bianca fills the doorway' },
        ] : [] }),
    });
    host.cards = async () => [];
    host.loreEntries = () => [
        { keys: ['Janus', 'femboy'], comment: 'Janus', content: JANUS },
        { keys: ['Bianca', 'housekeeper'], comment: 'Bianca', content: BIANCA },
        { keys: ['villa', 'Janus'], comment: 'Villa', content: VILLA },
    ];
    const asked = [];
    const call = host.call;
    host.call = async (m, msgs, ...rest) => {
        if (m !== 'profile') return call(m, msgs, ...rest);
        const name = msgs[1].content.match(/## Card: (.+)/)[1];
        asked.push(name);
        return JSON.stringify({ name: `${name} the Quick`, summary: `${name}, from the lorebook.`, stats: { agility: 70 } });
    };
    await director.kick();
    const s = director.view();
    assert.equal(s.cast.Janus?.stats?.agility, 70, 'Janus has stats');
    assert.equal(s.cast.Bianca?.stats?.agility, 70, 'Bianca has stats');
    assert.ok(!('Janus the Quick' in s.cast), 'the cast name is kept, whatever name the model gave');
    assert.deepEqual(asked.sort(), ['Bianca', 'Janus'], 'card people (Elizabeth, Dorothy) are not profiled again');
    chat.push(narr('Bianca sets bread on the table tonight.'));
    await director.kick();
    assert.equal(asked.length, 2, 'an unchanged entry is not profiled again');
});

test('only an entry about them (titled, or first keyed, with the name) that names them in its opening counts', () => {
    const s = initialState({ player: 'Max' });
    s.cast = { Janus: {}, Bianca: { stats: { might: 80 } }, Max: { pc: true }, Gerta: {} };
    const cards = loreCards(s, [
        { keys: ['villa', 'Janus'], comment: 'Villa', content: VILLA },
        { keys: ['healer'], comment: 'Healer', content: 'Gerta is the town healer, squat and red-faced, scarred to the elbow.' },
        { keys: ['Bianca'], comment: 'Bianca', content: BIANCA },
    ]);
    assert.deepEqual(cards, [], 'Janus: the villa entry only lists him; Gerta: no entry under her name; Bianca already has stats');
    const more = loreCards(s, [{ keys: ['Janus'], comment: '', content: JANUS }, { keys: ['Janus'], comment: 'Janus', content: `${JANUS} He hums.` }]);
    assert.equal(more.length, 1);
    assert.match(more[0].text, /He hums/, 'the longest entry wins');
});

test('a story-only character is profiled once from what the story has shown of them (owner, 21 Nov 2026)', async () => {
    const chat = [narr('Here is the healer: Gerta, squat and red-faced, forearms scarred to the elbow from years at the bonesetting table.'), user('a')];
    const { director, host } = makeHost(chat, {
        script: (m, msgs) => ({ ...fakeObserver(replyOf(msgs)), cast_changes: /Gerta, squat/.test(replyOf(msgs)) ? [{ who: 'Gerta', change: 'introduced', quote: 'Here is the healer: Gerta' }] : [] }),
    });
    host.cards = async () => [];
    host.loreEntries = () => [];
    const asked = [];
    const call = host.call;
    host.call = async (m, msgs, ...rest) => {
        if (m !== 'profile') return call(m, msgs, ...rest);
        asked.push(msgs[1].content);
        return JSON.stringify({ name: 'Gerta', summary: 'The town healer.', stats: { strength: 42, intellect: 48 } });
    };
    await director.kick();
    const s = director.view();
    assert.equal(asked.length, 1);
    assert.match(asked[0], /## Story notes: Gerta/);
    assert.match(asked[0], /forearms scarred to the elbow/, 'the sentences naming her are the evidence');
    assert.match(asked[0], /never split/);
    assert.equal(s.cast.Gerta.stats.intellect, 48);
    chat.push(narr('Gerta wipes her hands and names her price tonight.'));
    await director.kick();
    assert.equal(asked.length, 1, 'profiled once');
});

test('the profile prompt ties stats to build, occupation, background and age', async () => {
    const { profilePrompt } = await import('../../core/prompts.js');
    const sys = profilePrompt({ name: 'X', card: 'X is a smith.', genre: { dominant: 'fantasy' } })[0].content;
    for (const k of ['Build:', 'Occupation', 'Background', 'Age:', 'stays at 30']) assert.ok(sys.includes(k), k);
    assert.equal(sys, profilePrompt({ name: 'Y', card: 'notes', genre: { dominant: 'noir' }, story: true })[0].content, 'system text is the same for every call (cacheable)');
});

test('stats grow and decline with the story: small steps for practice or disuse, large for a decisive event', async () => {
    const { applyDelta } = await import('../../core/state.js');
    const { validateObservation } = await import('../../core/validate.js');
    const s = initialState({ player: 'Max' });
    s.cast.Janus = { ...s.cast.Janus, stats: { strength: 40, agility: 70, endurance: 35, intellect: 30, perception: 50, will: 30, presence: 40 } };
    const text = 'Janus drills the sword forms until dawn. The blade takes his left hand at the wrist.';
    const v = validateObservation({ stats: [
        { who: 'Janus', stat: 'perception', dir: 'up', quote: 'Janus drills the sword forms until dawn' },
        { who: 'Janus', stat: 'agility', dir: 'down', size: 'large', quote: 'The blade takes his left hand at the wrist' },
        { who: 'Janus', stat: 'strength', dir: 'down', size: 'large', quote: 'The blade takes his left hand at the wrist' },
    ] }, { text, names: ['Janus', 'Max'], tombstones: [], present: ['Janus'], uncertainIds: [], threadIds: [], clueIds: [], player: 'Max', known: '' });
    assert.deepEqual(v.delta.stats.map(x => x.size), ['small', 'large', 'large']);
    applyDelta(s, { delta: v.delta, accepted: 3, rejected: [] }, { mid: 'm-1-aaaaaaaa', i: 1, text, committed: true });
    assert.equal(s.cast.Janus.stats.perception, 52, 'practice: a small step up');
    assert.equal(s.cast.Janus.stats.agility, 62, 'a maiming: a large step down');
    assert.equal(s.cast.Janus.stats.strength, 32);
});
