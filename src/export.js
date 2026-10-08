// export.js — STL (binary, one or several bodies), a minimal ZIP writer, DXF (R12, ASCII, cp1251) and SVG for printing.

// ---- STL ------------------------------------------------------------------------------------------------------------------------------
/** Binary STL of one or several meshes ({positions: Float32Array xyz, indices}); coordinates stay in KOMPAS space (Z up, mm). */
export function stlBinary(meshes) {
  let nt = 0; for (const p of meshes) nt += p.indices.length / 3;
  const out = new DataView(new ArrayBuffer(84 + 50 * nt));
  new TextEncoder().encodeInto('KOMPAS-3D viewer binary STL (mm)', new Uint8Array(out.buffer, 0, 80));
  out.setUint32(80, nt, true);
  let o = 84;
  for (const p of meshes) {
    const P = p.positions, I = p.indices;
    for (let t = 0; t < I.length; t += 3, o += 50) {
      const v = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
      const a = [P[v[0]], P[v[0] + 1], P[v[0] + 2]], b = [P[v[1]], P[v[1] + 1], P[v[1] + 2]], c = [P[v[2]], P[v[2] + 1], P[v[2] + 2]];
      const u = b.map((x, k) => x - a[k]), w = c.map((x, k) => x - a[k]);
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n) || 1;
      [n[0] / l, n[1] / l, n[2] / l, ...a, ...b, ...c].forEach((x, k) => out.setFloat32(o + 4 * k, x, true));
    }
  }
  return new Uint8Array(out.buffer);
}

// ---- ZIP (stored, no compression) -----------------------------------------------------------------------------------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** files: [{ name, data: Uint8Array }] -> Uint8Array of a .zip (UTF-8 names). */
export function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, x) => a + x.length, 0)); let p = 0;
  for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}

// ---- line styles (KOMPAS style code -> width in mm and dash pattern in mm) ------------------------------------------------------------
export const STY = { 0: [0.6, null], 1: [0.18, null], 2: [0.18, [14.4, 1.5, 1.5, 1.5]], 3: [0.18, [4, 2]], 4: [1.0, null], 5: [0.18, [4, 2, 1, 2, 1, 2]], 6: [0.6, [8, 2, 1, 2]], 7: [0.6, [4, 2]], 8: [0.18, null], 9: [0.18, null] };
const styOf = e => STY[e.st] ? e.st : 0;

/** Ellipse / arc as points (the same sampling as the screen renderer). */
function ellipsePoints(e) {
  const n = Math.max(24, Math.min(256, Math.ceil(Math.abs(e.t1 - e.t0) / (2 * Math.PI) * 128))), pts = [];
  for (let i = 0; i <= n; i++) {
    const a = e.t0 + (e.t1 - e.t0) * i / n, c = Math.cos(a) * e.a, s = Math.sin(a) * e.b;
    pts.push([e.cx + c * e.ux + s * e.vx, e.cy + c * e.uy + s * e.vy]);
  }
  return pts;
}
const textLines = e => e.text.split(/\r\n|\r|\n/);

// ---- DXF R12 ----------------------------------------------------------------------------------------------------------------------------
const CP1251 = (() => {
  const m = new Map(); for (let i = 0; i < 64; i++) m.set(0x410 + i, 0xc0 + i);
  m.set(0x401, 0xa8); m.set(0x451, 0xb8); m.set(0xb0, 0xb0); m.set(0xb1, 0xb1); m.set(0xb7, 0xb7); m.set(0x2116, 0xb9); m.set(0xa7, 0xa7); m.set(0xa9, 0xa9); m.set(0xae, 0xae); m.set(0xb5, 0xb5);
  return m;
})();
/** Text for a DXF string group: cp1251 bytes where possible, %%c / %%d / %%p codes and \U+XXXX escapes for the rest. Returns a latin1-style string of bytes. */
function dxfText(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 0x2300 || c === 0x2205 || c === 0xd8) out += '%%c';
    else if (c === 0xb0) out += '%%d';
    else if (c === 0xb1) out += '%%p';
    else if (c < 0x80) out += ch;
    else if (CP1251.has(c)) out += String.fromCharCode(CP1251.get(c));
    else out += '\\U+' + c.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}
const LTYPES = { 0: 'CONTINUOUS', 1: 'CONTINUOUS', 2: 'CENTER', 3: 'DASHED', 4: 'CONTINUOUS', 5: 'PHANTOM', 6: 'DASHDOT', 7: 'DASHED', 8: 'CONTINUOUS', 9: 'CONTINUOUS' };
const LNAMES = { 0: 'MAIN', 1: 'THIN', 2: 'AXIS', 3: 'DASH', 4: 'THICK', 5: 'PHANTOM', 6: 'DASHDOT', 7: 'DASH2', 8: 'WAVE', 9: 'BREAK' };

/** Drawing / specification -> DXF R12 text as a Uint8Array (cp1251). Lines and arcs keep their width as polyline width. */
export function dxf(d) {
  const g = [];
  const G = (code, v) => g.push(String(code), typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(5)) : v);
  const used = new Set(); for (const e of d.entities) if (e.t === 'line' || e.t === 'ellipse') used.add(styOf(e));
  used.add(0);
  G(0, 'SECTION'); G(2, 'HEADER'); G(9, '$ACADVER'); G(1, 'AC1009'); G(9, '$DWGCODEPAGE'); G(3, 'ANSI_1251'); G(9, '$INSUNITS'); G(70, 4); G(0, 'ENDSEC');
  G(0, 'SECTION'); G(2, 'TABLES');
  G(0, 'TABLE'); G(2, 'LTYPE'); G(70, 6);
  const pat = { CONTINUOUS: ['Solid line', []], CENTER: ['Center', [14.4, 1.5, 1.5, 1.5]], DASHED: ['Dashed', [4, 2]], PHANTOM: ['Phantom', [4, 2, 1, 2, 1, 2]], DASHDOT: ['Dash dot', [8, 2, 1, 2]] };
  for (const [name, [desc, dash]] of Object.entries(pat)) {
    G(0, 'LTYPE'); G(2, name); G(70, 0); G(3, desc); G(72, 65); G(73, dash.length); G(40, dash.reduce((a, x) => a + x, 0));
    dash.forEach((x, i) => G(49, i % 2 ? -x : x));
  }
  G(0, 'ENDTAB');
  G(0, 'TABLE'); G(2, 'LAYER'); G(70, used.size + 1);
  G(0, 'LAYER'); G(2, 'TEXT'); G(70, 0); G(62, 7); G(6, 'CONTINUOUS');
  for (const k of used) { G(0, 'LAYER'); G(2, LNAMES[k]); G(70, 0); G(62, 7); G(6, LTYPES[k]); }
  G(0, 'ENDTAB');
  G(0, 'TABLE'); G(2, 'STYLE'); G(70, 2);
  G(0, 'STYLE'); G(2, 'STANDARD'); G(70, 0); G(40, 0); G(41, 1); G(50, 0); G(71, 0); G(42, 3.5); G(3, 'txt'); G(4, '');
  G(0, 'STYLE'); G(2, 'ITALIC'); G(70, 0); G(40, 0); G(41, 1); G(50, 15); G(71, 0); G(42, 3.5); G(3, 'txt'); G(4, '');
  G(0, 'ENDTAB');
  G(0, 'ENDSEC');
  G(0, 'SECTION'); G(2, 'ENTITIES');
  const poly = (pts, st, closed = false) => {
    const w = STY[st][0];
    G(0, 'POLYLINE'); G(8, LNAMES[st]); G(6, 'BYLAYER'); G(66, 1); G(10, 0); G(20, 0); G(30, 0); G(40, w); G(41, w); G(70, closed ? 1 : 0);
    for (const [x, y] of pts) { G(0, 'VERTEX'); G(8, LNAMES[st]); G(10, x); G(20, y); G(30, 0); }
    G(0, 'SEQEND'); G(8, LNAMES[st]);
  };
  for (const e of d.entities) {
    if (e.t === 'line') poly([[e.x1, e.y1], [e.x2, e.y2]], styOf(e));
    else if (e.t === 'ellipse') poly(ellipsePoints(e), styOf(e));
    else if (e.t === 'text') {
      const ang = Math.atan2(e.uy, e.ux) * 180 / Math.PI, vx = -e.uy, vy = e.ux, italic = e.sheet || e.italic;
      textLines(e).forEach((ln, i) => {
        if (!ln.trim()) return;
        const x = e.x - vx * i * e.h * 1.3, y = e.y - vy * i * e.h * 1.3;
        G(0, 'TEXT'); G(8, 'TEXT'); G(7, italic ? 'ITALIC' : 'STANDARD'); G(10, x); G(20, y); G(30, 0); G(40, e.h); G(1, dxfText(ln));
        if (ang) G(50, ang);
        if (e.align === 'center') { G(72, 1); G(11, x); G(21, y); G(31, 0); }
      });
    }
  }
  G(0, 'ENDSEC'); G(0, 'EOF');
  const s = g.join('\r\n') + '\r\n', out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;      // dxfText() already produced cp1251 bytes as code units < 256
  return out;
}

// ---- SVG pages for printing ---------------------------------------------------------------------------------------------------------------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Page rectangles of a drawing in drawing coordinates: the sheets of a multi-sheet specification, else the sheet / the bounding box. */
export function pageBoxes(d) {
  const sh = d.sheet;
  if (sh && sh.pages > 1) return Array.from({ length: sh.pages }, (_, k) => [0, -k * (sh.H + 15), sh.W, sh.H - k * (sh.H + 15)]);
  const b = d.bbox; if (!b) return [];
  const m = sh ? 0 : Math.max(5, 0.03 * Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]));
  return [[b.min[0] - m, b.min[1] - m, b.max[0] + m, b.max[1] + m]];
}
/** One SVG per page: black on white, units = mm, font widths adjusted with `measure(text, h, italic)` when maxw is set. */
export function svgPages(d, measure) {
  return pageBoxes(d).map(([x0, y0, x1, y1]) => {
    const w = x1 - x0, h = y1 - y0, X = x => (x - x0).toFixed(3), Y = y => (y1 - y).toFixed(3);
    const sw = {}, parts = [];
    for (const e of d.entities) {
      if (e.t === 'line') {
        const st = styOf(e), dash = STY[st][1];
        parts.push(`<line x1="${X(e.x1)}" y1="${Y(e.y1)}" x2="${X(e.x2)}" y2="${Y(e.y2)}" stroke-width="${STY[st][0]}"${dash ? ` stroke-dasharray="${dash.join(' ')}"` : ''}/>`);
      } else if (e.t === 'ellipse') {
        const st = styOf(e), dash = STY[st][1];
        parts.push(`<polyline points="${ellipsePoints(e).map(([x, y]) => X(x) + ',' + Y(y)).join(' ')}" fill="none" stroke-width="${STY[st][0]}"${dash ? ` stroke-dasharray="${dash.join(' ')}"` : ''}/>`);
      } else if (e.t === 'text') {
        const ang = -Math.atan2(e.uy, e.ux) * 180 / Math.PI, italic = e.sheet || e.italic;
        textLines(e).forEach((ln, i) => {
          if (!ln.trim()) return;
          let extra = '';
          if (e.maxw && measure) { const nw = measure(ln, e.h, italic); if (nw > e.maxw) extra = ` textLength="${e.maxw.toFixed(2)}" lengthAdjust="spacingAndGlyphs"`; }
          const cx = e.x - (-e.uy) * i * e.h * 1.3, cy = e.y - e.ux * i * e.h * 1.3;
          parts.push(`<text transform="translate(${X(cx)},${Y(cy)}) rotate(${ang.toFixed(2)})" font-size="${e.h}"${italic ? ' font-style="italic"' : ''}${e.align === 'center' ? ' text-anchor="middle"' : ''}${e.underline ? ' text-decoration="underline"' : ''}${extra} stroke="none" fill="#000">${esc(ln)}</text>`);
        });
      }
    }
    return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}" stroke="#000" stroke-linecap="butt" font-family="Arial, sans-serif">${parts.join('')}</svg>` };
  });
}
