// Narrator Director: SillyTavern glue. Everything with rules in it lives in core/ and is tested in Node;
// this file only connects SillyTavern's events, prompt slots and World Info to that core.
// Tested against SillyTavern 1.19.0 (release, 06bde93).

import { extension_prompt_roles, extension_prompt_types } from '../../../../script.js';
import { editGroup, group_generation_mode } from '../../../group-chats.js';
import { buildBrief, buildStoryBlock } from './core/brief.js';
import { DEFAULTS, Director } from './core/director.js';
import { extractJson } from './core/json.js';
import { DYNAMIC_WORLD, toWorldInfoEntry } from './core/lore.js';
import { applyRating, validateGenre } from './core/planner.js';
import { openingPrompt, premisePrompt, revisePrompt } from './core/prompts.js';
import { castPeople, classify, scan } from './core/state.js';
import { FALLBACK_NOTE, hasLeak, parseTags, stripDirector } from './core/text.js';
import { clone, similarity, str } from './core/util.js';
import { clearVars, publicVars, writeVars } from './core/vars.js';
import { memoryGaps, memoryStory, providerOptions, registerMemoryProvider } from './st/providers.js';
import { mountUi } from './st/ui.js';

const KEY = 'narrator_director';           // settings key, chat metadata key, card marker (data.extensions.narrator_director)
const PROMPT_BRIEF = 'narrator_director_brief';
const PROMPT_STORY = 'narrator_director_story';
const PROMPT_SCAN = 'narrator_director_scan';
const MACRO = 'director_notes';
const SKIP_TYPES = new Set(['quiet', 'impersonate']);
const SYSTEM_PROMPT_SOURCES = new Set(['claude', 'makersuite', 'vertexai']);
const PLANNING_MODULES = new Set(['planner', 'opening']);
const tempRefused = new Set();
// Profiles whose connection refused a streamed request: they get plain requests from then on.
const noStream = new Set();

const SETTINGS_DEFAULTS = {
    enabled: true,
    profile: '',                 // connection profile id for all modules; '' = current connection
    profiles: {},                // per-module overrides: observer, tracker, planner, summariser, genre, profile, opening
    castLimit: 4,                // above this many cast cards, the group runs in swap mode and the director injects the cast
    placement: 'auto',           // auto | depth | system | macro
    greetings: 'hide',           // hide | keep: other members' greetings in a narrator group
    cadence: DEFAULTS.cadence,
    nudgeAfter: DEFAULTS.nudgeAfter,
    stallAfter: DEFAULTS.stallAfter,
    dormantAfter: DEFAULTS.dormantAfter,
    rollEvery: DEFAULTS.rollEvery,
    backfill: DEFAULTS.backfill,
    trackEvery: DEFAULTS.trackEvery,
    cleanEvery: DEFAULTS.cleanEvery,
    cleanAbove: DEFAULTS.cleanAbove,
    recurrence: DEFAULTS.recurrence,
    briefTokens: DEFAULTS.briefTokens,
    storyTokens: DEFAULTS.storyTokens,
    maxRetries: DEFAULTS.maxRetries,
    tokens: { ...DEFAULTS.tokens },   // longest answer per module
    setTemps: true,              // send a temperature with director calls made through a connection profile
    tempRecord: 0.2,             // observer, summariser, story profile, character profiles: quotes must be exact
    tempPlan: 0.7,               // planner and opening: variety is wanted
    rating: 'mature',            // default content rating for new stories: mature | pg
    mirrorLore: true,            // keep real lorebook files for the director's entries, so other extensions can look them up
    memory: 'director',          // director | extension | off: who keeps the story's memory and feeds it to the narrator
    memoryProvider: 'auto',      // with memory 'extension': auto | baibai | summarize | macro (see st/providers.js)
    memoryMacro: '',             // with memoryProvider 'macro': the macro to read, e.g. bbsHistory
    stripTags: 'bbs_start, bbs_end, bbs_items, bbs_vars, bbi_image',   // other extensions' tags removed, content included, before the director reads a reply
};

const ctx = () => SillyTavern.getContext();
let settings = { ...SETTINGS_DEFAULTS };
let genType = 'normal';
let generating = false;
let generatingSince = 0;
let currentBrief = '';
let lastBrief = { text: '', scan: '', lines: {}, fallback: true };
let lastStory = { text: '', overflow: false, tokens: 0 };
let firstIncluded = 0;
let loreKeys = [];
let kickTimer = null;
let ui = null;

// ---------------------------------------------------------------- activation

const isNarratorCard = (ch) => !!ch?.data?.extensions?.[KEY];

function meta(create = false) {
    const c = ctx();
    if (!c.chatMetadata) return null;
    if (!c.chatMetadata[KEY] && create) c.chatMetadata[KEY] = { v: 1, setup: {} };
    return c.chatMetadata[KEY] ?? null;
}

function currentGroup() {
    const c = ctx();
    return c.groupId ? c.groups.find(g => g.id === c.groupId) ?? null : null;
}

function groupMembers(group = currentGroup()) {
    const c = ctx();
    return group ? group.members.map(av => c.characters.find(ch => ch.avatar === av)).filter(Boolean) : [];
}

/** The narrator of the open chat, or null when the director has no business here. */
function narratorRef() {
    if (!settings.enabled) return null;
    const c = ctx();
    const m = meta();
    if (m?.enabled === false) return null;
    const group = currentGroup();
    if (group) {
        const members = groupMembers(group);
        // Only the Narrator card (marked in its data) turns the director on; any other card never does.
        const n = members.find(isNarratorCard);
        return n ? { name: n.name, avatar: n.avatar, group: true, neutral: neutralPrefixes(n), strip: parseTags(settings.stripTags) } : null;
    }
    const ch = c.characters[c.characterId];
    if (!ch || c.groupId) return null;
    return isNarratorCard(ch) ? { name: ch.name, avatar: ch.avatar, group: false, neutral: neutralPrefixes(ch), strip: parseTags(settings.stripTags) } : null;
}

/** Whether the open chat has the Narrator card (solo, or a group member), whatever the on/off switches say. */
function narratorInChat() {
    const c = ctx();
    const group = currentGroup();
    if (group) return groupMembers(group).some(isNarratorCard);
    return !c.groupId && isNarratorCard(c.characters[c.characterId]);
}

/** The narrator card marks which of its greetings are neutral openers (data.extensions.narrator_director.neutral). */
function neutralPrefixes(ch) {
    const list = ch?.data?.extensions?.[KEY]?.neutral;
    return Array.isArray(list) ? list.filter(p => typeof p === 'string' && p.length >= 12) : [];
}

// ---------------------------------------------------------------- host for the core director

function castCards() {
    const c = ctx();
    const ref = narratorRef();
    const members = ref?.group ? groupMembers().filter(ch => ch.avatar !== ref.avatar) : [];
    return members.map(ch => {
        const fill = (t) => String(t ?? '').replace(/{{char}}/gi, ch.name).replace(/<BOT>/g, ch.name);
        const parts = [fill(ch.description), fill(ch.personality)].filter(s => s.trim());
        return { name: ch.name, text: parts.join('\n'), talkativeness: Number(ch.talkativeness ?? 0.5) };
    });
}

const host = {
    chat: () => ctx().chat,
    narrator: narratorRef,
    setup: () => ({ ...(meta()?.setup ?? {}), player: ctx().name1 }),
    setSetup(patch) {
        const m = meta(true);
        Object.assign(m.setup, patch);
        ctx().saveMetadataDebounced();
        if (patch.genre && !patch.genre.confirmed) {
            toastr.info(`Story profile drafted: ${[patch.genre.dominant, ...patch.genre.secondary].join(' / ')}. Review it with /director inspect.`, 'Narrator Director');
        }
        refresh('setup');
    },
    settings: () => settings,
    save: () => ctx().saveChat(),
    // A change the player made in the inspector (a milestone concluded, a criterion marked, a cast edit) may leave
    // work due: start the director, as a chat event would, rather than waiting for the next reply.
    changed: (reason) => { refresh(reason); if (reason === 'player') scheduleKick(); },
    firstIncluded: () => firstIncluded,
    loreKeys: () => loreKeys,
    loreEntries: () => loreEntries,
    castNames: () => castCards().map(card => card.name),
    memoryStory: () => memoryStory(settings),
    async call(module, messages, maxTokens, signal) {
        const c = ctx();
        // A check call ('tracker-check', 'planner-check') runs on its parent role's profile and temperature.
        const role = String(module).replace(/-check$/, '');
        const profile = settings.profiles?.[role] || settings.profile;
        if (profile) {
            // Streamed (owner, 21 Nov 2026): a slow thinking model sends nothing for a minute without streaming, and the
            // connection is cut ("socket hang up"). A stream keeps it alive. A profile that refuses streaming falls back.
            const streams = !noStream.has(profile);
            const opts = { stream: streams, signal, extractData: true, includePreset: true, includeInstruct: true };
            const collect = async (r) => {
                if (typeof r !== 'function') return r;
                let content = '', reasoning = '';
                for await (const chunk of r()) { content = chunk?.text ?? content; reasoning = chunk?.state?.reasoning ?? reasoning; }
                return { content, reasoning };
            };
            // A thinking model can spend the whole answer limit thinking and return no answer. Say so: retrying the same
            // call with the same limit would only fail again.
            const answer = (r) => {
                const text = r?.content ?? '';
                if (!String(text).trim() && String(r?.reasoning ?? '').trim()) throw new Error(`${module}: the model spent its whole answer limit (${maxTokens} tokens) thinking and wrote no answer. Raise this module's answer limit, or give it a model that thinks less.`);
                return text;
            };
            const request = async (payload, o) => answer(await collect(await c.ConnectionManagerRequestService.sendRequest(profile, messages, maxTokens, o, payload)));
            const send = async (payload) => {
                if (!streams) return request(payload, opts);
                try {
                    return await request(payload, opts);
                } catch (e) {
                    // Under streaming a refusal arrives only as "Got response status 4xx", with the reason lost (audit,
                    // 21 Nov 2026). Ask once without streaming: that answer carries the provider's own message, which the
                    // temperature fallback reads. A profile that then works without streaming stays off it.
                    const why = `${e?.message} ${e?.cause?.message ?? ''}`;
                    if (!/stream|response status 4\d\d/i.test(why)) throw e;
                    const r = await request(payload, { ...opts, stream: false });
                    noStream.add(profile);
                    return r;
                }
            };
            // The director sets its own temperature, so it does not depend on how the profile's preset was saved.
            const temperature = PLANNING_MODULES.has(role) ? settings.tempPlan : settings.tempRecord;
            if (!settings.setTemps || tempRefused.has(profile)) return await send({});
            try {
                return await send({ temperature });
            } catch (e) {
                // Some reasoning models accept only their default temperature. Stop sending it to that profile.
                if (!/temperature/i.test(`${e?.message} ${e?.cause?.message} ${JSON.stringify(e?.cause ?? '')}`)) throw e;
                tempRefused.add(profile);
                return await send({});
            }
        }
        // No director profile chosen: use the current connection. Works, but shares the narrator's sampler settings.
        return await c.generateRaw({ prompt: messages, responseLength: maxTokens });
    },
    async cards() {
        const c = ctx();
        const cards = castCards().map(({ name, text }) => ({ name, text }));
        const persona = c.powerUserSettings?.persona_description;
        // The player character's own lorebook entry counts too (audit, 21 Nov 2026: a persona holding only looks left a
        // lore-written S-class fighter profiled as an ordinary man).
        const low = String(c.name1 ?? '').trim().toLowerCase();
        const mine = low ? loreEntries.filter(e => [e.comment, e.keys[0]].some(k => String(k ?? '').trim().toLowerCase() === low)) : [];
        const text = [persona, ...mine.map(e => e.content.trim())].filter(Boolean).join('\n\n').slice(0, 4000);
        if (c.name1 && text) cards.push({ name: c.name1, text, isPlayer: true, aliases: mine.flatMap(e => e.keys) });
        return cards;
    },
    async material() {
        const c = ctx();
        const ref = narratorRef();
        const parts = [];
        for (const card of castCards()) parts.push(`[Character: ${card.name}]\n${card.text.slice(0, 1500)}`);
        const group = currentGroup();
        const scenario = c.chatMetadata?.scenario || (group ? groupMembers(group).map(ch => ch.scenario).filter(Boolean).join('\n') : '');
        if (scenario) parts.push(`[Scenario]\n${String(scenario).slice(0, 1500)}`);
        const persona = c.powerUserSettings?.persona_description;
        if (persona) parts.push(`[Player character: ${c.name1}]\n${String(persona).slice(0, 800)}`);
        if (loreSample.length) parts.push(`[World notes]\n${loreSample.join('\n').slice(0, 3000)}`);
        const opening = c.chat.find(m => !m.is_user && classify(m, ref) === 'narration');
        if (opening) parts.push(`[Opening]\n${stripDirector(opening.mes).slice(0, 1500)}`);
        // The player's first message says what the player character is after (owner, 19 Nov 2026). Without a premise
        // from a card, the scenario or the lorebook, the story waits for it: a persona describes who the player is, never
        // the story, so a profile drafted from it alone goes wherever the persona's text leans.
        const first = c.chat.find(m => m.is_user && !m.is_system);
        if (first) parts.push(`[The player's opening move: what ${c.name1 || 'the player character'} sets out to do]\n${String(first.mes).slice(0, 1200)}`);
        const premise = castCards().length || scenario || loreSample.length;
        if (!premise && !first) return '';
        return parts.join('\n\n');
    },
};

const director = new Director(host);

// ---------------------------------------------------------------- outputs: variables, prompts, UI

function refresh(reason = '') {
    const c = ctx();
    const ref = narratorRef();
    if (c.chatMetadata) {
        const vars = (c.chatMetadata.variables ??= {});
        const changed = ref ? writeVars(vars, publicVars(director.view())) : clearVars(vars);
        if (changed) c.saveMetadataDebounced();
    }
    ui?.update(reason);
}

function presetHasMacro() {
    const c = ctx();
    const needle = `{{${MACRO}}}`;
    if (c.mainApi === 'openai') {
        const oai = c.chatCompletionSettings;
        const ids = new Set((oai.prompts ?? []).filter(p => String(p.content ?? '').includes(needle)).map(p => p.identifier));
        if (!ids.size) return false;
        return (oai.prompt_order ?? []).some(o => (o.order ?? []).some(e => e.enabled && ids.has(e.identifier)));
    }
    const pu = c.powerUserSettings ?? {};
    return JSON.stringify([pu.sysprompt, pu.context, pu.instruct]).includes(needle);
}

/** Where the brief goes: its own preset entry if there is one, else placed by backend. */
function placement() {
    if (settings.placement !== 'auto') return settings.placement;
    if (presetHasMacro()) return 'macro';
    const c = ctx();
    // Claude and Gemini turn a late system message into a user turn, which would merge the brief with the player's message.
    if (c.mainApi === 'openai' && SYSTEM_PROMPT_SOURCES.has(c.chatCompletionSettings.chat_completion_source)) return 'system';
    return 'depth';
}

const promptFilter = () => !SKIP_TYPES.has(genType);

function setPrompts(brief, story) {
    const c = ctx();
    const T = extension_prompt_types, SYSTEM = extension_prompt_roles.SYSTEM;
    currentBrief = brief?.text ?? '';
    const where = placement();
    if (!currentBrief || where === 'macro') c.setExtensionPrompt(PROMPT_BRIEF, '', T.NONE, 0);
    else if (where === 'system') c.setExtensionPrompt(PROMPT_BRIEF, currentBrief, T.IN_PROMPT, 0, false, SYSTEM, promptFilter);
    else c.setExtensionPrompt(PROMPT_BRIEF, currentBrief, T.IN_CHAT, 1, false, SYSTEM, promptFilter);
    c.setExtensionPrompt(PROMPT_STORY, story?.text ?? '', T.IN_PROMPT, 0, false, SYSTEM, promptFilter);
    // Scan-only: World Info reads it, the prompt never contains it. The only scanned block.
    c.setExtensionPrompt(PROMPT_SCAN, brief?.scan ?? '', T.NONE, 0, true, SYSTEM, promptFilter);
}

function clearPrompts() {
    currentBrief = '';
    const c = ctx();
    for (const k of [PROMPT_BRIEF, PROMPT_STORY, PROMPT_SCAN]) c.setExtensionPrompt(k, '', extension_prompt_types.NONE, 0);
}

/** Swap-mode cast for the story block: full cards for those present, short profiles for the rest. */
function injectedCast(state) {
    const group = currentGroup();
    if (!group || group.generation_mode !== group_generation_mode.SWAP) return [];
    const c = ctx();
    return castCards().map(card => {
        const people = castPeople(state, [card.name]);
        return {
            name: card.name,
            people,
            full: `[${card.name}]\n${c.substituteParams(card.text)}`,
            short: people.map(n => state.cast[n]?.profile).filter(Boolean).join(' ') || c.substituteParams(card.text).slice(0, 240),
        };
    });
}

/**
 * Generate interceptor: runs after the player's message is in the chat and before World Info scans.
 * Finishes the brief in code; no model call happens here. Never runs for dry runs.
 */
globalThis.narratorDirectorIntercept = async function (_coreChat, _contextSize, _abort, type) {
    try {
        genType = type || 'normal';
        const ref = narratorRef();
        if (!ref) return clearPrompts();
        // Impersonate and quiet generations get nothing from the director. The prompt filters alone are not enough:
        // SillyTavern 1.19.0 ignores them for in-chat injections, so the blocks are removed and put back afterwards.
        if (SKIP_TYPES.has(genType)) return clearPrompts();
        director.sync();
        const c = ctx();
        const redo = ['swipe', 'regenerate', 'continue'].includes(genType);
        const state = director.view({ includeProvisional: !redo });
        const last = c.chat.at(-1);
        const entries = scan(c.chat, ref);
        const recentNarration = entries.filter(e => e.kind === 'narration').slice(-4).map(e => e.text);
        // Everyone a card holds shares that card's talkativeness.
        const talkativeness = Object.fromEntries(castCards().flatMap(card => castPeople(state, [card.name]).map(n => [n, card.talkativeness])));
        let playerMessage = '';
        if (last?.is_user) playerMessage = last.mes;
        else if (redo) playerMessage = [...c.chat].reverse().find(m => m.is_user)?.mes ?? '';
        lastBrief = buildBrief(state, { playerMessage, recentNarration, talkativeness, tokenCap: settings.briefTokens });
        lastStory = buildStoryBlock(state, { cast: injectedCast(state), firstIncluded, tokenCap: settings.storyTokens, memory: settings.memory, loreNames: loreKeys, unsummarised: settings.memory === 'extension' ? memoryGaps(settings) : null });
        setPrompts(lastBrief, lastStory);
        ui?.update('brief');
    } catch (e) {
        console.error('[Narrator Director] interceptor failed; narrating without notes', e);
        clearPrompts();
    }
};

// ---------------------------------------------------------------- events

function scheduleKick(delay = 400) {
    clearTimeout(kickTimer);
    kickTimer = setTimeout(() => {
        kickTimer = null;
        // A generation that never reported its end must not hold the director back for good.
        if (generating && Date.now() - generatingSince > 10 * 60_000) generating = false;
        if (generating) return scheduleKick(600);
        if (!narratorRef()) return;
        director.kick()?.catch(e => console.error('[Narrator Director]', e));
    }, delay);
}

/** Console handle for debugging and tests: narratorDirector.view(), .brief(), .idle(). */
globalThis.narratorDirector = {
    director,
    view: (opts) => director.view(opts),
    brief: () => lastBrief,
    story: () => lastStory,
    lorebook: () => director.lorebook(),
    idle: () => !kickTimer && !director.running && !generating,
    active: () => !!narratorRef(),
    ref: () => narratorRef(),
    firstIncluded: () => firstIncluded,
    /** Let another extension supply the story so far for the planner: { id, name, available(), story() }. */
    registerMemoryProvider,
};

function onChatChanged() {
    director.reset();
    generating = false;
    firstIncluded = 0;
    lastBrief = { text: '', scan: '', lines: {}, fallback: true };
    clearPrompts();
    if (narratorRef()) {
        director.sync();
        applyGroupRule().catch(console.error);
        scheduleKick();
    }
    refresh('chat');
}

function onGenerationStarted(type, _opts, dryRun) {
    if (dryRun) return;
    genType = type || 'normal';
    if (!SKIP_TYPES.has(genType)) { generating = true; generatingSince = Date.now(); }
}

function onGenerationDone() {
    generating = false;
    if (SKIP_TYPES.has(genType)) {
        genType = 'normal';
        if (narratorRef() && lastBrief.text) setPrompts(lastBrief, lastStory); // restore what the skipped generation removed
    }
    const n = Number(ctx().substituteParams('{{firstIncludedMessageId}}'));
    if (Number.isFinite(n)) firstIncluded = n;
    if (narratorRef()) { director.sync(); scheduleKick(); }
}

/** Leaked director text is removed from the saved reply itself, so it cannot teach the model to leak. */
function onMessageReceived(id) {
    const c = ctx();
    const m = c.chat[id];
    const ref = narratorRef();
    if (!ref || !m || m.is_user) return;
    let dirty = false;
    if (hasLeak(m.mes)) {
        m.mes = stripDirector(m.mes);
        if (Array.isArray(m.swipes) && typeof m.swipe_id === 'number') m.swipes[m.swipe_id] = m.mes;
        dirty = true;
    }
    if (hasLeak(m.extra?.reasoning)) { m.extra.reasoning = stripDirector(m.extra.reasoning); dirty = true; }
    if (dirty) { c.updateMessageBlock(id, m); c.saveChat(); }
    director.sync();
    scheduleKick();
}

const RETCON_OOC = /^\s*[([]?\s*OOC\s*[:：]\s*retcon\s*[:：]?\s*(.+?)[)\]]?\s*$/is;

function onMessageSent(id) {
    const c = ctx();
    if (!narratorRef()) return;
    director.sync();
    const m = c.chat[id];
    const ooc = m?.mes?.match(RETCON_OOC);
    if (ooc) {
        // An out-of-character retcon: apply it, then keep the message out of the prompt and the summaries.
        retcon(ooc[1]);
        m.is_system = true;
        $(`#chat .mes[mesid="${id}"]`).attr('is_system', 'true');
        c.saveChat();
    }
    refresh('sent');
}

function onChatMutated() {
    if (!narratorRef()) return;
    const r = director.sync();
    if (r.deleted.length || r.stale.length) refresh('mutated');
    scheduleKick();
}

// ---------------------------------------------------------------- World Info: dynamic lore and muted members' books

let loreSample = [];
/** Authored lorebook entries (not the director's own), for profiling cast members a lorebook describes. */
let loreEntries = [];
const arrOf = (v) => (Array.isArray(v) ? v.map(String) : []);

async function onEntriesLoaded(lists) {
    const all = [...lists.globalLore, ...lists.characterLore, ...lists.chatLore, ...lists.personaLore];
    const ref = narratorRef();
    if (!ref) return;
    const c = ctx();
    const have = new Set(all.map(e => e.world));
    if (ref.group) {
        // SillyTavern loads a bound lorebook only for the member that is generating. The cast is muted, so add theirs.
        for (const ch of groupMembers()) {
            const world = ch.data?.extensions?.world;
            if (!world || have.has(world)) continue;
            have.add(world);
            const data = await c.loadWorldInfo(world);
            if (!data?.entries) continue;
            for (const e of Object.values(data.entries)) lists.characterLore.push({ ...e, world });
        }
    }
    const narratorCard = c.characters.find(ch => ch.avatar === ref.avatar);
    const narratorWorld = narratorCard?.data?.extensions?.world;
    // The card's baseline lorebook (genre craft) works without the manual "Import Card Lore" step:
    // if it is not bound and loaded, its embedded entries are added here.
    const book = narratorCard?.data?.character_book;
    const baselineName = book?.name || 'Narrator baseline';
    if (book?.entries?.length && !(narratorWorld && have.has(narratorWorld)) && !have.has(baselineName)) {
        const converted = c.convertCharacterBook(book);
        // Entries are filed under a book the director owns: lookups by uid go to that file. If a file of the same name
        // exists that the director did not write (an earlier "Import Card Lore"), it may be out of date, so the
        // director uses its own copy beside it instead of touching the player's file.
        const worldName = await ownedWorldName(baselineName);
        for (const e of Object.values(converted.entries ?? {})) lists.characterLore.push({ ...e, world: worldName });
        // Kept in step with the card: a card update that adds entries must reach the file, or lookups by uid fail
        // ("Valid UID is required" from extensions such as WorldInfoInfo).
        await mirrorWorld(worldName, converted, true);
    }
    const authored = [...lists.globalLore, ...lists.characterLore, ...lists.chatLore]
        .filter(e => e.world !== narratorWorld && e.world !== baselineName && e.world !== `${baselineName} (director)` && e.world !== DYNAMIC_WORLD && !e.disable);
    loreKeys = [...new Set(authored.flatMap(e => e.key ?? []))].slice(0, 200);
    loreEntries = authored.map(e => ({ keys: arrOf(e.key), comment: String(e.comment ?? ''), content: String(e.content ?? '') })).filter(e => e.content.trim());
    loreSample = authored.filter(e => e.constant).concat(authored.filter(e => !e.constant)).slice(0, 12)
        .map(e => `- ${(e.key ?? []).slice(0, 2).join(', ') || e.comment || 'note'}: ${String(e.content ?? '').slice(0, 300)}`);
    const dynamic = director.lorebook().entries.map(toWorldInfoEntry);
    for (const e of dynamic) lists.characterLore.push(e);
    await mirrorWorld(DYNAMIC_WORLD, { entries: Object.fromEntries(dynamic.map(({ world, ...e }) => [e.uid, e])) }, true);
}

const MIRROR_MARK = 'narrator_director_mirror';
const mirrored = new Map();
const ownedNames = new Map();

/** `name` if no file has it or the director wrote that file; otherwise "<name> (director)". */
async function ownedWorldName(name) {
    if (ownedNames.has(name)) return ownedNames.get(name);
    let use = name;
    try {
        const c = ctx();
        if (settings.mirrorLore !== false && c.getWorldInfoNames().includes(name) && !(await c.loadWorldInfo(name))?.[MIRROR_MARK]) use = `${name} (director)`;
    } catch (e) {
        console.warn('[Narrator Director] could not check the lorebook file', e);
    }
    ownedNames.set(name, use);
    return use;
}

/**
 * The director's entries are added at load time under book names that would otherwise not exist as files.
 * Other extensions look activated entries up by book name and uid (for example /wi-get-timed-effect) and warn
 * when the file is missing. So each book is mirrored to a real lorebook file the director owns.
 * The mirror is never bound or activated; it only answers lookups. A file the director did not create is left alone.
 * @param {boolean} overwrite Rewrite the file when its content changes; otherwise create once.
 */
async function mirrorWorld(name, data, overwrite) {
    if (settings.mirrorLore === false) return;
    try {
        const c = ctx();
        const exists = c.getWorldInfoNames().includes(name);
        const signature = JSON.stringify(data.entries ?? {});
        if (exists && (!overwrite || mirrored.get(name) === signature)) return;
        if (exists && !mirrored.has(name)) {
            const current = await c.loadWorldInfo(name);
            if (!current?.[MIRROR_MARK]) return; // someone else's file with the same name
            if (JSON.stringify(current.entries ?? {}) === signature) { mirrored.set(name, signature); return; }
        }
        await c.saveWorldInfo(name, { entries: structuredClone(data.entries ?? {}), [MIRROR_MARK]: true }, true);
        mirrored.set(name, signature);
        if (!exists) await c.updateWorldInfoList();
    } catch (e) {
        console.warn('[Narrator Director] could not mirror lore to a file', e);
    }
}

// ---------------------------------------------------------------- groups

/** Cast up to the limit: SillyTavern joins every card. Above it: swap mode, and the director injects the cast. */
async function applyGroupRule() {
    const ref = narratorRef();
    const group = currentGroup();
    if (!ref?.group || !group) return;
    const m = meta(true);
    if (m.groupMode === undefined) { m.groupMode = group.generation_mode; ctx().saveMetadataDebounced(); }
    const cast = group.members.length - 1;
    const want = cast <= settings.castLimit ? group_generation_mode.APPEND_DISABLED : group_generation_mode.SWAP;
    if (group.generation_mode !== want) {
        group.generation_mode = want;
        await editGroup(group.id, true, false);
        $('#rm_group_generation_mode').val(want);
    }
}

/** On disable, put the group back in a join mode so the cast still reaches the narrator. */
async function restoreGroupMode() {
    const group = currentGroup();
    const m = meta();
    if (!group || m?.groupMode === undefined) return;
    const original = m.groupMode === group_generation_mode.SWAP ? group_generation_mode.APPEND_DISABLED : m.groupMode;
    delete m.groupMode;
    if (group.generation_mode !== original) {
        group.generation_mode = original;
        await editGroup(group.id, true, false);
        $('#rm_group_generation_mode').val(original);
    }
}

/** One click: only the narrator speaks. Mutes the cast and applies the cast-size rule. */
async function setupGroup() {
    const ref = narratorRef();
    const group = currentGroup();
    if (!ref?.group || !group) return 'Open a group chat that includes the narrator card first.';
    group.disabled_members = group.members.filter(av => av !== ref.avatar);
    await editGroup(group.id, true, false);
    await applyGroupRule();
    return `Group set up: ${ref.name} narrates, ${group.disabled_members.length} cast member(s) muted.`;
}

/** In a group, the narrator opens with her group greeting (CCv3 group_only_greetings), not her solo one. */
function onFirstMessageSelected(args) {
    if (!settings.enabled || !currentGroup() || !isNarratorCard(args?.character)) return;
    // Another extension (Group Greetings, which loads first) has already chosen this opening: leave it.
    if (args.output) return;
    const g = args.character.data?.group_only_greetings;
    if (Array.isArray(g) && g[0]) args.output = g[0];
}

/** SillyTavern posts every member's greeting and offers no way to suppress one, so the others are hidden after the fact. */
function onGroupChatCreated() {
    const ref = narratorRef();
    if (!ref?.group || settings.greetings !== 'hide') return;
    const c = ctx();
    let hid = 0;
    c.chat.forEach((m, i) => {
        // By authorship, not by classify(): the narrator's neutral greeting is not "narration" but must stay visible.
        const hers = m.original_avatar ? m.original_avatar === ref.avatar : m.name === ref.name;
        if (m.is_user || hers) return;
        m.is_system = true;
        $(`#chat .mes[mesid="${i}"]`).attr('is_system', 'true');
        hid++;
    });
    if (hid) c.saveChat();
}

// ---------------------------------------------------------------- player actions

function retcon(text) {
    const state = director.view();
    const all = [...state.canon, ...state.uncertain];
    const needle = text.toLowerCase().trim();
    // Prefer facts that contain the text; fall back to close rewordings. A loose match would delete too much.
    let hits = all.filter(f => f.fact.toLowerCase().includes(needle));
    if (!hits.length) hits = all.filter(f => similarity(f.fact, text) >= 0.6);
    // Matched facts become tombstones by id; free text is kept only when nothing on record matched.
    director.playerOp({ kind: 'retcon', ids: hits.map(f => f.id), texts: hits.length ? [] : [str(text, 300)] });
    return hits.length ? `Retconned: ${hits.map(f => f.fact).join(' | ').slice(0, 240)}` : 'No recorded fact matched; the narrator is told it did not happen.';
}

/** Several edits saved together, with one note to the narrator. */
function editStates(pairs) {
    for (const [path, value] of pairs) director.playerOp({ kind: 'edit', path, value });
    director.playerOp({ kind: 'note', text: 'the record was corrected; treat these notes as the truth where they differ from earlier narration' });
}

/** Plan-side records the narrator never sees. Editing them sends no note: a note would only reveal that a plan exists. */
const PLAN_PATHS = new Set(['arc', 'beats', 'scenes', 'spine']);

function editState(path, value) {
    director.playerOp({ kind: 'edit', path, value });
    if (PLAN_PATHS.has(path.split('.')[0])) return;
    // Operation note: the narrator reflects the change without ever hearing about the tool.
    director.playerOp({ kind: 'note', text: `the record of ${path.split('.')[0]} was corrected; treat these notes as the truth where they differ from earlier narration` });
}

async function rerunGenre() {
    await director.ensureGenre(true);
    host.save();
    refresh('genre');
}

async function confirmGenre(value) {
    const v = validateGenre(value);
    if (!v.ok) return toastr.error(v.error, 'Narrator Director');
    v.value.confirmed = true;
    // Before the story starts the profile is a setup value; afterwards a change is logged on the latest message.
    if (ctx().chat.length <= 1) host.setSetup({ genre: v.value });
    else director.playerOp({ kind: 'genre', value: v.value });
    scheduleKick(50);
}

/** Draft an opening from a premise the player picks, and offer it as a swipe of the first message. */
async function draftOpening() {
    const c = ctx();
    const ref = narratorRef();
    if (!ref) return 'The director is not active in this chat.';
    const state = director.view();
    const material = await host.material();
    const raw = await director.model('opening', premisePrompt({ genre: state.genre, material }));
    const premises = (extractJson(raw).value?.premises ?? []).map(p => str(p, 400)).filter(Boolean).slice(0, 3);
    if (!premises.length) return 'No premises came back; see the inspector for the raw output.';
    const html = `<h3>Pick a premise</h3>${premises.map((p, i) => `<label class="nd-premise"><input type="radio" name="nd-premise" value="${i}" ${i ? '' : 'checked'}> ${escapeHtml(p)}</label>`).join('')}`;
    let pick = 0;
    const ok = await c.callGenericPopup(html, c.POPUP_TYPE.CONFIRM, '', { onClose: (popup) => { pick = Number(popup.dlg.querySelector('input[name="nd-premise"]:checked')?.value ?? 0); } });
    if (!ok) return 'Cancelled.';
    const premise = premises[pick];
    const text = stripDirector(await director.model('opening', openingPrompt({ genre: state.genre, premise, material, player: c.name1 })));
    if (!text) return 'The opening came back empty.';
    host.setSetup({ premise });
    const first = c.chat.findIndex(m => !m.is_user && (m.original_avatar ? m.original_avatar === ref.avatar : m.name === ref.name));
    if (first !== -1 && c.chat.length <= first + 1) {
        const m = c.chat[first];
        m.swipes = Array.isArray(m.swipes) && m.swipes.length ? m.swipes : [m.mes];
        m.swipes.push(text);
        if (Array.isArray(m.swipe_info)) m.swipe_info.push({ send_date: m.send_date, extra: {} });
        m.swipe_id = m.swipes.length - 1;
        m.mes = text;
        await c.saveChat();
        await c.reloadCurrentChat();
        return 'Opening drafted as a new swipe of the first message.';
    }
    await c.executeSlashCommandsWithOptions(`/sendas name=${JSON.stringify(ref.name)} ${JSON.stringify(text)}`);
    return 'Opening posted.';
}

async function revise(kind, instruction) {
    const state = director.view();
    if (kind === 'genre') {
        const raw = await director.model('genre', revisePrompt({ kind: 'story profile', current: state.genre, instruction }));
        const parsed = extractJson(raw);
        if (parsed.ok) await confirmGenre(parsed.value);
        return 'Story profile revised.';
    }
    director.playerOp({ kind: 'instruction', text: instruction });
    scheduleKick(50);
    return 'The planner will revise the plan.';
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));

async function setEnabledForChat(on) {
    const m = meta(true);
    const c = ctx();
    if (on) {
        // Resumes a Narrator chat paused with /director off. It never adopts another card as narrator.
        delete m.enabled;
        delete m.narrator;
    } else {
        m.enabled = false;
        await restoreGroupMode();
    }
    c.saveMetadataDebounced();
    onChatChanged();
}

/** /director: free text, or a keyword followed by a colon. */
async function directorCommand(_named, text) {
    const input = String(text ?? '').trim();
    const [, key, rest] = input.match(/^(\w+)\s*:?\s*([\s\S]*)$/) ?? [];
    const k = (key ?? '').toLowerCase();
    if (k === 'on') {
        if (!narratorInChat()) return 'The director runs only with the Narrator card. Open a chat with it, or add it to a group with your cards.';
        await setEnabledForChat(true);
        return 'Director on for this chat.';
    }
    if (k === 'off') { await setEnabledForChat(false); return 'Director off for this chat.'; }
    if (k === 'inspect' || !input) { ui?.open(); return ''; }
    if (!narratorRef()) return narratorInChat() ? 'The director is off for this chat. /director on turns it back on.' : 'The director runs only with the Narrator card. Open a chat with it, or add it to a group with your cards.';
    switch (k) {
        case 'scene': {
            const fields = Object.fromEntries([...rest.matchAll(/(location|time|mood)\s*=\s*([^;,\n]+)/gi)].map(m => [m[1].toLowerCase(), m[2].trim()]));
            const present = rest.match(/present\s*=\s*([^;\n]+)/i)?.[1].split(/,|\band\b/).map(s => s.trim()).filter(Boolean);
            for (const f of ['location', 'time']) if (fields[f]) director.playerOp({ kind: 'edit', path: `scene.${f}`, value: { value: fields[f], established: true } });
            if (fields.mood) director.playerOp({ kind: 'edit', path: 'scene.mood', value: fields.mood });
            if (present) director.playerOp({ kind: 'edit', path: 'scene.present', value: present });
            director.playerOp({ kind: 'note', text: `scene change: ${rest}` });
            return 'Scene adjusted.';
        }
        case 'beats': {
            const beats = rest.split(/;|\n/).map(s => s.trim()).filter(Boolean).map(intent => ({ intent, type: 'choice', required: false }));
            if (!beats.length) return 'Give one or more intents separated by semicolons.';
            director.playerOp({ kind: 'beats', value: beats, seq: Date.now() % 100000 });
            return `Queued ${beats.length} beat(s).`;
        }
        case 'rewrite': {
            const c = ctx();
            const last = c.chat.at(-1);
            if (!last || classify(last, narratorRef()) !== 'narration') return 'The latest message is not a narrator reply.';
            director.playerOp({ kind: 'instruction', text: `rewrite the last reply: ${rest}` });
            const count = last.swipes?.length ?? 1;
            if ((last.swipe_id ?? 0) < count - 1) await c.swipe.to(null, 'right', { forceSwipeId: count - 1 });
            await c.swipe.right(); // past the last swipe: SillyTavern generates a new one
            return '';
        }
        case 'pg': {
            // The rating switch. PG turns all adult content off; "pg off" returns the story to the mature default.
            const off = /^(off|no|false|0)$/i.test(rest.trim());
            const genre = director.view().genre;
            if (!genre) return 'The story profile is not ready yet.';
            await confirmGenre(applyRating(genre, off ? 'mature' : 'pg'));
            return off ? 'Mature rating: explicit content on, lethality high.' : 'PG rating: adult content is off for this story.';
        }
        case 'explicit': {
            const on = !/^(off|no|false|0)$/i.test(rest.trim());
            const genre = director.view().genre;
            if (!genre) return 'The story profile is not ready yet.';
            if (on && genre.pg) return 'This story is rated PG. Use /director pg off first.';
            await confirmGenre({ ...genre, explicit: on });
            return on ? 'Explicit content is on for this story.' : 'Explicit content is off for this story.';
        }
        case 'retcon': return retcon(rest);
        case 'profile': await rerunGenre(); return 'Story profile re-run.';
        case 'confirm': await confirmGenre(director.view().genre); return 'Story profile confirmed.';
        case 'replan': director.playerOp({ kind: 'instruction', text: rest || 're-plan from where the story stands', ...(rest ? {} : { quiet: true }) }); scheduleKick(50); return 'Re-planning.';
        case 'rollup': await director.maybeRollUp(true); host.save(); refresh('rollup'); return 'Summaries rolled up.';
        case 'track': {
            if (!director.view().spine) return 'There is no spine yet. Use /director spine first.';
            await director.trackNow();
            refresh('tracked');
            return 'Spine checked against the latest replies.';
        }
        case 'spine': {
            const had = !!director.view().spine;
            if (!director.view().arc) return 'The spine is drafted after the arc. Accept the story profile or start playing first.';
            const ok = await director.ensureSpine(true);
            host.save(); refresh('spine');
            return ok ? (had ? 'Spine redrafted from the setup.' : 'Spine drafted.') : 'No spine came back; see the Log tab.';
        }
        case 'redraft': {
            if (!director.view().genre) return 'The story profile is not ready yet.';
            const ok = await director.redraftArc();
            host.save(); refresh('spine');
            return ok ? 'Arc, spine and plan redrafted from where the story stands.' : 'No arc came back; see the Log tab.';
        }
        case 'settle': {
            if (!rest.trim()) return 'Usage: /director settle <what is closed, e.g. Max wants nothing in return>';
            director.playerOp({ kind: 'settle', text: rest.trim() });
            scheduleKick(50);
            return 'Settled: the story will not press it again.';
        }
        case 'unsettle': {
            const list = director.view().settled ?? [];
            const item = list[Number(rest) - 1];
            if (!item) return list.length ? `Settled:\n${list.map((s, i) => `${i + 1}. ${s.text}`).join('\n')}\nUse /director unsettle <number>.` : 'Nothing is settled.';
            director.playerOp({ kind: 'unsettle', id: item.id });
            return `Reopened: ${item.text}`;
        }
        case 'opening': return await draftOpening();
        case 'setup': return await setupGroup();
        case 'retry': director.retry(); return 'Retrying failed reads.';
        case 'dump': return JSON.stringify(director.view(), null, 2);
        case 'suggest': return await suggestBeat();
        case 'revise': {
            const [, what, instr] = rest.match(/^(\w+)\s+([\s\S]+)$/) ?? [];
            return what ? await revise(what.toLowerCase(), instr) : 'Usage: /director revise genre|plan <instruction>';
        }
        default:
            // Free text: an instruction to the director. It reaches the planner and, once, the narrator's notes.
            director.playerOp({ kind: 'instruction', text: input });
            scheduleKick(50);
            return 'Noted.';
    }
}

/** Suggest mode: the player picks which queued beat comes next. Opt-in by command, because it shows the plan. */
async function suggestBeat() {
    const c = ctx();
    const state = director.view();
    const queued = state.beats.filter(b => b.status === 'queued');
    if (queued.length < 2) return 'Fewer than two beats are queued.';
    const html = `<h3>What should come next?</h3><small>This shows where the story may be heading.</small>${queued.slice(0, 6).map((b, i) => `<label class="nd-premise"><input type="radio" name="nd-beat" value="${i}" ${i ? '' : 'checked'}> ${escapeHtml(b.intent)} <i>(${b.type})</i></label>`).join('')}`;
    let pick = 0;
    const ok = await c.callGenericPopup(html, c.POPUP_TYPE.CONFIRM, '', { onClose: (popup) => { pick = Number(popup.dlg.querySelector('input[name="nd-beat"]:checked')?.value ?? 0); } });
    if (!ok || pick === 0) return '';
    const chosen = queued[pick];
    const beats = clone(state.beats);
    const from = beats.findIndex(b => b.id === chosen.id), to = beats.findIndex(b => b.status === 'queued');
    beats.splice(to, 0, ...beats.splice(from, 1));
    director.playerOp({ kind: 'edit', path: 'beats', value: beats });
    return 'Next beat chosen.';
}

// ---------------------------------------------------------------- init

function loadSettings() {
    const c = ctx();
    c.extensionSettings[KEY] = { ...SETTINGS_DEFAULTS, ...(c.extensionSettings[KEY] ?? {}) };
    // Saved token limits predate newer modules: fill in their defaults.
    c.extensionSettings[KEY].tokens = { ...SETTINGS_DEFAULTS.tokens, ...(c.extensionSettings[KEY].tokens ?? {}) };
    // A strip list still at the earlier default gains BaiBai Book's item and variable tags; one the player edited stays.
    if (c.extensionSettings[KEY].stripTags === 'bbs_start, bbs_end, bbi_image') c.extensionSettings[KEY].stripTags = SETTINGS_DEFAULTS.stripTags;
    // A plan's beats now carry a goal and an opening each: a planner limit still at the old default of 1800 was cutting
    // plans off mid-answer (found live, 19 Nov 2026). It becomes 3000; tokens are spent only when the plan needs them.
    if (c.extensionSettings[KEY].tokens?.planner === 1800) c.extensionSettings[KEY].tokens.planner = 3000;
    // Timed re-plans default to off (owner, 18 Nov 2026): a cadence still at the old default of 6 becomes 0, once.
    if (!c.extensionSettings[KEY].cadenceEvents) {
        if (c.extensionSettings[KEY].cadence === 6) c.extensionSettings[KEY].cadence = 0;
        c.extensionSettings[KEY].cadenceEvents = true;
    }
    settings = c.extensionSettings[KEY];
    settings.profiles ??= {};
    settings.tokens = { ...DEFAULTS.tokens, ...(settings.tokens ?? {}) };
}

function registerMacro() {
    const c = ctx();
    const handler = () => (narratorRef() && !SKIP_TYPES.has(genType) && placement() === 'macro' ? currentBrief : '');
    const description = 'The director\'s notes for this turn. Put it in its own prompt entry to choose where the notes go.';
    if (c.macros?.register) c.macros.register(MACRO, { handler, description, category: 'prompts' });
    else c.registerMacro?.(MACRO, handler, description);
}

function registerCommand() {
    const c = ctx();
    c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
        name: 'director',
        callback: async (named, text) => {
            try {
                const out = await directorCommand(named, text);
                if (out && out.length < 300) toastr.info(out, 'Narrator Director');
                return out ?? '';
            } catch (e) {
                console.error('[Narrator Director]', e);
                toastr.error(String(e?.message ?? e), 'Narrator Director');
                return '';
            }
        },
        unnamedArgumentList: [c.SlashCommandArgument.fromProps({ description: 'instruction, or keyword: text', typeList: [c.ARGUMENT_TYPE.STRING], isRequired: false })],
        helpString: `<div>Talk to the story director without breaking the scene.</div>
<ul><li><code>/director make the next scene quieter</code> – free-text instruction</li>
<li><code>/director scene: location=the docks; mood=tense; present=Ji Si, Hale</code></li>
<li><code>/director beats: a rival appears; the storm breaks</code></li>
<li><code>/director rewrite: less dialogue</code> – redo the latest reply as a new swipe</li>
<li><code>/director retcon: the letter was burned</code></li>
<li><code>/director pg</code> – rate this story PG: all adult content off (<code>/director pg off</code> returns to mature)</li>
<li><code>/director explicit off</code> – keep the mature rating but fade to black on sex</li>
<li><code>/director redraft</code> – a fresh arc, spine and plan from where the story stands, when the story feels stuck</li>
<li><code>/director settle &lt;text&gt;</code> – close a matter so the story stops pressing it; <code>/director unsettle</code> lists and reopens</li>
<li><code>/director spine</code> – draft the story spine (endings and milestones) now, or redraft it</li>
<li><code>/director track</code> – check the spine against the latest replies now, without waiting for the next batch</li>
<li><code>inspect, profile, confirm, replan, rollup, opening, suggest, setup, retry, dump, on, off</code></li></ul>`,
    }));
}

(function init() {
    const c = ctx();
    loadSettings();
    registerMacro();
    registerCommand();
    const E = c.eventTypes, on = (ev, fn) => ev && c.eventSource.on(ev, fn);
    on(E.CHAT_CHANGED, onChatChanged);
    on(E.GENERATION_STARTED, onGenerationStarted);
    on(E.GENERATION_ENDED, onGenerationDone);
    on(E.GENERATION_STOPPED, onGenerationDone);
    on(E.MESSAGE_RECEIVED, onMessageReceived);
    on(E.MESSAGE_SENT, onMessageSent);
    for (const ev of [E.MESSAGE_DELETED, E.MESSAGE_EDITED, E.MESSAGE_UPDATED, E.MESSAGE_SWIPED, E.MESSAGE_SWIPE_DELETED]) on(ev, onChatMutated);
    on(E.WORLDINFO_ENTRIES_LOADED, onEntriesLoaded);
    on(E.GROUP_UPDATED, () => { applyGroupRule().catch(console.error); scheduleKick(); });
    on(E.CHARACTER_EDITED, () => scheduleKick(1500));
    on(E.CHARACTER_FIRST_MESSAGE_SELECTED, onFirstMessageSelected);
    on(E.GROUP_CHAT_CREATED, onGroupChatCreated);
    ui = mountUi({
        director, host, getSettings: () => settings, defaults: SETTINGS_DEFAULTS, narratorRef, narratorInChat, escapeHtml, providerOptions,
        saveSettings: () => { c.saveSettingsDebounced(); refresh('settings'); },
        onToggle: async (enabled) => { if (!enabled) await restoreGroupMode(); onChatChanged(); },
        getBrief: () => ({ brief: lastBrief, story: lastStory, placement: placement(), preview: () => buildBrief(director.view(), { tokenCap: settings.briefTokens }) }),
        editState, editStates, confirmGenre, rerunGenre, retcon, setupGroup,
        playerOp: (op) => director.playerOp(op),
        command: (text) => directorCommand({}, text),
        groupInfo: () => { const g = currentGroup(); return g ? { mode: g.generation_mode, cast: g.members.length - 1, muted: g.disabled_members?.length ?? 0 } : null; },
        fallbackNote: FALLBACK_NOTE, dynamicWorld: DYNAMIC_WORLD,
    });
    if (c.chat?.length) onChatChanged();
    console.log('[Narrator Director] ready');
})();
