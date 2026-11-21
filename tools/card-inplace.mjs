// node tools/card-inplace.mjs <in.png> <dist/Narrator.card.json> <out.png>: same image, card data from the build, SillyTavern's own fields (chat link, dates) kept. For updating an installed card in place.
import fs from 'node:fs';
import zlib from 'node:zlib';
const [inp, distPath, out] = process.argv.slice(2);
const b = fs.readFileSync(inp);
const chunks = []; let o = 8;
while (o < b.length) { const len = b.readUInt32BE(o); chunks.push({ type: b.toString('ascii', o + 4, o + 8), data: b.subarray(o + 8, o + 8 + len) }); o += 12 + len; }
const text = (c) => { const z = c.data.indexOf(0); return { key: c.data.toString('latin1', 0, z), json: JSON.parse(Buffer.from(c.data.toString('latin1', z + 1), 'base64').toString('utf8')) }; };
const old = text(chunks.find(c => c.type === 'tEXt' && text(c).key === 'ccv3')).json;
const dist = JSON.parse(fs.readFileSync(distPath, 'utf8'));
const data = { ...dist.data, extensions: { ...(old.data.extensions ?? {}), ...(dist.data.extensions ?? {}) } };
const top = { ...old, name: data.name, description: data.description, personality: data.personality, scenario: data.scenario, first_mes: data.first_mes, mes_example: data.mes_example, data };
const v3 = { ...top, spec: 'chara_card_v3', spec_version: '3.0' };
const v2 = { ...top, spec: 'chara_card_v2', spec_version: '2.0' };
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type, 'ascii'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
const tEXt = (key, obj) => chunk('tEXt', Buffer.concat([Buffer.from(key + '\0', 'latin1'), Buffer.from(Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'), 'latin1')]));
const parts = [b.subarray(0, 8)];
for (const c of chunks) {
  if (c.type === 'tEXt' && ['chara', 'ccv3'].includes(text(c).key)) continue;
  if (c.type === 'IEND') parts.push(tEXt('chara', v2), tEXt('ccv3', v3));
  parts.push(chunk(c.type, c.data));
}
fs.writeFileSync(out, Buffer.concat(parts));
console.log('written', out, 'entries', data.character_book.entries.length);
