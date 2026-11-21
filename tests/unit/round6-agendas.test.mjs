// Round 6 (19 November 2026), simplified by the owner the same day: every cast character may have up to three lasting,
// high-level wants. No trigger, no expiry, no observer check. Drafted with the spine, seeded and (only when the story
// transforms one) changed by the planner, edited on the Cast tab, shown to the narrator while the character is present.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agendaLines, agendaName, applyPlanAgendas, cleanWants, seedCandidates, validateAgendas, validateRenewals, wantOf } from '../../extension/core/agenda.js';
import { buildBrief } from '../../extension/core/brief.js';
import { planPrompt, spinePrompt } from '../../extension/core/prompts.js';
import { applyOp, ensureCast, initialState } from '../../extension/core/state.js';

const castState = () => {
    const s = initialState({ player: 'Max' });
    s.genre = { dominant: 'fantasy' };
    ensureCast(s, 'Max').pc = true;
    for (const n of ['Corliss', 'Piet', 'Elsa', 'Hale']) ensureCast(s, n);
    s.cast.Corliss.main = true;
    s.cast.Piet.knows = [1, 2];
    s.cast.Hale.dead = true;
    s.scene.present = ['Piet'];
    return s;
};
const ENTRY = { mid: 'm-0001-abcdef' };

test('wants: up to three, short, no duplicates; an old agenda shape still reads', () => {
    assert.deepEqual(cleanWants(['a happy family', 'A happy family', 'to amass a fortune', 'to be loved', 'a fourth']), ['a happy family', 'to amass a fortune', 'to be loved']);
    assert.deepEqual(cleanWants({ want: 'the ship back', trigger: 'x', expires: { replies: 30 } }), ['the ship back']);
    assert.deepEqual(cleanWants(''), []);
});

test('names: cast, or every word in the material; never the player', () => {
    const material = 'Max rides into Veldmark looking for news of the Juringen sisters, Elizabeth and Dorothy.';
    assert.equal(agendaName('Elizabeth Juringen', { cast: [], player: 'Max', material }), 'Elizabeth Juringen');
    assert.equal(agendaName('Hanne Juringen', { cast: [], player: 'Max', material }), '');
    assert.equal(agendaName('Max', { cast: [], player: 'Max', material }), '');
    assert.equal(agendaName('piet', { cast: ['Piet'], player: 'Max' }), 'Piet');
});

test('the spine drafter gives wants to every character it names, with no limit on how many characters', () => {
    const s = castState();
    const v = validateAgendas([
        { who: 'Corliss', wants: ['the writ back', 'respect in the guild'] },
        { who: 'Piet', wants: 'to be paid' },
        { who: 'Elsa', wants: ['revenge'] },
        { who: 'Max', wants: ['nothing'] },
        { who: 'Nobody Known', wants: ['x'] },
    ], s, 'The story material.');
    assert.deepEqual(v.map(a => [a.name, a.wants.length]), [['Corliss', 2], ['Piet', 1], ['Elsa', 1]]);
    applyOp(s, { kind: 'agendas', by: 'setup', value: v }, ENTRY);
    assert.equal(wantOf(s, 'Corliss'), 'the writ back; respect in the guild');
    assert.equal(wantOf(s, 'Max'), '');
});

test('the planner seeds wants for characters with none, changes them only with a why, never for one the player cleared', () => {
    const s = castState();
    assert.deepEqual(seedCandidates(s), ['Corliss', 'Piet', 'Elsa'], 'main cast, then present, then known most; never the dead or the player');
    applyOp(s, { kind: 'edit', by: 'player', path: 'agendas', value: { Elsa: { wants: ['revenge'] } } }, ENTRY);
    applyOp(s, { kind: 'edit', by: 'player', path: 'agendas', value: { Corliss: { wants: ['the writ back'], by: 'player' } } }, ENTRY);
    assert.deepEqual(s.meta.clearedAgendas, ['Elsa']);
    const v = validateRenewals([
        { who: 'Piet', wants: ['to be paid', 'a stall of his own'] },
        { who: 'Corliss', wants: ['revenge on the court'] },
        { who: 'Corliss', wants: ['x'], why: 'the court burned his writ' },
        { who: 'Elsa', wants: ['peace'] },
        { who: 'Hale', wants: ['order'] },
    ], s);
    assert.deepEqual(v.map(a => a.name), ['Piet', 'Corliss']);
    assert.equal(v[1].why, 'the court burned his writ');
    applyPlanAgendas(s, { agendas: v });
    assert.equal(wantOf(s, 'Piet'), 'to be paid; a stall of his own');
    assert.equal(wantOf(s, 'Corliss'), 'x');
    // A logged plan carrying a change without its why is refused on replay.
    applyPlanAgendas(s, { agendas: [{ name: 'Piet', wants: ['forged'] }] });
    assert.equal(wantOf(s, 'Piet'), 'to be paid; a stall of his own');
});

test('the narrator sees wants on a present character\'s cast line only', () => {
    const s = castState();
    s.agendas = { Piet: { wants: ['to be paid'] }, Corliss: { wants: ['the writ back'] } };
    s.meta.turn = 2;
    const cast = buildBrief(s).lines.cast.join('\n');
    assert.match(cast, /Piet[^\n]*; wants: to be paid/);
    assert.ok(!cast.includes('the writ back'), 'Corliss is away');
});

test('prompts: the planner\'s system text stays fixed; wants and seed candidates go in the user message', () => {
    const s = castState();
    const a = planPrompt({ state: s, loreKeys: [], reason: 'cadence' });
    s.agendas = { Piet: { wants: ['to be paid'] } };
    const b = planPrompt({ state: s, loreKeys: [], reason: 'drifting' });
    assert.equal(a[0].content, b[0].content);
    assert.match(b[1].content, /## Wants\n- Piet \(in the scene\): wants to be paid\n- Corliss: no wants yet \(may be given some\)/);
    assert.deepEqual(agendaLines(s).length, 3);
    assert.match(spinePrompt({ material: 'm', genre: s.genre, premise: '', arc: null, player: 'Max' })[0].content, /what they live for: one to three lasting, high-level wants/);
});

test('live fixes: wants survive the notes cap longest; a cut-off outcome is dropped (19 Nov 2026)', async () => {
    const { validatePlan } = await import('../../extension/core/planner.js');
    const s = castState();
    s.agendas = { Piet: { wants: ['to be paid'] } };
    s.meta.turn = 2;
    const tight = buildBrief(s, { tokenCap: 60 }).lines.cast.join('\n');
    assert.match(tight, /Piet[^\n]*wants: to be paid/);
    const v = validatePlan({ beats: [{ goal: 'g', pressure: 'p' }], outcomes: ['Corliss sold the writ to the court.', 'The younger man walked north up the'] }, s).value;
    assert.deepEqual(v.outcomes, ['Corliss sold the writ to the court.']);
});
