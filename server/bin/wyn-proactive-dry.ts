// Dry run of Wyn's proactive layer against a data folder (use a copy, never the live one): what she'd be shown
// right now, and the messages she'd send for the rest of today and for a whole fresh day at each level.
// No brain turn, no message, no push; the only writes are the usual table setup when a db is opened.
//   bun server/bin/wyn-proactive-dry.ts --data C:\path\to\data-copy [--level normal]
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { istDate, OFFSET, openStore } from "../store";
import { openWynDb, prefsOf } from "../wyn-tools";
import { pendingFollowups } from "../wyn-learn";
import { PROACTIVE_LEVELS, proactiveLevel, type ProactiveLevel } from "../wyn-settings";
import { agentTransitions, budget, candidates, fresh, loadLog, morningHold, pick, planDay, quietReason, RULES, type Snapshot } from "../wyn-proactive";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const dataDir = arg("data") ?? process.env.DATA_DIR;
if (!dataDir) { console.error("Pass --data <copy of the data folder>."); process.exit(1); }
if (/agentic-os[\\/]data$/i.test(dataDir.replace(/[\\/]+$/, ""))) { console.error("That's the live data folder. Copy it first."); process.exit(1); }

const auth = new Database(join(dataDir, "auth.db"), { readonly: true });
const u = auth.query("SELECT * FROM users WHERE role = 'owner' ORDER BY id LIMIT 1").get() as any;
if (!u) { console.error("No owner in auth.db."); process.exit(1); }
const s = openStore(u.agentos_db, u.events_path || null);
const n = openWynDb(join(dataDir, "wyn", `user-${u.id}`));
const p = prefsOf(n), b = s.bootstrap();
const now = Date.now(), hm = (ms: number) => new Date(ms + OFFSET * 60000).toISOString().slice(11, 16), today = istDate();
const at = (h: string) => Date.parse(`${today}T${h}:00+05:30`);
const sleep = b.sleep ?? { bed: "23:00", wake: "07:00" };
let appJobs: any[] = [];
try { appJobs = s.db.query("SELECT id, title, status, updated_at FROM jobs WHERE status = 'needs_input'").all() as any[]; } catch {}
const log = loadLog(n);
const snap: Snapshot = { now, events: b.week.days.slice(0, 2).flatMap((x: any) => x.events), tasks: b.today.tasks, appJobs,
  followups: pendingFollowups(n, now).filter((f) => !log[f.key]?.sent) };
const midnight = new Date(at("00:00")).toISOString();
const sent = n.query("SELECT text, at FROM messages WHERE role = 'wyn' AND turn LIKE 'reach-%' AND at >= ? ORDER BY id").all(midnight) as any[];
const lastAt = (n.query("SELECT max(at) a FROM messages WHERE role = 'wyn' AND turn LIKE 'reach-%'").get() as any)?.a ?? null;
const calledToday = !!n.query("SELECT 1 FROM calls WHERE started_at >= ? AND coalesce(seconds, 0) >= 20").get(midnight);
const level = (arg("level") as ProactiveLevel) ?? proactiveLevel(p);
const rule = RULES[level];
const awake = sleep.bed > sleep.wake ? hm(now) >= sleep.wake && hm(now) < sleep.bed : hm(now) >= sleep.wake || hm(now) < sleep.bed;
const brief = { morningCall: p.morning_call, wake: sleep.wake, calledToday };

console.log(`Wyn proactive dry run, ${today} ${hm(now)} India time, data ${dataDir}`);
console.log(`Level ${level} (stored: ${p.proactive_level || `unset, proactive=${p.proactive}`}). Rule ${JSON.stringify(rule)}`);
console.log(`Sleep ${sleep.bed}-${sleep.wake}, morning call ${p.morning_call || "off"}, called today: ${calledToday}. Reach-outs today: ${sent.length}, last ${lastAt ?? "never"}.`);
const quiet = quietReason({ level, awake, inCall: false });
const hold = morningHold({ now, ...brief, briefSent: !!log[`brief:${today}`], rule });
const bud = budget(sent.length, lastAt, now, rule, hold);
const all = candidates(snap, rule), fr = fresh(all, log), picked = quiet ? [] : pick(fr, rule, bud);
console.log(`\nRight now: ${quiet ? `quiet (${quiet})` : `budget ${JSON.stringify(bud)}${hold ? ", morning hold (urgent only)" : ""}`}`);
for (const c of all) console.log(`  ${picked.includes(c) ? "SEND?" : fr.includes(c) ? "  -  " : "seen "} [${c.score}] ${c.kind}: ${c.text}  {${c.key}}`);
if (!all.length) console.log("  nothing happening worth a nudge");
console.log(picked.length ? `  -> she'd get ${picked.length} candidate(s) and word one message (or none).` : "  -> no brain turn this check.");

console.log(`\nRest of today from ${hm(now)} at ${level} (as if she sends the top candidate each time):`);
const rest = planDay(snap, rule, { from: now, to: at(sleep.bed > sleep.wake ? sleep.bed : "23:59"), log, sentToday: sent.length, lastAt, brief: { ...brief, calledToday: calledToday || !!log[`brief:${today}`] } });
for (const x of rest) console.log(`  ${x.at}  ${x.kind}: ${x.text}  (${x.why})`);
if (!rest.length) console.log("  nothing more today");

console.log(`\nA whole fresh day (wake ${sleep.wake} to bed ${sleep.bed}, no morning call answered), by level:`);
for (const lv of PROACTIVE_LEVELS) {
  const day = planDay(snap, RULES[lv], { from: at(sleep.wake), to: at(sleep.bed > sleep.wake ? sleep.bed : "23:59"), brief: { ...brief, calledToday: false } });
  console.log(`  ${lv}: ${day.length} message(s)`);
  for (const x of day) console.log(`    ${x.at}  ${x.kind}: ${x.text}`);
}

const seen = (() => { try { return JSON.parse(String((n.query("SELECT value FROM prefs WHERE key = 'work.seen'").get() as any)?.value ?? "null")); } catch { return null; } })();
const { openAI } = await import("../ai");
const agents = await openAI(dataDir).agentsFor({ id: u.id } as any).catch(() => ({}));
const titles = new Map<string, string>(s.tasks().map((t: any) => [t.id, t.title]));
const tr = agentTransitions(seen, agents, (id) => titles.get(id) ?? id);
console.log(`\nWork reports: ${Object.keys(agents).length} give_to_claude job(s); ${seen ? `${tr.reports.length} report(s) due now` : "first look would only record their state"}.`);
for (const r of tr.reports) console.log(`  ${r.text.replace(/\n/g, " | ")}`);
const held = (() => { try { return JSON.parse(String((n.query("SELECT value FROM prefs WHERE key = 'proactive.outbox'").get() as any)?.value ?? "[]")); } catch { return []; } })();
if (held.length) console.log(`Held overnight: ${held.length}`);
