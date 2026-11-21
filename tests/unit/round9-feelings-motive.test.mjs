// Round 9 (owner, 21 Nov 2026): deeds count, words don't; goals put the player character's own wants first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WEIGHTS, CAPS } from '../../core/enums.js';
import { applyDelta, ensureCast, initialState } from '../../core/state.js';
import { validateObservation } from '../../core/validate.js';
import { MOTIVE, PLAN_RULES, SPINE_SYSTEM, arcPrompt, observerPrompt } from '../../core/prompts.js';

const ctx = (text) => ({ text, names: ['Bianca', 'Max'], player: 'Max' });
const rel = (category, quote, weight) => ({ who: 'Bianca', toward: 'Max', axis: 'trust', dir: 'up', weight, category, quote });

test('a pivotal deed moves a feeling by four; pivotal words do not', () => {
    assert.equal(WEIGHTS.pivotal, 4);
    assert.equal(CAPS.axisPerReply, 4);
    const text = 'Max drags Bianca out of the burning cellar. Bianca swears she will never forget it.';
    const deed = validateObservation({ relationships: [rel('action', 'Max drags Bianca out of the burning cellar', 'pivotal')] }, ctx(text));
    assert.equal(deed.delta.relationships[0].weight, 'pivotal');
    const talk = validateObservation({ relationships: [rel('words', 'Bianca swears she will never forget it', 'pivotal')] }, ctx(text));
    assert.equal(talk.delta.relationships[0].weight, 'minor', 'words alone are minor at most');
    const told = validateObservation({ relationships: [rel('disclosure', 'Bianca swears she will never forget it', 'pivotal')] }, ctx(text));
    assert.equal(told.delta.relationships[0].weight, 'major', 'pivotal needs a deed, a sacrifice, shared danger or a betrayal');
});

test('the pivotal step reaches the cast score', () => {
    const s = initialState({ player: 'Max' });
    const c = ensureCast(s, 'Bianca');
    const before = c.rel.trust;
    const text = 'Max drags Bianca out of the burning cellar.';
    const v = validateObservation({ relationships: [rel('action', text.slice(0, -1), 'pivotal')] }, ctx(text));
    applyDelta(s, v, { mid: 'abcdef123456', i: 1 });
    assert.equal(s.cast.Bianca.rel.trust, before + 4);
});

test('the observer rule says deeds weigh more than words', () => {
    const sys = observerPrompt({ state: initialState({ player: 'Max' }), reply: 'x', playerMessage: 'y' })?.[0]?.content ?? '';
    assert.match(sys, /deeds weigh more than words/);
    assert.match(sys, /minor \| major \| pivotal/);
});

test('arc, spine and planner put the player character\'s own wants first', () => {
    assert.match(MOTIVE, /not a saint/);
    const arc = arcPrompt({ state: initialState({ player: 'Max' }), loreKeys: [] })[0].content;
    assert.ok(arc.includes(MOTIVE));
    assert.ok(SPINE_SYSTEM.includes(MOTIVE));
    assert.match(SPINE_SYSTEM, /At least one ending rewards the player character putting themselves first/);
    assert.match(PLAN_RULES, /drives the story, not only serves it/);
    assert.ok(!/what he is after/.test(arc + SPINE_SYSTEM));
});

// Live, 21 Nov 2026: Max sucked the pus from Elizabeth's wound; the observer quoted her "Don't stop." as words, minor.
test('the evidence is the cause, and a costly kind of deed is never minor', () => {
    const sys = observerPrompt({ state: initialState({ player: 'Max' }), reply: 'x', playerMessage: 'y' })[0].content;
    assert.match(sys, /Judge by the cause, not the reaction/);
    assert.match(sys, /what caused the change, not how it shows/);
    const text = 'Max puts himself between her and the cudgel.';
    const v = validateObservation({ relationships: [rel('shared_danger', 'Max puts himself between her and the cudgel', 'minor')] }, ctx(text));
    assert.equal(v.delta.relationships[0].weight, 'major');
});
