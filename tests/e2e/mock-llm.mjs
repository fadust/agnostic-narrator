// A deterministic OpenAI-compatible endpoint for end-to-end tests. It plays both models:
// narrator requests get prose, director requests (recognised by their system prompt) get JSON.
// Every request is logged so tests can assert on what the narrator and each module were actually sent.

import http from 'node:http';

export function startMock(port = 8124) {
    const log = [];
    const control = { leak: false, contradict: false, narration: null, delayMs: 0, observerBeat: 'untouched', failObserver: false };
    let turn = 0;

    const flat = (messages) => messages.map(m => (typeof m.content === 'string' ? m.content : (m.content ?? []).map(p => p.text ?? '').join(''))).join('\n');

    function respond(messages) {
        const sys = flat(messages.filter(m => m.role === 'system'));
        const all = flat(messages);
        if (sys.includes('record keeper for an interactive story')) {
            if (control.failObserver) return { kind: 'observer', text: 'I cannot comply.' };
            const reply = all.split('## REPLY\n')[1] ?? '';
            const sentences = reply.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 15).slice(0, 4);
            const known = [...all.matchAll(/^- ([A-Z][\w ]+?)(?: \(|$)/gm)].map(m => m[1]);
            const present = [...new Set(['Mira', 'Old Tam', 'Captain Hale'].filter(n => reply.includes(n)))];
            const cast_changes = present.filter(n => !known.includes(n)).map(n => ({ who: n, change: 'introduced', quote: sentences.find(s => s.includes(n)) }));
            const loc = reply.match(/(?:at|in|into|through) (the [A-Z][\w]+(?: [A-Z][\w]+)*)/);
            const out = {
                summary: sentences[0] ?? 'Nothing happened.',
                scene: { present, mood: 'watchful', initiative: 'player', ...(loc ? { location: { value: loc[1], quote: sentences.find(s => s.includes(loc[1])) } } : {}) },
                cast_changes,
                facts: [
                    ...sentences.map(s => ({ fact: s.replace(/[.!?]$/, ''), quote: s, certainty: 'stated', witnesses: 'present' })),
                    { fact: 'The moon is made of cheese', quote: 'this sentence appears nowhere in the reply', certainty: 'stated' },
                ],
                relationships: present.includes('Mira') && /Mira (smiles|thanks|nods)/.test(reply)
                    ? [{ who: 'Mira', toward: 'the player', axis: 'trust', dir: 'up', weight: 'minor', category: 'words', quote: sentences.find(s => s.includes('Mira')) }] : [],
                lore: loc ? [{ keys: [loc[1].replace(/^the /, '')], text: `${loc[1]} is a place in this story.`, kind: 'place', quote: sentences.find(s => s.includes(loc[1])) }] : [],
                contradictions: control.contradict ? [{ quote: sentences[0], conflicts_with: 'Old Tam is dead', correction: 'Old Tam is dead and cannot speak; treat the voice as a memory' }] : [],
                direction: { beat: control.observerBeat, clues_found: [] },
            };
            return { kind: 'observer', text: '```json\n' + JSON.stringify(out) + '\n```' };
        }
        if (sys.includes('describe what kind of story it wants to be')) {
            return { kind: 'genre', text: JSON.stringify({ dominant: 'Fantasy', secondary: ['adventure'], register: 'plain, concrete, a little wry', pov: 'second person, present tense', priority: ['player agency', 'character consistency'], stakes: 'the village and its people', lethality: 'real', tempo: 'measured', promises: ['wonder with a cost'], avoid: ['modern slang'], stats_focus: ['agility', 'will'] }) };
        }
        if (sys.includes('compact profile of one character')) {
            const name = all.match(/## Card: (.+)/)?.[1] ?? 'X';
            return { kind: 'profile', text: JSON.stringify({ summary: `${name} in brief.`, stats: { strength: 35, agility: name === 'Mira' ? 66 : 40, endurance: 30, intellect: 45, perception: 50, will: 40, presence: 38 }, temperament: 'proud', tells: { warm: 'teases instead of praising' }, unprompted: 'checks the exits' }) };
        }
        if (sys.includes('outline the arc')) {
            return { kind: 'arc', text: JSON.stringify({ goal: 'Find out who poisoned the well', forces: ['the miller', 'the drought'], acts: 3, payoff: { name: 'the well runs clear', act: 3, hooks: ['a bitter taste', 'a missing ledger'] }, endings: [{ title: 'The truth out', outcomes: { Mira: 'stays' } }, { title: 'The village scatters', outcomes: { Mira: 'leaves' } }] }) };
        }
        if (sys.includes('You are the planner')) {
            return { kind: 'plan', text: JSON.stringify({ scenes: [{ id: 's1', purpose: 'unease at the well', if_unchallenged: ['the miller buys up the last clean water'], choice_points: ['confront or watch'], focus: { Mira: 'guarded hope' } }], beats: [{ scene: 's1', intent: 'let the bitter taste of the well water be noticed', precondition: 'someone drinks or draws water', type: 'reveal', required: true, lore: ['Greywell'], clues: [{ text: 'a grey film on the bucket', route: 'place', where: 'the well' }] }, { scene: 's1', intent: 'SECRET_SECOND_BEAT the miller makes an offer', precondition: 'the player lingers', type: 'pressure' }], tension: 'rising' }) };
        }
        if (sys.includes('compress the running summary')) return { kind: 'summariser', text: JSON.stringify({ summary: 'ROLLED: the story so far in brief.' }) };
        if (sys.includes('Offer three different premises')) return { kind: 'premises', text: JSON.stringify({ premises: ['A drought year.', 'A stranger arrives.', 'The well goes bitter.'] }) };
        if (sys.includes('Write the opening scene')) return { kind: 'opening', text: 'Dust hangs over the Greywell road as you arrive.' };

        turn++;
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        const said = flat(lastUser ? [lastUser] : []).slice(0, 60).replace(/\s+/g, ' ');
        let text = control.narration ?? `Mira nods toward the well at the Greywell Square as turn ${turn} begins. Old Tam mutters about the bitter water. The wind carries dust across the stones.`;
        control.narration = null;
        if (control.leak) text = `<director_notes>\nscene_intent: leaked\n</director_notes>\n${text}`;
        void said;
        return { kind: 'narrator', text };
    }

    const server = http.createServer(async (req, res) => {
        const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (req.method === 'GET' && req.url.endsWith('/models')) return send(200, { object: 'list', data: [{ id: 'mock', object: 'model' }] });
        if (req.method === 'GET' && req.url === '/log') return send(200, log);
        let body = '';
        for await (const chunk of req) body += chunk;
        if (req.method === 'POST' && req.url === '/control') { Object.assign(control, JSON.parse(body || '{}')); return send(200, control); }
        if (req.method === 'POST' && req.url === '/reset') { log.length = 0; return send(200, {}); }
        if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
            const data = JSON.parse(body);
            const out = respond(data.messages ?? []);
            log.push({ kind: out.kind, messages: data.messages, at: Date.now(), response: out.text, temperature: data.temperature });
            if (control.delayMs && out.kind !== 'narrator') await new Promise(r => setTimeout(r, control.delayMs));
            return send(200, { id: 'x', object: 'chat.completion', model: 'mock', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: out.text } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        }
        send(404, { error: 'not found' });
    });
    return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, log, control, port })));
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) startMock(Number(process.argv[2]) || 8124).then(m => console.log(`mock LLM on ${m.port}`));
