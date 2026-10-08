import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { parseM3D, loadAssembly } from '../m3d.js';
import { parseDrawing } from '../drawing.js';
import { parseSpecification } from '../spec.js';
import { stlBinary, zip, dxf, svgPages, STY } from './export.js';
import { t, getLang, setLang, applyStatic, SAMPLE_NAMES } from './i18n.js';

const $ = id => document.getElementById(id);
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
const dark = !matchMedia('(prefers-color-scheme: light)').matches;
scene.background = new THREE.Color(dark ? 0x1e2227 : 0xeef1f4);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.1));
const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(1, 2, 1.5); scene.add(dl);
const dl2 = new THREE.DirectionalLight(0xffffff, 0.5); dl2.position.set(-1, -1, -1); scene.add(dl2);

// KOMPAS file coordinates are Z-up; three.js is Y-up. Rotate the whole model group by -90° about X.
const root = new THREE.Group(); root.rotation.x = -Math.PI / 2; scene.add(root);
const palette = [0x6ea8d8, 0xe0a458, 0x7bc47f, 0xc77dba, 0xd9645a, 0x58b8c4];
let current = null, curName = '', mode2d = false;

// ---- 2D drawings (.cdw / .frw) on a plain canvas ----
const c2d = document.createElement('canvas');
c2d.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;cursor:grab';
view.prepend(c2d);
const ctx2 = c2d.getContext('2d');
let drw = null, T2 = { s: 1, x: 0, y: 0 };
function redraw2d() {
  if (!drw) return;
  const w = c2d.width = view.clientWidth * devicePixelRatio, h = c2d.height = view.clientHeight * devicePixelRatio, k = devicePixelRatio;
  ctx2.setTransform(1, 0, 0, 1, 0, 0);
  ctx2.fillStyle = dark ? '#1e2227' : '#eef1f4'; ctx2.fillRect(0, 0, w, h);
  const X = x => (T2.x + x * T2.s) * k, Y = y => (T2.y - y * T2.s) * k, k_ = k;
  ctx2.strokeStyle = dark ? '#e6eaee' : '#1d2329'; ctx2.fillStyle = ctx2.strokeStyle; ctx2.lineWidth = Math.max(1, 1.2 * k);
  const groups = new Map();
  for (const e of drw.entities) if (e.t === 'line' || e.t === 'ellipse') { const k = STY[e.st] ? e.st : 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  for (const [k, list] of groups) {
    const [wmm, dash] = STY[k];
    ctx2.lineWidth = Math.max(1, wmm * T2.s * k_ ); ctx2.setLineDash(dash ? dash.map(x => Math.max(1, x * T2.s * k_)) : []); ctx2.beginPath();
    for (const e of list) {
      if (e.t === 'line') { ctx2.moveTo(X(e.x1), Y(e.y1)); ctx2.lineTo(X(e.x2), Y(e.y2)); }
      else {
        const n = Math.max(24, Math.min(256, Math.ceil(Math.abs(e.t1 - e.t0) / (2 * Math.PI) * 128)));
        for (let i = 0; i <= n; i++) {
          const a = e.t0 + (e.t1 - e.t0) * i / n, c = Math.cos(a) * e.a, s = Math.sin(a) * e.b;
          const px = X(e.cx + c * e.ux + s * e.vx), py = Y(e.cy + c * e.uy + s * e.vy);
          if (i) ctx2.lineTo(px, py); else ctx2.moveTo(px, py);
        }
      }
    }
    ctx2.stroke();
  }
  ctx2.setLineDash([]);
  for (const e of drw.entities) if (e.t === 'text') {
    ctx2.save(); ctx2.translate(X(e.x), Y(e.y)); ctx2.rotate(-Math.atan2(e.uy, e.ux));
    ctx2.font = (e.sheet || e.italic ? 'italic ' : '') + Math.max(4, e.h * T2.s * k) + 'px sans-serif'; ctx2.textBaseline = 'alphabetic';
    ctx2.textAlign = e.align === 'center' ? 'center' : 'left';
    const mw = e.maxw ? e.maxw * T2.s * k : undefined;
    for (const [i, line] of e.text.split(/\r\n|\r|\n/).entries()) { ctx2.fillText(line, 0, i * e.h * 1.3 * T2.s * k, mw); if (e.underline) { const w = Math.min(ctx2.measureText(line).width, mw || 1e9), x0 = e.align === 'center' ? -w / 2 : 0, yy = i * e.h * 1.3 * T2.s * k + 0.9 * T2.s * k; ctx2.beginPath(); ctx2.lineWidth = Math.max(1, 0.18 * T2.s * k); ctx2.moveTo(x0, yy); ctx2.lineTo(x0 + w, yy); ctx2.stroke(); } }
    ctx2.restore();
  }
}
function fit2d() {
  const b = drw && drw.bbox; if (!b) return;
  const w = view.clientWidth, h = view.clientHeight, bw = Math.max(b.max[0] - b.min[0], 1e-6), bh = Math.max(b.max[1] - b.min[1], 1e-6);
  T2.s = Math.min(w / bw, h / bh) * 0.85;
  T2.x = w / 2 - (b.min[0] + bw / 2) * T2.s; T2.y = h / 2 + (b.min[1] + bh / 2) * T2.s;
  redraw2d();
}
c2d.addEventListener('wheel', e => {
  e.preventDefault();
  const r = c2d.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
  T2.x = mx - (mx - T2.x) * f; T2.y = my - (my - T2.y) * f; T2.s *= f; redraw2d();
}, { passive: false });
let drag = null;
c2d.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY, T2.x, T2.y]; c2d.setPointerCapture(e.pointerId); c2d.style.cursor = 'grabbing'; });
c2d.addEventListener('pointermove', e => { if (drag) { T2.x = drag[2] + e.clientX - drag[0]; T2.y = drag[3] + e.clientY - drag[1]; redraw2d(); } });
c2d.addEventListener('pointerup', () => { drag = null; c2d.style.cursor = 'grab'; });
function setMode(m2d) { mode2d = m2d; $('msg').textContent = t(m2d ? 'msg2d' : 'msg'); $('exp3d').style.display = m2d ? 'none' : ''; $('exp2d').style.display = m2d ? '' : 'none'; c2d.style.display = m2d ? 'block' : 'none'; renderer.domElement.style.display = m2d ? 'none' : 'block'; }
setMode(false);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); redraw2d();
}
new ResizeObserver(resize).observe(view); resize();
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();

function fit() {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z) * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.min(1, camera.aspect) * 1.35;     // narrow (portrait) views are limited by the horizontal field of view
  camera.position.copy(c).add(new THREE.Vector3(1, 0.8, 1.1).normalize().multiplyScalar(r));
  camera.near = r / 200; camera.far = r * 50; camera.updateProjectionMatrix();
  controls.target.copy(c); controls.update();
}

let lastErr = null;
function setErr(k, a) { lastErr = k ? [k, a] : null; $('err').textContent = k ? t(k, a) : ''; }
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const f = (v, n = 2) => Number(v).toFixed(n);

function show(model, keep) {
  setMode(false); drw = null;
  const flags = keep ? root.children.map(g => g.visible) : null;
  root.clear(); current = model; if (!keep) setErr(null);
  const m = model.meta;
  $('meta').innerHTML = row(t('app'), m.AppName || '—') + row(t('version'), m.AppFullVersion || m.AppVersion || '—') + row(t('type'), m.FileTypeName || '—') + row(t('streams'), model.chunks ?? '—') + (model.kind === 'assembly' ? row(t('assembly'), t('inst', { n: model.components.length })) : '');
  const tt = model.total;
  $('dims').innerHTML = tt ? row('X × Y × Z', tt.size.map(v => f(v)).join(' × ')) + row(t('volume'), f(tt.volume / 1000) + ' ' + t('cm3')) + row(t('area'), f(tt.area / 100, 1) + ' ' + t('cm2')) : row('', t('no_geom'));
  $('parts').innerHTML = '';
  model.parts.forEach((p, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    g.setIndex(new THREE.BufferAttribute(p.indices, 1));
    g.computeVertexNormals();
    const color = palette[i % palette.length];
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: .6, metalness: .05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: dark ? 0x0d1014 : 0x2a323c }));
    const grp = new THREE.Group(); grp.add(mesh, edges); grp.userData = { mesh, edges }; root.add(grp);
    const el = document.createElement('div'); el.className = 'part';
    el.innerHTML = `<span class="sw" style="background:#${color.toString(16).padStart(6, '0')}"></span><div><label><input type="checkbox" checked> ${p.name ? p.name.replace(/^item|\.m3d$/gi, '') : t('body', { n: i + 1 })}</label><br><span style="color:var(--muted)">${p.size.map(v => f(v, 1)).join(' × ')} ${t('mm')} · ${p.triangles} ${t('tri')} · ${f(p.volume / 1000)} ${t('cm3')}</span></div>`;
    if (flags && flags[i] === false) { grp.visible = false; el.querySelector('input').checked = false; }
    el.querySelector('input').onchange = e => { grp.visible = e.target.checked; };
    $('parts').append(el);
  });
  applyView(); if (!keep) fit();
}
function applyView() {
  root.children.forEach(g => { g.userData.edges.visible = $('edges').checked; g.userData.mesh.material.wireframe = $('wire').checked; });
}
$('edges').onchange = $('wire').onchange = applyView;
$('fit').onclick = () => { if (drw) fit2d(); else fit(); };

const base = n => n.split(/[\\/]/).pop().toLowerCase();
// tolerant name matching: Unicode-normalised, Cyrillic look-alikes folded to Latin, and suffix match
// (files get renamed after the assembly is saved, e.g. 'project-case-top.m3d' -> 'case-top.m3d')
const fold = n => base(n).normalize('NFC').replace(/[с]/g, 'c').replace(/[а]/g, 'a').replace(/[о]/g, 'o').replace(/[е]/g, 'e').replace(/[р]/g, 'p').replace(/[х]/g, 'x');
function makeResolver(files) {
  const exact = new Map(files.map(f => [base(f.name), f.buf]));
  const folded = files.map(f => [fold(f.name), f.buf]);
  return n => {
    if (exact.has(base(n))) return exact.get(base(n));
    const k = fold(n);
    const hit = folded.find(([fn]) => fn === k) || folded.find(([fn]) => k.endsWith(fn) || fn.endsWith(k));
    return hit ? hit[1] : null;
  };
}
function show2D(d, name, keep) {
  root.clear(); current = null; if (!keep) setErr(null); drw = d; setMode(true);
  const m = d.meta, s = d.stats, b = d.bbox;
  $('meta').innerHTML = row(t('app'), m.AppName || '—') + row(t('version'), m.AppFullVersion || m.AppVersion || '—') + row(t('type'), m.FileTypeName || '—') + row(t('views'), s.views);
  $('dims').innerHTML = b ? row(t('width'), f(b.max[0] - b.min[0]) + ' ' + t('mm')) + row(t('height'), f(b.max[1] - b.min[1]) + ' ' + t('mm')) + row(t('lines'), s.lines) + row(t('arcs'), s.ellipses) + row(t('texts'), s.texts) + row(t('dimensions'), s.dimensions) : row('', t('no_geom'));
  $('parts').innerHTML = '<div style="color:var(--muted)">' + t('drawing_info', { n: d.entities.length }) + '</div>';
  if (keep) redraw2d(); else fit2d();
}
async function load(files) {
  // files: [{ name, buf }] — a single part, or an assembly (.a3d) together with its parts
  try {
    const main = files.find(f => /\.a3d$/i.test(f.name)) || files.find(f => /\.m3d$/i.test(f.name)) || files[0];
    curName = main.name;
    if (/\.spw$/i.test(main.name)) { show2D(parseSpecification(main.buf), main.name); document.title = 'KOMPAS-3D viewer — ' + main.name; return; }
    if (/\.(cdw|frw)$/i.test(main.name)) { show2D(parseDrawing(main.buf), main.name); document.title = 'KOMPAS-3D viewer — ' + main.name; return; }
    let model;
    if (/\.a3d$/i.test(main.name)) {
      model = await loadAssembly(main.buf, makeResolver(files));
    } else model = parseM3D(main.buf);
    show(model);
    document.title = 'KOMPAS-3D viewer — ' + main.name;
    if (model.missing && model.missing.length) setErr('missing', { list: model.missing.join(', ') });
  } catch (e) { console.error(e); setErr('open_fail', { e: e.message }); }
}
const readFiles = async list => load(await Promise.all([...list].map(async f => ({ name: f.name, buf: await f.arrayBuffer() }))));
$('file').onchange = e => { if (e.target.files.length) readFiles(e.target.files); };

const SAMPLES = [
  ['Корпус Orange Pi Zero 3 (деталь)', '', ['sample.m3d']],
  ['Поплавок (сборка, 2 детали)', 'samples/beer_float/', ['assemblyBeerFloat.a3d', 'itemBeerFloatBottom.m3d', 'itemBeerFloatTop.m3d']],
  ['Плашка M2 (сборка, 7 экз.)', 'samples/die_m2/', ['assemblyBodyOfDieForThreadingM2.a3d', 'itemBodyOfDieForThreadingM2-1.m3d', 'itemBodyOfDieForThreadingM2-2.m3d', 'itemBodyOfDieForThreadingM2-3.m3d', 'itemNutM3.m3d', 'itemSemicircularHeadScrewM3X8.m3d']],
  ['Дверь принтера (сборка, 12 планок)', 'samples/printer_door/', ['assembly3dPrinterDoor.a3d', 'item3dPrinterDoorPlankV2.m3d']],
  ['Болт и гайка (старый формат, экспериментально)', 'samples/legacy_bolt_nut/', ['Сборка.Д.a3d', 'болт.Д.m3d', 'гайка.Д.m3d']],
  ['Чертёж-фрагмент (.frw): линии, окружность, текст, размер', 'samples/drawings/', ['frag1.frw']],
  ['Чертёж (.cdw)', 'samples/drawings/', ['draw1.cdw']],
  ['Реальный чертёж Калибровочный фланец (.cdw, частично)', 'samples/drawings/', ['derm1.cdw']],
  ['Схема электрическая A1 (.cdw, формат КОМПАС v14)', 'samples/drawings/', ['schematic_a1.cdw']],
  ['Стили линий (.frw): основная, тонкая, осевая, штриховая…', 'samples/drawings/', ['styles.frw']],
  ['Спецификация «Фильтр», 2 листа (.spw)', 'samples/spw/', ['spec1.spw']],
  ['Спецификация «Кронштейн» (.spw)', 'samples/spw/', ['spec2.spw']],
  ['Спецификация «Ролик в сборе» (.spw)', 'samples/spw/', ['spec3.spw']],
  ['Корпус принтера (сборка, 24 экз.)', 'samples/casing/', ['assembly3dPrinterCasing.a3d', 'item3dPrinterCasingBlock1.m3d', 'item3dPrinterCasingDVP1.m3d', 'item3dPrinterCasingPipe1.m3d', 'item3dPrinterCasingPipe2.m3d']],
  ['Крышка термобокса (сборка, 40 экз., 98 тыс. треуг.)', 'samples/termobox_top/', ['assembly3dPrinterTermoboxTopV2.a3d', 'item3dPrinterTermoboxCornerV2.2.m3d', 'item3dPrinterTermoboxPlankV2.m3d', 'item3dPrinterTermoboxPlankV2_2.2.m3d', 'item3dPrinterTermoboxPlankV2_2.m3d']],
];
const EMB = window.__M3D_SAMPLES || {};     // samples embedded by tools/build.mjs; the ones that are not present are not offered
function fillSamples() {
  const keep = $('sample').value;
  $('sample').innerHTML = '';
  SAMPLES.forEach(([label, dir, names], i) => { if (!names.every(n => EMB[dir + n])) return; $('sample').add(new Option(t('example') + (getLang() === 'en' && SAMPLE_NAMES.en[i] ? SAMPLE_NAMES.en[i] : label), i)); });
  if (keep !== '') $('sample').value = keep;
}
fillSamples();
const b64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
async function getSample(path) {
  const emb = window.__M3D_SAMPLES && window.__M3D_SAMPLES[path];
  if (emb) return b64(emb);
  return await (await fetch(path)).arrayBuffer();
}
async function loadSample(i) {
  const [, dir, names] = SAMPLES[i];
  try { load(await Promise.all(names.map(async n => ({ name: n, buf: await getSample(dir + n) })))); }
  catch (e) { setErr('sample_fail', { e: e.message }); }
}
$('sample').onchange = () => loadSample(+$('sample').value);
addEventListener('dragover', e => { e.preventDefault(); $('drop').style.display = 'flex'; });
addEventListener('dragleave', e => { if (!e.relatedTarget) $('drop').style.display = 'none'; });
addEventListener('drop', e => { e.preventDefault(); $('drop').style.display = 'none'; if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files); });

// ---- export ----
const stem = () => (curName || 'model').replace(/\.[^.]+$/, '');
const safe = n => String(n).replace(/[\/:*?"<>|]+/g, '_').trim() || 'body';
function download(data, name, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function exportParts() {                      // [{ name, mesh }] for the bodies to export
  if (!current) return [];
  const only = $('onlyVis').checked;
  return current.parts.map((p, i) => ({ p, i, on: !root.children[i] || root.children[i].visible })).filter(x => !only || x.on)
    .map(({ p, i }) => ({ name: safe(p.name ? p.name.replace(/^item|\.m3d$/gi, '') : 'body' + (i + 1)), mesh: p }));
}
$('stlAll').onclick = () => {
  const list = exportParts(); if (!list.length) { setErr('no_bodies'); return; }
  download(stlBinary(list.map(x => x.mesh)), stem() + '.stl', 'model/stl');
};
$('stlSep').onclick = () => {
  const list = exportParts(); if (!list.length) { setErr('no_bodies'); return; }
  if (list.length === 1) { download(stlBinary([list[0].mesh]), list[0].name + '.stl', 'model/stl'); return; }
  const used = new Map();
  const files = list.map((x, i) => { const n = used.get(x.name) || 0; used.set(x.name, n + 1); return { name: `${String(i + 1).padStart(2, '0')}_${x.name}${n ? '_' + (n + 1) : ''}.stl`, data: stlBinary([x.mesh]) }; });
  download(zip(files), stem() + '_stl.zip', 'application/zip');
};
$('dxf').onclick = () => { if (drw) download(dxf(drw), stem() + '.dxf', 'application/dxf'); };
$('print').onclick = () => {
  if (!drw) return;
  const mctx = document.createElement('canvas').getContext('2d');
  const pages = svgPages(drw, (t, h, it) => { mctx.font = (it ? 'italic ' : '') + h + 'px Arial, sans-serif'; return mctx.measureText(t).width; });
  if (!pages.length) return;
  const A = Math.max(...pages.map(p => p.w)) > 297 || Math.max(...pages.map(p => p.h)) > 297;       // bigger than A4: let the printer scale it to a sheet
  const landscape = pages[0].w > pages[0].h;
  const html = `<!doctype html><meta charset="utf-8"><title>${stem()}</title><style>
    @page { size: ${A ? 'A3' : 'A4'} ${landscape ? 'landscape' : 'portrait'}; margin: 0 }
    html,body { margin:0; background:#fff }
    .pg { width:100vw; height:100vh; page-break-after:always; break-after:page; display:flex; align-items:center; justify-content:center; overflow:hidden }
    .pg:last-child { page-break-after:auto; break-after:auto }
    svg { max-width:100%; max-height:100%; width:auto; height:auto }
  </style>${pages.map(p => `<div class="pg">${p.svg.replace(/ width="[^"]*mm" height="[^"]*mm"/, ` style="width:${p.w >= p.h ? '100%' : 'auto'};height:${p.w >= p.h ? 'auto' : '100%'}"`)}</div>`).join('')}`;
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.append(fr);
  fr.srcdoc = html;
  fr.onload = () => { setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); }, 150); setTimeout(() => fr.remove(), 60000); };
};

// ---- language and the mobile drawer ----
const closeMenu = () => document.body.classList.remove('menu-open');
$('menu').onclick = () => document.body.classList.add('menu-open');
$('scrim').onclick = closeMenu;
addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
$('sample').addEventListener('change', closeMenu);
$('file').addEventListener('change', closeMenu);
function switchLang(l) {
  setLang(l); applyStatic(); fillSamples(); $('msg').textContent = t(mode2d ? 'msg2d' : 'msg');
  if (lastErr) $('err').textContent = t(lastErr[0], lastErr[1]);
  if (current) show(current, true); else if (drw) show2D(drw, '', true);
}
document.querySelectorAll('[data-lang]').forEach(b => { b.onclick = () => switchLang(b.dataset.lang); });
applyStatic();
if ($("sample").options.length) loadSample(+$("sample").value);
