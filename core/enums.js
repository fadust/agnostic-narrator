// Every value a model may propose is one of these. Anything else is rejected by validate.js.

export const AXES = ['trust', 'affection', 'desire', 'tension'];
export const BANDS = ['hostile', 'wary', 'neutral', 'warm', 'devoted'];
export const STAGES = ['stranger', 'acquaintance', 'familiar', 'close', 'bonded'];
export const EVIDENCE = ['words', 'action', 'sacrifice', 'disclosure', 'shared_danger', 'time_together', 'betrayal', 'conflict'];
export const WEIGHTS = { minor: 1, major: 2, pivotal: 4 };
export const SCORE_MIN = -10, SCORE_MAX = 10;

export const STATS = ['strength', 'agility', 'endurance', 'intellect', 'perception', 'will', 'presence'];
export const STAT_BASELINE = 30;
export const STAT_STEP = 2;
/** A decisive change in ability (a maiming, a breakthrough, a power gained or lost, long training across a time skip). */
export const STAT_STEP_LARGE = 8;
export const SEVERITY = ['mild', 'serious', 'critical'];

export const ARC_TENSION = ['low', 'rising', 'high', 'peak'];
export const BEAT_TYPES = ['pressure', 'release', 'reward', 'reveal', 'choice'];
export const BEAT_STATUS = ['queued', 'complete', 'skipped'];
export const BEAT_PROGRESS = ['untouched', 'advanced', 'complete', 'preempted'];
export const THREAD_OPS = ['open', 'advance', 'resolve'];
export const CLUE_ROUTES = ['place', 'person', 'news', 'investigation'];
export const INITIATIVE = ['player', 'world'];
export const CERTAINTY = ['stated', 'implied'];
export const CAST_CHANGES = ['introduced', 'departed', 'returned', 'dead'];
export const AGE_GROUPS = ['child', 'teen', 'young adult', 'adult', 'middle-aged', 'elderly'];
export const STATUS_OPS = ['add', 'treat', 'worsen', 'clear'];
export const LORE_KINDS = ['character', 'place', 'item', 'event', 'world'];
export const TEMPERAMENTS = ['reserved', 'warm', 'proud', 'playful', 'stern', 'timid'];
export const LETHALITY = ['none', 'low', 'real', 'high'];
export const TEMPO = ['slow', 'measured', 'brisk', 'relentless'];

/** Per-pass caps: one reply cannot rewrite the world. */
export const CAPS = {
    settled: 2, settledKept: 8,
    facts: 4, beliefs: 4, relationships: 6, stats: 3, statuses: 4, cast_changes: 4, threads: 3, lore: 3,
    contradictions: 3, axisPerReply: 4, loreText: 600, loreKeys: 5, fact: 300, summary: 500,
    beats: 6, scenes: 3, clues: 3, endings: 3, hooks: 3,
};

/** Genre labels that have a craft entry in the narrator's baseline lorebook, and what the profiler tends to call them. */
export const GENRES = ['fantasy', 'slice of life', 'survival', 'horror', 'mystery', 'romance', 'science fiction', 'wuxia', 'comedy', 'drama', 'adventure', 'erotica'];
export const GENRE_ALIASES = {
    'sci-fi': 'science fiction', scifi: 'science fiction', sf: 'science fiction', cyberpunk: 'science fiction', 'space opera': 'science fiction',
    cozy: 'slice of life', 'slice-of-life': 'slice of life', 'everyday life': 'slice of life', iyashikei: 'slice of life',
    xianxia: 'wuxia', murim: 'wuxia', cultivation: 'wuxia', 'martial arts': 'wuxia',
    detective: 'mystery', noir: 'mystery', thriller: 'mystery', crime: 'mystery',
    'high fantasy': 'fantasy', 'dark fantasy': 'fantasy', isekai: 'fantasy', 'sword and sorcery': 'fantasy',
    'post-apocalyptic': 'survival', apocalypse: 'survival', 'survival horror': 'survival',
    smut: 'erotica', nsfw: 'erotica', adult: 'erotica', erotic: 'erotica', lewd: 'erotica', hentai: 'erotica', 'erotic romance': 'erotica',
    humor: 'comedy', humour: 'comedy', 'romantic comedy': 'romance', 'fantasy adventure': 'fantasy',
};

/**
 * What a fact is about. The observer names the kind; code decides the weight. "dropped" kinds are not facts at all.
 * Each entry: [kind, weight, one-line meaning for the observer prompt].
 */
export const FACT_KINDS = [
    ['identity', 'major', 'who someone is'],
    ['knowledge', 'major', 'who knows or learns what'],
    ['relationship', 'major', 'who trusts, owes, serves or opposes whom'],
    ['possession', 'major', 'who holds, gained or lost something'],
    ['decision', 'major', 'a choice or agreement made'],
    ['promise', 'major', 'a promise, deal or threat'],
    ['revelation', 'major', 'a secret or truth revealed'],
    ['change', 'major', 'a lasting change to a person, place or thing'],
    ['event', 'minor', 'something that happened that the story could refer to again'],
    ['condition', 'minor', 'an injury, a mood, weather, a short-lived state'],
    ['gesture', 'dropped', 'a look, touch, posture, expression'],
    ['scenery', 'dropped', 'description, background'],
];
export const FACT_KIND_WEIGHT = Object.fromEntries(FACT_KINDS.map(([k, w]) => [k, w]));
