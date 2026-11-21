// node tools/card-png.mjs <image.png> <dist/Narrator.card.json> <out.png>: same picture, card data only from the build. For a release package.
// Same picture, card data taken only from the build: no install-specific fields (chat link, dates, favourite).
import fs from 'node:fs';
const [img, cardPath, out] = process.argv.slice(2);
const b = fs.readFileSync(img);
const chunks = []; let o = 8;
while (o < b.length) { const len = b.readUInt32BE(o); chunks.push({ type: b.toString('ascii', o + 4, o + 8), data: b.subarray(o + 8, o + 8 + len) }); o += 12 + len; }
const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
const d = card.data;
const top = { name: d.name, description: d.description, personality: d.personality, scenario: d.scenario, first_mes: d.first_mes, mes_example: d.mes_example, data: d };
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type, 'ascii'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
const tEXt = (key, obj) => chunk('tEXt', Buffer.concat([Buffer.from(key + '\0', 'latin1'), Buffer.from(Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'), 'latin1')]));
const parts = [b.subarray(0, 8)];
for (const c of chunks) {
    if (c.type === 'tEXt') continue; // drop every old text chunk, card data included
    if (c.type === 'IEND') parts.push(tEXt('chara', { ...top, spec: 'chara_card_v2', spec_version: '2.0' }), tEXt('ccv3', { ...top, spec: 'chara_card_v3', spec_version: '3.0' }));
    parts.push(chunk(c.type, c.data));
}
fs.writeFileSync(out, Buffer.concat(parts));
console.log('written', out, 'lorebook entries', d.character_book?.entries?.length, 'regex', d.extensions?.regex_scripts?.length);
