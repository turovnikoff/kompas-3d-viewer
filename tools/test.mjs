// node tools/test.mjs [file.m3d]  — parse a .m3d and print part sizes / volumes
import fs from 'node:fs';
import { parseM3D } from '../m3d.js';

const file = process.argv[2] || new URL('../sample.m3d', import.meta.url);
const buf = fs.readFileSync(file);
const t0 = performance.now();
const m = parseM3D(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
console.log('meta:', m.meta.AppName, '|', m.meta.AppVersion, '|', m.meta.FileTypeName, '| chunks:', m.chunks, '| ms:', (performance.now() - t0).toFixed(0));
for (const p of m.parts) {
  console.log(`part chunk#${p.chunk}: faces=${p.faces} tris=${p.triangles} size=${p.size.map(v => v.toFixed(2)).join(' x ')} vol=${(p.volume / 1000).toFixed(3)} cm3 area=${(p.area / 100).toFixed(1)} cm2`);
}
console.log('total volume cm3:', (m.total.volume / 1000).toFixed(3));
