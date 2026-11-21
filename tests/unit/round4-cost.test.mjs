// Round 4 (I5): cacheable system prompts, per-module cost totals, early fact clean-up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSpine } from '../../core/planner.js';
import {
    arcPrompt, cleanupPrompt, conclusionPrompt, genrePrompt, observerPrompt, planPrompt, profilePrompt, spinePrompt, summariserPrompt, trackerPrompt,
} from '../../core/prompts.js';
import { emptySpine } from '../../core/spine.js';
import { ensureCast, initialState } from '../../core/state.js';
import { roughTokens } from '../../core/util.js';
import { makeHost, narr, user } from './helpers.mjs';

function bareState() {
    return initialState({ player: 'Rowan', genre: { dominant: 'fantasy' } });
}

function busyState() {
    const s = initialState({ player: 'Mira', genre: { dominant: 'mystery', lethality: 'high', tempo: 'slow' } });
    ensureCast(s, 'Corwin');
    s.cast.Corwin.main = true;
    s.scene.location = { value: 'the harbour', established: true };
    s.scene.present = ['Corwin', 'Mira'];
    s.canon.push({ id: 'f1', fact: 'Corwin owes the guild money', turn: 2, weight: 'major', witnesses: ['Mira'] });
    s.threads.push({ id: 't1', setup: 'Who sank the ship?', status: 'open' });
    s.premise = 'A harbour town with a secret.';
    s.meta.turn = 9;
    s.spine = { ...emptySpine(), ...validateSpine({
        question: 'Will the truth come out?',
        endings: [{ title: 'Exposed', criteria: ['the guild is shamed'] }, { title: 'Buried', criteria: ['the ledger burns'] }],
        milestones: [{ title: 'A first lead', criteria: ['Corwin talks'] }],
    }).value };
    return s;
}

const pairs = {
    observer: [observerPrompt({ state: bareState(), reply: 'Rain fell.', playerMessage: '' }), observerPrompt({ state: busyState(), reply: 'Corwin spoke of the ledger at length.', playerMessage: 'I ask.', offered: { beat: 'b1', clues: [] } })],
    tracker: [trackerPrompt({ state: bareState(), exchanges: [{ player: 'B', reply: 'A.' }] }), trackerPrompt({ state: busyState(), exchanges: [{ player: 'x', reply: 'y' }, { player: 'z', reply: 'w' }] })],
    planner: [planPrompt({ state: bareState(), loreKeys: [], reason: 'cadence' }), planPrompt({ state: busyState(), loreKeys: ['harbour', 'guild'], reason: 'a milestone was reached' })],
    arc: [arcPrompt({ state: bareState(), loreKeys: [] }), arcPrompt({ state: busyState(), loreKeys: ['harbour'] })],
    spine: [spinePrompt({ material: 'one', genre: null, premise: '', arc: null, player: 'Rowan' }), spinePrompt({ material: 'two', genre: { dominant: 'mystery' }, premise: 'p', arc: { goal: 'g', forces: [], endings: [] }, player: 'Mira' })],
    summariser: [summariserPrompt({ rolled: '', summaries: ['a'] }), summariserPrompt({ rolled: 'older', summaries: ['b', 'c'] })],
    conclusion: [conclusionPrompt({ milestone: { title: 'A', criteria: [] }, player: 'Rowan', genre: null }), conclusionPrompt({ milestone: { title: 'B', criteria: [{ text: 'x', mark: 'met', quote: 'q' }] }, player: 'Mira', genre: { register: 'terse' }, scene: 'docks' })],
    cleanup: [cleanupPrompt({ facts: [] }), cleanupPrompt({ facts: [{ id: 'f1', fact: 'x', turn: 1, weight: 'minor' }] })],
    profile: [profilePrompt({ name: 'Corwin', card: 'A sailor.', genre: { dominant: 'fantasy' }, isPlayer: false }), profilePrompt({ name: 'Mira', card: 'A detective.', genre: { dominant: 'mystery', lethality: 'high' }, isPlayer: true })],
    genre: [genrePrompt({ material: 'one' }), genrePrompt({ material: 'two' })],
};

test('every role\'s system message is byte-identical across states and inputs', () => {
    for (const [role, [a, b]] of Object.entries(pairs)) {
        assert.equal(a[0].role, 'system', role);
        assert.equal(a[0].content, b[0].content, `${role}: system message varies`);
        assert.notEqual(a[1].content, b[1].content, `${role}: test inputs should differ`);
    }
});

test('the varying parts moved to the end of the user message', () => {
    const plan = pairs.planner[1][1].content;
    assert.ok(plan.trimEnd().endsWith('a milestone was reached'), 'reason last');
    const pc = pairs.profile[1][1].content;
    assert.ok(pc.includes('mystery, lethality high'));
    assert.ok(pc.trimEnd().endsWith('This is the player character.'));
    assert.ok(!pairs.profile[0][1].content.includes('player character'));
    assert.ok(pairs.profile[0][0].content.includes('"characters"'), 'multi-person shape still offered');
});

test('usage totals add up per module after scripted calls', async () => {
    const { director } = makeHost([user('hi'), narr('Hello there.')]);
    const plan = pairs.planner[1], obs = pairs.observer[0];
    await director.model('planner', plan);
    await director.model('planner', plan);
    await director.model('observer', obs);
    const entry = director.calls.planner;
    const promptText = plan.map(m => m.content).join('\n');
    assert.equal(entry.promptChars, promptText.length);
    assert.equal(entry.promptTokens, roughTokens(promptText));
    assert.equal(entry.answerChars, entry.raw.length);
    assert.equal(entry.answerTokens, roughTokens(entry.raw));
    assert.equal(director.usage.planner.calls, 2);
    assert.equal(director.usage.planner.promptTokens, 2 * entry.promptTokens);
    assert.equal(director.usage.planner.answerTokens, 2 * entry.answerTokens);
    assert.equal(director.usage.observer.calls, 1);
    assert.equal(director.usage.observer.answerTokens, director.calls.observer.answerTokens);
    // A failed call (empty answer) still counts its prompt.
    const { director: d2, host } = makeHost([user('hi'), narr('Hello.')]);
    host.call = async () => '';
    await assert.rejects(d2.model('cleanup', pairs.cleanup[1]));
    assert.equal(d2.usage.cleanup.calls, 1);
    assert.equal(d2.usage.cleanup.answerTokens, 0);
    assert.ok(d2.usage.cleanup.promptTokens > 0);
    d2.reset();
    assert.deepEqual(d2.usage, {});
});

/** A director whose view shows `n` live facts (a stub: the clean-up rules, not replay, are under test). */
function cleanRig(settings) {
    const chat = [user('hi'), narr('Hello.')];
    const rig = makeHost(chat, { settings });
    const s = bareState();
    rig.setFacts = (n) => { s.canon = Array.from({ length: n }, (_, i) => ({ id: `f${i}`, fact: `fact ${i}`, turn: i, weight: 'minor' })); };
    rig.director.view = () => s;
    rig.retire = 0;
    rig.host.call = async (module) => {
        rig.state.calls.push({ module });
        return JSON.stringify(module === 'cleanup' ? { merge: [], retire: s.canon.slice(0, rig.retire).map(f => f.id) } : {});
    };
    rig.cleanups = () => rig.state.calls.filter(c => c.module === 'cleanup').length;
    return rig;
}

test('early clean-up fires above the limit only when the count grew', async () => {
    const rig = cleanRig({ cleanEvery: 0, cleanAbove: 30 });
    rig.setFacts(30);
    assert.equal(await rig.director.maybeCleanUp(), false, 'at the limit: no');
    rig.setFacts(31);
    rig.retire = 3;
    assert.equal(await rig.director.maybeCleanUp(), true, 'above the limit, never cleaned: yes');
    assert.equal(rig.cleanups(), 1);
    const op = rig.host.chat().at(-1).narrator_ops.at(-1);
    assert.equal(op.kind, 'facts-clean');
    assert.equal(op.live, 28, 'stores the count left after the clean-up');
    assert.equal(rig.director.lastCleanLive(), 28);
    // Nothing was removed this time: the count stays above 30 but has not grown.
    // Growth is counted from what the last clean-up left (28): it must grow by at least max(5, 30/4 = 8), so 36.
    rig.retire = 0;
    rig.setFacts(32);
    assert.equal(await rig.director.maybeCleanUp(), false, '32: above the limit but only 4 more than left: not yet');
    rig.setFacts(36);
    assert.equal(await rig.director.maybeCleanUp(), true, '36: grew by 8: yes');
    assert.equal(rig.director.lastCleanLive(), 36);
    assert.equal(await rig.director.maybeCleanUp(), false, 'same count: not again');
    rig.setFacts(37);
    assert.equal(await rig.director.maybeCleanUp(), false, 'one new fact after a clean-up that could not shrink the list: not every turn');
    assert.equal(rig.cleanups(), 2);
    rig.setFacts(44);
    assert.equal(await rig.director.maybeCleanUp(), true, 'grew by 8 again: yes');
    assert.equal(rig.cleanups(), 3);
});

test('cleanAbove 0 disables the early trigger; the turn timer still works on its own', async () => {
    const off = cleanRig({ cleanEvery: 0, cleanAbove: 0 });
    off.setFacts(80);
    assert.equal(await off.director.maybeCleanUp(), false);
    assert.equal(off.cleanups(), 0);
    const timed = cleanRig({ cleanEvery: 10, cleanAbove: 0 });
    timed.setFacts(9);
    timed.director.view().meta.turn = 10;
    assert.equal(await timed.director.maybeCleanUp(), true);
});
