// Second round: design flaws found in live play (18 November 2026). Tracker failures need a reason, spine criteria
// are objectives with a role, facts are weighed and fade, and a periodic clean-up merges and retires them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSpine } from '../../extension/core/planner.js';
import { SPINE_SYSTEM, trackerPrompt } from '../../extension/core/prompts.js';
import { FACT_FADE, factsInView, reconcile, visibleText } from '../../extension/core/state.js';
import { hash } from '../../extension/core/util.js';
import { validateCleanup, validateObservation, validateTracking } from '../../extension/core/validate.js';
import { NARRATOR, makeHost, narr, user } from './helpers.mjs';

test('tracker: a failure needs a reason, "happened" needs a criterion met with it, criteria are listed apart from readings', () => {
    const text = 'Ilse looks at the scar a long time. Sithe is dead, she says.';
    const spine = { endingIds: ['e1'], criterionIds: ['e1-c1', 'm1-c1', 'm1-c2'], milestoneIds: ['m1'], milestoneCriteria: { m1: ['m1-c1', 'm1-c2'] } };
    const v = validateTracking({
        readings: [{ ending: 'e1', reading: 'aside' }],
        marks: [
            { id: 'e1-c1', mark: 'failed', quote: 'Ilse looks at the scar a long time.' },
            { id: 'm1-c2', mark: 'failed', quote: 'Sithe is dead, she says.', reason: 'Sithe is dead, so he can never vouch' },
        ],
        happened: [{ milestone: 'm1', quote: 'Ilse looks at the scar a long time.' }],
    }, { texts: [text], spine });
    assert.deepEqual(v.delta.marks.map(m => m.id), ['m1-c2'], 'a failure without a reason is refused');
    assert.equal(v.delta.marks[0].reason, 'Sithe is dead, so he can never vouch');
    assert.equal(v.delta.happened.length, 0, 'happened without one of its criteria met is refused');
    const ok = validateTracking({ marks: [{ id: 'm1-c1', mark: 'met', evidence: 'shown', quote: 'Ilse looks at the scar a long time.' }], happened: [{ milestone: 'm1', quote: 'Ilse looks at the scar a long time.' }] }, { texts: [text], spine });
    assert.equal(ok.delta.happened.length, 1);
    const state = { spine: { endings: [{ id: 'e1', title: 'Trust', criteria: [{ id: 'e1-c1', text: 'she trusts him', role: 'an ally', mark: 'open' }] }], milestones: [] } };
    const u = trackerPrompt({ state, exchanges: [{ player: 'p', reply: 'r' }] })[1].content;
    assert.match(u, /## Endings \(one reading for each\)\n- e1: Trust\n/);
    assert.match(u, /## Open criteria \(mark only those an exchange settles; most exchanges settle none\)\nEnding e1, Trust:\n {2}- e1-c1: she trusts him \(lasting\) \(role: an ally\)/);
});

test('spine drafter: criteria are objectives with a role; at most four per item and five milestones', () => {
    const crit = (n) => Array.from({ length: n }, (_, i) => ({ text: `objective ${i}`, role: `role ${i}` }));
    const v = validateSpine({ question: 'q', endings: [{ title: 'A', criteria: crit(6) }, { title: 'B', criteria: ['plain string'] }], milestones: Array.from({ length: 7 }, (_, i) => ({ title: `M${i}`, criteria: crit(2) })) });
    assert.ok(v.ok);
    assert.equal(v.value.endings[0].criteria.length, 4);
    assert.deepEqual(v.value.endings[0].criteria[0], { id: 'e1-c1', text: 'objective 0', role: 'role 0', mark: 'open' });
    assert.equal(v.value.endings[1].criteria[0].text, 'plain string');
    assert.equal(v.value.milestones.length, 5);
    assert.match(SPINE_SYSTEM, /each an objective/);
    assert.match(SPINE_SYSTEM, /never a milestone/);
});

test('facts: weighed on intake, minor ones fade from what the models see, old unweighed facts count as major', () => {
    const text = 'Sithe is her brother. The barman wipes the counter.';
    const v = validateObservation({ summary: 's', facts: [
        { fact: 'Sithe is her brother', quote: 'Sithe is her brother.', certainty: 'stated', weight: 'major' },
        { fact: 'The barman wipes the counter', quote: 'The barman wipes the counter.', certainty: 'stated' },
    ] }, { text, names: ['Max'], tombstones: [], present: [], uncertainIds: [], threadIds: [], clueIds: [], player: 'Max' });
    assert.deepEqual(v.delta.facts.map(f => f.weight), ['major', 'minor'], 'no weight given counts as minor');
    const canon = [
        { id: 'a', fact: 'old', turn: 1 }, { id: 'b', fact: 'major', turn: 2, weight: 'major' }, { id: 'c', fact: 'minor old', turn: 2, weight: 'minor' },
        { id: 'd', fact: 'minor new', turn: 9, weight: 'minor' }, { id: 'e', fact: 'retired', turn: 9, weight: 'minor', retired: true },
    ];
    assert.deepEqual(factsInView({ canon, meta: { turn: 9 } }).map(f => f.id), ['a', 'b', 'd'], `minor facts older than ${FACT_FADE} turns, and retired facts, are not shown`);
});

test('fact clean-up: validation drops unknown ids, uses a fact once, never retires a major fact', () => {
    const facts = [{ id: 'f1', weight: 'major' }, { id: 'f2', weight: 'major' }, { id: 'f3', weight: 'minor' }, { id: 'f4', weight: 'major' }];
    const v = validateCleanup({ merge: [{ ids: ['f1', 'f2', 'zz'], fact: 'The boat runs Friday now' }, { ids: ['f2', 'f4'], fact: 'reuse' }], retire: ['f3', 'f4'] }, facts).value;
    assert.deepEqual(v.merges, [{ ids: ['f1', 'f2'], fact: 'The boat runs Friday now' }]);
    assert.deepEqual(v.retire, ['f3']);
});

test('fact clean-up: the newest fact carries the merged truth, minor facts are retired but kept, it waits N turns', async () => {
    const chat = [user('start')];
    const WORDS = ['anchor', 'lantern', 'ledger', 'harbour', 'letter', 'oilskin', 'chandlery', 'rope', 'gull', 'tide'];
    for (let i = 0; i < 10; i++) chat.push(narr(`The ${WORDS[i]} matters to Ilse in its own way.`), user(`p${i}`));
    reconcile(chat, NARRATOR);
    chat.forEach((m, i) => {
        if (m.is_user) return;
        m.extra.narrator.obs = { hash: hash(visibleText(m)), delta: { summary: 's', facts: [{ fact: `The ${WORDS[(i - 1) / 2]} matters to Ilse`, quote: m.mes, certainty: 'stated', weight: i % 4 === 1 ? 'major' : 'minor', witnesses: [] }] }, accepted: 1, rejected: [] };
    });
    const { director, host, state } = makeHost(chat, { settings: { cleanEvery: 10 } });
    const live = director.view({ includeProvisional: false }).canon;
    const older = live.find(f => f.weight === 'major');
    const newer = live.at(-1);
    const minor = live.find(f => f.weight === 'minor' && f !== newer);
    const call = host.call;
    host.call = async (module, messages, ...rest) => {
        if (module !== 'cleanup') return call(module, messages, ...rest);
        state.calls.push({ module });
        return JSON.stringify({ merge: [{ ids: [older.id, newer.id], fact: 'The boat runs Friday' }], retire: [minor.id, older.id] });
    };
    assert.equal(await director.maybeCleanUp(), true);
    const s = director.view();
    const merged = s.canon.find(f => f.id === newer.id);
    assert.equal(merged.fact, 'The boat runs Friday');
    assert.equal(merged.weight, 'major', 'merging a major fact keeps it major');
    assert.ok(!s.canon.some(f => f.id === older.id), 'the older fact is merged away');
    assert.ok(s.canon.find(f => f.id === minor.id).retired, 'a minor fact is retired but kept');
    assert.equal(await director.maybeCleanUp(), false, 'not again until another N turns pass');
    assert.equal(state.calls.filter(c => c.module === 'cleanup').length, 1);
});

test('an empty answer from the connection never uses up a reply\'s tries', async () => {
    const chat = [user('go'), narr('Ilse sets the glass down and looks at him for a long time.'), user('next')];
    let empty = 3;
    const { director, host } = makeHost(chat, { settings: { maxRetries: 2 } });
    const call = host.call;
    host.call = async (module, ...rest) => (module === 'observer' && empty-- > 0 ? '' : call(module, ...rest));
    for (let i = 0; i < 3; i++) await director.kick();
    clearTimeout(director.retryTimer);
    assert.equal(chat[1].extra.narrator.err, undefined, 'no failure recorded against the reply');
    await director.kick();
    clearTimeout(director.retryTimer);
    assert.ok(chat[1].extra.narrator.obs, 'read once the connection answers');
});

test('a name whose parts are known separately ("Elizabeth and Dorothy Juringen") still joins the cast', () => {
    const intro = { cast_changes: [{ who: 'Elizabeth Juringen', change: 'introduced', quote: 'The elder one is Elizabeth.' }] };
    const base = { text: 'The elder one is Elizabeth. She does not look up.', names: ['Max'], tombstones: [], present: [], uncertainIds: [], threadIds: [], clueIds: [], player: 'Max' };
    assert.deepEqual(validateObservation(intro, { ...base, known: 'Two women: Elizabeth and Dorothy Juringen.' }).delta.cast_changes.map(c => c.who), ['Elizabeth Juringen']);
    assert.equal(validateObservation(intro, { ...base, known: 'Dorothy Juringen only.' }).delta.cast_changes.length, 0, 'a part never seen is not accepted');
});

test('a quote of speech without its tags matches, sentence by sentence and in order; a paraphrase still does not', async () => {
    const { quoteMatches } = await import('../../extension/core/text.js');
    const reply = '"My father had a chest," she says. Low. Measured. "Bond notes. Letters from men with names on them. My mother burned what she could."';
    assert.ok(quoteMatches('My father had a chest. Bond notes. Letters from men with names on them.', reply));
    assert.ok(!quoteMatches('My father had a box. Bond notes. Letters from men with names on them.', reply), 'one changed word fails');
    assert.ok(!quoteMatches('Letters from men with names on them. My father had a chest.', reply), 'out of order fails');
});
