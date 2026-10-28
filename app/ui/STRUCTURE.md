# The phone app's design system and who edits what

The approved mockup (`j15/mockup/final`, read its `STRUCTURE.md`) is ported into this app: one app, two skins,
**Obsidian** (default) and **Matte**, on one layout, with the new tab bar. This file is the map for Phase 2.

## File map

```
app/
  index.html                shell: boot script (skin + theme before first paint), stylesheet order, the five tab pages,
                            the dock (accessory, tab bar, +), sheets, scrim, #peek, toast
  ui/
    system.css              structural tokens, the token contract, the legacy bridge, base, type roles, materials,
                            and every shared component (page shell, top bar, lists, controls, rings, dock, sheets,
                            peek, toast, the skin control). Header = the token contract.
    skins/obsidian.css      Obsidian: tokens (dark, light), reduced transparency/contrast, glass rims, ring paint, bloom
    skins/matte.css         Matte: Literata, tokens (dark, light), opaque stock, ring paint, ink texture, ink-in
    ui.js                   skins + theme, seg(), rings (ring, ringSet, setRing, pulse), peek, onHold
    icons.js                the mockup's line icons (AOS.icons)
    screens/today.css       area (a)   ┐ one file per Phase 2 area, each with blocks
    screens/jobs.css        area (b)   │ 1 · SHARED, 2 · OBSIDIAN, 3 · MATTE.
    screens/content.css     area (d)   │ They load after styles.css and work/work.css,
    screens/life.css        area (e)   │ so a rule here wins over the legacy rule it
    screens/more.css        area (e)   │ amends at equal weight.
    screens/overlays.css    area (e)   ┘
  styles.css                the screens app.js draws, re-tokenised; Matte block at the end
  work/work.css             Jobs, re-tokenised (linked in index.html; AOS.css skips it)
  work/tab.js               the Jobs tab: summary line, Board · Projects · Ideas
  modules/*.css             appended by AOS.css(), after everything above
```

Load order (index.html): `ui/system.css` → `ui/skins/obsidian.css` → `ui/skins/matte.css` → `styles.css` →
`work/work.css` → `ui/screens/*.css` → module sheets (runtime).

## How skins are scoped

- **The skin** is `<html data-skin="obsidian|matte">`, set by index.html's first script from `?skin=` (remembered),
  else `localStorage['aos-skin']`, else Obsidian. `AOS.setSkin(id)` switches it inside a View Transition crossfade
  (240 ms, `--d-skin`; a plain fade of `#screen` where View Transitions are missing; 150 ms under reduced motion),
  syncs `meta[name=theme-color]` and every skin control, then re-draws the rings on the page you are looking at.
- **The theme** is `data-theme="dark|light"` on `<html>`, always explicit. The choice is `localStorage['aos-theme']`:
  `auto` (default, follows the phone and keeps following it), `dark` or `light`. `?theme=` overrides for one visit.
  Skins scope light as `:root[data-skin="x"][data-theme="light"]`. There are no `prefers-color-scheme` rules any more.
- **Tokens**: `ui/system.css` holds the structural tokens (spacing `--s-*`, page margin `--gutter`, section rhythm
  `--gap-sec`, type roles `--fs-*/--lh-*`, radii `--r-*`, motion). Every colour and material comes from a skin
  (`:root[data-skin="x"] { … }`), filling the contract listed at the top of `system.css`.
  - **The legacy bridge**: `system.css` maps the names the app already used onto the contract (`--label → --ink`,
    `--label-2/3`, `--surface → --e1`, `--bg → --e0`, `--fill → --fill-1`, `--fill-2`, `--separator → --sep`,
    `--danger → --fail-ink`, `--defer → --needs`, `--glass → --e2`, `--shadow-float/lift`). Old rules and module
    sheets follow the skin through them. New rules use the contract names.
  - `--gutter` is the page margin (16, Matte 20). The timeline's hour column is `--tl-gutter` (58).
- **Skin rules** are written `:where(:root[data-skin="x"]) .selector { … }` (no added specificity: it wins over the
  shared rule it amends by coming later). A skin's keyframes start `obs-` or `mat-`.
- **Materials are levels, not looks**: `.surface` (E1, what you read: cards, lists), `.chrome` / `.glass` (E2, what
  floats: dock, top-bar buttons, composer, sticky switch), `.overlay` / `.sheet` / `.toast` (E3). Obsidian makes them
  stone and glass (with a rim and lens on E2), Matte paper and float stock. Inside a sheet a list is an inlay.
- **Rings**: `AOS.ring()` emits the union markup (Obsidian's light `.rg-l`, Matte's `.ink-tex`); `AOS.pulse(root)`
  sets both state classes (`bloom`, `ink`); the draw length and curve come from the skin (`--draw`, `--ease-draw`,
  `--count-ease`). Set `--ring-bg` on an ancestor to the surface colour under the ring.
- **Primary actions** use their domain's fill: `style="--c:var(--jobs-fill)"` on `.act.primary`, `.btn.primary`,
  `.nav-pill.strong`, `.gbtn.accent` (the label colour follows). Without `--c` they are ink.
- **Rules from j15/AUDIT-slop.md stand**: no radial lights, no glows (Obsidian's ring light is the only one), no
  perpetual motion except a running job's head and one spinner, no uppercase tracked labels, area colours only as
  8px dots, 3px rails and 15% washes, 44px targets, text ≥ 12px (body ≥ 15), inputs ≥ 16px.

## Mockup names → this app's names

The app already used some of the mockup's class names for other things; the app's meaning wins:

| Mockup | Here | Why |
|---|---|---|
| `.seg` (the control) | `.segmented` + buttons + `.seg-thumb` (`AOS.seg()` writes it) | `.seg` is the Day/Week button |
| `.group > .row` | `.group > .lrow` (or the existing `.area-list > .area-row`) | `.row` is the task row |
| `.rbody .rtitle .rmeta .rend .tile` | same names (`.ar-text .ar-name .ar-sub .area-icon` in old lists) | |
| `.chip` (a choice) | `.chip-btn` (`.on` = picked) | `.chip` is a static parsed chip |
| `.check` (26px circle) | `.check > i` (the task check) | |
| `.field` (input capsule) | `.ifield`, `.search` | `.field` is a labelled section in a sheet |
| `.scroll` / `.pages` / `.stack` | `.scroller` + `.tab-content` / `.page` + `.root` / `.page.detail` | |
| `.topbar` `.tb-title` | `.navbar` `.nav-title` (`.gbtn`, `.nav-back`, `.nav-pill` inside) | |
| `.tab-lens` `.tbadge` `.capture` | `.tab-pill` `.tab-badge` `.capture-btn` | |
| `.live` | `.live-dot` | `.live` is a word in session rows |
| `.grab` `.sheet-close` | `.grabber`, `.sheet-close` (new) | |
| `.pill .btn .gbtn .dot .bar .steps .tile .agent .jring .spin .switch .note .sh .phead .lt .met .num` and the type roles | same names | free in this app |

Content containers (`.tab-content`, `.settings-body`, `.item-body`) carry the page margin. A `.group`, `.sh` or
`.note` inside them has no side margin of its own (the mockup put `--gutter` on each group).

The app's own old components are scoped so they never leak into new markup: the timeline's blocks are
`.timeline .block` (a `.btn.block` is a full-width button, nothing more); the task check's box, ring and tick apply
only inside `.timeline`, `.ghost`, `.row` and `.ih-row`; `.mic-btn` is a 44px circle anywhere and is placed inside a
field only by `.cap-field`, `.nb-field`, `.jc-row`, `.ctx-box` and `.inline-add`; the 164px two-segment switch is
`.view-seg` / `.life-seg` only, so every other `.segmented` is the system's control.

## What app.js and window.AOS gained (also in app/MODULES.md)

- `AOS.skins`, `AOS.skin()`, `AOS.setSkin(id)`, `AOS.theme()` (`auto|dark|light`), `AOS.setTheme(pref)`,
  `AOS.skinSeg(cls)`, `AOS.themeSeg(cls)`: the controls work wherever they are drawn.
- `AOS.ring(p, hue, size, w, { inner, cls, k, id, delay, label })`, `AOS.ringSet([[p, hue, opts], …], size, w, gap)`,
  `AOS.setRing(el, p)`, `AOS.pulse(root, delay)` (`[data-count][data-fmt]` figures count up with the draw).
- `AOS.seg(name, [[value, html, n?], …], selected, { cls, label, role: 'tab'|'radio' })` → markup; a tap moves the lens
  and fires a bubbling `segchange` (`e.detail` = value) on the control; `AOS.selectSeg(el, value)`.
- `AOS.peek(html, [{ label, icon, run }])`, `AOS.closePeek()`, `AOS.onHold(root, selector, fn, ms)`, `AOS.icons`
  (the mockup's whole set, including `next`, `pinF`, `folderPlus`, `paste`), `AOS.areaIcons` (slug → glyph).
- `AOS.registerTab(id, { render(el, page), onShow?(el, page) })` fills a tab app.js only frames (`clients`,
  `content`); `AOS.register({ …, tab: 'clients'|'content' })` does the same with a module's `page(el)` (the module
  leaves More's list and `AOS.openPage(id)` opens the tab). `AOS.renderTab(name)` redraws a TABS-registered tab if up.
- `AOS.openTasks(list?)` pushes the Tasks page over Today; `AOS.openLife({ goals })` pushes Life over More.
- `AOS.visiblePage()`: the top pushed page, else the current tab's page.

## The information architecture

- **Tab bar**: Today · Jobs · Clients · Content · More (+ capture). `#screen[data-tab]` says which is up; the
  accessory shows on Today and Jobs only. Each tab is `section.page#page<Tab> > .root > .navbar + .scroller`, with
  its own push stack (`ui.stack.<tab>`).
- **Old tab names still work** (`setTab()`, `?tab=`, `#hash`, `agenticos://`): `tasks` → Today + the Tasks page,
  `life` / `goals` → More + the Life page (goals scrolled to), `projects` / `ideas` / `code` → Jobs on that segment.
- **Today**: hero (title, Wyn, account, the three rings, the strip, night card, brief, module cards), then the sticky
  Schedule | Tasks switch (`ui.todayPane`). Schedule = `#dayView` / `#weekView` with Day | Week; Tasks = tiles +
  today's open tasks; a tile or All tasks pushes the full Tasks page (`kind: 'tasks'`). Hold Tasks for a quick look.
- **Jobs** (`work/tab.js`, `ui.jobsSeg`): summary line, Board (the old Code page: lanes, builders, terminals, New
  session) · Projects · Ideas. Gear = board settings, New = new session. Job, project, terminal, copy, compare pages
  push over the current tab.
- **Clients**: the clients module fills it through the tab hook (`app/modules/crm.js`).
- **Content**: the content module's page (`tab: 'content'`).
- **More**: Life card (opens the Life page: review, wheel/map, goals), Areas, Voice recordings, modules, App
  (Appearance, Theme, Keyboard on the iPhone app, Settings = the account sheet). The account sheet also has
  Appearance and Theme.

## Phase 2: who edits what

Each area edits only its own files and regions, with targeted edits (never rewrite `app.js`, `styles.css`,
`work.css` or `index.html`). app.js regions are its `// ---------- Name ----------` sections and the functions named.
New CSS goes in your `ui/screens/*.css` file; change a legacy rule in place only when moving it is worse.

| Area | app.js (sections · functions) | CSS | Other files |
|---|---|---|---|
| **(a) Today + Tasks + task/event/sleep sheets + accessory** | Day model · Day view · Hero (`renderHero`, `stripHTML`) · Week view · Chrome (`renderChrome`, `renderIsland`, `renderAccessory`, `updateNowButton`) · Task actions · Sheets (`openPlan`, `renderPlanList`, `rowHTML`, `completeFromList`; not `makeSheet`) · Gestures · Tag sheet · Item sheet · Tasks tab (`groupBy*`, `renderTasks`) · Today: the Schedule \| Tasks switch (`renderTodaySwitch`, `setTodayPane`, `renderTodayPane`, `openTasksPage`) · Clicks for Tasks and Life (the task half) · Clicks (dayView, weekView, strip, Now, accessory handlers) · Sleep · Plan my day · Brief · Sort the inbox · Tag blocks | `ui/screens/today.css`; styles.css sections Today bar/hero, Day timeline, Week, Task rows, The Tasks page, Tag sheet, Item sheet, Sleep, the AI layer's Brief / Plan my day / Sort the inbox | `index.html` markup inside `#pageToday`, `#accessory` |
| **(b) Jobs** | Give to Claude (`openAgent` … `demoAgentAct`) | `ui/screens/jobs.css`, `work/work.css` | `app/work/*` (incl. `tab.js`) |
| **(c) Clients** | none (use `AOS.registerTab` / `tab:`) | `app/modules/crm.css` | `app/modules/crm.js`, `server/modules/crm.ts` |
| **(d) Content + module pages** | none | `ui/screens/content.css`, `app/modules/*.css` | `app/modules/*.js` (not crm) |
| **(e) Life/Goals + More + Wyn + capture + account** | Shared helpers for goals and areas (`goalStats`, `paceBar`, `goalCardHTML`, `goalsHTML`, `lifeCardHTML`, `goalDetailHTML`) · Areas · Life · Score sheet · Account sheet · Projects inside an area · Clicks for Tasks and Life (the Life half) · `renderMore` · Capture (`parseCapture` … `openCapture`, the `#captureForm` submit and `#captureBtn` handlers in Clicks) · Ask bar · Voice · Wyn · Wyn's preferences · Call sounds · Calling Wyn · Wyn calling you · Weekly review | `ui/screens/life.css`, `more.css`, `overlays.css`; styles.css sections Goals, Detail pages, Areas, Life wheel families, Life, Map, Score sheet, Account, Wyn, + sheet, the AI layer's Weekly review | `index.html` markup of the capture, Wyn, call, account sheets |
| **Foundation (ask first)** | top of file (imports, Data/sync), Time, Motion, Render orchestration (`render`, `softRefresh`, `setView`), Toast, `makeSheet`, Tabs + push navigation (`setTab`, `renderTab`, `registerTab`, `pushDetail`, `popDetail`, `renderDetail`), Modules (`openModPage`, `registerMod`, `loadCss`, `window.AOS`), Clicks on the new screens, the boot at the end | `ui/system.css`, `ui/skins/*.css`, styles.css head, Controls (desktop), Real phone | `ui/ui.js`, `ui/icons.js`, `index.html` head, tab bar, page frames |

Owed between areas (from the Clients agent, Phase 1):
- **(b) Jobs owes** `AOS.work.openJobSheet({ folder })`, opening the job sheet with that folder as where the job
  works, and `AOS.work.jobFolders = true` once it does, so Clients can start a job in a client's folder.
- **(e) owes** hiding the old "Client window" module tile on More: that module's pages are now "Client pages" under
  the Clients tab (`renderMore` lists every module without `tab:`; filter `clients` out there, or have (d)/(c)
  register it with `tab: 'clients'` if its page moves into Clients).
- **(c) may drop** the `.cl-seg` / `.cl-jfield` workaround in `crm.css`: the old 164px switch is scoped to
  `.view-seg` / `.life-seg` now.

Shared seams whose signatures stay: `rowHTML(t, grip, { project })`, `dayLabel`, `color`, `areaName`, `areaShort`,
`openCapture(preset)`, `openItem`, `openTasksPage(list)`, `openLifePage({ goals })`, `lifeCardHTML()`,
`goalsHTML({ section })`, every `AOS.*` above, and app/work's `openJob`, `openProject`, `openCode`, `mountBoard`,
`renderProjectsList`, `mountIdeas`. Need a new token, icon or shared component? Ask the foundation; do not edit
`ui/system.css` or the skins.

## Verify

- `node j15/tools/shoot-app-s.mjs "/?skin=obsidian" <out> <steps.json>` and the same with `?skin=matte` (the `-s`
  version reuses one login; the plain one logs in every run and the server rate-limits that). `SCHEME=light`
  emulates a light phone; `?theme=light` forces light for one visit.
- `j15/tools/steps-port-foundation.json` walks every tab, the Tasks page, a task sheet, a job chat, Projects and
  Ideas, More, Life and its goals, a module page, the + sheet (Task and Job), Wyn and the account sheet.
- No `pageerror` lines; compare against `j15/shots/final/<skin>/`.
