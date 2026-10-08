// Builds dist/viewer.bundle.js (classic script, works from file://) and dist/samples.js (embedded sample files).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
await build({ entryPoints: ['src/viewer.js'], bundle: true, format: 'iife', outfile: 'dist/viewer.bundle.js', minify: true, alias: { three: './vendor/three.module.js' } });
const emb = {};
const add = f => { emb[f.split(path.sep).join('/')] = fs.readFileSync(f).toString('base64'); };
if (fs.existsSync('sample.m3d')) add('sample.m3d');
if (fs.existsSync('samples')) for (const d of fs.readdirSync('samples')) for (const f of fs.readdirSync(path.join('samples', d))) if (!f.startsWith('~$')) add(path.join('samples', d, f));      // optional: absent in a clean checkout
fs.writeFileSync('dist/samples.js', 'window.__M3D_SAMPLES=' + JSON.stringify(emb) + ';');
console.log('built', Object.keys(emb).length, 'samples');
