// The OS redesigns itself from your thumbs (big idea 10), server side. app/modules/thumbs.js posts what the
// thumbs did (tab, a short target selector, hesitation from page open to first tap; never a value) and this
// module stores it in the user's agentos db (tables from the CLI's thumbs module). On the 1st at 09:00, or
// on POST /run, the last 30 days are summed in code (agentos thumbs) and one Sonnet call proposes three UI
// changes grounded in those numbers, each with a phone-width mockup in the app's design language. Mockups
// live under <dataDir>/mod/thumbs/mockups/<id>.html; accepting one makes a task "UI: <title>" with the path in its notes.
//   POST /events                 { events: [{ at, tab, target, hesitation_ms }] }   any signed-in user
//   GET  /summary                numbers, the latest proposals, and whether a run is going
//   GET  /proposals?all=1 · GET /mockups/:id[?json=1] · POST /run · POST /proposals/:id/accept · POST /proposals/:id/decline
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JobCtx, ModCtx, Module } from "./types";

const APP_DIR = resolve(import.meta.dir, "..", "..", "app");
const OFFSET = 330;
const istDate = (d = new Date()) => new Date(d.getTime() + OFFSET * 60000).toISOString().slice(0, 10);
const hasTables = (db: Database) => !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'thumbs_events'").get();
async function ensure(ctx: JobCtx) {
  if (hasTables(ctx.db())) return;
  await ctx.agentos(["mods"]);
  if (!hasTables(ctx.db())) throw new Error("The agentos CLI in use has no thumbs module; build it from feat/mod-observe and point AGENTOS_BIN at it.");
}
const mockupDir = (ctx: JobCtx) => join(ctx.dataDir, "mod", "thumbs", "mockups");
const shape = (p: any) => {
  let numbers: string[] = [];
  try { const v = JSON.parse(p.numbers ?? "[]"); numbers = Array.isArray(v) ? v.map(String) : []; } catch {}
  return { id: `u${p.id}`, month: p.month, title: p.title, reason: p.reason ?? "", numbers, mockup: p.mockup_path ? `/api/v1/mod/thumbs/mockups/u${p.id}` : null,
    status: p.status, task: p.task_id ? `t${p.task_id}` : null, createdAt: p.created_at, decidedAt: p.decided_at ?? null };
};

// ── events ──────────────────────────────────────────────────────────────────
async function ingest(ctx: ModCtx) {
  const b = await ctx.body();
  const list: any[] = Array.isArray(b?.events) ? b.events.slice(0, 500) : [];
  if (!list.length) return ctx.fail(400, "Send { events: [...] }.");
  const ins = ctx.db().prepare("INSERT INTO thumbs_events (at, tab, target, hesitation_ms, user_id) VALUES (?, ?, ?, ?, ?)");
  let stored = 0;
  ctx.db().transaction(() => {
    for (const e of list) {
      const at = typeof e?.at === "string" && Number.isFinite(Date.parse(e.at)) && Math.abs(Date.now() - Date.parse(e.at)) < 7 * 864e5 ? new Date(e.at).toISOString() : new Date().toISOString();
      const tab = String(e?.tab ?? "?").replace(/\s+/g, " ").trim().slice(0, 40) || "?";
      const target = String(e?.target ?? "?").replace(/\s+/g, " ").trim().slice(0, 80) || "?";
      const h = e?.hesitation_ms == null ? null : Math.max(0, Math.min(600_000, Math.round(Number(e.hesitation_ms))));
      ins.run(at, tab, target, Number.isFinite(h as number) ? h : null, ctx.user.id);
      stored++;
    }
  })();
  return ctx.json({ ok: true, stored });
}

// ── the monthly run ─────────────────────────────────────────────────────────
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { proposals: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false,
    properties: { title: { type: "string" }, reason: { type: "string" }, numbers: { type: "array", items: { type: "string" }, maxItems: 6 }, mockupHtml: { type: "string" } },
    required: ["title", "reason", "numbers", "mockupHtml"] } } },
  required: ["proposals"],
};
/** The design tokens and a screen's worth of markup from the app, so the mockups speak its language. */
export function designMaterial() {
  let css = "", html = "";
  try { css = readFileSync(join(APP_DIR, "styles.css"), "utf8"); } catch {}
  try { html = readFileSync(join(APP_DIR, "index.html"), "utf8"); } catch {}
  const block = (sel: string) => { const i = css.indexOf(`${sel} {`); if (i < 0) return ""; const j = css.indexOf("\n}", i); return css.slice(i, j + 2); };
  const lines = [".large-title", ".tab-intro", ".detail-hero", ".detail-kicker", ".detail-title", ".detail-sub", ".detail-card", ".act", ".act.primary", ".act.wide",
    ".chip", ".chip.area", ".area-list", ".area-row", ".brief-card", ".ai-kicker", ".ai-btn", ".ai-btn.primary", ".ai-pill", ".empty-line"]
    .map((sel) => css.split("\n").find((l) => l.startsWith(`${sel} {`)) ?? "").filter(Boolean);
  const tokens = [block(":root"), block(':root[data-theme="dark"]'), ...lines].join("\n");
  const trimSvg = (s: string) => s.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>");
  const today = html.match(/<section class="page" id="pageToday"[\s\S]*?<\/section>/)?.[0] ?? "";
  const tabbar = html.match(/<nav class="tabbar-wrap"[\s\S]*?<\/nav>/)?.[0] ?? "";
  return { tokens: tokens.slice(0, 9000), markup: trimSvg(`${today}\n${tabbar}`).slice(0, 7000) };
}
/** Scripts and handlers never make it into a stored mockup; the pages also render it in a sandboxed frame. */
export function sanitizeMockup(html: string, tokens: string) {
  let h = String(html).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<script[^>]*>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "").replace(/<iframe[\s\S]*?<\/iframe>/gi, "").replace(/<(object|embed)[^>]*>/gi, "");
  if (!/<html/i.test(h)) h = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${tokens}\n* { box-sizing: border-box; margin: 0; padding: 0; } body { width: 402px; margin: 0 auto; min-height: 100vh; background: var(--bg); color: var(--label); font: 400 17px/1.29 var(--font); }</style></head><body>${h}</body></html>`;
  else if (!/--surface/.test(h)) h = h.replace(/<\/head>/i, `<style>${tokens}</style></head>`);
  return h;
}
type RunState = { running: boolean; startedAt: string; finishedAt?: string; count?: number; error?: string; why: string };
const runs = new Map<number, RunState>();
export async function runNow(ctx: JobCtx, why: string) {
  const uid = ctx.user.id;
  if (runs.get(uid)?.running) return runs.get(uid)!;
  const state: RunState = { running: true, startedAt: new Date().toISOString(), why };
  runs.set(uid, state);
  const db = new Database(ctx.dbPath);
  db.exec("PRAGMA busy_timeout = 5000;");
  try {
    const summary = await ctx.agentos(["thumbs", "--days", "30"]);
    const { tokens, markup } = designMaterial();
    const month = istDate().slice(0, 7);
    const earlier = (db.query("SELECT title, status FROM thumbs_proposals WHERE status IN ('accepted', 'declined') ORDER BY id DESC LIMIT 12").all() as any[])
      .map((p) => `- ${p.title} (${p.status})`).join("\n");
    const r = await ctx.ai.claude({
      model: "sonnet", schema: SCHEMA, timeout: 540_000,
      system: `You are the product designer of Agentic OS, Alex's phone app: tabs Today (a day timeline past a fixed now line), Tasks, Goals, Areas, Life (a wheel of nine aspects), More (modules).
Design rules: monochrome chrome, colour only from areas; anything the AI proposes is pencilled in (dashed outline) until the user keeps it; no sparkles or gradients; phone width 402 px with 16 px side gutters;
SF Pro / Inter, large title 34 px bold, cards on var(--surface) with 16–18 px corners, buttons .act 50 px tall with 14 px corners, hit targets at least 44 px.
You get the numbers of the last 30 days of use. Propose exactly three UI changes, each grounded in those numbers: a short title, a reason in two sentences that cites the numbers,
the numbers you leaned on (as short strings), and a mockup. A mockup is one self-contained HTML document at 402 px wide, inline <style> only, no scripts, no external assets,
showing the changed screen after the change, using the CSS tokens below (copy the :root block into the mockup's <style>) and the markup conventions of the real screen. Keep each mockup under 7000 characters.
Prefer changes that remove friction where hesitation is high, promote what is tapped most, and retire or fold screens that are dead. Do not propose what was already accepted or declined.`,
      prompt: `CSS tokens and a few rules from app/styles.css:\n${tokens}\n\nMarkup of the Today screen and the tab bar (SVGs collapsed):\n${markup}\n\nNumbers from the last 30 days (agentos thumbs):\n${JSON.stringify(summary, null, 1)}\n\n${earlier ? `Earlier proposals, already decided:\n${earlier}\n\n` : ""}Return the three proposals.`,
    });
    const list = Array.isArray(r.out?.proposals) ? r.out.proposals : [];
    const dir = mockupDir(ctx);
    mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    db.query("UPDATE thumbs_proposals SET status = 'replaced', decided_at = ? WHERE month = ? AND status = 'open'").run(now, month);
    let count = 0;
    for (const p of list.slice(0, 3)) {
      const title = String(p?.title ?? "").trim().slice(0, 80), reason = String(p?.reason ?? "").trim().slice(0, 600);
      const numbers = Array.isArray(p?.numbers) ? p.numbers.map((x: unknown) => String(x).slice(0, 120)).slice(0, 6) : [];
      const html = String(p?.mockupHtml ?? "");
      if (!title || html.length < 120) continue;
      const row = db.query("INSERT INTO thumbs_proposals (month, title, reason, numbers, status, created_at) VALUES (?, ?, ?, ?, 'open', ?) RETURNING id")
        .get(month, title, reason, JSON.stringify(numbers), now) as any;
      const path = join(dir, `u${row.id}.html`);
      writeFileSync(path, sanitizeMockup(html, tokens));
      db.query("UPDATE thumbs_proposals SET mockup_path = ? WHERE id = ?").run(path, row.id);
      count++;
    }
    Object.assign(state, { running: false, finishedAt: new Date().toISOString(), count });
    ctx.log(`run (${why}): ${count} proposals in ${r.ms} ms`);
    if (count) ctx.push("Three UI ideas from your thumbs", list.map((p: any) => String(p?.title ?? "")).filter(Boolean).join(" · ").slice(0, 200), { page: "thumbs" }).catch(() => {});
  } catch (e: any) {
    Object.assign(state, { running: false, finishedAt: new Date().toISOString(), error: String(e?.message ?? e).slice(0, 300) });
    ctx.log(`run failed: ${state.error}`);
  } finally { db.close(); }
  return state;
}

// ── the module ──────────────────────────────────────────────────────────────
const latest = (db: Database) => (db.query(`SELECT * FROM thumbs_proposals WHERE status != 'replaced' AND month = (SELECT max(month) FROM thumbs_proposals WHERE status != 'replaced') ORDER BY id`).all() as any[]).map(shape);
export const thumbs: Module = {
  name: "thumbs",
  async handle(ctx) {
    const p = ctx.path, m = ctx.method;
    try { await ensure(ctx); } catch (e: any) { return ctx.fail(503, e?.message ?? String(e)); }
    if (p === "/events" && m === "POST") return ingest(ctx);
    if (!ctx.owner) return ctx.fail(403, "The proposals are the owner's.");
    if (p === "/summary" && m === "GET") {
      const summary = await ctx.agentos(["thumbs", "--days", "30"]);
      return ctx.json({ ok: true, month: istDate().slice(0, 7), summary, proposals: latest(ctx.db()), run: runs.get(ctx.user.id) ?? null });
    }
    if (p === "/proposals" && m === "GET") {
      const all = ctx.url.searchParams.get("all") === "1";
      return ctx.json({ ok: true, proposals: all ? (ctx.db().query("SELECT * FROM thumbs_proposals ORDER BY id DESC").all() as any[]).map(shape) : latest(ctx.db()) });
    }
    const mk = p.match(/^\/mockups\/u?(\d+)$/);
    if (mk && m === "GET") {
      const row = ctx.db().query("SELECT mockup_path FROM thumbs_proposals WHERE id = ?").get(Number(mk[1])) as any;
      if (!row?.mockup_path || !existsSync(row.mockup_path)) return ctx.fail(404, "No mockup for that proposal.");
      const html = readFileSync(row.mockup_path, "utf8");
      if (ctx.url.searchParams.get("json") === "1") return ctx.json({ ok: true, html });
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data:" } });
    }
    if (p === "/run" && m === "POST") {
      const cur = runs.get(ctx.user.id);
      if (cur?.running) return ctx.json({ ok: true, run: cur });
      void runNow(ctx, "manual"); // the run outlives this request; it opens its own db handle
      await Bun.sleep(50);
      return ctx.json({ ok: true, run: runs.get(ctx.user.id) }, 202);
    }
    const act = p.match(/^\/proposals\/u?(\d+)\/(accept|decline)$/);
    if (act && m === "POST") {
      const db = ctx.db(), id = Number(act[1]);
      const row = db.query("SELECT * FROM thumbs_proposals WHERE id = ?").get(id) as any;
      if (!row) return ctx.fail(404, "No such proposal.");
      if (row.status !== "open") return ctx.fail(409, `Already ${row.status}.`);
      const now = new Date().toISOString();
      if (act[2] === "decline") {
        db.query("UPDATE thumbs_proposals SET status = 'declined', decided_at = ? WHERE id = ?").run(now, id);
        return ctx.json({ ok: true, proposal: shape(db.query("SELECT * FROM thumbs_proposals WHERE id = ?").get(id)) });
      }
      const notes = `${row.reason ?? ""}\n\nMockup: ${row.mockup_path ?? "(none)"}\nNumbers: ${shape(row).numbers.join("; ")}\nSource: thumbs ${row.month}`;
      const title = `UI: ${row.title}`;
      let r: any;
      try { r = await ctx.agentos(["add", title, "--area", "projects", "--notes", notes, "--source", "thumbs"]); }
      catch { r = await ctx.agentos(["add", title, "--notes", notes, "--source", "thumbs"]); }
      const taskId = Number(String(r?.task?.id ?? "").replace(/^t/, "")) || null;
      db.query("UPDATE thumbs_proposals SET status = 'accepted', task_id = ?, decided_at = ? WHERE id = ?").run(taskId, now, id);
      return ctx.json({ ok: true, proposal: shape(db.query("SELECT * FROM thumbs_proposals WHERE id = ?").get(id)), task: r?.task ?? null });
    }
    return null;
  },
  jobs: [{
    id: "thumbs-monthly", at: "09:00",
    async run(ctx) {
      if (!istDate().endsWith("-01")) return; // the scheduler knows weekdays, not the day of the month
      await ensure(ctx);
      await runNow(ctx, "monthly");
    },
  }],
};
