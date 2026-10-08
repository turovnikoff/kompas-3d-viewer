// spec.js — reader for KOMPAS-3D specifications (.spw, GOST R 2.106, several sheets) → the same entity list as drawing.js (sheets are stacked vertically).
// Reverse-engineered from three specifications (spec1 with two sheets) of KOMPAS v24 (see FORMAT.md §10). Geometry of the sheet was measured on KOMPAS' own rendering.
import { openContainer } from './m3d.js';
import { decodeText } from './symbols.js';
import { LINES as TPL_LINES, LABELS as TPL_LABELS } from './sheet-template.js';

// ---- title block of a specification (first sheet): 185 × 40 mm, measured on a KOMPAS rendering --------------------------------------------
// [x1, y1, x2, y2, thick]
const STAMP_LINES = [
  [20, 45, 205, 45, 1], [20, 40, 85, 40, 0], [20, 35, 85, 35, 1], [20, 30, 205, 30, 1], [20, 25, 85, 25, 0], [155, 25, 205, 25, 1],
  [20, 20, 85, 20, 0], [155, 20, 205, 20, 1], [20, 15, 85, 15, 0], [20, 10, 85, 10, 0],
  [27, 30, 27, 45, 1], [37, 5, 37, 45, 1], [60, 5, 60, 45, 1], [75, 5, 75, 45, 1], [85, 5, 85, 45, 1], [155, 5, 155, 30, 1], [170, 20, 170, 30, 1], [185, 20, 185, 30, 1],
];
// header labels (rows of the stamp): [text, x, y of the top edge, height, rotation]
const STAMP_LABELS = [
  ['Изм.', 20.62, 34.18, 3.5, 0], ['Лист', 27.61, 34.18, 3.5, 0], ['№ докум.', 40.63, 34.18, 3.5, 0], ['Подп.', 63.1, 34.18, 3.5, 0], ['Дата', 75.61, 34.18, 3.5, 0],
  ['Разраб.', 20.5, 29.18, 3.5, 0], ['Пров.', 20.5, 24.18, 3.5, 0], ['Н.контр.', 20.5, 14.18, 3.5, 0], ['Утв.', 20.5, 9.18, 3.5, 0],
  ['Лит.', 158.47, 29.18, 3.5, 0], ['Лист', 172.5, 29.18, 3.5, 0], ['Листов', 187, 29.18, 3.5, 0],
];
// stamp cells: [id, x0, y0, x1, y1, height, align]
const STAMP_CELLS = [
  [1, 85, 5, 155, 30, 10, 'C'], [2, 85, 30, 205, 45, 7, 'C'], [9, 155, 5, 205, 20, 7, 'C'],
  [110, 37, 25, 60, 30, 3.5, 'L'], [111, 37, 20, 60, 25, 3.5, 'L'], [112, 37, 15, 60, 20, 3.5, 'L'], [114, 37, 10, 60, 15, 3.5, 'L'], [115, 37, 5, 60, 10, 3.5, 'L'],
];

// ---- specification table ---------------------------------------------------------------------------------------------------------------
const COLS = [20, 26, 32, 40, 110, 173, 183, 205];            // Формат | Зона | Поз. | Обозначение | Наименование | Кол. | Примечание
const COL_ALIGN = ['C', 'C', 'C', 'L', 'L', 'C', 'L'];
const ROW0 = 277, ROW_H = 8, FIRST_N = 29, NEXT_N = 32;                       // first body row starts at y = 277; sheet 1: 29 rows down to y = 45, next sheets: 32 rows down to y = 20
// object type -> section (GOST R 2.106 numbering: 5 documentation, 10 complexes, 15 assemblies, 20 parts, 25 standard, 30 other, 35 materials, 40 kits)
const SECTIONS = { 5: 'Документация', 10: 'Комплексы', 15: 'Сборочные единицы', 20: 'Детали', 25: 'Стандартные изделия', 30: 'Прочие изделия', 35: 'Материалы', 40: 'Комплекты' };
const CELL_RE = /\u0002/;


/** Objects: header "02 80 1d 2c 01 <id> 00 <type>" (first occurrence of the class) or "02 00 1d 2c <type>" (later ones). */
export function readObjects(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), n = d.length, heads = [];
  for (let p = 0; p + 12 < n; p++) {
    if (d[p] !== 0x02 || d[p + 2] !== 0x1d || d[p + 3] !== 0x2c) continue;
    if (d[p + 1] === 0x80 && d[p + 4] === 0x01) heads.push({ at: p, type: d[p + 7] });
    else if (d[p + 1] === 0x00) heads.push({ at: p, type: d[p + 4] });
  }
  // group headings ("Винты ГОСТ …"): an object of the same class, header "02 00 TT TT <type> 00 05 01 07" (the subtype 05 instead of 01)
  for (let p = 0; p + 12 < n; p++) {
    if (d[p] === 0x02 && d[p + 1] === 0x00 && d[p + 5] === 0 && d[p + 6] === 5 && d[p + 7] === 1 && d[p + 8] === 7 && SECTIONS[d[p + 4]] && !(d[p + 2] === 0x1d && d[p + 3] === 0x2c)) heads.push({ at: p, type: d[p + 4], heading: true });
  }
  heads.sort((a, b) => a.at - b.at);
  const objs = [];
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].at : n, cells = [];
    for (let q = h.at; q + 28 < end; q++) {
      // continuation line of the previous cell: ff ff ff ff 00 01 <len> 00 00 00 <UTF-16>  (e.g. the standard of a part: second line of the name)
      if (cells.length && cells[cells.length - 1][0] === 5 && d[q] === 0xff && d[q + 1] === 0xff && d[q + 2] === 0xff && d[q + 3] === 0xff && d[q + 4] === 0 && d[q + 5] === 1 && d[q + 7] === 0 && d[q + 8] === 0 && d[q + 9] === 0 && d[q + 6] >= 2 && q + 10 + 2 * d[q + 6] <= end) {
        const len = d[q + 6]; let t = '', ok = true;
        for (let k = 0; k < len; k++) { const c = dv.getUint16(q + 10 + 2 * k, true); if (c < 0x20 || c > 0x4ff) { ok = false; break; } t += String.fromCharCode(c); }
        if (ok && !/^[0-9a-f-]{8,}$/.test(t)) { cells[cells.length - 1][1] += String.fromCharCode(10) + t; q += 9 + 2 * len; continue; }
      }
      // 00 01 <col> 00 01 00 01 01 (01|02) 00*7 01 <len> 00 00 00 <UTF-16>   (the first cell of an object has no "ff ff ff ff" before it)
      if (d[q] !== 0 || d[q + 1] !== 1 || d[q + 3] !== 0 || d[q + 4] !== 1 || d[q + 5] !== 0 || d[q + 6] !== 1 || d[q + 7] !== 1 || (d[q + 8] !== 1 && d[q + 8] !== 2)) continue;
      let ok = true; for (let z = 9; z < 16; z++) if (d[q + z] !== 0) { ok = false; break; }
      if (!ok || d[q + 16] !== 1 || d[q + 18] !== 0 || d[q + 19] !== 0 || d[q + 20] !== 0) continue;
      const len = d[q + 17], col = d[q + 2];
      if (len < 1 || col < 1 || col > 9 || q + 21 + 2 * len > end) continue;
      const text = decodeText(d, dv, q + 21, len, { reach: 400, keepLF: false });   // special signs: see symbols.js
      cells.push([col, text]);
      q += 20 + 2 * len;
    }
    objs.push({ type: h.type, cells, heading: !!h.heading });
  });
  return objs;
}

/** One logical row from the cells of an object. Several runs of the same column are concatenated. */
function toRow(o) {
  const r = {};
  for (const [col, t] of o.cells) r[col] = (r[col] || '') + t;
  return r;
}

export function parseSpec(arrayBuffer) {
  const { meta, chunks } = openContainer(arrayBuffer);
  let big = chunks[0]; for (const c of chunks) if (c.length > big.length) big = c;
  const objs = readObjects(big);
  // the file lists every object twice (second list = copies) -> keep the first occurrence of (type, pos, designation, name)
  const seen = new Set(), items = [], headings = new Map();
  for (const o of objs) {
    const r = toRow(o);
    if (o.heading) { const t = clean(r[5]); if (t) { if (!headings.has(o.type)) headings.set(o.type, []); if (!headings.get(o.type).includes(t)) headings.get(o.type).push(t); } continue; }
    if (!Object.keys(r).length) continue;
    const key = [o.type, r[4] || '', (r[5] || '').trim()].join('|');
    if (r[4] && seen.has(key)) { const ex = items.find(i => i.key === key); for (const [c, t] of Object.entries(r)) if (!ex.row[c]) ex.row[c] = t; continue; }   // copy of an object: fill in what the first list lacks (position)
    if (!r[4] && seen.has(key + '|' + (r[3] || ''))) continue;
    seen.add(key); if (!r[4]) seen.add(key + '|' + (r[3] || '')); items.push({ type: o.type, row: r, key });
  }
  // standard items: the first list carries "name + standard" (no position), the copies carry "name " + position -> attach the full text to the entry with a position
  const full = items.filter(i => i.type === 25 && !i.row[3] && i.row[5]);
  for (const it of items) {
    if (it.type !== 25 || !it.row[3] || !it.row[5]) continue;
    const base = it.row[5].trim();
    const f = full.find(x => x.row[5].startsWith(base) && x.row[5].length > base.length);
    if (f) it.row[5] = base + '\n' + f.row[5].slice(base.length).trim();
  }
  const rows = items.filter(i => i.row[3] || i.row[4] || i.type === 5 || i.type === 20);
  // sort inside a section: by position number, then by designation
  const bySection = new Map();
  for (const it of rows.filter(i => i.row[3] || i.row[4] || i.row[5])) { if (!bySection.has(it.type)) bySection.set(it.type, []); bySection.get(it.type).push(it); }
  const num = s => parseFloat(s) || 0;
  const fmt = r => parseFloat(((r[1] || '').match(/\d/) || ['9'])[0]);
  for (const [t, list] of bySection) if (t === 5) list.sort((a, b) => fmt(a.row) - fmt(b.row) || (a.row[4] || '').localeCompare(b.row[4] || '', 'ru')); else list.sort((a, b) => num(a.row[3]) - num(b.row[3]) || (a.row[4] || '').localeCompare(b.row[4] || '', 'ru'));
  return { meta, sections: [...bySection.keys()].sort((a, b) => a - b).map(t => ({ type: t, title: SECTIONS[t] || ('Раздел ' + t), items: bySection.get(t), headings: headings.get(t) || [] })), chunks, big };
}

const clean = s => (s || '').replace(/\u0001/g, ' ').replace(/ +/g, ' ').trim();

/** Group key of a standard item (used to split a section into groups that carry their own heading "Винты ГОСТ …"): heuristic, see FORMAT.md §10. */
const shapeKey = n => { n = (n || '').trim(); return /^М\d/.test(n) ? 'thread' : /^\d/.test(n) ? 'num' : n.split(/\s+/)[0]; };

/** Layout (checked on three KOMPAS renderings): 1 blank row, then for every section: title, blank row, items; 3 blank rows between sections;
 *  inside a section with headings every group = [blank row between groups] + heading + items. */
function layout(spec) {
  const rows = [];
  let first = true;
  for (const s of spec.sections) {
    if (first) rows.push({ blank: true }); else rows.push({ blank: true }, { blank: true }, { blank: true });
    first = false;
    rows.push({ title: s.title }, { blank: true });
    let gi = -1, prev = null;
    for (const it of s.items) {
      const r = it.row, name = (s.type === 5 ? clean(r[5]).replace(/^.*?\.\s+/, '') : clean(r[5])).split('\n').map(clean), desig = clean(r[4]), note = clean(r[7]);
      if (s.headings && s.headings.length) {
        const key = shapeKey(name[0]);
        if (key !== prev) { gi++; if (gi > 0) rows.push({ blank: true }); if (s.headings[gi]) rows.push({ head: s.headings[gi] }); prev = key; }
      }
      const fm = (r[5] || '').replace(/\u0001/g, ' ').match(/^(\S+) {2,}(.+?) {2,}(.+)$/);   // fraction: "Уголок  numerator  denominator"
      if (fm) { rows.push({ frac: [clean(fm[1]), clean(fm[2]), clean(fm[3])], cells: { 1: clean(r[1]), 2: clean(r[2]), 3: clean(r[3]), 4: desig, 6: clean(r[6]), 7: note } }, { cont: true }); continue; }
      const lines = Math.max(1, name.length);
      for (let k = 0; k < lines; k++) rows.push({ cells: k === 0 ? { 1: clean(r[1]), 2: clean(r[2]), 3: clean(r[3]), 4: desig, 5: name[0] || '', 6: clean(r[6]), 7: note } : { 5: name[k] } });
    }
  }
  return rows;
}

/** Sheets: the first one holds 29 rows (form 1 title block), the next ones 32 (form 2a). */
function paginate(rows) {
  const pages = [rows.slice(0, FIRST_N)];
  for (let i = FIRST_N; i < rows.length; i += NEXT_N) pages.push(rows.slice(i, i + NEXT_N));
  return pages;
}

// roles of the records of the title-block chunk (ids of KOMPAS stamp cells): 1 name, 2 designation, 110 developer, 111 checker, 112, 114 norm control, 115 approver, 9 organisation
const STAMP_IDS = new Set([1, 2, 9, 0x6e, 0x6f, 0x70, 0x72, 0x73]);

/** Title-block texts live in a small chunk: records "01 01 01 00*7 01 <len> 00 00 00 <UTF-16>"; the role (cell id) of a record is the marker
 *  "00 <id> 80" that follows its text (the last record without a marker: the designation if it is missing, else "Перв. примен."). */
function readSpecStamp(chunks, big) {
  const cells = new Map();
  for (const d of chunks) {
    if (d === big || d.length > 3000 || d.length < 300) continue;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), recs = [];
    for (let q = 0; q + 20 < d.length; q++) {
      if (d[q] !== 1 || d[q + 1] !== 1 || d[q + 2] !== 1) continue;
      let ok = true; for (let z = 3; z < 10; z++) if (d[q + z] !== 0) { ok = false; break; }
      if (!ok || d[q + 10] !== 1 || d[q + 12] !== 0 || d[q + 13] !== 0 || d[q + 14] !== 0) continue;
      const len = d[q + 11];
      if (len < 1 || q + 15 + 2 * len > d.length) continue;
      let t = ''; for (let k = 0; k < len; k++) { const c = dv.getUint16(q + 15 + 2 * k, true); if (c >= 0x20) t += String.fromCharCode(c); else if (c === 0x0a) t += '\n'; }
      recs.push({ at: q, end: q + 15 + 2 * len, text: t.trim() });
      q += 14 + 2 * len;
    }
    if (recs.length < 2 || recs.length > 12) continue;
    recs.forEach((r, i) => {
      const lim = i + 1 < recs.length ? recs[i + 1].at : d.length;
      for (let q = r.end; q + 2 < lim; q++) if (d[q] === 0 && d[q + 2] === 0x80 && STAMP_IDS.has(d[q + 1])) { r.id = d[q + 1]; break; }
    });
    const last = recs[recs.length - 1];
    if (last.id === undefined) last.id = recs.some(r => r.id === 2) ? 'prim' : 2;
    for (const r of recs) if (r.text && r.id !== undefined && !cells.has(r.id)) cells.set(r.id, r.text);
    break;
  }
  return cells;
}

export function parseSpecification(arrayBuffer) {
  const spec = parseSpec(arrayBuffer);
  const W = 210, H = 297, GAP = 15, out = [];
  const pages = paginate(layout(spec)), total = pages.length;
  const cells = readSpecStamp(spec.chunks, spec.big);
  let oy = 0;
  const L = (x1, y1, x2, y2, thick) => out.push({ t: 'line', x1, y1: y1 + oy, x2, y2: y2 + oy, w: thick ? 1 : 0, st: thick ? 0 : 1, sheet: true });
  const label = (text, x, topY, h, rot, extra = {}) => {
    const th = rot * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    out.push({ t: 'text', x: x + 0.8 * h * s, y: topY - 0.8 * h * c + oy, ux: c, uy: s, h, text, sheet: true, align: 'left', ...extra });
  };
  const centered = (text, x0, y0, x1, y1, h) => {          // one centred line in a cell
    const hh = Math.min(h, (y1 - y0 - 1) / 1.35);
    out.push({ t: 'text', x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 0.35 * hh + oy, ux: 1, uy: 0, h: hh, text, sheet: true, align: 'center', maxw: x1 - x0 - 1 });
  };
  const headerRow = () => {
    const hdr = [['Формат', 0, 90], ['Зона', 1, 90], ['Поз.', 2, 90], ['Обозначение', 3, 0], ['Наименование', 4, 0], ['Кол.', 5, 90], ['Приме-\nчание', 6, 0]];
    for (const [text, ci, rot] of hdr) {
      const x0 = COLS[ci], x1 = COLS[ci + 1], cx = (x0 + x1) / 2, cy = 284.5;
      text.split('\n').forEach((ln, k, arr) => {
        if (rot === 90) out.push({ t: 'text', x: cx + 1.2, y: cy + oy, ux: 0, uy: 1, h: 3.5, text: ln, sheet: true, align: 'center', maxw: 14, italic: true });
        else out.push({ t: 'text', x: cx, y: cy - 1.7 + ((arr.length - 1) / 2 - k) * 4.8 + oy, ux: 1, uy: 0, h: 5, text: ln, sheet: true, align: 'center', maxw: x1 - x0 - 1 });
      });
    }
  };
  pages.forEach((prows, pi) => {
    oy = -pi * (H + GAP);
    const first = pi === 0, nrows = first ? FIRST_N : NEXT_N, bottom = first ? 45 : 20;
    // sheet edge, frame, left strips with their captions (the upper group "Справ. № / Перв. примен." only on the first sheet)
    L(0, 0, W, 0, 0); L(W, 0, W, H, 0); L(W, H, 0, H, 0); L(0, H, 0, 0, 0);
    L(20, 5, 205, 5, 1); L(205, 5, 205, 292, 1); L(205, 292, 20, 292, 1); L(20, 292, 20, 5, 1);
    for (const [x1, y1, x2, y2, w, kind] of TPL_LINES) if (kind === 'sb' || (first && kind === 'st')) L(x1, y1, x2, y2, w);
    for (const [text, x, y, h, rot, kind] of TPL_LABELS) {
      if (kind === 'sb' || (first && kind === 'st')) label(text, x, y, h, rot);
      else if (text === 'Копировал' || text === 'Формат' || text === 'A4') label(text, x, y, h, rot);
    }
    // title block
    if (first) {
      for (const l of STAMP_LINES) L(...l);
      for (const [text, x, y, h, rot] of STAMP_LABELS) label(text, x, y, h, rot);
      L(160, 20, 160, 25, 0); L(165, 20, 165, 25, 0);
      for (const [id, x0, y0, x1, y1, h, align] of STAMP_CELLS) {
        const text = cells.get(id); if (!text) continue;
        const lines = text.split('\n'), hh = Math.min(h, (y1 - y0 - 1) / (1.35 * lines.length)), pitch = 1.3 * hh;
        lines.forEach((ln, i) => {
          const off = ((lines.length - 1) / 2 - i) * pitch - 0.35 * hh;
          if (align === 'C') out.push({ t: 'text', x: (x0 + x1) / 2, y: (y0 + y1) / 2 + off + oy, ux: 1, uy: 0, h: hh, text: ln, sheet: true, align: 'center', maxw: x1 - x0 - 1 });
          else out.push({ t: 'text', x: x0 + 0.5, y: y1 - 0.82 - 0.8 * hh - i * pitch + oy, ux: 1, uy: 0, h: hh, text: ln, sheet: true, align: 'left', maxw: x1 - x0 - 1 });
        });
      }
      if (cells.get('prim')) label(cells.get('prim'), 14.2, 251.3, 4.2, 90);
      if (total > 1) centered('1', 170, 20, 185, 25, 5);
      centered(String(total), 185, 20, 205, 25, 5);
    } else {
      // form 2a: 185 × 15 mm
      L(20, 20, 205, 20, 1); L(20, 15, 85, 15, 0); L(20, 10, 85, 10, 1); L(195, 13, 205, 13, 1);
      for (const x of [27, 37, 60, 75, 85, 195]) L(x, 5, x, 20, 1);
      for (const [text, x] of [['Изм.', 20.62], ['Лист', 27.61], ['№ докум.', 40.63], ['Подп.', 63.1], ['Дата', 75.61]]) label(text, x, 9.18, 3.5, 0);
      label('Лист', 196.2, 18.9, 3.5, 0);
      if (cells.get(2)) centered(cells.get(2), 85, 5, 195, 20, 9);
      centered(String(pi + 1), 195, 5, 205, 13, 5);
    }
    // table grid
    L(20, ROW0, 205, ROW0, 1);
    for (const x of COLS) L(x, bottom, x, 292, 1);
    L(20, 292, 205, 292, 1);
    for (let i = 1; i < nrows; i++) L(20, ROW0 - ROW_H * i, 205, ROW0 - ROW_H * i, 0);
    headerRow();
    // body
    prows.forEach((r, i) => {
      const top = ROW0 - ROW_H * i, base = top - ROW_H + 2.1;
      if (r.title) out.push({ t: 'text', x: (COLS[4] + COLS[5]) / 2, y: base + oy, ux: 1, uy: 0, h: 5, text: r.title, sheet: true, align: 'center', underline: true, maxw: COLS[5] - COLS[4] - 2 });
      else if (r.head) out.push({ t: 'text', x: COLS[4] + 1, y: base + oy, ux: 1, uy: 0, h: 5, text: r.head, sheet: true, align: 'left', maxw: COLS[5] - COLS[4] - 1.5 });
      else if (r.cells) {
        if (r.frac) {                         // two rows: the prefix at the bar, numerator above, denominator below
          const [pre, num, den] = r.frac, x0 = COLS[4], bar = top - ROW_H, cx = x0 + 37.5;
          out.push({ t: 'text', x: x0 + 1, y: bar - 1.2 + oy, ux: 1, uy: 0, h: 3.5, text: pre, sheet: true, align: 'left', maxw: 14 });
          out.push({ t: 'text', x: cx, y: bar + 2.2 + oy, ux: 1, uy: 0, h: 4, text: num, sheet: true, align: 'center', maxw: 47 });
          out.push({ t: 'text', x: cx, y: bar - 5.8 + oy, ux: 1, uy: 0, h: 4, text: den, sheet: true, align: 'center', maxw: 47 });
          L(cx - 23.5, bar, cx + 23.5, bar, 0);
        }
        for (const [c, text] of Object.entries(r.cells)) {
        if (!text) continue;
        const ci = c - 1, al = COL_ALIGN[ci], x0 = COLS[ci], x1 = COLS[ci + 1];
        out.push({ t: 'text', x: al === 'C' ? (x0 + x1) / 2 : x0 + 1, y: base + oy, ux: 1, uy: 0, h: ci === 0 || ci === 1 ? 3.5 : 5, text, sheet: true, align: al === 'C' ? 'center' : 'left', maxw: x1 - x0 - 1.5 });
        }
      }
    });
  });
  const minY = -(total - 1) * (H + GAP);
  return { meta: spec.meta, entities: out, sheet: { W, H, stamp: true, cells: cells.size, pages: total }, bbox: { min: [0, minY], max: [W, H] }, stats: { lines: out.filter(e => e.t === 'line').length, ellipses: 0, texts: out.filter(e => e.t === 'text').length, dimensions: 0, views: 0, unique: out.length, sections: spec.sections.length, rows: spec.sections.reduce((a, s) => a + s.items.length, 0), pages: total }, spec };
}
