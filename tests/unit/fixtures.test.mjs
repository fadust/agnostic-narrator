import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { judge, prepare } from '../../tools/fixtures.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8'));
const all = [...load('observer.json'), ...load('planning.json')];

test('every fixture builds a prompt from the extension\'s own builders', () => {
    for (const fx of all) {
        const { messages } = prepare(fx);
        assert.ok(messages.length === 2 && messages[1].content.length > 20, fx.id);
    }
    assert.ok(all.length >= 18);
});

test('the judge passes a good answer, fails a weak one and catches forbidden output', () => {
    const fx = all.find(f => f.id === 'obs-attempt-is-not-outcome');
    const quote = 'Your blade whistles through the space where Captain Hale stood a heartbeat ago';
    const good = { summary: 'The strike misses.', facts: [{ fact: 'The player\'s blade missed Captain Hale, who stepped back', quote, certainty: 'stated' }] };
    assert.ok(judge(fx, JSON.stringify(good)).pass);
    const bad = { summary: 'Hale dies.', facts: [{ fact: 'Captain Hale is dead', quote, certainty: 'stated' }] };
    const r = judge(fx, JSON.stringify(bad));
    assert.ok(!r.pass && r.forbidden);
    // An invented quote never reaches the delta, so a model that hallucinates support simply fails the expectation.
    const invented = { summary: 'x', facts: [{ fact: 'the blade missed', quote: 'Hale laughs and dodges away', certainty: 'stated' }] };
    assert.ok(!judge(fx, JSON.stringify(invented)).pass);
    assert.ok(!judge(fx, 'not json').pass);
});

test('the observer never sees more of the plan than the narrator did', () => {
    const fx = all.find(f => f.id === 'obs-no-plan-contamination');
    const text = prepare(fx).messages.map(m => m.content).join('\n');
    assert.ok(text.includes('scene intent: let the debt'));
    assert.ok(!/Beats still queued|"endings"|payoff/.test(text));
});

test('docs/rules.md matches the rules the models are actually given', async () => {
    const { build } = await import('../../tools/rules.mjs');
    assert.equal(readFileSync(new URL('../../docs/rules.md', import.meta.url), 'utf8'), build(), 'run: npm run docs');
});
