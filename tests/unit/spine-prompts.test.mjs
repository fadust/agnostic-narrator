import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateConclusion, validatePlan, validateSpine } from '../../extension/core/planner.js';
import { TRACKER_SYSTEM, conclusionPrompt, observerPrompt, planPrompt, spinePrompt, trackerPrompt } from '../../extension/core/prompts.js';
import { emptySpine, spineIds } from '../../extension/core/spine.js';
import { initialState } from '../../extension/core/state.js';
import { validateObservation, validateTracking } from '../../extension/core/validate.js';

const draft = {
    question: 'Can the fallen prince take back what was stolen?',
    endings: [
        { id: 'zz', title: 'The rightful throne', how: 'by force', criteria: ['loyalists rallied', 'the guard won over', 'the usurper defeated in the open'] },
        { title: 'The usurper unmasked', how: 'through the court', criteria: ['proof of the murder', 'a voice the court trusts'] },
        { title: 'No criteria', criteria: [] },
    ],
    milestones: [{ title: 'Building first allies', criteria: ['Ser Corwin stands with him', 'gold for mercenaries'] }],
};

function spineState() {
    const s = initialState({ player: 'Rowan', genre: { dominant: 'fantasy' } });
    s.spine = { ...emptySpine(), ...validateSpine(draft).value };
    return s;
}

test('validateSpine assigns its own ids, keeps caps and needs two endings and a milestone', () => {
    const v = validateSpine(draft);
    assert.ok(v.ok);
    assert.deepEqual(v.value.endings.map(e => e.id), ['e1', 'e2'], 'model ids ignored; an ending without criteria dropped');
    assert.deepEqual(v.value.endings[0].criteria.map(c => c.id), ['e1-c1', 'e1-c2', 'e1-c3']);
    assert.ok(v.value.endings[0].criteria.every(c => c.mark === 'open'));
    assert.equal(v.value.milestones[0].id, 'm1');
    assert.equal(v.value.milestones[0].status, 'open');
    assert.equal(v.value.milestones[0].conclusion, '');
    const many = { ...draft, endings: Array.from({ length: 7 }, (_, i) => ({ title: `E${i}`, criteria: Array.from({ length: 9 }, (_, k) => `c${k}`) })) };
    const capped = validateSpine(many).value;
    assert.equal(capped.endings.length, 4);
    assert.equal(capped.endings[0].criteria.length, 4);
    assert.equal(validateSpine({ ...draft, endings: [draft.endings[0]] }).ok, false);
    assert.equal(validateSpine({ ...draft, milestones: [] }).ok, false);
    assert.equal(validateSpine('nope').ok, false);
});

test('validateConclusion takes the conclusion text and refuses an empty one', () => {
    assert.deepEqual(validateConclusion({ conclusion: 'He gained a brother-in-arms.' }), { ok: true, value: 'He gained a brother-in-arms.' });
    assert.equal(validateConclusion({ conclusion: '' }).ok, false);
    assert.equal(validateConclusion(null).ok, false);
});

test('validatePlan keeps serves only for open criteria, alternatives only for known endings, a new ending only when all are turned away', () => {
    const s = spineState();
    s.spine.endings[1].criteria[0].mark = 'met';
    const raw = {
        scenes: [{ id: 's1', purpose: 'p' }],
        beats: [
            { scene: 's1', intent: 'Ser Corwin offers a spar', type: 'reward', serves: 'm1-c1' },
            { scene: 's1', intent: 'a met one', type: 'release', serves: 'e2-c1' },
            { scene: 's1', intent: 'an unknown one', type: 'choice', serves: 'x9' },
        ],
        alternatives: [{ ending: 'e2', text: 'a magistrate from the next kingdom listens' }, { ending: 'e9', text: 'no such ending' }, { ending: 'e1', text: 'a' }, { ending: 'e1', text: 'b' }, { ending: 'e1', text: 'c' }],
        new_ending: { title: 'A quiet life', criteria: ['a safe home'] },
    };
    let v = validatePlan(raw, s).value;
    assert.deepEqual(v.beats.map(b => b.serves), ['m1-c1', '', '']);
    assert.equal(v.alternatives.length, 3);
    assert.ok(v.alternatives.every(a => a.ending !== 'e9'));
    assert.equal(v.new_ending, undefined, 'endings still live: no new ending');
    s.spine.turnedAway = ['e1', 'e2'];
    s.spine.againstTurn = 3; // turning away always comes with the turn of the "against"
    v = validatePlan(raw, s).value;
    assert.equal(v.new_ending.title, 'A quiet life');
    assert.deepEqual(validatePlan(raw, initialState()).value.beats.map(b => b.serves), ['', '', ''], 'no spine: no serves');
});

test('the observer never sees the spine; the tracker sees its endings, open criteria and the exchange', () => {
    const s = spineState();
    const obs = observerPrompt({ state: s, reply: 'Rain.', playerMessage: '', offered: {} });
    assert.ok(!obs[0].content.includes('Spine rules') && !obs[1].content.includes('e1: The rightful throne'), 'the observer is back to record keeping');
    const tr = trackerPrompt({ state: s, reply: 'Rain falls on the gate.', playerMessage: 'I wait for Corwin.' });
    assert.ok(tr[0].content === TRACKER_SYSTEM && tr[0].content.includes('Spine rules:'));
    assert.ok(tr[1].content.includes('e1: The rightful throne') && tr[1].content.includes('m1-c1: Ser Corwin stands with him'));
    assert.ok(tr[1].content.includes('I wait for Corwin.') && tr[1].content.includes('### REPLY\nRain falls on the gate.'));
    const batch = trackerPrompt({ state: s, exchanges: [{ player: 'a', reply: 'One.' }, { player: 'b', reply: 'Two.' }] })[1].content;
    assert.ok(batch.indexOf('## EXCHANGE 1') < batch.indexOf('## EXCHANGE 2') && batch.includes('### REPLY\nTwo.'));
    s.spine.endings[0].criteria[0].mark = 'met';
    assert.ok(!trackerPrompt({ state: s, reply: 'Rain.' })[1].content.includes('e1-c1'), 'resolved criteria are not shown');
});

test('the planner reads the spine, the kind definitions and the spine rules', () => {
    const s = spineState();
    s.spine.turnedAway = ['e1', 'e2'];
    s.spine.againstTurn = 3;
    const [sys, user] = planPrompt({ state: s, loreKeys: [], reason: 'test' });
    assert.ok(sys.content.includes('Beat kinds.') && sys.content.includes('release: the push eases') && sys.content.includes('"serves"') && sys.content.includes('"new_ending"'));
    assert.ok(user.content.includes('## Story spine') && user.content.includes('e1: The rightful throne (turned away from)') && user.content.includes('propose a new ending'));
    assert.ok(!planPrompt({ state: initialState(), loreKeys: [], reason: 't' })[1].content.includes('Story spine'));
});

test('spine and conclusion prompts carry their inputs', () => {
    const sp = spinePrompt({ material: 'A prince serves a noble house.', genre: { dominant: 'fantasy' }, premise: 'p', arc: null, player: 'Rowan' });
    assert.ok(sp[0].content.includes('"endings"') && sp[1].content.includes('A prince serves a noble house.'));
    const c = conclusionPrompt({ milestone: { title: 'Building first allies', criteria: [{ text: 'Ser Corwin stands with him', mark: 'met', quote: 'Corwin knelt' }, { text: 'the daughter trusts him', mark: 'failed', quote: 'her door stayed shut' }] }, player: 'Rowan' });
    assert.ok(c[1].content.includes('achieved: Ser Corwin stands with him') && c[1].content.includes('failed: the daughter trusts him') && c[1].content.includes('"Corwin knelt"'));
});

test('the validator keeps spine findings only for ids on offer, with quotes; "against" needs a quote', () => {
    const s = spineState();
    const text = 'Ser Corwin stands with him at the gate. Rowan tears up the letter from the loyalists and burns it.';
    const v = validateTracking({
        spine: {
            readings: [
                { ending: 'e1', reading: 'against', quote: 'tears up the letter from the loyalists' },
                { ending: 'e2', reading: 'against', quote: 'not in the reply at all' },
                { ending: 'e9', reading: 'toward' },
                { ending: 'e1', reading: 'toward' },
            ],
            marks: [
                { id: 'm1-c1', mark: 'met', evidence: 'shown', quote: 'Ser Corwin stands with him' },
                { id: 'm1-c2', mark: 'met', evidence: 'shown', quote: 'invented' },
                { id: 'e1-c1', mark: 'done', quote: 'Ser Corwin stands with him' },
                { id: 'x1', mark: 'met', quote: 'Ser Corwin stands with him' },
            ],
            happened: [{ milestone: 'm1', quote: 'Ser Corwin stands with him at the gate' }, { milestone: 'm7', quote: 'Ser Corwin' }],
        },
    }, { text, spine: spineIds(s) });
    assert.deepEqual(v.delta.readings, [{ ending: 'e1', reading: 'against', quote: 'tears up the letter from the loyalists', exchange: 1 }]);
    assert.deepEqual(v.delta.marks, [{ id: 'm1-c1', mark: 'met', quote: 'Ser Corwin stands with him', exchange: 1, evidence: 'shown' }]);
    assert.deepEqual(v.delta.happened.map(h => h.milestone), ['m1']);
    assert.equal(v.rejected.filter(r => r.kind === 'spine').length, 7, 'three readings, three marks, one milestone refused');
    const flat = validateTracking({ readings: [{ ending: 'e1', reading: 'toward' }] }, { text, spine: spineIds(s) });
    assert.equal(flat.delta.readings.length, 1, 'the answer without a wrapping "spine" key is read too');
    const none = validateTracking({ readings: [{ ending: 'e1', reading: 'toward' }] }, { text });
    assert.equal(none.delta.readings.length, 0, 'no spine on offer: nothing accepted');
    assert.ok(validateObservation({ summary: 's', spine: {} }, { text, names: [], player: 'Rowan' }).rejected.some(r => r.reason === 'unknown key "spine"'), 'the observer no longer answers for the spine');
});
