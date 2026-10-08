// m3d.js — reader for KOMPAS-3D .m3d (part) files: container, metadata, tessellated geometry.
// Reverse-engineered from files written by KOMPAS-3D v24, for personal interoperability; see FORMAT.md.
// Only the *display tessellation* stored in the file is read (not the parametric model / B-rep).
//
//   import { parseM3D } from './m3d.js';
//   const model = parseM3D(arrayBuffer);          // no dependencies
//   model.meta, model.parts[i].{positions:Float32Array, indices:Uint32Array, bbox, size, volume, area}

const td16be = new TextDecoder('utf-16be');

// ---- tiny DEFLATE decoder (RFC 1951) that reports where the stream ended -----------------------
const LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEXT  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DEXT  = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const CLORD = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

function huff(lengths) {                      // canonical Huffman -> {count, symbol}
  const count = new Uint16Array(16), symbol = new Uint16Array(lengths.length), offs = new Uint16Array(16);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
  return { count, symbol };
}
let FIXED = null;

/** Inflate a raw deflate stream starting at byte `start`. Returns { out, end } (end = byte index after the stream). */
export function inflate(src, start = 0) {
  let pos = start, bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, (src.length - start) * 4)), olen = 0;
  const need = n => { if (olen + n > out.length) { const b = new Uint8Array(Math.max(out.length * 2, olen + n)); b.set(out.subarray(0, olen)); out = b; } };
  const bits = n => {
    while (bitCnt < n) { if (pos >= src.length) throw new Error('inflate: unexpected end'); bitBuf |= src[pos++] << bitCnt; bitCnt += 8; }
    const v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v;
  };
  const decode = h => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error('inflate: bad Huffman code');
  };
  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      const len = src[pos] | (src[pos + 1] << 8); pos += 4;
      need(len); out.set(src.subarray(pos, pos + len), olen); olen += len; pos += len;
    } else if (type === 1 || type === 2) {
      let lit, dist;
      if (type === 1) {
        if (!FIXED) {
          const l = new Uint8Array(288);
          for (let i = 0; i < 144; i++) l[i] = 8; for (let i = 144; i < 256; i++) l[i] = 9;
          for (let i = 256; i < 280; i++) l[i] = 7; for (let i = 280; i < 288; i++) l[i] = 8;
          FIXED = { lit: huff(l), dist: huff(new Uint8Array(30).fill(5)) };
        }
        ({ lit, dist } = FIXED);
      } else {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) cl[CLORD[i]] = bits(3);
        const ch = huff(cl), lens = new Uint8Array(nlen + ndist);
        for (let i = 0; i < nlen + ndist;) {
          const s = decode(ch);
          if (s < 16) lens[i++] = s;
          else {
            let rep, val = 0;
            if (s === 16) { val = lens[i - 1]; rep = 3 + bits(2); } else if (s === 17) rep = 3 + bits(3); else rep = 11 + bits(7);
            while (rep--) lens[i++] = val;
          }
        }
        lit = huff(lens.subarray(0, nlen)); dist = huff(lens.subarray(nlen));
      }
      for (;;) {
        const s = decode(lit);
        if (s < 256) { need(1); out[olen++] = s; }
        else if (s === 256) break;
        else {
          const li = s - 257, len = LBASE[li] + bits(LEXT[li]);
          const di = decode(dist), d = DBASE[di] + bits(DEXT[di]);
          need(len);
          for (let k = 0; k < len; k++, olen++) out[olen] = out[olen - d];
        }
      }
    } else throw new Error('inflate: bad block type');
  } while (!last);
  return { out: out.slice(0, olen), end: pos };   // whole bytes consumed (unused bits in last byte are discarded)
}

/** Minimal ZIP reader (central directory; stored + deflate). */
export function readZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a ZIP container (not a .m3d?)');
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Bad ZIP central directory');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = u8.subarray(start, start + csize);
    files[name] = method === 0 ? raw : inflate(raw, 0).out;
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

/** "Contents" = 'KF' + back-to-back zlib streams (no length prefixes). Returns the inflated chunks. */
export function readChunks(contents) {
  if (contents[0] !== 0x4b || contents[1] !== 0x46) throw new Error('Contents: missing "KF" signature');
  const chunks = [];
  let pos = 2;
  while (pos + 2 < contents.length) {
    // valid zlib header: CM=8 and (CMF*256+FLG) % 31 == 0; anything else is the trailing index block
    if ((contents[pos] & 0x0f) !== 8 || ((contents[pos] << 8) | contents[pos + 1]) % 31 !== 0) break;
    let r;
    try { r = inflate(contents, pos + 2); } catch { break; }   // skip 2-byte zlib header
    chunks.push(r.out);
    pos = r.end + 4;                                            // skip adler32
  }
  chunks.tail = contents.subarray(pos);                         // trailer (not decoded yet)
  return chunks;
}

/** FileInfo: binary header followed by UTF-16BE "key=value" lines (BOM FE FF). */
export function readFileInfo(u8) {
  const out = {};
  if (!u8) return out;
  let i = 0;
  while (i < u8.length - 1 && !(u8[i] === 0xfe && u8[i + 1] === 0xff)) i++;
  if (i >= u8.length - 1) return out;
  const text = td16be.decode(u8.subarray(i + 2));
  for (const line of text.split('\n')) {
    const k = line.indexOf('=');
    if (k > 0 && !line.startsWith('[')) out[line.slice(0, k).trim()] = line.slice(k + 1).trim();
  }
  return out;
}

/**
 * Find face-tessellation records inside one inflated chunk. Record layout (little endian):
 *   u32 N, u32 0, N*(f32 x,y,z)        vertices
 *   u32 N, u32 0, N*(f32 nx,ny,nz)     normals (not trusted; recompute them from the triangles)
 *   u32 T, u32 0, T*(u32 a,b,c)        triangle indices, local to this record
 * Located by pattern, so no knowledge of the surrounding object graph is needed.
 */
export function scanMesh(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), n = d.length;
  const recs = [];
  let o = 0;
  while (o < n - 40) {
    const N = dv.getUint32(o, true);
    if (N >= 3 && N <= 500000 && dv.getUint32(o + 4, true) === 0) {
      const nOff = o + 8 + 12 * N, tOff = o + 16 + 24 * N;
      if (tOff + 8 <= n && dv.getUint32(nOff, true) === N && dv.getUint32(nOff + 4, true) === 0) {
        const T = dv.getUint32(tOff, true);
        if (dv.getUint32(tOff + 4, true) === 0 && T >= 1 && T <= 4 * N && tOff + 8 + 12 * T <= n) {
          let ok = true;
          const pos = new Float32Array(3 * N);
          for (let i = 0; i < 3 * N && ok; i++) {
            const v = dv.getFloat32(o + 8 + 4 * i, true);
            if (!Number.isFinite(v) || Math.abs(v) > 1e5) ok = false; else pos[i] = v;
          }
          const idx = new Uint32Array(3 * T);
          for (let i = 0; i < 3 * T && ok; i++) {
            const v = dv.getUint32(tOff + 8 + 4 * i, true);
            if (v >= N) ok = false; else idx[i] = v;
          }
          if (ok) { recs.push({ pos, idx }); o = tOff + 8 + 12 * T; continue; }
        }
      }
    }
    o++;
  }
  return recs;
}

function merge(recs) {
  let nv = 0, ni = 0;
  for (const r of recs) { nv += r.pos.length; ni += r.idx.length; }
  const positions = new Float32Array(nv), indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const r of recs) {
    const base = vo / 3;
    positions.set(r.pos, vo); vo += r.pos.length;
    for (let i = 0; i < r.idx.length; i++) indices[io++] = r.idx[i] + base;
  }
  return { positions, indices };
}

/** bbox, size, signed volume (mm³ if the file is in mm), surface area. */
export function measure(positions, indices) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) { const v = positions[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  let vol = 0, area = 0;
  const P = positions;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2], cx = P[c], cy = P[c + 1], cz = P[c + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return { bbox: { min, max }, size: max.map((m, i) => m - min[i]), volume: vol, area };
}

/** Parse a .m3d file. One entry in `parts` per inflated chunk that contains tessellation. */
/**
 * Open either container flavour:
 *  - ZIP ("Contents" = KF + zlib chunks, FileInfo with version) — KOMPAS v20+ in the samples;
 *  - legacy flat file starting with 'KF' (no ZIP, no compression) — older versions (samples from 2020).
 */
export function openContainer(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const isZip = u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b;
  if (isZip) {
    const files = readZip(arrayBuffer);
    if (!files.Contents) throw new Error('No "Contents" stream: not a KOMPAS file');
    return { legacy: false, files, meta: readFileInfo(files.FileInfo), chunks: readChunks(files.Contents) };
  }
  if (u8[0] === 0x4b && u8[1] === 0x46) {
    const hdr = Array.from(u8.subarray(0, 8), b => b.toString(16).padStart(2, '0')).join(' ');
    return { legacy: true, files: {}, meta: { AppName: 'KOMPAS-3D (legacy container)', AppVersion: 'legacy', header: hdr }, chunks: [u8] };
  }
  throw new Error('Unknown file format (neither ZIP nor KF)');
}

export function parseM3D(arrayBuffer) {
  const { files, meta, chunks } = openContainer(arrayBuffer);
  const parts = [];
  chunks.forEach((c, chunk) => {
    if (c.length < 200) return;
    const recs = scanMesh(c);
    if (!recs.length) return;
    const { positions, indices } = merge(recs);
    parts.push({ chunk, faces: recs.length, triangles: indices.length / 3, positions, indices, ...measure(positions, indices) });
  });
  let total = null;
  if (parts.length) {
    const m = merge(parts.map(p => ({ pos: p.positions, idx: p.indices })));
    total = measure(m.positions, m.indices);
  }
  return { meta, streams: Object.keys(files), chunks: chunks.length, parts, total, preview: files.Preview || null };
}

// ------------------------------------------------------------------------------------------
// Assemblies (.a3d). The assembly stores no geometry, only component records: each one holds
//   3 × f64 translation (mm), then 9 × f64 rotation matrix (row-major, orthonormal),
// followed (a few hundred bytes later) by the referenced file name in UTF-16LE (full path, then the bare name).
// The same part may be referenced many times (one record per instance).
// ------------------------------------------------------------------------------------------
function findNames(d) {
  const out = [];
  for (let i = 0; i + 14 <= d.length; i++) {
    // look for ".m3d" / ".a3d" in UTF-16LE: 2E 00 (m|a) 00 (3) 00 (d) 00
    if (d[i] === 0x2e && d[i + 1] === 0 && (d[i + 2] === 0x6d || d[i + 2] === 0x61) && d[i + 3] === 0 &&
        d[i + 4] === 0x33 && d[i + 5] === 0 && d[i + 6] === 0x64 && d[i + 7] === 0) {
      let s = i;                          // walk back over printable UTF-16LE chars
      for (;;) {                          // ASCII, Latin-1, Cyrillic etc. (code units 0x20..0x4FF)
        if (s < 2) break;
        const cu = d[s - 2] | (d[s - 1] << 8);
        if (cu < 0x20 || cu === 0x7f || cu > 0x4ff) break;
        s -= 2;
      }
      const text = new TextDecoder('utf-16le').decode(d.subarray(s, i + 8));
      out.push({ at: s, text });
    }
  }
  return out;
}

function findRotation(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), tol = 1e-6;
  for (let o = 24; o + 72 <= d.length; o++) {
    const v = new Array(9);
    let ok = true;
    for (let i = 0; i < 9; i++) { v[i] = dv.getFloat64(o + 8 * i, true); if (!(Math.abs(v[i]) <= 1.0000001)) { ok = false; break; } }
    if (!ok) continue;
    const dot = (a, b) => v[3 * a] * v[3 * b] + v[3 * a + 1] * v[3 * b + 1] + v[3 * a + 2] * v[3 * b + 2];
    if (Math.abs(dot(0, 0) - 1) > tol || Math.abs(dot(1, 1) - 1) > tol || Math.abs(dot(2, 2) - 1) > tol ||
        Math.abs(dot(0, 1)) > tol || Math.abs(dot(0, 2)) > tol || Math.abs(dot(1, 2)) > tol) continue;
    const t = [0, 1, 2].map(i => dv.getFloat64(o - 24 + 8 * i, true));
    if (!t.every(x => Number.isFinite(x) && Math.abs(x) < 1e7)) continue;
    return { at: o, R: v, t };
  }
  return null;
}

/** Component list of an assembly: [{ file, rotation (9, row-major), translation (3), chunk }] */
function findRotations(d, from = 0) {
  const out = [];
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), tol = 1e-6;
  for (let o = Math.max(24, from); o + 72 <= d.length; o++) {
    const v = new Array(9);
    let ok = true;
    for (let i = 0; i < 9; i++) { v[i] = dv.getFloat64(o + 8 * i, true); if (!(Math.abs(v[i]) <= 1.0000001)) { ok = false; break; } }
    if (!ok) continue;
    const dot = (a, b) => v[3 * a] * v[3 * b] + v[3 * a + 1] * v[3 * b + 1] + v[3 * a + 2] * v[3 * b + 2];
    if (Math.abs(dot(0, 0) - 1) > tol || Math.abs(dot(1, 1) - 1) > tol || Math.abs(dot(2, 2) - 1) > tol ||
        Math.abs(dot(0, 1)) > tol || Math.abs(dot(0, 2)) > tol || Math.abs(dot(1, 2)) > tol) continue;
    const tr = [0, 1, 2].map(i => dv.getFloat64(o - 24 + 8 * i, true));
    if (!tr.every(x => Number.isFinite(x) && Math.abs(x) < 1e5)) continue;
    out.push({ at: o, R: v, t: tr }); o += 71;
  }
  return out;
}

/**
 * EXPERIMENTAL — legacy (pre-ZIP) assemblies. Layout seen in 3 samples: a table of referenced files
 * (bare name + full path, UTF-16) followed by one placement record per component, ~614 bytes apart.
 * Assumes one component per referenced file, in table order (not verifiable without the original KOMPAS).
 */
function parseLegacyAssembly(d) {
  const names = findNames(d), files = [];
  for (const n of names) {
    if (!/[\\/]/.test(n.text)) continue;
    const base = n.text.split(/[\\/]/).pop();
    if (!files.includes(base)) files.push(base);
  }
  if (!files.length) return [];
  const last = names[names.length - 1].at;
  const rots = findRotations(d, last).filter(r => Math.abs(r.t[0]) < 1e5);
  // the component records come first and are evenly spaced; stop at the first gap
  const comps = [];
  for (let i = 0; i < rots.length && comps.length < files.length; i++) {
    if (comps.length && rots[i].at - rots[i - 1].at > 700) break;
    comps.push(rots[i]);
  }
  return comps.map((r, i) => ({ file: files[i] || files[files.length - 1], path: files[i], rotation: r.R, translation: r.t, chunk: 0 }));
}

export function parseAssembly(arrayBuffer) {
  const { legacy, meta, chunks } = openContainer(arrayBuffer);
  if (legacy) return { meta, components: parseLegacyAssembly(chunks[0]), legacy: true };
  const components = [];
  chunks.forEach((c, chunk) => {
    const names = findNames(c);
    if (!names.length) return;
    const rot = findRotation(c);
    if (!rot || names[0].at < rot.at) return;          // the name must follow the matrix
    // prefer the occurrence that has a directory part (its basename is reliable; bare names may carry a stray prefix char)
    const full = names.filter(n => /[\\/]/.test(n.text));
    const last = (full.length ? full[full.length - 1] : names[names.length - 1]).text;
    components.push({ file: last.split(/[\\/]/).pop(), path: last, rotation: rot.R, translation: rot.t, chunk });
  });
  return { meta, components };
}

/** Apply a component placement: p' = Rᵀ·p + t, with R as stored in the file (row-major).
 *  Verified on a 12-plank door frame: only this convention gives a closed frame. */
export function placeMesh(positions, R, t, transpose = true) {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    for (let r = 0; r < 3; r++) {
      const a = transpose ? R[r] : R[3 * r], b = transpose ? R[3 + r] : R[3 * r + 1], c = transpose ? R[6 + r] : R[3 * r + 2];
      out[i + r] = a * x + b * y + c * z + t[r];
    }
  }
  return out;
}

/**
 * Build an assembly: `resolve(fileName)` must return the ArrayBuffer of the referenced part (or null).
 * Returns the same shape as parseM3D: { meta, parts[], total, missing[] } with parts already placed.
 */
export async function loadAssembly(arrayBuffer, resolve, { transpose = true } = {}) {
  const asm = parseAssembly(arrayBuffer);
  const cache = new Map(), parts = [], missing = [];
  for (const comp of asm.components) {
    if (!cache.has(comp.file)) {
      const buf = await resolve(comp.file);
      if (!buf) { cache.set(comp.file, null); }
      else if (/\.a3d$/i.test(comp.file)) cache.set(comp.file, await loadAssembly(buf, resolve, { transpose }));
      else cache.set(comp.file, parseM3D(buf));
    }
    const src = cache.get(comp.file);
    if (!src) { if (!missing.includes(comp.file)) missing.push(comp.file); continue; }
    for (const p of src.parts) {
      const positions = placeMesh(p.positions, comp.rotation, comp.translation, transpose);
      parts.push({ ...p, positions, name: comp.file, ...measure(positions, p.indices) });
    }
    if (src.missing) for (const m of src.missing) if (!missing.includes(m)) missing.push(m);
  }
  let total = null;
  if (parts.length) {
    const m = merge(parts.map(p => ({ pos: p.positions, idx: p.indices })));
    total = measure(m.positions, m.indices);
  }
  return { meta: asm.meta, kind: 'assembly', components: asm.components, parts, total, missing };
}
