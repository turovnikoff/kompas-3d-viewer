// drawing.js — reader for KOMPAS-3D drawings (.cdw) and fragments (.frw): 2D geometry only.
// Reverse-engineered from files written by KOMPAS-3D v20–v24 (see FORMAT.md §9). Same container as .m3d.
//
//   import { parseDrawing } from './drawing.js';
//   const d = parseDrawing(arrayBuffer);   // { meta, entities, bbox, stats }
//
// Entities (all in sheet coordinates, mm):
//   { t:'line',  x1,y1,x2,y2 }
//   { t:'ellipse', cx,cy, ux,uy, vx,vy, a,b, t0,t1 }   circle / arc / ellipse; P(t) = C + a·cos t·u + b·sin t·v
//   { t:'text', x,y, ux,uy, h, text }
// Dimensions are expanded into lines (+ arrows) and text.
import { openContainer, readZip } from './m3d.js';
import { decodeText } from './symbols.js';
import { LINES as TPL_LINES, LABELS as TPL_LABELS, CELLS as TPL_CELLS } from './sheet-template.js';

const TAG_DIM_LINE = 0x1c07, TAG_DIM_TEXT = 0x7a03;      // class tags as they appear in "02 00 LL HH" (little endian)
const TAG_TABLE = 0x6d24, TAG_CELL = 0x715a;           // table object and its cell records
const TAG_DIM_LINEAR = 0x240e, TAG_DIM_DIAM = 0x0948, TAG_DIM_RAD = 0x762c;

function sane(v) { return Number.isFinite(v) && Math.abs(v) < 1e7; }
function f64(dv, o, n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = dv.getFloat64(o + 8 * i, true); return a; }

/** Class tag of the object header ("02 00 TT TT 00 00 00 00") shortly before payload offset p. */
function readHeaderTag(d, p) {
  for (let q = p - 4; q >= Math.max(0, p - 64); q--) {
    if (d[q] === 0x02 && d[q + 1] === 0x00 && d[q + 4] === 0 && d[q + 5] === 0 && d[q + 6] === 0 && d[q + 7] === 0 &&
        !(d[q + 2] === 0 && d[q + 3] === 0) && d[q + 2] !== 0x18) return d[q + 2] | (d[q + 3] << 8);
  }
  return 0;
}

const IDENT = { ox: 0, oy: 0, ux: 1, uy: 0, vx: 0, vy: 1, s: 1 };
function apply(fr, x, y) { return [fr.ox + x * fr.ux + y * fr.vx, fr.oy + x * fr.uy + y * fr.vy]; }
function applyDir(fr, x, y) { return [x * fr.ux + y * fr.vx, x * fr.uy + y * fr.vy]; }
/** Frame `inner` (given in the view's local units) expressed on the sheet. Annotation sizes are sheet units, so the view scale is not applied to the axes. */
function compose(view, inner) {
  const [ox, oy] = apply(view, inner.ox, inner.oy);
  const k = view.s ? 1 / view.s : 1;
  const [ux, uy] = applyDir(view, inner.ux * k, inner.uy * k), [vx, vy] = applyDir(view, inner.vx * k, inner.vy * k);
  return { ox, oy, ux, uy, vx, vy, s: 1 };
}

function addLine(out, fr, x1, y1, x2, y2, st = 0) {
  const [a, b] = apply(fr, x1, y1), [c, d] = apply(fr, x2, y2);
  out.push({ t: 'line', x1: a, y1: b, x2: c, y2: d, st });
}

/** A dimension parent record: header "02 00 TT TT 00 00 00 00" followed at +40 by a frame [ox oy cos sin -sin cos]
 *  and, within the next ~700 bytes, a dimension-line child (tag 0x1c07). */
function readDimParent(d, dv, o) {
  if (o + 120 > d.length) return null;
  const tag = d[o + 2] | (d[o + 3] << 8);
  if (tag === TAG_DIM_LINE || tag === TAG_DIM_TEXT || tag === 0) return null;
  // frame [ox oy cos sin -sin cos] sits at +40 (+42 in the longer header variant)
  let v = null;
  for (const off of [40, 42, 41, 43, 44, 46, 48]) {
    const w = f64(dv, o + off, 6);
    if (w.every(sane) && Math.abs(Math.hypot(w[2], w[3]) - 1) < 1e-6 && Math.abs(w[4] + w[3]) < 1e-6 && Math.abs(w[5] - w[2]) < 1e-6) { v = w; break; }
  }
  if (!v) return null;
  // a real dimension is followed by its children and, last, its text child (tag 0x7a03); tables and other containers are not
  let child = false;
  for (let q = o + 8; q < Math.min(d.length - 8, o + 1200); q++) {
    if (d[q] !== 0x02 || d[q + 1] !== 0) continue;
    const t2 = d[q + 2] | (d[q + 3] << 8);
    if (t2 === TAG_DIM_LINE) child = true;
    else if (t2 === TAG_DIM_TEXT) return { tag, fr: { ox: v[0], oy: v[1], ux: v[2], uy: v[3], vx: v[4], vy: v[5], s: 1 } };
  }
  return null;
}


/** Table object: header (tag 0x6d24) with a frame [ox oy cos sin -sin cos] at +20..+64, lines (tag 0x1c07) and nCells cell records (tag 0x715a);
 *  lines and the next nCells texts are given in the table frame. Verified against KOMPAS DXF (frame at +40 in v21+, at +20 in v14). */
function readTable(d, dv, o) {
  let fr = null;
  for (let off = 12; off <= 64 && !fr; off++) {
    if (o + off + 48 > d.length) break;
    const w = f64(dv, o + off, 6);
    if (w.every(sane) && Math.abs(Math.hypot(w[2], w[3]) - 1) < 1e-6 && Math.abs(w[4] + w[3]) < 1e-6 && Math.abs(w[5] - w[2]) < 1e-6) fr = { ox: w[0], oy: w[1], ux: w[2], uy: w[3], vx: w[4], vy: w[5], s: 1 };
  }
  if (!fr) return null;
  let lines = 0, cells = 0;
  for (let q = o + 8; q + 8 < Math.min(d.length, o + 60000); q++) {
    if (d[q] !== 2 || d[q + 1] !== 0 || !((d[q + 4] === 0 && d[q + 5] === 0 && d[q + 6] === 0 && d[q + 7] === 0) || (d[q + 4] === 0xff && d[q + 5] === 0xff && d[q + 6] === 0xff && d[q + 7] === 0xff))) continue;
    const tg = d[q + 2] | (d[q + 3] << 8);
    if (tg === TAG_DIM_LINE) lines++;
    else if (tg === TAG_CELL) cells++;
    else if (tg === TAG_TABLE || tg === 0x707e || tg === 0x5264) break;   // next table / free text / macro: the table is over (the cell texts live inside the cell records)
  }
  return lines >= 2 && cells >= 1 ? { fr, textsLeft: cells } : null;
}

/** First "u32 len + UTF-16LE string" inside d[from, to) (dimension value text is stored this way). */
function findString(d, dv, from, to) {
  for (let q = from; q + 6 < to; q++) {
    const len = dv.getUint32(q, true);
    if (len < 1 || len > 60 || q + 4 + 2 * len > to) continue;
    let ok = true;
    for (let i = 0; i < len; i++) {
      const c = dv.getUint16(q + 4 + 2 * i, true);
      if (!(c === 1 || (c >= 0x20 && c < 0x7f) || (c >= 0x400 && c < 0x500) || c === 0xb0 || c === 0xb1 || c === 0xd7 || c === 0xd8 || c === 0x2300 || (c >= 0x391 && c < 0x3ca))) { ok = false; break; }
    }
    if (ok) { const t = decodeText(d, dv, q + 4, len, { keepLF: false }); if (t) return t; }   // 0x0001 pairs are special signs (symbols.js)
  }
  return null;
}


// ---------------------------------------------------------------------------------------------
// Hatching: header "02 00 TT TT 01 | 9 zero bytes | f32 step | f32 angle°", followed by contour containers (tag 0x3107)
// whose boundary pieces (segments 47 08, arcs 6a 10) are listed one after another.
// ---------------------------------------------------------------------------------------------
const TAG_CONTOUR = 0x3107;

function readHatch(d, dv, o) {
  if (d[o] !== 0x02 || d[o + 1] !== 0 || d[o + 4] !== 0x01) return null;
  for (let k = 5; k <= 13; k++) if (d[o + k] !== 0) return null;                 // 01 + 9 zero bytes (the last 3 belong to the step float)
  const step = dv.getFloat32(o + 11, true), angle = dv.getFloat32(o + 15, true);
  if (!(step > 0.05 && step < 50) || !(angle >= 0 && angle <= 360)) return null;
  // collect contours until a header that is not a contour container
  const contours = []; let cur = null;
  for (let q = o + 19; q < d.length - 40 && q < o + 6000; q++) {
    if (d[q] === 0x02 && d[q + 1] === 0 && d[q + 4] === 0 && d[q + 5] === 0 && d[q + 6] === 0 && d[q + 7] === 0 && !(d[q + 2] === 0 && d[q + 3] === 0) && d[q + 2] !== 0x18) {
      const tg = d[q + 2] | (d[q + 3] << 8);
      if (tg === TAG_CONTOUR) { cur = []; contours.push(cur); q += 7; continue; }
      if (cur && cur.length) break;                                              // next object
      if (!cur) { /* header before the first contour: tolerate one */ }
    }
    if (!cur) continue;
    if (d[q] === 0x47 && d[q + 1] === 0x08) {
      const v = f64(dv, q + 2, 4);
      if (v.every(sane) && (v[0] !== v[2] || v[1] !== v[3])) { cur.push({ p: [[v[0], v[1]], [v[2], v[3]]] }); q += 33; }
    } else if (d[q] === 0x6a && d[q + 1] === 0x10) {
      const v = f64(dv, q + 2, 10);
      if (v.every(sane) && v[6] > 0 && v[7] > 0 && Math.abs(Math.hypot(v[2], v[3]) - 1) < 1e-6 && v[9] > v[8]) {
        const pts = [], n = Math.max(8, Math.ceil((v[9] - v[8]) / 0.15));
        for (let i = 0; i <= n; i++) { const a = v[8] + (v[9] - v[8]) * i / n, c = Math.cos(a) * v[6], s = Math.sin(a) * v[7]; pts.push([v[0] + c * v[2] + s * v[4], v[1] + c * v[3] + s * v[5]]); }
        cur.push({ p: pts }); q += 81;
      }
    }
  }
  const polys = [];
  for (const pieces of contours) {
    if (!pieces.length) continue;
    const poly = [...pieces[0].p];
    for (let i = 1; i < pieces.length; i++) {
      const last = poly[poly.length - 1], pp = pieces[i].p;
      const dS = Math.hypot(pp[0][0] - last[0], pp[0][1] - last[1]), dE = Math.hypot(pp[pp.length - 1][0] - last[0], pp[pp.length - 1][1] - last[1]);
      poly.push(...(dE < dS ? [...pp].reverse() : pp).slice(1));
    }
    if (poly.length >= 3) polys.push(poly);
  }
  return polys.length ? { step, angle, polys } : null;
}

/** Parallel lines at `angle` (degrees, CCW) every `step` mm, clipped to the polygons (even-odd). Returns [[x1,y1,x2,y2]…]. */
function hatchLines(polys, step, angleDeg) {
  const th = angleDeg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const rot = ([x, y]) => [x * c + y * s, -x * s + y * c];          // into the hatch frame (lines become horizontal)
  const unrot = ([u, v]) => [u * c - v * s, u * s + v * c];
  const P = polys.map(poly => poly.map(rot));
  let vmin = Infinity, vmax = -Infinity;
  for (const poly of P) for (const [, v] of poly) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  const out = [];
  for (let v = Math.ceil(vmin / step) * step; v <= vmax + 1e-9; v += step) {
    const vv = v + 1e-7, xs = [];
    for (const poly of P) for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a[1] <= vv) !== (b[1] <= vv)) xs.push(a[0] + (vv - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) { const p1 = unrot([xs[i], v]), p2 = unrot([xs[i + 1], v]); out.push([p1[0], p1[1], p2[0], p2[1]]); }
  }
  return out;
}


// ---------------------------------------------------------------------------------------------
// Library macro elements (symbols): container header "02 00 TT TT (00 00 00 00 | ff ff ff ff) <u16 handle> 00 00 80 35 6a 01",
// children in the symbol's local coordinates, and a trailer frame [ox oy cos sin -sin cos] followed by u32 len + the macro name.
// (Signature seen in KOMPAS v14 files; no such containers were found in the v20–v24 samples.)
// ---------------------------------------------------------------------------------------------
function findMacros(d, dv) {
  const n = d.length, heads = [];
  for (let o = 0; o + 16 < n; o++) {
    if (d[o] !== 2 || d[o + 1] !== 0 || d[o + 10] !== 0 || d[o + 11] !== 0 || d[o + 12] !== 0x80 || d[o + 13] !== 0x35 || d[o + 14] !== 0x6a) continue;
    const z = d[o + 4] === 0 && d[o + 5] === 0 && d[o + 6] === 0 && d[o + 7] === 0, f = d[o + 4] === 0xff && d[o + 5] === 0xff && d[o + 6] === 0xff && d[o + 7] === 0xff;
    if (z || f) heads.push(o);
  }
  const out = [];
  const printable = c => (c >= 0x20 && c < 0x7f) || (c >= 0x400 && c < 0x500);
  for (let h = 0; h < heads.length; h++) {
    const s = heads[h], lim = Math.min(n - 60, h + 1 < heads.length ? heads[h + 1] : s + 6000);
    for (let o = s + 60; o < lim; o++) {
      if (d[o + 7] !== 0x3f && d[o + 7] !== 0xbf && d[o + 7] !== 0x00 && d[o + 7] !== 0x80) { /* cheap filter on the high byte of the first double */ }
      const v = f64(dv, o, 6);
      if (!v.every(sane) || Math.abs(Math.hypot(v[2], v[3]) - 1) > 1e-6 || Math.abs(v[4] + v[3]) > 1e-6 || Math.abs(v[5] - v[2]) > 1e-6) continue;
      // name: u32 len (3..40) + printable UTF-16 within the next 64 bytes
      let ok = false;
      for (let q = o + 48; q < Math.min(n - 8, o + 112) && !ok; q++) {
        const len = dv.getUint32(q, true);
        if (len < 3 || len > 40 || q + 4 + 2 * len > n) continue;
        let all = true; for (let i = 0; i < len; i++) if (!printable(dv.getUint16(q + 4 + 2 * i, true))) { all = false; break; }
        if (all) ok = true;
      }
      if (ok) { out.push({ start: s, end: o + 48, fr: { ox: v[0], oy: v[1], ux: v[2], uy: v[3], vx: v[4], vy: v[5], s: 1 } }); break; }
    }
  }
  return out;
}
function chain(view, f) {
  const [ox, oy] = apply(view, f.ox, f.oy), [ux, uy] = applyDir(view, f.ux, f.uy), [vx, vy] = applyDir(view, f.vx, f.vy);
  return { ox, oy, ux, uy, vx, vy, s: view.s };
}

/** Scan one inflated chunk (or a whole legacy file) and append entities. */
function scanChunk(d, out, stats) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), n = d.length;
  const macros = findMacros(d, dv); let mi = 0;
  const startIdx = out.length;
  let symChunk = false;            // chunk of the "unspecified roughness" sign: its geometry is local to the sign
  let view = IDENT, ctx = null;   // ctx = open dimension: { tag, fr, lines: [] }
  let tctx = null;                 // open table: { fr, textsLeft }
  const childKeys = new Set();     // local coordinates of dimension children already seen (their later copies are skipped)
  const lk = (a, b, c, e) => [a, b, c, e].map(x => Math.round(x * 1e4) / 1e4).join();

  const closeDim = (storedText) => {
    if (!ctx) return;
    const L = ctx.lines[0];
    if (ctx.arc && !storedText && Math.abs((ctx.arc.t1 - ctx.arc.t0) - 2 * Math.PI) < 1e-6) { /* full circle: not an angular value */ }
    else if (ctx.arc) {                               // angular dimension: value from the arc, text outside the arc middle
      const A = ctx.arc, ang = (A.t1 - A.t0) * 180 / Math.PI, mid = (A.t0 + A.t1) / 2;
      const txt = storedText || (Math.round(ang * 100) / 100).toString().replace('.', ',') + '°';
      const [wx, wy] = apply(compose(view, ctx.fr), (A.a + 2) * Math.cos(mid) - 0.6 * txt.length, (A.a + 2) * Math.sin(mid));
      out.push({ t: 'text', x: wx, y: wy, ux: 1, uy: 0, h: 3.5, text: txt, derived: !storedText });
    }
    if (L && !ctx.arc) {
      const len = Math.hypot(L.x2 - L.x1, L.y2 - L.y1);
      if (len > 1e-9) {
        const ex = (L.x2 - L.x1) / len, ey = (L.y2 - L.y1) / len, al = 3.5, aw = 0.6;
        const fr = compose(view, ctx.fr);
        for (const [px, py, s] of [[L.x1, L.y1, 1], [L.x2, L.y2, -1]]) {
          if (Math.abs(px) < 1e-9 && Math.abs(py) < 1e-9) continue;          // a radius line starts at the centre: no arrow there
          const bx = px + s * ex * al, by = py + s * ey * al;
          for (const k of [1, -1]) addLine(out, fr, px, py, bx - ey * aw * k, by + ex * aw * k, 1);
        }
        let txt = storedText, derived = false;
        if (!txt && (ctx.tag === TAG_DIM_LINEAR || ctx.tag === TAG_DIM_DIAM || ctx.tag === TAG_DIM_RAD)) {
          const val = (Math.round(len * 100) / 100).toString().replace('.', ',');
          txt = (ctx.tag === TAG_DIM_DIAM ? '⌀' : ctx.tag === TAG_DIM_RAD ? 'R' : '') + val; derived = true;
        }
        if (txt) {
          const mx = (L.x1 + L.x2) / 2 - 0.5 * txt.length * 1.2, my = (L.y1 + L.y2) / 2 + 1;
          const [wx, wy] = apply(fr, mx, my);
          out.push({ t: 'text', x: wx, y: wy, ux: fr.ux, uy: fr.uy, h: 3.5, text: txt, derived });
        }
      }
    }
    ctx = null;
  };

  for (let o = 0; o < n - 20; o++) {
    const b = d[o];
    while (mi < macros.length && o >= macros[mi].end) mi++;
    const mac = mi < macros.length && o >= macros[mi].start ? macros[mi] : null;
    const base = mac ? chain(view, mac.fr) : view;

    // --- view header: doubles [a b c d | ox oy | 1 0 0 1], (a b c d) a rotation (det 1); view scale s is the double 24 bytes earlier
    if (o + 80 <= n && (d[o + 7] === 0x3f || d[o + 7] === 0xbf || d[o + 7] === 0x00 || d[o + 7] === 0x80 || d[o + 7] === 0x40)) {
      const v = f64(dv, o, 10);
      if (v[6] === 1 && v[7] === 0 && v[8] === 0 && v[9] === 1 && v.slice(0, 6).every(sane) &&
          Math.abs(v[0] * v[3] - v[1] * v[2] - 1) < 1e-9 && Math.abs(Math.hypot(v[0], v[1]) - 1) < 1e-9) {
        closeDim();
        let s = o >= 24 ? dv.getFloat64(o - 24, true) : 1;
        if (!(s > 1e-6 && s < 1e6)) s = 1;
        view = { ox: v[4], oy: v[5], ux: s * v[0], uy: s * v[1], vx: s * v[2], vy: s * v[3], s };
        stats.views++; o += 79; continue;
      }
    }

    // --- hatching
    if (b === 0x02 && d[o + 1] === 0 && d[o + 4] === 0x01 && o + 40 < n) {
      const hx = readHatch(d, dv, o);
      if (hx) {
        stats.hatches = (stats.hatches || 0) + 1;
        for (const [x1, y1, x2, y2] of hatchLines(hx.polys, hx.step / (view.s || 1), hx.angle)) { addLine(out, view, x1, y1, x2, y2, 1); out[out.length - 1].hatch = true; }
        o += 18; continue;
      }
    }

    // --- object headers: dimension parents and dimension text
    if (b === 0x02 && d[o + 1] === 0 && d[o + 4] === 0 && d[o + 5] === 0 && d[o + 6] === 0 && d[o + 7] === 0) {
      const tag = d[o + 2] | (d[o + 3] << 8);
      if (tag === TAG_DIM_TEXT) {
        if (ctx) closeDim(findString(d, dv, o + 8, Math.min(n, o + 400)));
        continue;
      }
      if (tag === TAG_TABLE && !(d[o + 4] === 1)) { const tb = readTable(d, dv, o); if (tb) { closeDim(); tctx = tb; stats.tables = (stats.tables || 0) + 1; o += 7; continue; } }
      const p = readDimParent(d, dv, o);
      if (p) { closeDim(); ctx = { tag: p.tag, fr: p.fr, lines: [] }; stats.dimensions++; o += 7; continue; }
    }

    // --- straight segment: marker 47 08 + 4 doubles
    if (b === 0x47 && d[o + 1] === 0x08 && o + 34 <= n) {
      const v = f64(dv, o + 2, 4);
      if (v.every(sane) && (v[0] !== v[2] || v[1] !== v[3])) {
        const tag = readHeaderTag(d, o);
        if (ctx && tag === TAG_DIM_LINE) {
          ctx.lines.push({ x1: v[0], y1: v[1], x2: v[2], y2: v[3] });
          childKeys.add(lk(...v));
          addLine(out, compose(view, ctx.fr), v[0], v[1], v[2], v[3], 1);
        } else if (tctx && tag === TAG_DIM_LINE) {
          addLine(out, compose(view, tctx.fr), v[0], v[1], v[2], v[3], o >= 3 ? d[o - 3] : 0);
        } else if (tag === TAG_DIM_LINE && childKeys.has(lk(...v))) {
          // second copy of a dimension child, stored outside its dimension: skip
        } else addLine(out, base, v[0], v[1], v[2], v[3], o >= 3 ? d[o - 3] : 0);   // style code = byte at marker−3 (see FORMAT.md §9.7)
        stats.lines++; o += 33; continue;
      }
    }

    // --- ellipse / circle / arc: marker 6a 10 + [cx cy cos sin -sin cos a b t0 t1]
    if (b === 0x6a && d[o + 1] === 0x10 && o + 82 <= n) {
      const v = f64(dv, o + 2, 10);
      if (v.every(sane) && v[6] > 0 && v[7] > 0 && Math.abs(Math.hypot(v[2], v[3]) - 1) < 1e-6 && Math.abs(v[8]) <= 6.2832 && Math.abs(v[9]) <= 6.2832 * 2 && v[9] > v[8]) {
        const fr = ctx ? compose(view, ctx.fr) : base;
        const [cx, cy] = apply(fr, v[0], v[1]);
        const [ux, uy] = applyDir(fr, v[2], v[3]), [vx, vy] = applyDir(fr, v[4], v[5]);
        out.push({ t: 'ellipse', cx, cy, ux, uy, vx, vy, a: v[6], b: v[7], t0: v[8], t1: v[9], st: ctx ? 1 : (o >= 3 ? d[o - 3] : 0) });
        if (ctx && !ctx.arc) ctx.arc = { a: v[6], t0: v[8], t1: v[9], fr };
        stats.ellipses++; o += 81; continue;
      }
    }

    // --- stand-alone text: 00 00 80 3F 00 00 80 3F | u32 len | UTF-16LE ; frame [x y cos sin -sin cos] lies 82 bytes before len
    if (b === 0x00 && d[o + 1] === 0x00 && d[o + 2] === 0x80 && d[o + 3] === 0x3f && d[o + 4] === 0 && d[o + 5] === 0 && d[o + 6] === 0x80 && d[o + 7] === 0x3f && o + 14 < n) {
      const len = dv.getUint32(o + 8, true);
      const s = o + 12;
      if (len >= 1 && len <= 4000 && s + 2 * len <= n && o >= 82) {
        let ok = true;
        let printable = 0;
        for (let i = 0; i < len; i++) { const c = dv.getUint16(s + 2 * i, true); if (c >= 0x20) printable++; else if (c > 0x1f || c === 0) { ok = false; break; } }
        if (!printable) ok = false;
        if (ok) {
          const fr = f64(dv, o + 8 - 82, 6);
          if (fr.every(sane) && Math.abs(Math.hypot(fr[2], fr[3]) - 1) < 1e-3) {
            let text = '';
            text = decodeText(d, dv, s, len);   // codes < 0x20 are formatting markers, placeholder pairs are special signs (symbols.js)
            let h = 3.5;
            const hp = s + 2 * len + 56;
            if (hp + 8 <= n && dv.getUint32(hp + 4, true) === 0x3f800000) { const hv = dv.getFloat32(hp, true); if (hv >= 0.5 && hv <= 200) h = hv; }
            // f32 just before the two 1.0 factors = horizontal shift computed for centred table cells (0 otherwise)
            const shift = o >= 8 ? dv.getFloat32(o - 8, true) : 0;
            if (Number.isFinite(shift) && Math.abs(shift) < 500 && shift !== 0) { fr[0] += shift * fr[2]; fr[1] += shift * fr[3]; }
            let [x, y] = apply(base, fr[0], fr[1]), [ux, uy] = applyDir(base, fr[2], fr[3]);
            let inTable = false;
            if (tctx && tctx.textsLeft > 0) {
              const tf = compose(view, tctx.fr); [x, y] = apply(tf, fr[0], fr[1]); [ux, uy] = applyDir(tf, fr[2], fr[3]); inTable = true;
              if (--tctx.textsLeft === 0) tctx = null;
            }
            closeDim();
            // a text whose frame is exactly the local origin belongs to a nested symbol (roughness mark, section label…)
            // whose parent frame is not decoded yet: skip it instead of drawing it at the wrong place
            if (!inTable && fr[0] === 0 && fr[1] === 0) { stats.unplaced = (stats.unplaced || 0) + 1; (stats.unplacedTexts || (stats.unplacedTexts = [])).push(text); if (/^Ra/.test(text)) symChunk = true; }
            else { out.push({ t: 'text', x, y, ux, uy, h, text }); stats.texts++; }
            o = s + 2 * len - 1; continue;
          }
        }
      }
    }
  }
  closeDim();
  if (symChunk) for (let i = startIdx; i < out.length; i++) out[i].sym = true;
}


// ---------------------------------------------------------------------------------------------
// Sheet frame, GOST 2.104 first-sheet title block and its cell values (drawings only)
// ---------------------------------------------------------------------------------------------
function sheetSize(files) {
  const o = files && files['Options.xml'];
  if (!o) return null;
  let i = 0; while (i < o.length - 1 && !(o[i] === 0xfe && o[i + 1] === 0xff)) i++;
  const txt = new TextDecoder(i < o.length - 1 ? 'utf-16be' : 'utf-8').decode(o.subarray(i < o.length - 1 ? i + 2 : 0));
  const num = k => { const m = new RegExp('name="' + k + '" value="([0-9.]+)"').exec(txt); return m ? parseFloat(m[1]) : null; };
  const W = num('rectW'), H = num('rectH');
  return W && H ? { W, H } : null;
}

/** Does the file carry the standard first-sheet title block (GOST 2.104, form 1)? Its definition is a nested ZIP (*.tb). */
function hasFirstSheetStamp(files) {
  for (const name of Object.keys(files)) {
    if (!/\.tb$/i.test(name)) continue;
    try {
      const inner = readZip(files[name]);
      const c = inner.Contents; if (!c) continue;
      let s = ''; for (let i = 0; i + 1 < Math.min(c.length, 400); i += 2) s += String.fromCharCode(c[i] | (c[i + 1] << 8));
      if (s.includes('Первый лист')) return true;   // "Первый лист"
    } catch { /* not a zip */ }
  }
  return false;
}

/** Stamp cell values: records "ff ff ff ff 00 NN flag 00 00 01 0x 00*7 u32 len UTF-16LE". 0x02 inside the text is a line break. */
export function readStampCells(chunks) {
  const cells = new Map();
  const decode = (d, dv, p, len) => {
    const text = decodeText(d, dv, p, len, { stamp: true, reach: 400 });          // 02 = line break, 01 pairs = special signs (symbols.js)
    return /\S/.test(text) ? text.replace(/ +\n/g, '\n').trim() : null;
  };
  for (const d of chunks) {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), n = d.length;
    let last = null;   // { id, end, fresh }: the previous cell record (its text may continue in a following run)
    for (let o = 0; o + 28 < n; o++) {
      if (d[o] !== 0xff || d[o + 1] !== 0xff || d[o + 2] !== 0xff || d[o + 3] !== 0xff || (o > 0 && d[o - 1] === 0xff)) continue;   // start of the run only (the 0xff runs are padding)
      // (A) full cell record. id: "00 NN" for plain cells; composite cells (built from variables) start with "02 00 …" = document number (cell 2)
      let id = -1;
      if (d[o + 4] === 0x00) id = d[o + 5]; else if (d[o + 4] === 0x02 && d[o + 5] === 0x00) id = 2;
      let q = -1;
      if (id > 0) for (let k = o + 6; k < Math.min(n - 20, o + 200); k++) {
        if (d[k] === 1 && (d[k + 1] === 1 || d[k + 1] === 2) && d[k + 2] === 0 && d[k + 3] === 0 && d[k + 4] === 0 && d[k + 5] === 0 && d[k + 6] === 0 && d[k + 7] === 0 && d[k + 8] === 0) { q = k + 9; break; }
      }
      if (q >= 0) {
        const len = dv.getUint32(q, true);
        if (len >= 1 && len <= 400 && q + 4 + 2 * len <= n) {
          const text = decode(d, dv, q + 4, len);
          if (text) {
            const fresh = !cells.has(id);
            if (id === 2 && text.length < 6) continue;              // composite pattern also matches short format labels such as "A4"
            if (fresh) cells.set(id, text);
            last = { id, end: q + 4 + 2 * len, fresh };
            o = q + 4 + 2 * len - 1; continue;
          }
        }
      }
      // (B) continuation run: ff ff ff ff 00 | u32 len | chars  (next line of the previous cell)
      if (d[o + 4] === 0x00 && last && last.fresh && o - last.end < 400) {
        const len = dv.getUint32(o + 5, true);
        if (len >= 1 && len <= 200 && o + 9 + 2 * len <= n) {
          const text = decode(d, dv, o + 9, len);
          if (text) { cells.set(last.id, cells.get(last.id) + '\n' + text); last.end = o + 9 + 2 * len; o = last.end - 1; }
        }
      }
    }
  }
  return cells;
}

/** Legacy (single flat stream) files: the sheet is a record [0.0][W][H][0.0] of doubles with W, H from the A-series; first occurrence wins. */
function legacySheet(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), n = d.length;
  const sizes = [[210, 297], [297, 420], [420, 594], [594, 841], [841, 1189]];
  for (let o = 8; o + 32 < n; o++) {
    const w = dv.getFloat64(o, true);
    if (w !== 210 && w !== 297 && w !== 420 && w !== 594 && w !== 841 && w !== 1189) continue;
    const h = dv.getFloat64(o + 8, true);
    if (!sizes.some(s => (s[0] === w && s[1] === h) || (s[0] === h && s[1] === w))) continue;
    if (dv.getFloat64(o - 8, true) === 0 && Math.abs(dv.getFloat64(o + 16, true)) < 1e-100) return { W: w, H: h };
  }
  return null;
}
function legacyHasFirstSheetStamp(d) {
  const needle = 'Первый лист';
  const bytes = new Uint8Array(needle.length * 2);
  for (let i = 0; i < needle.length; i++) { bytes[2 * i] = needle.charCodeAt(i) & 255; bytes[2 * i + 1] = needle.charCodeAt(i) >> 8; }
  outer: for (let o = 0; o + bytes.length < d.length; o++) { for (let k = 0; k < bytes.length; k++) if (d[o + k] !== bytes[k]) continue outer; return true; }
  return false;
}


/** Legacy (KOMPAS ≤ v14-era) stamp cells. Cell record: font header "x 19 04" + 7 zero bytes, then [NN][flag] 00 00 01 (01|02|05) 00*7 u32 len UTF-16LE;
 *  further lines of the same cell follow as runs "19 04" + zeros + u32 len + chars. */
function readLegacyStampCells(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), n = d.length, cells = new Map();
  const readRun = (p) => {                                             // u32 len + chars at p
    const len = dv.getUint32(p, true);
    if (len < 1 || len > 300 || p + 4 + 2 * len > n) return null;
    const text = decodeText(d, dv, p + 4, len, { stamp: true, reach: 400 });
    return /\S/.test(text) ? { text: text.trim(), end: p + 4 + 2 * len } : null;
  };
  for (let k = 12; k + 20 < n; k++) {
    const id = d[k];
    if (id < 1 || id > 250 || d[k + 2] !== 0 || d[k + 3] !== 0 || d[k + 4] !== 1 || (d[k + 5] !== 1 && d[k + 5] !== 2 && d[k + 5] !== 5)) continue;
    let ok = true; for (let z = 6; z < 13; z++) if (d[k + z] !== 0) { ok = false; break; }
    if (!ok) continue;
    const afterFont = d[k - 9] === 0x19 && d[k - 8] === 0x04 && [1, 2, 3, 4, 5, 6, 7].every(z => d[k - z] === 0);   // font header "19 04" + 7 zeros
    const afterMark = d[k - 5] === 0x01 && d[k - 4] === 0x07 && d[k - 3] === 0 && d[k - 2] === 0 && d[k - 1] === 0;   // first cell of the block: "01 07 00 00 00"
    if (!afterFont && !afterMark) continue;
    const run = readRun(k + 13);
    if (!run) continue;
    let text = run.text, end = run.end;
    if (d[k + 5] === 5) {                                              // multi-run cell: following lines
      for (let guard = 0; guard < 8; guard++) {
        let found = null;
        for (let q = end; q < Math.min(n - 8, end + 260) && !found; q++) {
          if (d[q] !== 0x19 || d[q + 1] !== 0x04) continue;
          let z = q + 2; while (z < n && d[z] === 0 && z - q < 12) z++;
          if (z - q - 2 < 3) continue;
          const r = readRun(z); if (r && r.text) found = r;
        }
        if (!found) break;
        text += '\n' + found.text; end = found.end;
      }
    }
    if (!cells.has(id)) cells.set(id, text);
    k = end - 1;
  }
  return cells;
}

const FORMATS = [[210, 297, 'A4'], [297, 420, 'A3'], [420, 594, 'A2'], [594, 841, 'A1'], [841, 1189, 'A0']];

function buildSheet(W, H, cells, withStamp) {
  const out = [];
  const L = (x1, y1, x2, y2, w) => out.push({ t: 'line', x1, y1, x2, y2, w, st: w ? 0 : 1, sheet: true });
  L(0, 0, W, 0, 0); L(W, 0, W, H, 0); L(W, H, 0, H, 0); L(0, H, 0, 0, 0);          // sheet edge (thin)
  L(20, 5, W - 5, 5, 1); L(W - 5, 5, W - 5, H - 5, 1); L(W - 5, H - 5, 20, H - 5, 1); L(20, H - 5, 20, 5, 1);   // frame (thick)
  if (!withStamp) return out;
  const dx = W - 210, dy = H - 297;
  // verified against KOMPAS DXF of an A1 sheet: the whole left strip stays bottom-anchored; only the document-number box follows the top frame
  const sh = (kind, x, y) => kind === 's' ? [x + dx, y] : kind === 'tb' ? [x, y + dy] : [x, y];
  for (const [x1, y1, x2, y2, w, kind] of TPL_LINES) { const a = sh(kind, x1, y1), b = sh(kind, x2, y2); L(a[0], a[1], b[0], b[1], w); }
  const fmt = (FORMATS.find(f => Math.abs(f[0] - Math.min(W, H)) < 1 && Math.abs(f[1] - Math.max(W, H)) < 1) || [0, 0, ''])[2];
  const asLabel = (text, x, y, h, rot, kind) => {
    const th = rot * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), [px, py] = sh(kind, x, y);
    out.push({ t: 'text', x: px + 0.8 * h * s, y: py - 0.8 * h * c, ux: c, uy: s, h, text, sheet: true, align: 'left' });
  };
  for (const [text, x, y, h, rot, kind] of TPL_LABELS) {
    if (text === '1:1') continue;                                  // default scale: shown only when cell 6 is empty
    asLabel(text === 'A4' && fmt ? fmt : text, x, y, h, rot, kind);
  }
  if (!cells.has(6)) asLabel('1:1', 192.44, 34.9, 5, 0, 's');
  for (const [n, kind, x0, y0, x1, y1, h, align, rot] of TPL_CELLS) {
    const text = cells.get(n); if (!text) continue;
    const a = sh(kind, x0, y0), b = sh(kind, x1, y1), th = rot * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    const lines = text.split('\n'), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    const reading = (rot === 90 || rot === 270) ? Math.abs(b[1] - a[1]) : Math.abs(b[0] - a[0]);   // length of the box along the text direction
    if (align === 'C') {
      // centre of the box, baseline 0.35 h below the centre (perpendicular to the reading direction); lines stack away from "up"
      const boxH = Math.abs(b[(rot === 90 || rot === 270) ? 0 : 1] - a[(rot === 90 || rot === 270) ? 0 : 1]);
      const hh = Math.min(h, (boxH - 1) / (1.35 * lines.length)), n2 = lines.length, pitch = 1.3 * hh;
      lines.forEach((ln, i) => {
        const off = ((n2 - 1) / 2 - i) * pitch - 0.35 * hh;      // along "up" (-s, c)
        out.push({ t: 'text', x: cx - s * off, y: cy + c * off, ux: c, uy: s, h: hh, text: ln, sheet: true, align: 'center', maxw: reading - 1 });
      });
    } else {
      const top = Math.max(a[1], b[1]) - 0.82;
      lines.forEach((ln, i) => out.push({ t: 'text', x: Math.min(a[0], b[0]) + 0.5, y: top - 0.8 * h - i * 1.3 * h, ux: 1, uy: 0, h, text: ln, sheet: true, align: 'left', maxw: reading - 1 }));
    }
  }
  return out;
}

export function entityBounds(entities) {
  const bb = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
  const add = (x, y) => { if (x < bb.min[0]) bb.min[0] = x; if (y < bb.min[1]) bb.min[1] = y; if (x > bb.max[0]) bb.max[0] = x; if (y > bb.max[1]) bb.max[1] = y; };
  for (const e of entities) {
    if (e.t === 'line') { add(e.x1, e.y1); add(e.x2, e.y2); }
    else if (e.t === 'ellipse') for (let i = 0; i <= 16; i++) { const t = e.t0 + (e.t1 - e.t0) * i / 16, c = Math.cos(t), s = Math.sin(t); add(e.cx + e.a * c * e.ux + e.b * s * e.vx, e.cy + e.a * c * e.uy + e.b * s * e.vy); }
    else if (e.t === 'text') { add(e.x, e.y); add(e.x + e.h * 0.6 * e.text.length * e.ux, e.y + e.h * 0.6 * e.text.length * e.uy); }
  }
  return bb;
}

export function parseDrawing(arrayBuffer) {
  const { meta, chunks, files } = openContainer(arrayBuffer);
  const raw = [], stats = { lines: 0, ellipses: 0, texts: 0, dimensions: 0, views: 0 };
  const legacyFile = chunks.length === 1 && !files['Contents'];
  const size = legacyFile ? legacySheet(chunks[0]) : sheetSize(files);
  for (const c of chunks) if (c.length > 120) scanChunk(c, raw, stats);
  // the same object can be stored twice (e.g. in a view and in a layer list) -> drop exact duplicates
  const seen = new Set(), entities = [];
  const r = v => Math.round(v * 1e4) / 1e4;
  for (const e of raw) {
    const key = e.t === 'line' ? ['l', ...[e.x1, e.y1, e.x2, e.y2].map(r)].sort().join()
      : e.t === 'ellipse' ? ['e', e.cx, e.cy, e.a, e.b, e.t0, e.t1, e.ux, e.uy].map(x => typeof x === 'number' ? r(x) : x).join()
      : ['t', r(e.x), r(e.y), e.text].join();
    if (seen.has(key)) continue;
    seen.add(key); entities.push(e);
  }
  // the "unspecified roughness" sign sits in the top-right corner of the sheet (placement measured on a KOMPAS rendering)
  const sym = entities.filter(e => e.sym);
  if (sym.length) {
    const rest = entities.filter(e => !e.sym);
    entities.length = 0; entities.push(...rest);
    if (size) {
      const ls = sym.filter(e => e.t === 'line'); let mx = -Infinity, my = -Infinity;
      for (const e of ls) { mx = Math.max(mx, e.x1, e.x2); my = Math.max(my, e.y1, e.y2); }
      if (ls.length) {
        const dx = size.W - 12.8 - mx, dy = size.H - 11.3 - my;
        for (const e of sym) { if (e.t === 'line') { e.x1 += dx; e.x2 += dx; e.y1 += dy; e.y2 += dy; } else if (e.t === 'ellipse') { e.cx += dx; e.cy += dy; } else { e.x += dx; e.y += dy; } e.sym = false; entities.push(e); }
      }
    }
  }
  // a dimension without a stored value gets a computed one (derived); drop it when the author put the same number next to it as a plain text
  const norm = t => t.replace(/\s+/g, '').replace('.', ',');
  const plain = entities.filter(e => e.t === 'text' && !e.derived && !e.sheet);
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    if (e.t === 'text' && e.derived && plain.some(q => norm(q.text) === norm(e.text) && Math.hypot(q.x - e.x, q.y - e.y) < 20)) entities.splice(i, 1);
  }
  let sheet = null;
  if (size) {
    const withStamp = legacyFile ? legacyHasFirstSheetStamp(chunks[0]) : hasFirstSheetStamp(files), cells = !withStamp ? new Map() : legacyFile ? readLegacyStampCells(chunks[0]) : readStampCells(chunks);
    sheet = { W: size.W, H: size.H, stamp: withStamp, cells: cells.size };
    entities.unshift(...buildSheet(size.W, size.H, cells, withStamp));
  }
  return { meta, entities, sheet, bbox: sheet ? { min: [0, 0], max: [sheet.W, sheet.H] } : entities.length ? entityBounds(entities) : null, stats: { ...stats, unique: entities.length } };
}
