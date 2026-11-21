// Round 5, W5: a later milestone concludes while an earlier one is open -> the earlier one is skipped.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySpineOp, chapters, mergeSpineEdit, needsConclusion, spineForObserver, spineForPlanner } from '../../core/spine.js';

const crit = (id) => ({ id, text: id, mark: 'open' });
const fresh = () => ({
    meta: { turn: 3 },
    spine: {
        question: 'q', endings: [{ id: 'e1', title: 'E', how: '', criteria: [crit('e1-c1')] }], readings: [], turnedAway: [], scene: { key: null }, proposal: null,
        milestones: ['m1', 'm2', 'm3'].map(id => ({ id, title: id, status: 'open', conclusion: '', criteria: [crit(`${id}-c1`)] })),
    },
});
const entry = { mid: 'abcdef123' };
/** Replay a list of ops from scratch, as the extension does. */
const replayOps = (ops) => { const s = fresh(); for (const op of ops) applySpineOp(s, op, entry); return s; };
const conclude = (milestone) => ({ kind: 'conclusion', by: 'director', milestone, text: `${milestone} done` });
const status = (s) => s.spine.milestones.map(m => m.status);

test('a later conclusion skips the earlier open milestone; only the tracker still watches for it (owner, 22 Nov 2026)', () => {
    const s = replayOps([conclude('m2')]);
    assert.deepEqual(status(s), ['skipped', 'concluded', 'open']);
    assert.deepEqual(needsConclusion(s).map(m => m.id), []);
    assert.deepEqual(chapters(s).map(m => m.id), ['m2']);
    assert.deepEqual(spineForObserver(s).milestones.map(m => m.id), ['m3', 'm1']);
    assert.deepEqual(spineForPlanner(s).milestones.map(m => m.id), ['m3']);
    // even a fully resolved skipped milestone, or one whose event happened, never waits for a conclusion
    s.spine.milestones[0].criteria[0].mark = 'met';
    s.spine.milestones[0].happened = { quote: 'x', source: 'y' };
    assert.deepEqual(needsConclusion(s).map(m => m.id), []);
    assert.ok(!chapters(s).some(c => c.id === 'm1'));
});

test('"Conclude now" on a later milestone skips the earlier one once it is concluded', () => {
    const s = replayOps([{ kind: 'spine-conclude', by: 'player', milestone: 'm2' }, conclude('m2')]);
    assert.deepEqual(status(s), ['skipped', 'concluded', 'open']);
});

test('a conclusion of an earlier milestone skips nothing later', () => {
    assert.deepEqual(status(replayOps([conclude('m1')])), ['concluded', 'open', 'open']);
});

test('swiping the later conclusion away reopens the earlier milestone on replay', () => {
    assert.deepEqual(status(replayOps([conclude('m3')])), ['skipped', 'skipped', 'concluded']);
    assert.deepEqual(status(replayOps([])), ['open', 'open', 'open']);
});

test('a hand reopen returns it to open and survives replay', () => {
    const ops = [conclude('m2'), { kind: 'spine-reopen', by: 'player', milestone: 'm1' }];
    const s = replayOps(ops);
    assert.deepEqual(status(s), ['open', 'concluded', 'open']);
    assert.deepEqual(spineForObserver(s).milestones.map(m => m.id), ['m1', 'm3']);
    assert.deepEqual(status(replayOps(ops)), ['open', 'concluded', 'open']);
    // reopening something that is not skipped changes nothing
    applySpineOp(s, { kind: 'spine-reopen', milestone: 'm2' }, entry);
    assert.equal(s.spine.milestones[1].status, 'concluded');
});

test('a Plan tab save does not undo a skip', () => {
    const s = replayOps([conclude('m2')]);
    const edit = structuredClone(s.spine);
    edit.milestones[0].status = 'open';
    edit.milestones[0].title = 'renamed';
    const merged = mergeSpineEdit(s.spine, edit);
    assert.equal(merged.milestones[0].status, 'skipped');
    assert.equal(merged.milestones[0].title, 'renamed');
});

test('a skipped milestone that happens after all is reopened (owner, 22 Nov 2026)', async () => {
    const { applySpineDelta } = await import('../../core/spine.js');
    const s = replayOps([conclude('m2')]);
    applySpineDelta(s, { happened: [{ milestone: 'm1', quote: 'the knee is lanced' }] }, { mid: 'zz' }, s.spine.scene.key, true);
    assert.equal(s.spine.milestones[0].status, 'open');
    assert.ok(s.spine.milestones[0].happened);
});
