// The Clients module against a copy of the client system's file formats, written to a temp dir: the board, NOW.md,
// dossiers, work logs, OS cards, payments, contracts, goals, leads and WORKFLOWS.md, with the real formats' quirks
// (both work-log heading styles, blank templates, CRLF, a client with no OS folder) and private files that must stay shut.
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { _resetCache, crm, dueLabel, readSystem, readText, scrub, SNAPSHOT, stageOf, waitingList } from "./crm";
import type { ModCtx } from "./types";

const root = mkdtempSync(join(tmpdir(), "aos-crm-"));
const brain = join(root, "studio-brain"), os = join(root, "studio-os");
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text.replace(/^\n/, "")); };
const TODAY = "2026-10-21";

// ── the brain ──
put(join(brain, "clients", "_pipeline.md"), `
# Client pipeline — the board

> updated: 2026-10-17 · Stages: \`lead → pilot → active → paused → churned\`. Every stage change updates this row.

## Customers and pilots

| Client | Product / work | Stage | Since | Notes |
|---|---|---|---|---|
| \`acme-tiles\` | **Tile Desk** (stock app for them) | active, unpaid | 2026-09-02 | Customer. Live on their stock. Alex will chase the setup fee. |
| \`harbor-sons\` | **Harborline OS** (ShopBrain rebuilt for them) | active, unpaid | 2026-10-10 | Customer for Harborline OS. |

## Not clients

| Slug | Why |
|---|---|
| \`old-brand\` | Retired as a client 2026-10-17 (D-035). History only. |
| \`free-club\` | Never a client (D-022). Free build; never count it anywhere. |

## Leads

| Lead | Stage | Notes |
|---|---|---|
| \`blue-door\` | warming | Met at the fair. |

## Paused / Churned

*(none — record with date + one-line reason)*
`);
put(join(brain, "NOW.md"), `
# NOW — live state

## Active clients

| Client | Stage | Notes |
|---|---|---|
| \`acme-tiles\` | active, unpaid | Live. Alex will chase the setup fee. |

## Open loops

- [ ] **Acme Tiles stock app (2026-10-12):** live on their stock; two reports left. **Waiting on Alex:** confirm the GST rate, pick the report font (serif or sans, his call), send the invoice. Runbooks: repo \`docs/RUN.md\`.

- [ ] **Acme Tiles: the warehouse login is still shared** — one password for four people.
- [x] **Acme Tiles go-live** — done 2026-10-01.
- [ ] 🚪 **Free Club: reveal date unknown** — nobody has set one.
- [ ] **Something else entirely** — not about any client.

## Open decisions (Alex's word needed)

0. **WHAT IS STILL OPEN.** Answered 2026-10-08: Acme Tiles is a customer (D-040).
   - ~~a. Is Acme a customer?~~ **ANSWERED — D-040.** Acme Tiles stays.
   - **b. How do products get priced** — open.
2. **Acme Tiles annual plan (2026-10-18, Claude, not a ruling).** Offer Acme Tiles a yearly price.
3. Logo: which variant wins? — **DEFERRED by Alex ("later"); don't surface until he raises it** — Acme Tiles mockups use it.
`);
put(join(brain, "clients", "acme-tiles", "dossier.md"), `
# Acme Tiles (ACME) — dossier

> updated: 2026-10-19

## Basics

| Field | Value |
|---|---|
| Phone / WhatsApp | +91 98100 12345 |
| Address | Plot No. 14, Midtown, New Delhi 110001 |

## Commercials

- Setup fee not paid yet.

## Working setup

Owner inputs remain: the GST certificate, the shop hours and the logo file.

## Health

🟡 paying slowly; the owner answers within a day.
`);
put(join(brain, "clients", "acme-tiles", "work-log.md"), `
# Acme Tiles — work log

> append-only. Newest at the bottom.

## 2026-09-02 — onboarded
- Came in through a referral. Called the owner on +91 98100 12345 and mailed owner@acme.in about the quote.

## 2026-10-05 (later) — quote sent

Sent the yearly quote. They asked for a week.

## 2026-10-09: payment received

₹15,000 setup fee came in.
`);
put(join(brain, "clients", "acme-tiles", "results.md"), "# Acme Tiles — results\n");
put(join(brain, "clients", "harbor-sons", "dossier.md"), "# Harbor & Sons (HARBORLINE) — dossier\n\n## Basics\n\nA family friend's shop.\n\n## Commercials\n\n| Field | Value |\n|---|---|\n| Package | Basic + Advanced, **price not final (D-034)** |\n| Locked rate (founding ladder) | ₹ |\n| Billing | {advance / monthly} |\n");
put(join(brain, "clients", "harbor-sons", "work-log.md"), "# Harbor & Sons — work log\n\n## 2026-10-10 — Harborline OS built and live\nWent live on real data.\n");
put(join(brain, "clients", "free-club", "dossier.md"), "# Free Club — dossier\n\n## Health\n\nTraffic light: 🟢/🟡/🔴 (approval latency · payment)\n");
put(join(brain, "clients", "free-club", "work-log.md"), "# Free Club — work log\n\n## 2026-08-19 — intake\nFiled.\n");
put(join(brain, "clients", "_template", "work-log.md"), "# {Client name} — work log\n\n## YYYY-MM-DD — onboarded\n- (how they came in)\n");
put(join(brain, "private", "acme-keys.md"), "SECRET-TOKEN-123 · owner phone +91 98100 99999\n");

// ── the OS ──
put(join(os, "clients", "acme-tiles", "index.md"), `
# Acme Tiles — operational card

> stage: active (build) · package: stock app (yearly) · since: 2026-09-02 · updated: 2026-10-19

**One line:** tile shop in Westside; we run their stock app.

## Opted-in workflows

- [x] stock-import — imported 4,120 items on 2026-09-10. Work pointer: \`stock-import/README.md\`.
- [ ] reports — two left, waiting on Alex's font pick.
- [ ] training: staff session — paused until Diwali.

## Key dates

| What | When |
|---|---|
| send the invoice | Alex sends; ASAP |
| quote list to client | 2026-08-06 — superseded, nothing sent |
| intake | 2026-09-02 — done |
| staff training | 2026-10-23 |
| reveal | unknown (ask) |
| last design pass | committed 2026-10-08 as abc123 |
`);
put(join(os, "clients", "acme-tiles", "payments.md"), [
  "# Acme Tiles — payments ledger", "", "> append-only rows.", "",
  "| Date | What | Amount | Status | Note |", "|---|---|---|---|---|",
  "| 2026-09-02 | Setup fee | ₹15,000 | paid | first half |", "| 2026-10-01 | Year one | ₹30,000 | due | invoice to send |", "",
  "- **Outstanding:** ₹30,000 as of 2026-10-01", "- **Payment behavior:** slow",
].join("\r\n"));
put(join(os, "clients", "acme-tiles", "contract.md"), `
# Acme Tiles — contract

> updated: 2026-09-02

- **Package:** stock app at the yearly rate
- **Term:** 2026-09-02 → rolling yearly.
- **Deliverables (agreed 2026-09-02):** stock app · two reports · one staff session.
- **Payment terms:** half upfront, half at go-live.
`);
put(join(os, "clients", "acme-tiles", "goals.md"), `
# Acme Tiles — goals

## Their words (verbatim wants)

- Know what is in the godown without walking there.

## Real needs (our read)

- Stop double-ordering the same tiles. It costs them every month.

## Agreed targets

| Target | Baseline | Goal | By |
|---|---|---|---|
| Stock counted in the app | 0 | all lines | 2026-11-01 |
| Repeat orders | unknown (ask) | unknown (ask) | — |

## Dreams (long game)

- A second shop.
`);
put(join(os, "clients", "acme-tiles", "contacts.md"), "# Contacts\n\n- Owner: Ramesh, +91 98100 77777, ramesh@acme.in, 12 Tile Market Road\n");
put(join(os, "clients", "acme-tiles", "brand.md"), "# Acme Tiles — brand\n");
mkdirSync(join(os, "clients", "acme-tiles", "stock-import"), { recursive: true });
mkdirSync(join(os, "clients", "acme-tiles", "raw"), { recursive: true });
put(join(os, "clients", "free-club", "index.md"), "# Free Club — operational card\n\n> stage: active (build) · package: website — **free build, ₹0** · since: 2026-08-19 · updated: 2026-08-21\n\n## Key dates\n\n| What | When |\n|---|---|\n| reveal | not scheduled — a surprise |\n");
put(join(os, "clients", "free-club", "payments.md"), "# Free Club — payments ledger\n\n| Date | What | Amount | Status | Note |\n|---|---|---|---|---|\n| 2026-08-19 | website build | ₹0 | n/a | free |\n\n- **Outstanding:** ₹0 as of 2026-08-19\n");
put(join(os, "clients", "free-club", "contract.md"), "# {Client Name} — contract\n\n> updated: {YYYY-MM-DD}\n\n- **Package:** {name} at {rate}\n- **Term:** {start} → {end}\n");
put(join(os, "clients", "free-club", "goals.md"), "# {Client Name} — goals\n\n## Their words (verbatim wants)\n\n- {what the owner literally said they want}\n\n## Real needs (our read)\n\n- {what actually moves their business}\n");
put(join(os, "sales", "blue-door", "index.md"), `
# Blue Door Cafe — lead card

> stage: warming · source: the fair · since: 2026-10-02 · updated: 2026-10-15
> **next-touch: 2026-10-23 — call about the menu app** ← sacred; the weekly/nightly pass surfaces this

**One line:** cafe that wants a menu and order app.

- **Warmth:** hint dropped — asked what it would cost
`);
put(join(os, "sales", "blue-door", "potential.md"), "# Blue Door — potential\n\n- **Deal size guess:** unknown (ask) · confidence low\n- **Likely entry product:** menu app\n");
put(join(os, "sales", "blue-door", "pitch.md"), "# Blue Door — how to pitch THEM\n\n- **Angle:** unknown (ask)\n");
put(join(os, "sales", "ghost-lead", "index.md"), "# Ghost Lead — lead card\n\n> stage: new · source: unknown (ask) · since: 2026-07-18 · updated: 2026-07-18\n> **next-touch: unknown (ask) — {what to do then}**\n\n- **Warmth:** unknown (ask) — cold / hint dropped / asked for pricing / ready\n");
put(join(os, "_templates", "client", "index.md"), "# {Client Name} — operational card\n\n> stage: {onboarding | active | paused | churned} · package: {CE-30} · since: {YYYY-MM-DD}\n");
put(join(os, "_templates", "lead", "index.md"), "# {Lead Name} — lead card\n\n> stage: {new | warming | pitched | negotiating | snoozed | dead} · source: {who}\n");
put(join(os, "WORKFLOWS.md"), `
# Northwind OS — Workflow Board

## The catalog (v1 — full board)

| Dept | Workflow | Form | Gate | Status |
|---|---|---|---|---|
| **Sales (= leads)** | lead-intake | SKILL | — | **v1 BUILT 2026-07-18** |
| | prepare-pitch | SKILL | pitch plan: Alex | spec'd below |
| **Audit (own dept — paid service)** | audit-xray (research + report) | workflow | report: Alex | spec'd below |
| **Content engine (per client)** | content-calendar → reel-scripting | workflow branch | — | catalog, spec next round |
| **Web/Tech** | website-build (11 phases, hybrid skill+folder) | SKILL drives | — | **spec'd below; step 0 \`web-client-intake\` v1, in test** |
| **Ads (= forced-leads dept)** | campaign-setup · weekly-optimization | workflow | spend: Alex | catalog |

### 2. prepare-pitch — SKILL

- Pitch prep = what we say and how we sell them.
`);
put(join(os, "skills", "lead-intake", "SKILL.md"), "---\nname: lead-intake\n---\n");
put(join(os, "skills", "web-client-intake", "SKILL.md"), "---\nname: web-client-intake\n---\n");

const dirs = { brain, os };
const sys = () => readSystem(dirs, TODAY);
const client = (slug: string) => sys().clients.find((c) => c.slug === slug)!;

function ctx(path: string, { method = "GET", body = {}, owner = true, conf = {} as Record<string, string> } = {}): ModCtx {
  const url = new URL(`http://local/api/v1/mod/crm${path}`);
  const c = (k: string, d: string) => ({ STUDIO_BRAIN: brain, STUDIO_OS: os, ...conf } as Record<string, string>)[k] ?? d;
  return {
    req: new Request(url, { method }), url, method, path: url.pathname.slice("/api/v1/mod/crm".length),
    user: { id: 1, role: owner ? "owner" : "member" } as any, owner, dbPath: "", contentDbPath: "", dataDir: join(root, "data"), store: {} as any,
    db: () => { throw new Error("no agentos db in these tests"); }, agentos: async () => ({}), conf: c, ai: {} as any,
    codex: async () => { throw new Error("no agents in tests"); }, wyn: null, push: async () => {},
    body: async () => body, json: (j, status = 200) => Response.json(j, { status }), fail: (status, error) => Response.json({ error }, { status }), log: () => {},
  };
}
async function call(path: string, opts?: Parameters<typeof ctx>[1]) {
  const r = await crm.handle(ctx(path, opts));
  if (!r) throw new Error(`no route for ${path}`);
  return { status: r.status, data: (await r.json()) as any, text: "" };
}
beforeEach(() => _resetCache());

describe("the board and NOW.md", () => {
  test("the roster: customers, a free build, a retired client and leads, each in its place", () => {
    const s = sys();
    expect(s.clients.map((c) => c.slug)).toEqual(["acme-tiles", "harbor-sons", "free-club"]);
    expect(s.retired).toEqual([{ slug: "old-brand", name: "Old brand", note: "Retired as a client 2026-10-17 (D-035)" }]);
    expect(client("free-club").free).toBe(true);
    expect(client("free-club").freeNote).toBe("Never a client (D-022)");
    expect(s.leads.map((l) => l.slug).sort()).toEqual(["blue-door", "ghost-lead"]);
    expect(s.stages.client).toEqual(["onboarding", "pilot", "active", "paused", "churned"]);
    expect(s.stages.lead).toEqual(["new", "warming", "pitched", "negotiating", "snoozed", "dead"]);
  });
  test("stage, product and since come from the OS card first, then the board", () => {
    const a = client("acme-tiles");
    expect([a.stage, a.stageNote, a.since, a.product]).toEqual(["active", "build", "Sep 2026", "Tile Desk"]);
    expect(a.src.stage).toBe("index.md");
    const t = client("harbor-sons");
    expect([t.stage, t.stageNote, t.src.stage]).toEqual(["active", "unpaid", "_pipeline.md"]);
    expect(stageOf("Atlas ERP/ShopBrain pilot")).toEqual({ stage: "pilot", note: "Atlas ERP/ShopBrain" });
  });
  test("the next step: an ASAP key date first; waiting-on lists the loops and decisions that name the client", () => {
    const a = client("acme-tiles");
    expect(a.next).toEqual({ text: "Send the invoice", due: "ASAP", owner: "you" });
    const you = a.waitingOn.you.map((x) => x.text);
    expect(you).toContain("Acme Tiles annual plan (open decision 2)");
    expect(you).toContain("Confirm the GST rate");
    expect(you).toContain("Pick the report font (serif or sans, his call)");
    expect(you).toContain("The warehouse login is still shared");
    expect(you.some((t) => /invoice/i.test(t))).toBe(false);          // the same thing as the next step, said once
    expect(you.some((t) => /go-live|Logo|WHAT IS STILL OPEN|still open/i.test(t))).toBe(false);   // done, deferred, answered
    expect(a.waitingOn.them).toEqual(["The GST certificate", "The shop hours", "The logo file"]);
    // the free build's only loop is its next step, so it isn't listed twice; "free" alone is not its name
    const f = client("free-club");
    expect([f.next.text, f.waitingOn.you.length]).toEqual(["Reveal date unknown", 0]);
  });
  test("a date in the coming week comes next; with none, a 'Alex will …' note on NOW.md's table", () => {
    const path = join(os, "clients", "acme-tiles", "index.md");
    const card = readFileSync(path, "utf8");
    try {
      writeFileSync(path, card.replace("| send the invoice | Alex sends; ASAP |\n", ""));
      expect(client("acme-tiles").next).toEqual({ text: "Staff training", due: "Fri 23", owner: "you" });
      writeFileSync(path, card.replace("| send the invoice | Alex sends; ASAP |\n", "").replace("2026-10-23", "2026-11-23"));
      expect(client("acme-tiles").next).toEqual({ text: "Chase the setup fee", due: "No date", owner: "you" });
    } finally { writeFileSync(path, card); }
  });
  test("'Waiting on Alex:' splits at top-level commas only and stops at the next labelled sentence", () => {
    expect(waitingList("x. **Waiting on Alex:** a thing (with, commas), `b, c`, and the last one. Runbooks: e.")).toEqual(["A thing (with, commas)", "B, c", "The last one"]);
    expect(waitingList("**Waiting on Alex:** (1) offsite: pick one; (2) a retention rule")).toEqual(["Offsite: pick one", "A retention rule"]);
  });
});

describe("one client's files", () => {
  test("health is the dossier's traffic light; the template's three lights are not a reading", () => {
    expect([client("acme-tiles").health, client("acme-tiles").healthNote]).toEqual(["yellow", "paying slowly; the owner answers within a day."]);
    expect(client("free-club").src.health).toBe("snapshot");
  });
  test("work log: both heading styles and (later) qualifiers, newest first, one sentence each", () => {
    const log = client("acme-tiles").log;
    expect(log.map((e) => [e.date, e.title])).toEqual([["2026-10-09", "Payment received"], ["2026-10-05", "Quote sent"], ["2026-09-02", "Onboarded"]]);
    expect(log[1]).toMatchObject({ qualifier: "later", body: "Sent the yearly quote." });
    expect(log[2].body).toBe("Came in through a referral.");
  });
  test("the OS card: opted-in workflows with their state and folder, and key dates said the phone's way", () => {
    const a = client("acme-tiles");
    expect(a.workflows.map((w) => [w.name, w.status, w.folder])).toEqual([["Stock import", "done", "stock-import"], ["Reports", "waiting on you", null], ["Training", "paused", null]]);
    expect(a.keyDates.map((k) => [k.what, k.when, k.tone])).toEqual([["Send the invoice", "ASAP", "late"], ["Staff training", "Fri 23", ""], ["Reveal", "Unknown", "quiet"], ["Last design pass", "8 Oct", "quiet"]]);
    expect(client("free-club").keyDates).toEqual([{ what: "Reveal", when: "Not scheduled", iso: null, tone: "quiet" }]);
  });
  test("payments (CRLF), contract and goals; free work owes nothing", () => {
    const a = client("acme-tiles");
    expect(a.money).toMatchObject({ outstanding: "₹30,000", state: "due", asOf: "2026-10-01" });
    expect(a.money.rows.map((r) => [r.what, r.amount, r.status])).toEqual([["Setup fee", "₹15,000", "paid"], ["Year one", "₹30,000", "due"]]);
    expect(a.contract).toMatchObject({ term: "2026-09-02 → rolling yearly", deliverables: ["Stock app", "Two reports", "One staff session"], payment: "half upfront, half at go-live" });
    expect(a.goals).toEqual(["Know what is in the godown without walking there.", "Stop double-ordering the same tiles.", "Stock counted in the app: all lines"]);
    expect(client("free-club").money).toMatchObject({ outstanding: "₹0", state: "none" });
  });
  test("the dossier's commercials: table rows with their labels, bullets as notes, blank template cells left out", () => {
    expect(client("acme-tiles").commercials).toEqual([{ label: "", value: "Setup fee not paid yet." }]);
    expect(client("harbor-sons").commercials).toEqual([{ label: "Package", value: "Basic + Advanced, price not final (D-034)" }]);
    expect(client("free-club").commercials).toEqual([]);
  });
  test("Files lists the folders without contacts.md, dotfiles or private/", () => {
    expect(client("acme-tiles").files).toEqual({ os: ["index.md", "payments.md", "contract.md", "goals.md", "brand.md", "raw/", "stock-import/"].sort((a, b) => (a === "raw/" ? 1 : b === "raw/" ? -1 : 0)), brain: ["dossier.md", "work-log.md", "results.md"] });
  });
  test("leads: stage, warmth, a dated next touch, and an unknown one", () => {
    const s = sys();
    const b = s.leads.find((l) => l.slug === "blue-door")!, g = s.leads.find((l) => l.slug === "ghost-lead")!;
    expect([b.name, b.stage, b.warmth, b.since, b.source, b.potential, b.pitch, b.onBoard]).toEqual(["Blue Door Cafe", "warming", "warm", "Oct 2026", "the fair", "Menu app", "Not started", true]);
    expect(b.nextTouch).toEqual({ text: "Fri 23 · Call about the menu app", set: true, iso: "2026-10-23", what: "call about the menu app" });
    expect([g.warmth, g.nextTouch.text, g.nextTouch.set, g.onBoard]).toEqual(["unknown", "Not set (ask)", false, false]);
  });
  test("workflows: built from skills/, spec'd or only named, agency-era ones need his OK", () => {
    const w = Object.fromEntries(sys().workflows.map((x) => [x.id, x]));
    expect(w["lead-intake"]).toMatchObject({ built: true, for: "lead", needsOk: false, name: "Lead intake" });
    expect(w["prepare-pitch"]).toMatchObject({ built: false, spec: true, for: "lead", needsOk: false });
    expect(w["audit-xray"]).toMatchObject({ built: false, spec: true, for: "client", needsOk: true });
    expect(w["web-client-intake"]).toMatchObject({ built: true, for: "client" });
    expect(w["campaign-setup"]).toMatchObject({ built: false, spec: false, for: "client", needsOk: true });
  });
});

describe("fallbacks and sync issues", () => {
  test("a client with no OS folder takes money, workflows, dates, contract and goals from the snapshot, and says so", () => {
    const t = client("harbor-sons");
    expect(t.osFolder).toBeNull();
    expect(t.money.rows).toEqual(SNAPSHOT["harbor-sons"].money.rows);
    expect(t.health).toBe(SNAPSHOT["harbor-sons"].health);
    for (const k of ["money", "workflows", "keyDates", "contract.term", "goals", "health"]) expect(t.src[k]).toBe("snapshot");
    expect(t.src.log).toBe("work-log.md");
    const issue = sys().issues.find((i) => i.kind === "missing-os-folder")!;
    expect(issue).toMatchObject({ slugs: ["harbor-sons"], text: "1 client has no OS folder yet" });
  });
  test("a blank template is a fallback and an issue; so is a ledger the work log has moved past", () => {
    const f = client("free-club");
    expect([f.src["contract.term"], f.src.goals]).toEqual(["snapshot", "snapshot"]);
    const kinds = sys().issues.map((i) => [i.kind, i.slugs?.join(",")]);
    expect(kinds).toContainEqual(["template-unfilled", "free-club"]);
    expect(kinds).toContainEqual(["ledger-behind", "acme-tiles"]);
    expect(kinds).toContainEqual(["lead-not-on-board", "ghost-lead"]);
    expect(sys().issues.find((i) => i.kind === "ledger-behind")!.text).toBe("Acme Tiles: the work log has a payment note from 9 Oct; payments.md was last balanced 1 Oct");
  });
  test("no brain and no OS on disk: the whole snapshot, with the reason", () => {
    const s = readSystem({ brain: join(root, "nowhere-brain"), os: join(root, "nowhere-os") }, TODAY);
    expect(s.clients.map((c) => c.slug)).toEqual(Object.keys(SNAPSHOT));
    expect(s.clients.every((c) => c.src.money === "snapshot" && c.src.health === "snapshot")).toBe(true);
    expect(s.issues.map((i) => i.kind)).toEqual(["no-brain", "no-os"]);
    expect(s.leads.map((l) => l.name)).toEqual(["Silver Lens"]);
  });
  test("due labels", () => {
    expect(["2026-10-21", "2026-10-19", "2026-10-22", "2026-10-24", "2026-11-09", "2027-01-02"].map((d) => dueLabel(d, TODAY)))
      .toEqual(["Today", "Overdue 2 days", "Tomorrow", "Sat 24", "9 Nov", "2 Jan 2027"]);
  });
});

describe("privacy", () => {
  test("private/ and contacts.md are never opened", () => {
    expect(() => readText(join(brain, "private", "acme-keys.md"))).toThrow("never reads");
    expect(() => readText(join(os, "clients", "acme-tiles", "contacts.md"))).toThrow("never reads");
    expect(() => readText(join(os, "clients", "acme-tiles", "CONTACTS.md"))).toThrow("never reads");
  });
  test("no phone, email or address leaves, even where a work log has one", async () => {
    for (const path of ["/overview", "/clients/acme-tiles", "/leads/blue-door"]) {
      const r = await call(path);
      expect(r.status).toBe(200);
      const text = JSON.stringify(r.data);
      for (const bad of ["98100", "@acme.in", "SECRET-TOKEN", "Ramesh", "Tile Market Road", "110001", "Plot No"]) expect(text).not.toContain(bad);
    }
    expect((await call("/clients/acme-tiles")).data.client.log.at(-1).body).toBe("Came in through a referral.");
    expect(scrub("Call +91 98100 12345 or 011-2345 6789, mail a.b@c.co.in, New Delhi 110001, House No. 4")).toBe("Call [number hidden] or [number hidden], mail [email hidden], New Delhi [PIN hidden], [address hidden]");
    expect(scrub("428,420 bills on 2026-10-19, release 20261019-110018-2ada817a, ₹40,000")).toBe("428,420 bills on 2026-10-19, release 20261019-110018-2ada817a, ₹40,000");
  });
});

describe("routes", () => {
  test("owner only", async () => {
    expect((await call("/overview", { owner: false })).status).toBe(403);
  });
  test("overview: money across clients, health counts, write off by default, issues", async () => {
    const { data } = await call("/overview");
    expect(data.money).toEqual({ paid: 15000, due: 30000, approx: false, unpriced: 1, billed: 45000 });
    expect(data.health).toEqual({ green: 1, yellow: 2, red: 0 });
    expect(data.write.on).toBe(false);
    expect(data.clients[0].log.length).toBeLessThanOrEqual(3);
    expect(data.clients[0].files).toBeUndefined();
    expect(data.sync).toMatchObject({ source: "studio-os + studio-brain", found: { brain: true, os: true } });
  });
  test("one client, one lead, workflows; unknown and retired slugs 404", async () => {
    expect((await call("/clients/acme-tiles")).data.client.logCount).toBe(3);
    expect((await call("/leads/blue-door")).data.lead.name).toBe("Blue Door Cafe");
    expect((await call("/workflows")).data.workflows.length).toBeGreaterThan(3);
    expect((await call("/clients/nobody")).status).toBe(404);
    expect((await call("/clients/old-brand")).data.error).toContain("retired");
    expect((await call("/leads/nobody")).status).toBe(404);
  });
  test("reads are cached for 60 s; ?fresh=1 reads again", async () => {
    const path = join(brain, "clients", "acme-tiles", "dossier.md");
    const before = readFileSync(path, "utf8");
    expect((await call("/clients/acme-tiles")).data.client.health).toBe("yellow");
    writeFileSync(path, before.replace("🟡", "🔴"));
    try {
      expect((await call("/clients/acme-tiles")).data.client.health).toBe("yellow");
      expect((await call("/clients/acme-tiles?fresh=1")).data.client.health).toBe("red");
    } finally { writeFileSync(path, before); }
  });
});

describe("the write guard", () => {
  const log = join(brain, "clients", "acme-tiles", "work-log.md");
  test("Log work is refused while CRM_WRITE is off, and the file is untouched", async () => {
    const before = readFileSync(log, "utf8");
    const r = await call("/clients/acme-tiles/log", { method: "POST", body: { text: "Sent the invoice" } });
    expect(r.status).toBe(403);
    expect(r.data.error).toContain("CRM_WRITE=on");
    expect((await call("/clients/acme-tiles/log", { method: "POST", body: { text: "x y" }, conf: { CRM_WRITE: "off" } })).status).toBe(403);
    expect(readFileSync(log, "utf8")).toBe(before);
  });
  test("with CRM_WRITE=on it appends one dated entry and keeps every earlier byte", async () => {
    const before = readFileSync(log, "utf8");
    const r = await call("/clients/acme-tiles/log", { method: "POST", conf: { CRM_WRITE: "on" }, body: { text: "Sent the invoice\nThey will pay Friday.\n## not a heading" } });
    expect(r.status).toBe(201);
    const after = readFileSync(log, "utf8");
    expect(after.startsWith(before)).toBe(true);
    const added = after.slice(before.length);
    expect(added).toMatch(/^\n## \d{4}-\d\d-\d\d — Sent the invoice\n\nThey will pay Friday\.\n\\## not a heading\n$/);
    expect(r.data.entry.title).toBe("Sent the invoice");
    expect(r.data.client.log[0].title).toBe("Sent the invoice");
    writeFileSync(log, before);
  });
  test("it refuses an empty entry and a client without a work log", async () => {
    expect((await call("/clients/acme-tiles/log", { method: "POST", conf: { CRM_WRITE: "on" }, body: { title: " " } })).status).toBe(400);
    expect((await call("/clients/nobody/log", { method: "POST", conf: { CRM_WRITE: "on" }, body: { title: "x y" } })).status).toBe(404);
  });
});
