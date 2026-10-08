// symbols.js — special signs inside KOMPAS texts (see FORMAT.md §10.2).
// The text holds two placeholders (U+0001) per sign; the run table after the text ("02 00 TT TT <index u16> <code u16> 00") names it:
// code low byte 0x16 at the first placeholder, 0x17 at the second, high byte (shared by the pair) = the sign.

/** high byte of the code -> character (checked against DXF exported by KOMPAS itself, see FORMAT.md). conf: V verified, C from the context only. */
export const SYMBOLS = {
  0x01: '°',   // V degree
  0x02: '⌀',   // V diameter
  0x03: '±',   // V plus-minus
  0x04: '×',   // V multiplication sign
  0x33: 'α',   // V alpha
  0x34: 'β',   // V beta
  0x35: 'γ',   // V gamma
  0x3b: 'τ',   // V tau
  0x1e: 'Ⓜ',   // V circled M (glyph U+F03B of GOST_AU)
  0x3f: '↻',   // V "turned" sign after a section title (glyph U+F03E: circle with an arrow)
  0x28: '▭',   // V rectangle (glyph U+F047)
  0x29: 'I',        // V roman numeral I (glyph U+F00B)
  0x2a: 'II',       // V roman numeral II (glyph U+F00C)
  0x22: 'II',       // C roman numeral II (glyph U+F00C), by elimination in 12020.cdw
  0x65: '※',   // C reference mark (glyph U+F000), after the thread tolerance "-7H"
  0x64: '*',        // V asterisk (footnote mark)
  0xab: '√',   // C check mark of roughness "6,3 (√)"
  0x0c: '◁',   // C taper sign before "1:10" (drawn as lines by KOMPAS)
  0x0d: '∠',   // C slope sign before "1:19.922"
  0x6f: '₁',   // C subscript 1 in "z1=15"
  0x70: '₂',   // C subscript 2 in "z2=60"
};
const UNKNOWN = '□';

/** Decode `len` UTF-16 code units at d[s]. The run table is searched in d[s+2*len, s+2*len+reach). Codes < 0x20 other than the signs are dropped
 *  (keepLF keeps 10 and 13). */
export function decodeText(d, dv, s, len, { reach = 260, keepLF = true, stamp = false } = {}) {
  const chars = [];
  for (let i = 0; i < len; i++) chars.push(dv.getUint16(s + 2 * i, true));
  const starts = new Map(), end = Math.min(d.length, s + 2 * len + reach);
  if (chars.includes(1)) for (let x = s + 2 * len; x + 9 <= end; x++) {
    if (d[x] === 2 && d[x + 1] === 0 && d[x + 5] === 0 && d[x + 8] === 0 && (d[x + 6] === 0x16 || d[x + 6] === 0x17) && d[x + 4] < len && chars[d[x + 4]] === 1) starts.set(d[x + 4], [d[x + 6], d[x + 7]]);
  }
  let text = '';
  for (let k = 0; k < len; k++) {
    const a = starts.get(k), b = starts.get(k + 1);
    if (a && b && a[0] === 0x16 && b[0] === 0x17 && a[1] === b[1]) { text += SYMBOLS[a[1]] || UNKNOWN; k++; continue; }
    const c = chars[k];
    if (stamp) { if (c === 2 || c === 10) { text += String.fromCharCode(10); continue; } if (c === 1) { text += ' '; continue; } }
    if (c >= 0x20 || (keepLF && (c === 10 || c === 13))) text += String.fromCharCode(c);
  }
  return text;
}
