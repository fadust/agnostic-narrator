// Round 8: a critical injury was refused because the observer quoted "Her left hand ..." for the reply's
// "Elizabeth's left hand ...". A name/pronoun swap of one or two words in a long enough quote now matches, and the
// reply's own wording is stored. Invented or reworded quotes are still refused.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchQuote, quoteMatches } from '../../core/text.js';
import { aroundQuote, validateObservation } from '../../core/validate.js';

const REPLY = 'Rain hammers the yard. Elizabeth\'s left hand folds around the post at an angle that hands do not make. She does not scream.';
const ctx = { text: REPLY, names: ['Elizabeth', 'Max'], player: 'Max' };

test('the Elizabeth case: a possessive swapped for "her" is accepted and stored in the reply\'s words', () => {
    const v = validateObservation({ statuses: [{
        who: 'Elizabeth', op: 'add', status: 'crushed left hand, two fingers permanently maimed', severity: 'critical',
        quote: 'Her left hand folds around the post at an angle that hands do not make.',
    }] }, ctx);
    assert.equal(v.rejected.length, 0, JSON.stringify(v.rejected));
    assert.equal(v.delta.statuses[0].severity, 'critical');
    assert.equal(v.delta.statuses[0].quote, 'Elizabeth\'s left hand folds around the post at an angle that hands do not make');
    assert.ok(REPLY.includes(v.delta.statuses[0].quote));
    assert.match(aroundQuote(REPLY, 'Her left hand folds around the post at an angle'), /Elizabeth's left hand/);
});

test('a name swapped for a pronoun in a fact is accepted', () => {
    const text = 'Marcus draws the letter from his coat and hands it over without a word.';
    const v = validateObservation({ facts: [{ fact: 'Marcus gave up the letter', kind: 'event',
        quote: 'He draws the letter from his coat and hands it over' }] }, { text, names: ['Marcus'], player: 'Max' });
    assert.equal(v.delta.facts.length, 1, JSON.stringify(v.rejected));
    assert.equal(v.delta.facts[0].quote, 'Marcus draws the letter from his coat and hands it over');
    assert.ok(quoteMatches('Marcus draws the letter from her coat and hands it over', text), 'pronoun to pronoun');
});

test('a fabricated sentence about the same characters is refused', () => {
    const v = validateObservation({ statuses: [{ who: 'Elizabeth', op: 'add', status: 'broken hand', severity: 'critical',
        quote: 'Elizabeth screams as her hand is crushed against the post.' }] }, ctx);
    assert.equal(v.delta.statuses.length, 0);
    assert.equal(v.rejected[0].reason, 'quote not in the reply');
});

test('a quote differing in three or more content words is refused', () => {
    assert.ok(!quoteMatches('Her right arm bends around the post at an angle that hands do not make.', REPLY));
    assert.equal(matchQuote('Her left foot folds around the gate at an angle that feet do not make.', REPLY), '');
});

test('a short quote with a pronoun swap is refused', () => {
    assert.ok(quoteMatches('Elizabeth\'s left hand folds', REPLY), 'exact short quote still matches');
    assert.ok(!quoteMatches('Her left hand folds', REPLY));
    assert.ok(!quoteMatches('Elizabeth does not scream', REPLY));
});
