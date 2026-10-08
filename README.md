# KOMPAS-3D viewer

**Русская версия: [README.ru.md](README.ru.md)**

A browser-based viewer for native **KOMPAS-3D** files. It reads the binary formats directly (no KOMPAS installation, no server, no conversion step), shows 3D models with three.js and 2D drawings and specifications on a canvas, and exports them to **STL**, **DXF** and paper.

> Status: personal, non-commercial project. The file formats are reverse-engineered (see [`FORMAT.md`](FORMAT.md)), so some features are only partly covered. Tested on files from KOMPAS-3D v14 to v24.
> **License: all rights reserved — use only with the written permission of the copyright holder. See [License](#license).**

## Features

### Supported files

| Extension | Content | What is read |
|---|---|---|
| `.m3d` | 3D part | tessellated faces of every body, bounding box, volume, surface area, file/application metadata |
| `.a3d` | 3D assembly | components with their placement (rotation + translation), loaded from the accompanying `.m3d` parts; missing parts are reported |
| `.cdw` | drawing | everything listed under *Drawings* below |
| `.frw` | fragment | same engine as `.cdw` |
| `.spw` | specification | multi-sheet specifications per GOST R 2.106 |

Both container generations are handled: the current ZIP-based one (`Contents` stream made of concatenated zlib blocks) and the legacy flat `KF…` container of old versions (experimental for legacy assemblies).

### 3D models and assemblies
- WebGL viewer on three.js: orbit / zoom / pan with mouse or touch, *Fit* button, edge overlay and wireframe toggles.
- Per-body list with colour swatch, size, triangle count and volume; every body can be hidden.
- Assemblies: component transforms applied, tolerant file-name matching (renamed parts, Cyrillic look-alikes), large assemblies (tens of instances, ~100k triangles) tested.
- Overall dimensions X × Y × Z, volume and surface area.

### Drawings (`.cdw`, `.frw`)
- Line segments, circles, arcs, ellipses and elliptical arcs with **line styles** (main, thin, axis, dashed, dash-dot, wavy, …) rendered with proper widths and dash patterns.
- **Texts** with alignment, rotation, height, formatting codes and **special signs** (⌀ ° ± × α β γ τ Ⓜ ↻ ▭ I II ※ …) in text, dimension values, title-block cells and tables.
- **Dimensions** of all types: linear, diameter, radius, angular, ordinate; arrows, value text, tolerances.
- **Hatching**, views with scale, tables, and **macro elements** (symbols of schematics, roughness signs, etc.).
- **Sheet frame and title block** (form 1) with values; A4 – A1, portrait and landscape; old-container drawings included.
- Pan / zoom canvas, auto-fit.

### Specifications (`.spw`)
- Sections per GOST R 2.106 (documentation, assemblies, parts, standard items, materials, …), group headings, fractional entries, wrapped names and special signs.
- **Multi-sheet** specifications: first sheet (form 1) and continuation sheets (form 2a) with their frames, title blocks, "Sheet / Sheets" counters and the primary-application strip.
- Title-block values: name, designation, developers / checkers, organisation, primary application.

### Export and printing
- **STL** (binary, millimetres, KOMPAS coordinate system): all bodies in one file, or one file per body packed into a `.zip`; optionally only the bodies that are ticked in the list. Assemblies are exported with component placement applied.
- **DXF** (R12, cp1251) for drawings and specifications: layers per line style, polyline widths, line types, texts (cyrillic and `%%c %%d %%p` / `\U+XXXX` for signs).
- **Print**: vector SVG pages, black on white, one page per sheet (multi-sheet specifications print as several pages).

### Interface
- English by default, **EN / RU** switch (remembered).
- Responsive layout: on phones the side panel is a drawer opened with the ☰ button.
- Light / dark colour scheme follows the system.
- Drag-and-drop of files; built-in examples.
- Works from `file://` — no web server is required.

## Usage

1. Open `viewer.html` in a modern browser (developed and tested in Chromium-based browsers).
2. Click **Open …** or drop files onto the page.
   For an assembly select the `.a3d` **together with** its `.m3d` parts (several files at once).
3. Use the side panel for dimensions, bodies, view options and export.

A pre-built bundle is in `dist/viewer.bundle.js`, so no build step is needed to run it.

## Building and testing

```bash
npm install          # esbuild only
npm run build        # dist/viewer.bundle.js (+ dist/samples.js with the embedded examples that are present)
node tools/test.mjs  # quick geometry check of the bundled sample
```

## Repository layout

| Path | Purpose |
|---|---|
| `viewer.html`, `src/` | user interface, 3D / 2D rendering, export, translations |
| `m3d.js` | container and 3D geometry parser (parts, assemblies, legacy files) |
| `drawing.js`, `sheet-template.js` | drawings parser, sheet frame and title block |
| `spec.js`, `symbols.js` | specifications parser, special signs |
| `FORMAT.md` | **documentation of the reverse-engineered KOMPAS-3D formats** |
| `vendor/` | three.js (MIT) |
| `tools/` | build and test scripts |

## Limitations

Splines and points in drawings, rotation of views, some tolerance-frame signs (a few sign codes are still undecoded, shown as □) and some legacy assembly layouts are not supported or only partly supported. See `FORMAT.md` for the detailed status of every area.

## License

Copyright © 2026 turovnikoff. **All rights reserved.** The software may be used **only with the prior written permission of the copyright holder**; viewing the source in this repository does not grant any license. See [`LICENSE`](LICENSE). Third-party components keep their own licenses ([`NOTICE.md`](NOTICE.md)).

KOMPAS-3D is a trademark of ASCON. This project is independent and not affiliated with ASCON.
