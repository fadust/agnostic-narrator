// Round 4: the spine drafter. Milestones and criteria are written as what has happened on screen; code flags
// player-led, gesture, tally and scene-bound criteria, and one cheap check call rewrites only those before logging.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSpine, validateSpineRewrites } from '../../core/planner.js';
import { SPINE_SYSTEM, spineCheckPrompt, spinePrompt } from '../../core/prompts.js';
import { applySpineRewrites, flagSpine } from '../../core/spine.js';
import { makeHost, narr, user } from './helpers.mjs';

const MATERIAL = '[Scenario]\nThe king and queen were murdered; the prince now serves a noble house as a hired hand.';

const draft = (m1, extra = {}) => validateSpine({
    question: 'q',
    endings: [{ title: 'Throne', criteria: [{ text: 'the head of House Aldren backs his claim', role: 'the court is his' }] }, { title: 'Marriage', criteria: ['the daughter trusts him'] }],
    milestones: [m1, { title: 'Learns who ordered the killing', criteria: [{ text: 'he holds proof of who gave the order', role: 'a weapon at court' }] }],
    ...extra,
}).value;

test('the drafter wording: on-screen, recognisable, no tallies or chains, milestone 1 after the current scene, lasting', () => {
    for (const s of ['already happened or become true on screen', 'recognised afterwards', 'many different ways', 'Never a tally', 'joined by "and"', 'milestone 1 starts after it', 'The Auction Block', '"lasting": true']) {
        assert.ok(SPINE_SYSTEM.includes(s), s);
    }
    assert.ok(spinePrompt({ material: 'm', genre: null, premise: '', arc: null, player: 'Rowan' })[0].content.includes('"lasting": false'));
});

test('validateSpine keeps "lasting" only when it is a boolean', () => {
    const v = validateSpine({ question: 'q', endings: [{ title: 'A', criteria: [{ text: 'a', lasting: true }, { text: 'b', lasting: 'yes' }] }, { title: 'B', criteria: [{ text: 'c', lasting: false }] }], milestones: [{ title: 'M', criteria: ['d'] }] }).value;
    assert.equal(v.endings[0].criteria[0].lasting, true);
    assert.ok(!('lasting' in v.endings[0].criteria[1]));
    assert.equal(v.endings[1].criteria[0].lasting, false);
    assert.ok(!('lasting' in v.milestones[0].criteria[0]));
});

test('flagSpine: player name, gesture, tally and a scene-bound milestone 1; a good objective is left alone', () => {
    const opts = { present: ['Elizabeth'], player: 'Max Steel', location: 'the auction block' };
    const ids = (s) => flagSpine(s, opts).map(f => f.id);
    assert.deepEqual(ids(draft({ title: 'Wins a protector', criteria: ['Max persuades the steward to hide him'] })), ['m1-c1'], 'begins with the player');
    assert.deepEqual(ids(draft({ title: 'Wins a protector', criteria: ["Max's sword is returned to him"] })), [], 'a possessive is his situation, not his action');
    assert.deepEqual(ids(draft({ title: 'Wins a protector', criteria: ['the steward nods at him across the hall'] })), ['m1-c1'], 'gesture');
    assert.deepEqual(ids(draft({ title: 'Proves himself', criteria: ['the guard has completed its first patrols with him', 'he has won three times in the ring'] })), ['m1-c1', 'm1-c2'], 'tallies');
    const scene = flagSpine(draft({ title: 'The Auction Block', criteria: [{ text: 'Elizabeth has made eye contact with Max', role: 'a bond' }, { text: 'Elizabeth knows his name', role: 'a bond' }] }), opts);
    assert.deepEqual(scene.map(f => f.id), ['m1-c1', 'm1-c2'], 'scene-bound m1: every criterion flagged');
    assert.ok(scene[1].reason.includes('current scene') && scene[0].reason.includes('gesture'));
    // Same title, but a name from outside the scene: conservative, no scene flag.
    assert.deepEqual(ids(draft({ title: 'The Auction Block', criteria: ['Elizabeth knows his name', 'Lord Aldren owes Elizabeth a debt'] })), []);
    // The same scene-bound shape on milestone 2 is not checked by rule (d).
    const later = draft({ title: 'Wins a protector', criteria: ['the steward owes him his life'] });
    later.milestones[1] = { ...later.milestones[1], title: 'The Auction Block', criteria: [{ id: 'm2-c1', text: 'Elizabeth knows his name', mark: 'open' }] };
    assert.deepEqual(flagSpine(later, opts), []);
    assert.deepEqual(ids(draft({ title: 'Gains a first true ally', criteria: [{ text: 'Elizabeth trusts him with the truth about her brother', role: 'his ally against the guild' }] })), [], 'a good objective');
});

test('the check validator keeps only flagged ids with text; applying rewrites changes only those', () => {
    const flags = [{ id: 'm1-c1', reason: 'gesture' }];
    assert.equal(validateSpineRewrites({ rewrites: [{ id: 'e1-c1', text: 'x' }, { id: 'm1-c1', text: '' }] }, flags).ok, false);
    const v = validateSpineRewrites({ rewrites: [{ id: 'm1-c1', text: 'the steward owes him his life', role: 'a debt', lasting: true }, { id: 'e1-c1', text: 'not flagged' }, { id: 'm1-c1', text: 'dup' }] }, flags);
    assert.deepEqual(v.value, [{ id: 'm1-c1', text: 'the steward owes him his life', role: 'a debt', lasting: true }]);
    const s = draft({ title: 'Wins a protector', criteria: ['the steward nods at him'] });
    const out = applySpineRewrites(s, v.value);
    assert.equal(out.milestones[0].criteria[0].text, 'the steward owes him his life');
    assert.equal(s.milestones[0].criteria[0].text, 'the steward nods at him', 'the draft itself is not changed');
    assert.deepEqual(out.endings, s.endings);
    const p = spineCheckPrompt({ spine: s, flags: [{ id: 'm1-c1', text: 'the steward nods at him', reason: 'gesture' }], player: 'Rowan' });
    assert.ok(p[0].content.includes(SPINE_SYSTEM) && p[0].content.includes('"rewrites"'));
    assert.ok(p[1].content.includes('m1-c1: the steward nods at him (gesture)') && p[1].content.includes('Learns who ordered the killing'));
});

const RAW = { question: 'Can he take it back?', endings: [{ title: 'Throne', criteria: ['loyalists rallied'] }, { title: 'Marriage', criteria: ['the daughter trusts him'] }],
    milestones: [{ title: 'Wins a protector', criteria: ['Rowan persuades the steward to hide him', 'the steward owes him his life'] }] };

function spineHost(check) {
    const chat = [narr('The story opens at the gate of the noble house.'), user('I report for work.')];
    const { director, host } = makeHost(chat);
    host.material = async () => MATERIAL;
    const checks = [];
    const call = host.call;
    host.call = async (module, messages, ...rest) => {
        const system = messages[0].content;
        if (module === 'planner' && system.startsWith(SPINE_SYSTEM)) return JSON.stringify(RAW);
        if (module === 'planner' && system.startsWith('You check a drafted story spine')) { checks.push(messages); return check(messages); }
        return call(module, messages, ...rest);
    };
    return { director, checks };
}

test('the check pass rewrites only flagged ids, and the logged spine carries the rewrite', async () => {
    const { director, checks } = spineHost(() => JSON.stringify({ rewrites: [{ id: 'm1-c1', text: 'the steward has hidden him from the guild', role: 'a refuge' }, { id: 'm1-c2', text: 'not flagged' }] }));
    await director.kick();
    const sp = director.view().spine;
    assert.equal(checks.length, 1, 'one extra call');
    assert.ok(checks[0][1].content.includes('m1-c1: Rowan persuades') && !checks[0][1].content.includes('- m1-c2'));
    assert.equal(sp.milestones[0].criteria[0].text, 'the steward has hidden him from the guild');
    assert.equal(sp.milestones[0].criteria[0].role, 'a refuge');
    assert.equal(sp.milestones[0].criteria[1].text, 'the steward owes him his life', 'unflagged criterion untouched');
});

test('a failed check call still logs the original draft', async () => {
    const { director, checks } = spineHost(() => 'not json at all');
    await director.kick();
    const sp = director.view().spine;
    assert.equal(checks.length, 1);
    assert.equal(sp?.question, 'Can he take it back?');
    assert.equal(sp.milestones[0].criteria[0].text, 'Rowan persuades the steward to hide him');
});

test('a rewrite that still trips its flag is refused and the original stays', async () => {
    const { validateSpineRewrites } = await import('../../core/planner.js');
    const spine = { endings: [{ id: 'e1', title: 'Road', criteria: [{ id: 'e1-c1', text: 'Max has given up his horse for the women', mark: 'open' }, { id: 'e1-c2', text: 'Max nods at the bailiff', mark: 'open' }] }], milestones: [] };
    const flags = [{ id: 'e1-c1', reason: 'player' }, { id: 'e1-c2', reason: 'player' }];
    const v = validateSpineRewrites({ rewrites: [
        { id: 'e1-c1', text: 'Max has given up something he cannot get back' },
        { id: 'e1-c2', text: 'The bailiff has recorded the women as released to a new keeper' },
    ] }, flags, { spine, present: [], player: 'Max', location: '' });
    assert.deepEqual(v.value.map(r => r.id), ['e1-c2']);
    assert.equal(validateSpineRewrites({ rewrites: [{ id: 'e1-c1', text: 'Max still does it' }] }, flags, { spine, present: [], player: 'Max', location: '' }).ok, false);
});

test('the player character\'s situation is not flagged, only his actions', async () => {
    const { flagSpine } = await import('../../core/spine.js');
    const crit = (id, text) => ({ id, text, mark: 'open' });
    const spine = { endings: [{ id: 'e1', title: 'T', criteria: [
        crit('e1-c1', 'Max possesses enough coin or a written promise of credit to buy the cart'),
        crit('e1-c2', 'Max holds the amended writ'),
        crit('e1-c3', 'Max has enough coin for the road'),
        crit('e1-c4', 'Max has given up his horse for the women'),
        crit('e1-c5', 'Max gives Dorothy his coat'),
    ] }], milestones: [] };
    assert.deepEqual(flagSpine(spine, { player: 'Max' }).map(f => f.id), ['e1-c4', 'e1-c5']);
});
