// Round 6 (19 November 2026): names already taken (M3) and dormant threads (F1).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStoryBlock, takenNames } from '../../core/brief.js';
import { awakeThreads, initialState, threadKeys } from '../../core/state.js';
import { planTrigger } from '../../core/planner.js';
import { DEFAULTS } from '../../core/director.js';

test('names already in use: cast, player, renamed-away names, proper-name lore keys and lore characters', () => {
    const s = initialState({ player: 'Max' });
    s.cast = { 'Elizabeth Juringen': {}, Piet: {} };
    s.meta.renamedCast = { Hanne: 'Elizabeth Juringen' };
    s.lore_drafts = [{ kind: 'character', keys: ['Corliss', 'the bailiff'] }, { kind: 'place', keys: ['Veldmark'] }];
    const names = takenNames(s, ['Houshan', 'the gatehouse', 'guild', 'Piet']);
    assert.deepEqual(names, ['Corliss', 'Elizabeth Juringen', 'Hanne', 'Houshan', 'Max', 'Piet']);
    const block = buildStoryBlock(s, { loreNames: ['Houshan'] }).text;
    assert.match(block, /Names already in use \(never give a new character any of these names or first names\): Corliss, Elizabeth Juringen/);
});

test('a thread sleeps after N turns unseen, and wakes when a reply or the scene names it again', () => {
    assert.equal(DEFAULTS.dormantAfter, 12);
    assert.deepEqual(threadKeys({ setup: 'Elizabeth owes the Guild of Varn a debt. She hides it.' }), ['elizabeth', 'guild', 'varn']);
    const s = initialState();
    s.meta.turn = 20;
    s.scene.present = ['Piet'];
    s.scene.location = { value: 'the harbour', established: true };
    s.threads = [
        { id: 't1', status: 'open', setup: 'Corliss wants the writ back', seen: 3 },
        { id: 't2', status: 'open', setup: 'Piet owes money to the Guild', seen: 2 },
        { id: 't3', status: 'advanced', setup: 'the storm is coming', seen: 15 },
        { id: 't4', status: 'resolved', setup: 'done', seen: 20 },
    ];
    assert.deepEqual(awakeThreads(s, 12).map(t => t.id), ['t2', 't3'], 't1 sleeps; t2 names someone present');
    assert.deepEqual(awakeThreads(s, 0).map(t => t.id), ['t1', 't2', 't3'], '0: threads never sleep');
});

test('threads running low counts only awake threads', () => {
    const s = initialState();
    s.genre = { dominant: 'fantasy' };
    s.arc = { goal: 'g' };
    s.meta.turn = 20;
    s.meta.lastPlanTurn = 10;
    s.meta.dormantAfter = 12;
    s.beats = [{ status: 'queued' }];
    s.threads = [{ status: 'open', setup: 'Corliss wants the writ', seen: 1 }, { status: 'open', setup: 'Varn waits', seen: 2 }, { status: 'open', setup: 'Elsa hides', seen: 19 }];
    assert.match(planTrigger(s, { cadence: 0 }), /^threads running low/);
});
