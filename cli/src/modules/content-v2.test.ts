// Content OS v2 (Agentic OS 2.0): the swipe deck and its verdicts feeding the learning loop, rule switches, script
// revisions with revert, takes filed under the script they were recorded for, undoing a dry-run approval, and the
// RealFlow ledger (content-os state/history.jsonl + receipts) as posts. Real CLI on throwaway agentos.db + content.db.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { likeCount, scoreIdea, topicWords } from "./content";

const dir = mkdtempSync(join(tmpdir(), "agentos-content-v2-"));
const dbPath = join(dir, "agentos.db"), contentDb = join(dir, "content.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => { if (process.env.KEEP_TEST_DIR) console.log(`kept ${dir}`); else rmSync(dir, { recursive: true, force: true }); });
function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: contentDb } });
  return { text: r.stdout.toString(), code: r.exitCode };
}
const json = (...args: string[]) => { const r = cli(...args, "--json"); try { return JSON.parse(r.text); } catch { throw new Error(`no JSON from agentos ${args.join(" ")}: ${r.text.slice(0, 300)}`); } };
const sql = (q: string, ...p: any[]) => { const d = new Database(contentDb); try { return d.query(q).all(...p) as any[]; } finally { d.close(); } };
const write = (p: string, s: string) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, s); };
const SLOW = 90_000;
const contentOs = join(dir, "content-os");

beforeAll(() => {
  // a tiny content-os: one idea file, a ledger with a post that was re-created (the first copy is superseded), one cancelled,
  // and a receipt that moves a post's time
  write(join(contentOs, "pipeline", "01-ideas", "2026-10-20-launch-h1.md"), `---\nid: 2026-10-20-launch-h1\ntitle: "Launch reel one"\nstatus: inbox\n---\n\n## Hook\n\nOne.\n`);
  const L = (o: any) => JSON.stringify(o);
  write(join(contentOs, "state", "history.jsonl"), [
    L({ ts: "2026-10-20T10:00:00+05:30", cmd: "schedule", id: "2026-10-20-launch-h1", detail: { provider: "realflow", postId: "old-1", status: "scheduled", scheduledAt: "2026-10-21T15:30:00.000Z" } }),
    L({ ts: "2026-10-20T11:00:00+05:30", cmd: "schedule", id: "2026-10-20-launch-h1", detail: { provider: "realflow", postId: "new-1", status: "scheduled", scheduledAt: "2026-10-21T15:30:00.000Z" } }),
    L({ ts: "2026-10-20T11:05:00+05:30", cmd: "schedule", id: "2026-10-20-car-chase", detail: { provider: "realflow", postId: "car-1", status: "scheduled", scheduledAt: "2026-10-22T14:00:00.000Z" } }),
    L({ ts: "2026-10-20T12:00:00+05:30", cmd: "schedule.cancel", id: "2026-10-20-car-chase", detail: { provider: "realflow", postId: "car-1", status: "cancelled", scheduledAt: "2026-10-22T14:00:00.000Z" } }),
    L({ ts: "2026-10-20T12:30:00+05:30", cmd: "ideas.pick", id: "x" }),
    "not json",
  ].join("\n"));
  write(join(contentOs, "state", "realflow", "receipts", "a.json"), L({ sourceId: "2026-10-20-launch-h1", postId: "new-1", status: "scheduled", scheduledAt: "2026-10-21T16:00:00.000Z", createdAt: "2026-10-20T05:30:00.000Z" }));
});

describe("content v2: helpers", () => {
  test("topic words and the loop's likeness: two shared words and half the shorter title", () => {
    expect([...topicWords("The new Claude Code modding trick!")]).toEqual(["claude", "code", "modding", "trick"]);
    const killed: [number, Set<string>][] = [[1, topicWords("Claude Code modding is dangerous")], [2, topicWords("Scarf fold hack")]];
    expect(likeCount("A Claude Code modding tutorial", killed)).toBe(1);
    expect(likeCount("A Claude Code modding tutorial", killed, 1)).toBe(0);        // never like itself
    expect(likeCount("Mars rover update", killed)).toBe(0);
    const s = scoreIdea({ id: 9, title: "Claude Code modding for beginners", status: "inbox", created_at: "2026-10-21T00:00:00Z" },
      { hasScript: false, hasCard: false, topics: [], today: "2026-10-22", killed });
    expect(s.why).toContain("like an idea you killed");
    expect(s.score).toBeLessThan(6);
  });
});

describe("content v2: the CLI on a temp content.db", () => {
  test("migrates to v2 once: new columns, the ops table, user_version 2; a second run is a no-op", () => {
    json("content", "settings");
    json("content", "settings");
    const v = sql("PRAGMA user_version")[0].user_version;
    expect(v).toBe(2);
    const cols = (t: string) => sql(`PRAGMA table_info(${t})`).map((r) => r.name);
    expect(cols("content_posts")).toEqual(expect.arrayContaining(["external_id", "title", "source", "idea_id"]));
    expect(cols("content_learnings")).toEqual(expect.arrayContaining(["kind", "muted"]));
    expect(cols("content_scripts")).toContain("revisions");
    expect(cols("content_ops")).toEqual(expect.arrayContaining(["id", "data", "rev", "kind", "applied_at", "error"]));
  }, SLOW);

  test("verdicts: keep and kill move the idea, write a learning, replay by op id is a no-op, restore undoes it", () => {
    const a = json("content", "capture", "Claude Code modding is wild", "--source", "agent").idea.id;
    const b = json("content", "capture", "Scarf fold hack in thirty seconds", "--channel", "example_creator").idea.id;
    const k = json("content", "verdict", a, "kill", "--why", "done before", "--external-id", "op_1");
    expect(k.idea.status).toBe("dropped");
    expect(k.idea.verdict).toBe("killed: done before");
    expect(json("content", "verdict", a, "kill", "--external-id", "op_1").already).toBe(true);
    expect(sql("SELECT count(*) n FROM content_learnings WHERE kind = 'verdict'")[0].n).toBe(1);
    const kept = json("content", "verdict", b, "script", "--external-id", "op_2");
    expect(kept.idea.status).toBe("picked");
    expect(kept.write).toBe(true);
    const lv = json("content", "learnings");
    expect(lv.verdicts.map((x: any) => x.v)).toEqual(["keep", "kill"]);
    expect(lv.verdicts[1].why).toBe("done before");
    expect(lv.counts.killed30).toBe(1);
    // the deck now marks a lookalike of the killed idea down, with the reason
    const c = json("content", "capture", "Claude Code modding for beginners").idea.id;
    const d = json("content", "deck");
    const card = d.ideas.find((x: any) => x.id === c);
    expect(card.why).toContain("like an idea you killed");
    // undo: back to the inbox and the learning is gone
    const r = json("content", "verdict", a, "restore", "--was", "inbox", "--undo", "op_1");
    expect(r.idea.status).toBe("inbox");
    expect(sql("SELECT count(*) n FROM content_learnings WHERE external_id = 'verdict:op_1'")[0].n).toBe(0);
    expect(cli("content", "verdict", a, "maybe", "--json").code).toBe(2);
  }, SLOW);

  test("rules: a learning can be muted (every copy of the same text) and unmuted", () => {
    const d = new Database(contentDb);
    const ins = d.prepare("INSERT INTO content_learnings (date, text, receipt, source, external_id, created_at, kind) VALUES ('2026-10-18', ?, ?, 'content-os', ?, '2026-10-18T00:00:00Z', 'rule')");
    ins.run("Keep it under 35 seconds.", "r1", "x1"); ins.run("Keep it under 35 seconds.", "r2", "x2"); ins.run("Hinglish on example_creator.", "r3", "x3");
    ins.finalize();
    const id = (d.query("SELECT id FROM content_learnings WHERE external_id = 'x1'").get() as any).id;
    d.close();
    const before = json("content", "learnings");
    const rule = before.rules.find((r: any) => r.text === "Keep it under 35 seconds.");
    expect(rule.count).toBe(2);
    expect(rule.receipts).toEqual(expect.arrayContaining(["r1", "r2"]));
    expect(json("content", "learning", `l${id}`, "--mute").rows).toBe(2);
    expect(json("content", "learnings").rules.find((r: any) => r.text === "Keep it under 35 seconds.").muted).toBe(true);
    expect(json("content", "learning", `l${id}`, "--mute").already).toBe(true);
    json("content", "learning", `l${id}`, "--unmute");
    expect(sql("SELECT sum(muted) m FROM content_learnings")[0].m).toBe(0);
  }, SLOW);

  test("a script revision keeps the version before it; revert brings it back; the op id makes a replay a no-op", () => {
    const idea = json("content", "capture", "Agents in class").idea.id;
    const md = join(dir, "s.md"), tp = join(dir, "s.txt"), tp2 = join(dir, "s2.txt");
    writeFileSync(md, "# Agents in class\n\n## Spoken script\n\nMain lecture mein hoon.\n\nAgents kaam kar rahe hain.\n\nFollow karo.\n");
    writeFileSync(tp, "Main lecture mein hoon.\n\nAgents kaam kar rahe hain.\n\nFollow karo.\n");
    writeFileSync(tp2, "Lecture mein hoon, code ship ho raha hai.\n\nFollow karo.\n");
    const s = json("content", "script", "add", "--idea", idea, "--date", "today", "--title", "Agents in class", "--body-file", md, "--teleprompter-file", tp).script.id;
    const r = json("content", "script", s, "revise", "--teleprompter-file", tp2, "--label", "Shorter", "--external-id", "op_rw");
    expect(r.script.teleprompter).toContain("code ship ho raha hai");
    expect(r.script.previous.label).toBe("Shorter");
    expect(r.script.previous.teleprompter).toContain("Agents kaam kar rahe hain");
    expect(r.script.words).toBe(10);
    expect(json("content", "script", s, "revise", "--teleprompter-file", tp2, "--external-id", "op_rw").already).toBe(true);
    const back = json("content", "script", s, "revert");
    expect(back.script.teleprompter).toContain("Agents kaam kar rahe hain");
    expect(back.script.revisions).toEqual([]);
    expect(json("content", "script", s, "revert").already).toBe(true);
    // a take filed under the script it was recorded for marks the script shot; the overview carries it
    const t = json("content", "take", "add", "--file", join(dir, "take.mp4"), "--date", "today", "--script", s, "--chosen", "--external-id", "upload:u1");
    expect(t.take.script).toBe(s);
    expect(t.take.chosen).toBe(true);
    expect(sql("SELECT status FROM content_scripts WHERE id = ?", Number(s.slice(1)))[0].status).toBe("shot");
    const o = json("content", "overview");
    expect(o.takes.map((x: any) => x.id)).toContain(t.take.id);
    expect(o.deck.count).toBeGreaterThan(0);
    expect(Array.isArray(o.learnings.rules)).toBe(true);
  }, SLOW);

  test("unapprove takes back a dry run; a post booked in RealFlow is refused", () => {
    const e = json("content", "edit", "add", "--title", "A cut", "--render", join(dir, "cut.mp4")).edit.id;
    expect(json("content", "approve", e).post.status).toBe("dry-run");
    const u = json("content", "unapprove", e);
    expect(u.edit.status).toBe("review");
    expect(sql("SELECT count(*) n FROM content_posts WHERE edit_id = ?", Number(e.slice(1)))[0].n).toBe(0);
    expect(json("content", "unapprove", e).already).toBe(true);
    json("content", "approve", e, "--post-id", "rf-9", "--at", "2026-10-30T12:30:00+05:30");
    expect(cli("content", "unapprove", e, "--json").code).toBe(2);
  }, SLOW);

  test("realflow: the ledger becomes posts once; a superseded copy and a draft never show; a receipt's time wins", () => {
    const r = json("content", "realflow", "--content-os", contentOs);
    expect(r.found).toBe(true);
    expect(r.added).toBe(2);                    // new-1 and the cancelled car post; old-1 was superseded before it was seen
    const posts = sql("SELECT * FROM content_posts WHERE source = 'content-os' ORDER BY realflow_id");
    expect(posts.map((p) => [p.realflow_id, p.status])).toEqual([["car-1", "cancelled"], ["new-1", "scheduled"]]);
    expect(posts[1].title).toBe("Launch reel one");                 // the pipeline file's title
    expect(posts[1].scheduled_at).toBe("2026-10-21T16:00:00.000Z");  // the receipt moved it
    expect(posts[0].title).toBe("Car chase");                        // no file: the id, readable
    const again = json("content", "realflow", "--content-os", contentOs);
    expect([again.added, again.updated]).toEqual([0, 0]);
    expect(json("content", "realflow", "--content-os", join(dir, "nowhere")).found).toBe(false);
    expect(json("content", "posts").posts.find((p: any) => p.realflow === "new-1").title).toBe("Launch reel one");
  }, SLOW);
});
