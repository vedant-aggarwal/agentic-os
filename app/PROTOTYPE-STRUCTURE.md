> Reimagine (22 Oct): this file describes the j15 skins system, which still applies. File ownership for the reimagine build is in ../CONTRACT.md, not the 'Phase 2' table below. Tabs are now Today, Life, Work (id jobs), Agent, plus the Scan lens.

# Agentic OS · final app: structure

One app, two skins. Obsidian (stone, glass, light) and Matte (stock, pigment ink) share one JS codebase and one layout. Each skin owns its tokens, materials, textures, fonts and the way its rings arrive. Default skin: Obsidian.

Open: `http://127.0.0.1:8243/final/` · `?skin=obsidian` or `?skin=matte` · `?theme=light` · the style guide is `system.html`.

## File map

```
final/
  index.html              shell: pages, dock, scrim, peek, toast. Sets data-skin before first paint. Loads the CSS in order.
  system.html             the style guide: skin and theme toggles at the top, every value read live from the active skin
  css/
    system.css            shared structure: structural tokens, base, type roles, materials, lists, controls, ring geometry,
                          dock, stack, sheets, peek, toast, the skin control. The header documents the token contract.
    skins/obsidian.css    Obsidian: tokens (dark, light), reduced transparency/contrast, glass rims, ring paint, light, bloom
    skins/matte.css       Matte: Literata, tokens (dark, light), opaque stock, ring paint, ink texture, ink-in
    screens/today.css     Today, Tasks page, task/event/sleep sheets, peeks, the accessory's contents
    screens/jobs.css      Jobs board, chat, plan, changes, builders, terminal, projects, ideas, job peek
    screens/clients.css   Clients tab, client page, lead page, Clients sheets
    screens/content.css   Content OS and the teleprompter
    screens/life.css      Life page, wheel, goals, map, weekly review, score sheet, the Life card on More
    screens/more.css      More, Areas, Voice recordings, modules, account sheet, the Appearance row
    screens/overlays.css  capture (+) sheet, recorder, Wyn sheet, call screen, call pill, incoming banner
  js/
    main.js               boot: skin, tab bar, accessory, capture button, start tab
    core.js               shell API: tabs, push/pop, sheets, segmented, peek, toast, swipe, actions, ring(), pulse()
    skin.js               SKINS, skin(), setSkin(), skinSeg(), initSkin()
    icons.js              line icons. both() carries a glyph per skin where the skins drew their own
    scope.js              the pinned client (read by clients, capture, Wyn)
    data.js               mock data for every screen
    clients-data.js       the client snapshot (studio-os + studio-brain)
    today.js jobs.js clients.js content.js life.js more.js capture.js wyn.js   one module per screen area
```

## How skins are scoped

- The skin is one attribute: `<html data-skin="obsidian|matte">`. `index.html`'s first script sets it from `?skin=`, else `localStorage['aos-skin']`, else Obsidian. A `?skin=` value is also stored.
- **Tokens**: `css/system.css` defines the structural tokens (spacing, type sizes, radii, layout, shared motion). Every colour and material comes from a skin: `:root[data-skin="x"] { … }` fills the contract listed at the top of `system.css` (ink, domains with `-a -b -ink -fill`, semantics, the four levels `--e0…--e3`, `--ctl`, `--inlay`, `--pick`, `--sel`, frame and motion tokens). A skin may retune structural tokens (Matte: gutter 20, section rhythm 32, display 38/44 Literata, radii 18/34, hairline 1px).
- **Rules**: a skin's own rules are written `:where(:root[data-skin="x"]) .selector { … }`. `:where()` adds no specificity, so a skin rule weighs exactly what the shared rule it amends weighs and wins only by coming later. A more specific shared rule still wins, as it would in one file.
- **Load order** is part of the design: `system.css` → `skins/obsidian.css` → `skins/matte.css` → `screens/*.css`. Each screen file has three blocks in this order: `1 · SHARED`, `2 · OBSIDIAN`, `3 · MATTE`.
- **Light theme**: `data-theme="light"` sits on `<html>` too, and skins scope it as `:root[data-skin="x"][data-theme="light"]`. `.stay-dark` (teleprompter, call screen) re-declares the dark tokens so those stay dark.
- **Materials in markup are levels, not looks**: `.surface` (E1, what you read, as are `.group` and `.note`), `.chrome` (E2, what floats), `.overlay` (E3, sheets, peek, toast, banners). Obsidian makes them stone and glass. Matte makes them paper and float stock.
- **Union markup**: `ring()` emits Obsidian's light layer `.rg-l` (hidden by other skins) and Matte's `.ink-tex` class (ignored by other skins). `pulse()` sets both state classes on open: `bloom` (Obsidian's light) and `ink` (Matte's bleed). `setRing()` re-inks a moved head. The draw length and the count-up curve come from the skin (`--draw`, `--ease-draw`, `--count-ease`). Icons a skin drew for itself carry both glyphs (`.ig-obsidian`, `.ig-matte`).
- **Primary actions** are filled with their domain's `--<domain>-fill` (the vivid pigment in Obsidian, the text-safe tint in Matte), so one markup serves both.
- **Keyframes**: shared names stay plain (`rot`, `swap`, `beat`, `check-*`). A skin's own start with `obs-` or `mat-`, and a screen's own with its class prefix (`ct-swap`, `cl-fresh`).

## How switching works

`js/skin.js` → `setSkin(id)` writes the attribute and `localStorage`, updates the status-bar colour and favicon, syncs every copy of the control, then re-runs `pulse()` on the page you are looking at (`visiblePage()`: the top pushed page or the current tab), so Obsidian's light blooms or Matte's ink goes in once. The write happens inside `document.startViewTransition()` (a 240 ms crossfade, `--d-skin`). Without View Transitions the phone fades out and back in. Reduced motion keeps a 150 ms fade and skips the draw. The control is `skinSeg()`: the shared segmented control, each option leading with a swatch each skin paints in its own file (`.skin-sw[data-sw="…"]`, unscoped so both read the same in either skin). It sits in More → App → Appearance and in the account sheet, and at the top of `system.html`.

## Adding a third skin

1. Copy `css/skins/matte.css` to `css/skins/<name>.css`, scope everything to `:root[data-skin="<name>"]`, fill every token in the contract (top of `css/system.css`), paint the rings (`.rg-t .rg-a .rg-o` and the caps) and its swatch `.skin-sw[data-sw="<name>"]`.
2. Link it in `index.html` and `system.html` after the other skins. Add `{ id, name, bar, icon }` to `SKINS` in `js/skin.js` and the name to the `ok()` check in both pages' first script.
3. In each `css/screens/*.css`, add a `4 · <NAME>` block for whatever that screen should do differently. The shared blocks do not change.

## Phase 2: who edits what

Each area edits only its own files: its JS module(s), its screen CSS file(s) (all three blocks, both skins), and its own steps files (`j15/tools/steps-final-<area>*.json`) and shots (`j15/shots/final/_wip-<area>/`).

| Area | JS | CSS |
|---|---|---|
| (a) Today + Tasks + task/event/sleep sheets + accessory | `js/today.js` | `css/screens/today.css` |
| (b) Jobs: board, chat, changes, builders, terminal, projects, ideas | `js/jobs.js` | `css/screens/jobs.css` |
| (c) Clients: tab, client and lead pages, sheets | `js/clients.js`, `js/clients-data.js` | `css/screens/clients.css` |
| (d) Content, Life, More + modules, capture, Wyn | `js/content.js`, `js/life.js`, `js/more.js`, `js/capture.js`, `js/wyn.js` | `css/screens/content.css`, `life.css`, `more.css`, `overlays.css` |
| Lead (shared) | `js/core.js`, `js/icons.js`, `js/main.js`, `js/skin.js`, `js/scope.js`, `js/data.js` | `css/system.css`, `css/skins/obsidian.css`, `css/skins/matte.css`, `index.html`, `system.html` |

Rules:
- Layout changes go in block 1 once, for both skins. A skin block restates only what that skin does differently, prefixed `:where(:root[data-skin="…"])`. Use skin-only tokens only inside that skin's block: Obsidian's `--glow-*` and `--tex-*`, Matte's `--paper --raised --float --surface-3 --grain --edge-2 --shadow-2 --float-box --serif`.
- Need a new token, icon, shared component or a change to `core.js`? Ask the lead. Do not edit shared files.
- Shared seams between areas, whose signatures stay as they are:
  - `today.js` exports `taskRow`, `jobRing` and `jobRowMini` (used by Jobs), and the `.pk` peek styles in `today.css` also serve Jobs' peek.
  - `jobs.js` exports `openJob` and `openProject(slug, back)` (used by Clients).
  - `capture.js` exports `openCapture(type, { client })` and `recorder` (used by Clients and Wyn).
  - `life.js` exports `openLife`, `lifeCard` and `stackBar` (used by More).
- `data-act` names are global: keep the ones other areas call (`client-open`, `lead-open`, `job`, `new-job`, `capture`, `life-open`, `life-goals`, `account`, `wyn`, `tab`) and prefix new ones with your area (`cl-`, `ct-`, `lf-`, `mo-`, `cap-`, `wyn-`, `j`).
- Verify in both skins before handing back: `node j15/tools/shoot.mjs "http://127.0.0.1:8243/final/?skin=obsidian" <out> <steps>` and the same with `matte`, and `node j15/tools/check-variant.mjs "http://127.0.0.1:8243/final/?skin=<skin>"` (no page errors, no overflow). Each skin must look at least as good as before your change.
