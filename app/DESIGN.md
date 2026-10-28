# Agentic OS for iOS: design notes

Web prototype of the five tabs (Today, Tasks, Goals, Areas, Life). The SwiftUI build should copy it screen for screen, including the JSON shapes in `mock/`. No SwiftUI here yet.

- Run: `python scripts/serve.py` then open http://127.0.0.1:5181 (desktop shows an iPhone 16 Pro frame, and under 520px wide it goes full screen with real safe areas).
- Refresh data: `node scripts/pull-mock.mjs` (reads the `agentos` CLI, writes `mock/*.json`).
- Data: two sources, switched under Life > ••• (or the Data control on desktop, or `?data=demo|real`).
  - **Demo** (default): the real calendar and areas plus the 6 July wheel, topped up by `mock/demo.json` from `node scripts/build-demo.mjs` (42 tasks, a 12-goal ladder, 6 projects, an inbox, monthly wheel scores). It exists to show every screen at full capacity.
  - **Real**: only what agentos has. The task DB is empty today, so Today shows just the calendar.
  - `mock/life.json` holds the nine aspects, the real 6 July scores and a proposed area-to-aspect mapping.
- Screenshots: `screens/` (light and dark, framed and phone).

## Concept: the day flows past a fixed now line

The current web Today page is a flat timeline. This one is built around the present:

1. **Hours already lived fold up.** Everything before now collapses into one "Earlier today" row (done count plus area dots). Tap it to open the past at full scale. The future gets the whole screen.
2. **Free time is a visible object.** Gaps between blocks render as striped slots labelled "1h free". Tap one to add a task at that time. While dragging a task, gaps that fit it light up and pull the block in (magnetic within 20 min of the gap start).
3. **Tasks become time blocks by drag.** Unscheduled tasks live in the "To plan" tray (the bar above the tab bar). Hold a row, the tray steps aside, drop it on the timeline. It lands snapped to 15 minutes.
4. **The hero strip is the whole day at a glance.** Past blocks solid, future blocks faint, tasks as small marks (filled when done), a now tick. Tap anywhere on it to jump there.
5. **The live block lives in the Dynamic Island** (time left, progress, what's next). In the real app this is a Live Activity.

Directions judged and dropped:
- An agenda list with tasks above a separate calendar. It splits "what" from "when", which is the problem being solved.
- A horizontal swipeable day carousel. It fights swipe-to-complete and hides the shape of the week.

## Screens

### Today
- **Day**: nav bar (date when scrolled, Day/Week segmented control, Now/Today button when the now line is off screen), large title, hero strip, summary ("3 of 8 tasks done, 1h still free."), then the timeline: sleep band, Earlier row, now line, blocks, gaps, bottom sleep band.
- **Week**: 7 columns (05:30–22:00 scaled to fit), free hours per day in the header, striped background = free time, now line on today, area legend. Tap a day to open it in Day view.
- **Bottom accessory** (iOS 26 `tabViewBottomAccessory`): left = task in progress with a progress ring (tap marks it done, with Undo). With nothing in progress it shows the next planned task. Right = "To plan" with a count (red when something is overdue).

### Tasks
A full task manager next to the timeline, so tasks are not limited to the To plan bar.
- Search (title, area, project), then smart lists as chips with counts: Today, Upcoming, Inbox, Overdue, No date, Done, All. The Tasks tab icon carries a red badge with the overdue count.
- Group by Date (Overdue, In progress, Planned today, Due today, then each day of the week, Later, No date, Inbox) or by Area. Today ends with a "Done today" group.
- Rows: check, title, area, time or due, project, length. Swipe right = done, left = tomorrow, tap = details sheet. "Add a task" at the bottom uses the list as its preset (Inbox captures go to the inbox, Upcoming defaults to tomorrow).

### Goals
- Ladder of horizons, each showing the current period only: This week, October, This quarter, This year, This decade, Life. Header shows period label and time left.
- Goal card: area, due, title, **pace bar**, "0 of 1 task done", pace verdict. The pace bar puts goal progress (area colour fill) next to a tick marking how much of the period has passed. Verdict: Done, Not started (0% and under 25% of time used), Behind pace (time used minus progress > 20 points), otherwise On pace.
- Empty horizon: one row with "Add" (opens capture in goal mode).
- Goal detail (push): kicker, title, measure, big pace bar with start/end dates, sentence ("0% done with 81% of the time used, 1 day left."), **Serves** (the parent goal) and **Feeds this goal** (child goals) so the ladder can be walked up and down, linked tasks, Add a task (pre-linked).
- Manual goals show their measure ("Instagram followers: 46%"). Auto goals count linked tasks.

### Areas
- "Your calendar this week": hours by area as a stacked bar plus legend, from calendar blocks and scheduled tasks, sleep excluded. Real finding: **20h 30m of this week's blocks have no area** (Algebra, ERA, P&S LAB, EVS, Cardio).
- Area list (inset grouped): glyph tile, name, hours this week, open task count.
- "No area" row opens the **tag sheet**: each untagged block name with area chips. Picking one tags every block with that name (in the app: create an agentos area rule).
- Area detail (push): header with this week's hours, then Coming up (next 6 blocks, tap jumps to Today on that day), tasks, goals and projects. Each project shows its deadline, a progress bar from its tasks and the next task.

### Life
Built from the July 2026 life review: nine aspects scored out of 10, grouped as Self (Body, Mind, Soul), Work (Mission, Money, Growth) and People (Family, Romance, Friends). Two views:
- **Wheel**: a rose chart. Each wedge's length is the latest score, coloured by family. A dashed arc marks the score you compare against (default: the first review). The insight line names what grew most and what hasn't moved. "Compare with" chips switch the baseline. Tap a wedge or row to highlight it. **Score today** opens nine sliders; saving adds a dated snapshot and the wedges spring to the new shape.
- **Growth**: one row per aspect with a sparkline across all snapshots (0–10 scale, so rows compare honestly), the score and the change since the baseline.
- **Map** (after Mind Atlas): you in the centre, the nine aspects around you as glowing cores sized by score. Each area orbits its main aspect with its goals (diamonds), projects (squares) and open tasks (dots). Dotted links run to an area's second aspect. An aspect nothing feeds is drawn hollow. The intro names the aspects with no tasks ("No tasks feed Soul, Romance and Friends."). Tap a cluster to see what feeds it, or "Add a goal for Soul" when it is empty.

### Sheets
- **To plan** (half/large): Inbox, Overdue, Due today, Later, No date. Row: check, title, area, length, due. Grip: tap plans it in the next free gap, drag lets you choose.
- **Capture** (+ button): one line with live parsing into chips. `#area` (slug, initials like `#wb`, or name word), `at 6pm` / `18:30` / `at 6`, `for 30m` / `1.5h`, `today/tomorrow/mon…sun`. Scheduled tasks land on the timeline, the rest go to To plan. Goal mode adds a goal to a horizon.
- **Details** (tap any task or block): task = editable title, area, due, time (unschedule / plan in next gap), length, goal, Start/Pause, Tomorrow, Drop. Calendar block = time, location, area chips with "apply to all N blocks with this name".
- **Score today**: nine 0–10 sliders, same questions as the July review.
- **Data** (Life > •••): Demo or Real, and reset local changes.
- Sheets stack (details over To plan). Escape or a scrim tap closes the top one.

## Tokens

### Colour
Neutrals are tinted toward hue 265 (cool). Colour comes only from areas, so chrome stays monochrome.

| Token | Light | Dark | Use |
|---|---|---|---|
| bg | `#f4f6f8` | `#090a0d` | screen background |
| surface | `#fdfdff` | `#14161a` | cards, sheets, task blocks |
| ink / label | `#16181e` | `#f4f5f8` | text, now line, primary buttons |
| label-2 | ink at 62% | ink at 62% | secondary text, hour labels |
| label-3 | ink at 36% | ink at 34% | disabled, placeholders only |
| fill / fill-2 | ink at 5% / 9% | ink at 6% / 10% | chips, empty rows, tracks |
| separator | ink at 12% | ink at 13% | hairlines (0.5pt) |
| glass | `#f9fafc` at 72% + blur 22 + saturate 180% | `#191b1e` at 66% | nav bar when scrolled, accessory, tab bar |
| done | `#2e9e52` | same | swipe-complete, On pace |
| defer | `#e48e26` | same | swipe-to-tomorrow |
| danger | `#de3b3d` | same | overdue, Behind pace, Drop |

Event blocks: area colour mixed into surface at 15% (light) / 30% (dark), meta text = area colour mixed into label at 62% / 45%. Past blocks use 9% / 18% on bg. Task blocks: surface with a 1pt area-colour outline and a check circle.

Life families: Self `oklch(0.68 0.15 150)` (green), Work `oklch(0.62 0.16 262)` (blue), People `oklch(0.66 0.17 12)` (rose). In dark mode the map cores get a soft blur glow on a deep radial card.

Area colours (from `agentos area`): City College `#5b8def`, Morgan & Co. `#d9822b`, Corner Market `#e0559b`, Northwind Studio `#7c5cff`, Projects `#2bb39a`, Content `#f2b134`, Personal + Health `#4caf50`, no area `#8e8e93`.

### Type (SF Pro, with Inter as the Windows fallback)
| Role | Size/leading | Weight | SwiftUI |
|---|---|---|---|
| Large title | 34/41, tracking −0.026em | Bold | `.largeTitle.bold()` |
| Detail title | 28/34 | Bold | `.title.bold()` |
| Section / sheet title | 20–22/25–28 | Bold | `.title3.bold()` / `.title2.bold()` |
| Block title, card title | 15–17/19–22 | Semibold | `.subheadline/.headline` |
| Body, rows | 15–17/20–22 | Regular/Medium | `.body` |
| Meta, times | 12–13/15–17, tabular numbers | Medium | `.caption/.footnote` + `.monospacedDigit()` |

### Shape and spacing
- Side margin 16. Timeline gutter 58 (hour labels and the now pill).
- Corners: blocks 12, cards 16–18, sheets 38 (top only). Tab bar and accessory are capsules, 62 and 48 high, inset 20 from the edges.
- Hit targets ≥ 44 (check circles have a 30pt tap area inside a 44pt row).

### Timeline geometry
- Future: 80pt per hour. Past: folded to 14pt total, or 80pt per hour when opened.
- Snap 15 min. Blocks shorter than 40pt switch to one line. Overlaps split into columns.
- Day window = between the overnight sleep events. Without them it is 07:00–22:00, widened to fit.

## Motion
Springs everywhere a finger can interrupt (`response` s, `damping` ratio). Gestures hand their release velocity to the spring.

| What | Spring | Notes |
|---|---|---|
| Sheet detents | 0.42 / 1.0 (0.88 after a flick) | projected landing, d = 0.998 |
| Push / pop page | 0.42 / 1.0 | page below moves 30% under a shade. Edge swipe from the left 24pt commits past 50% (projected) |
| Lift a block | scale 1.03, 0.3 / 0.8 | shadow lifts |
| Drop / reposition | 0.36 / 0.9 | from the lifted position |
| Task lands from tray | 0.36 / 0.86 | carries drag velocity |
| Swipe snap back | 0.35 / 0.85 | arms at 76pt, commits at 170pt projected (d = 0.99) |
| Earlier fold | 0.5 / 1.0 | |
| Segmented thumb, tab pill | 0.32 / 1.0, 0.36 / 0.82 | |
| Wheel reshapes after a re-score | 0.55 / 0.82 | the one place with a little overshoot: a rare, rewarding moment |
| Map first appears | 620ms ease-out, 45ms stagger per aspect | once per session, scale 0.55 → 1 |
| Press feedback | scale 0.92–0.98, 100ms ease-out | on touch down |

Reduced motion: springs jump to the end state and only opacity animates. Reduced transparency: glass becomes solid surface.

## Haptics (SwiftUI `.sensoryFeedback`)
- `.impact(weight: .medium)`: lift a block, lift a task out of the tray, long-press create.
- `.selection`: each 15-minute step while dragging, tab change, field change in a sheet.
- `.impact(weight: .light)`: swipe arms, drop after move, defer.
- `.success`: task done, task lands in a slot, task added, area rule created, wheel saved.

## Gestures
| Where | Gesture | Result |
|---|---|---|
| Task block | swipe right / left | done (or not done) / move to tomorrow, Undo toast |
| Any future block | hold 380ms, drag | move, with a time tag at the snapped start |
| Empty timeline or gap | hold | new task at that time |
| Gap | tap | capture with that time preset |
| Now pill | drag | scrub the clock (prototype only) |
| Tray row | hold, or drag the grip | schedule by drop. Tap the grip for the next free gap |
| Tray / list row | swipe | done / tomorrow |
| Detail page | swipe from the left edge | back |
| Any task or block | tap | details sheet |
| Wheel wedge, aspect row, map cluster | tap | highlight it / show what feeds it |

Horizontal swipes need 8pt of travel and 1.2× more horizontal than vertical, so vertical scrolling stays native.

## Data contract
Times are ISO 8601 UTC. The client converts with `timezone` / `utcOffsetMinutes` (Asia/Kolkata, 330).

```ts
Day     { date, weekday, timezone, utcOffsetMinutes, now?, events: Event[], tasks: Task[], inboxCount? }
Event   { id, title, start, end, allDay, area|null, location|null, source: "google"|"agentos", editable }
Task    { id, title, status: "inbox"|"todo"|"doing"|"done"|"dropped", area|null, project|null, goal|null,
          due: "YYYY-MM-DD"|null, scheduled: { start, end }|null, estimateMinutes|null, priority, owner,
          startedAt?, completedAt? }
Area    { slug, name, color }
Goal    { id, title, horizon: "day"|"week"|"month"|"quarter"|"year"|"decade"|"life", period, label, area|null,
          status, progress 0–100, progressMode: "auto"|"manual", measure|null, start, end|null, due|null, parent|null, notes|null }
          aspects?: string[]           // life aspects, used when a goal has no area
Horizon { horizon, period, label }   // current period per horizon
Project { slug, name, area, status, deadline|null, link|null }
Life    { families: {key,name}[], aspects: {key,name,family}[], areaAspects: { [areaSlug]: aspectKey[] },
          snapshots: { date, source, scores: { [aspectKey]: 0–10 } }[] }
```

Files: `mock/today.json` (Day + now + inboxCount), `mock/week.json` ({ from, to, timezone, days: Day[] }), `mock/tasks.json`, `mock/areas.json`, `mock/goals.json` ({ horizons, goals }), `mock/projects.json`, `mock/life.json`, `mock/demo.json` (demo layer: eventAreas, tasks, goals, projects, snapshots).

## API endpoints the app needs
Today the web app talks to `/__agentos` routes on localhost. The iOS app needs a token-protected API reachable from the phone (VPS or a named Cloudflare tunnel).

Read
- `GET /api/v1/today` → Day (events, today's tasks, now, inboxCount)
- `GET /api/v1/week?from=YYYY-MM-DD` → { from, to, timezone, days: Day[] }
- `GET /api/v1/tasks?status=open` (and `?scheduled=false` for the tray)
- `GET /api/v1/areas`, `GET /api/v1/goals` (with `horizons`), `GET /api/v1/projects`
- `GET /api/v1/life` → Life (aspects, mapping, snapshots)

Write
- `POST /api/v1/tasks` { title, area, goal, due, scheduled, estimateMinutes }
- `POST /api/v1/inbox` { text } for raw capture
- `PATCH /api/v1/tasks/:id` { title, status, area, goal, due, scheduled|null, estimateMinutes } covers done, undo, start, pause, defer, drop, schedule, unschedule, move
- `PATCH /api/v1/events/:id` { start, end, area } to move a Google Calendar block and set its area
- `POST /api/v1/areas/:slug/rules` { pattern } (same as `agentos area rule`)
- `POST /api/v1/goals`, `PATCH /api/v1/goals/:id` { progress, status, parent, aspects, … }
- `POST /api/v1/life/snapshots` { date, scores } and `PUT /api/v1/life/area-aspects` for the mapping
- `POST /api/v1/projects`, `PATCH /api/v1/projects/:slug` (agentos already has `project add` and `project set`)

Also needed
- `startedAt` and `completedAt` on tasks (the CLI has start/done but the JSON does not expose times), plus `estimateMinutes` (the CLI has `--for`).
- An `updatedSince` (or ETag) on reads so the app can sync cheaply. Push notifications later.
- Area tagging for the untagged class blocks, either via rules or `PATCH /events/:id`.

## Not built yet
- Resize a block by dragging its edge.
- Drag across days in Week view.
- Project detail pages and inbox triage (assign area in one swipe).
- Editing manual goal progress, and multi-line title editing.
- A keyboard alternative for drag-to-move (the tray grip already offers "plan in next gap").
- Real sync.
