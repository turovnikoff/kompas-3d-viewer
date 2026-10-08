// i18n.js — interface strings (English by default, Russian optional; the choice is remembered in localStorage when available).
const D = {
  en: {
    open: 'Open .m3d / .a3d / .cdw / .frw / .spw', hint: 'For an assembly, select the .a3d together with its .m3d parts (several files at once).',
    h_file: 'File', h_dims: 'Dimensions (mm)', h_bodies: 'Bodies', h_view: 'View', edges: 'edges', wire: 'wireframe', fit: 'Fit',
    h_export: 'Export', stl_all: 'STL', stl_all_title: 'all bodies in one STL file', stl_sep: 'STL .zip', stl_sep_title: 'one STL per body, packed in a .zip', only_sel: 'selected bodies only',
    print: 'Print', drop: 'Drop a file here', msg: 'LMB — rotate, wheel — zoom, RMB — pan', msg2d: 'Drag — pan, wheel — zoom', menu: 'Menu',
    example: 'Example: ', app: 'Application', version: 'Version', type: 'Type', streams: 'Streams', assembly: 'Assembly', inst: '{n} inst.', views: 'Views',
    width: 'Width', height: 'Height', lines: 'Lines', arcs: 'Circles / arcs', texts: 'Texts', dimensions: 'Dimensions', volume: 'Volume', area: 'Area', cm3: 'cm³', cm2: 'cm²', mm: 'mm',
    no_geom: 'geometry not found', body: 'Body {n}', tri: 'tri.',
    drawing_info: 'Drawing: {n} objects. Not supported: splines, points, view rotation; symbols (roughness etc.) and the texts inside them are shown partly.',
    missing: 'Missing parts: {list}', open_fail: 'Could not open the file: {e}', sample_fail: 'Example not loaded: {e}', no_bodies: 'No bodies to export',
  },
  ru: {
    open: 'Открыть .m3d / .a3d / .cdw / .frw / .spw', hint: 'Для сборки выберите .a3d вместе с её деталями .m3d (несколько файлов сразу).',
    h_file: 'Файл', h_dims: 'Габариты (мм)', h_bodies: 'Тела', h_view: 'Вид', edges: 'рёбра', wire: 'каркас', fit: 'Вписать',
    h_export: 'Экспорт', stl_all: 'STL', stl_all_title: 'все тела одним файлом STL', stl_sep: 'STL .zip', stl_sep_title: 'по файлу STL на тело, в одном .zip', only_sel: 'только отмеченные тела',
    print: 'Печать', drop: 'Отпустите файл здесь', msg: 'ЛКМ — вращение, колесо — масштаб, ПКМ — сдвиг', msg2d: 'Перетаскивание — сдвиг, колесо — масштаб', menu: 'Меню',
    example: 'Пример: ', app: 'Приложение', version: 'Версия', type: 'Тип', streams: 'Потоков', assembly: 'Сборка', inst: '{n} экз.', views: 'Виды',
    width: 'Ширина', height: 'Высота', lines: 'Отрезков', arcs: 'Окружностей / дуг', texts: 'Текстов', dimensions: 'Размеров', volume: 'Объём', area: 'Площадь', cm3: 'см³', cm2: 'см²', mm: 'мм',
    no_geom: 'геометрия не найдена', body: 'Тело {n}', tri: 'треуг.',
    drawing_info: 'Чертёж: {n} объектов. Не поддерживаются: сплайны, точки, повороты видов; символы (шероховатость и др.) и тексты внутри них показаны частично.',
    missing: 'Не хватает деталей: {list}', open_fail: 'Не удалось открыть файл: {e}', sample_fail: 'Пример не загружен: {e}', no_bodies: 'Нет тел для экспорта',
  },
};
export const SAMPLE_NAMES = {
  en: ['Orange Pi Zero 3 case (part)', 'Beer float (assembly, 2 parts)', 'Threading die M2 (assembly, 7 inst.)', 'Printer door (assembly, 12 planks)', 'Bolt and nut (old format, experimental)',
    'Drawing fragment (.frw): lines, circle, text, dimension', 'Drawing (.cdw)', 'Real drawing "Calibration flange" (.cdw, partial)', 'Electrical schematic A1 (.cdw, KOMPAS v14 format)',
    'Line styles (.frw): main, thin, axis, dashed…', 'Specification "Filter", 2 sheets (.spw)', 'Specification "Bracket" (.spw)', 'Specification "Roller assembly" (.spw)',
    'Printer casing (assembly, 24 inst.)', 'Thermobox lid (assembly, 40 inst., 98k triangles)'],
};
let lang = 'en';
try { const s = localStorage.getItem('m3d-lang'); if (s === 'ru' || s === 'en') lang = s; } catch { /* storage unavailable */ }
export const getLang = () => lang;
export function setLang(l) { lang = l === 'ru' ? 'ru' : 'en'; try { localStorage.setItem('m3d-lang', lang); } catch { /* ignore */ } }
export const t = (k, a = {}) => (D[lang][k] ?? D.en[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => a[n] ?? '');
/** Translate the static markup: [data-i] -> text, [data-i-title] -> title, [data-i-label] -> aria-label. */
export function applyStatic() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i]')) el.textContent = t(el.dataset.i);
  for (const el of document.querySelectorAll('[data-i-title]')) el.title = t(el.dataset.iTitle);
  for (const el of document.querySelectorAll('[data-i-label]')) el.setAttribute('aria-label', t(el.dataset.iLabel));
  for (const b of document.querySelectorAll('[data-lang]')) b.classList.toggle('on', b.dataset.lang === lang);
}
