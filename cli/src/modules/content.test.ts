// Content OS through the real CLI on throwaway agentos.db + content.db files, with small fixture copies of the
// four import sources (content-os pipeline, Reel Lab projects, craft-inbox reels, Codex script packs).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frontmatter, scoreIdea, spokenText } from "./content";

const dir = mkdtempSync(join(tmpdir(), "agentos-content-"));
const dbPath = join(dir, "agentos.db"), contentDb = join(dir, "content.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => { if (process.env.KEEP_TEST_DIR) console.log(`kept ${dir}`); else rmSync(dir, { recursive: true, force: true }); });

function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: contentDb } });
  return { text: r.stdout.toString(), code: r.exitCode };
}
const json = (...args: string[]) => { const r = cli(...args, "--json"); try { return JSON.parse(r.text); } catch { throw new Error(`no JSON from agentos ${args.join(" ")}: ${r.text.slice(0, 300)}`); } };
const sql = (q: string, ...p: any[]) => { const d = new Database(contentDb); try { return d.query(q).all(...p) as any[]; } finally { d.close(); } };
const SLOW = 90_000;

// ── fixtures: the shapes the real folders have ──────────────────────────────
const src = { contentOs: join(dir, "content-os"), reelStudio: join(dir, "Reel Lab", "projects"), craft: join(dir, "craft-inbox"), codex: join(dir, "Codex") };
const write = (p: string, s: string) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, s); };
beforeAll(() => {
  const ideas = join(src.contentOs, "pipeline", "01-ideas");
  write(join(ideas, "2026-08-02-gpt-5-vs-claude.md"), `---
id: 2026-08-02-gpt-5-vs-claude
title: "GPT-5 vs Claude: compare your workflow"
source: "grok-scan-x — model war"
angle: "Show 3 real jobs and which model wins."
score: 9
status: inbox
created: 2026-08-02T18:42:29+05:30
---

## Hook

Everyone ranking GPT-5 vs Claude. Nobody ranking them on your actual stack.

## Verdicts
`);
  write(join(ideas, "2026-08-03-old-idea.md"), `---
id: 2026-08-03-old-idea
title: "An old idea"
score: 4
status: inbox
created: 2026-08-03T10:00:00+05:30
---

## Hook

Old.
`);
  write(join(src.contentOs, "pipeline", "02-selected", "2026-08-27-deepseek.md"), `---
id: 2026-08-27-deepseek
title: "DeepSeek built an AI system that should not be possible"
source: "AI Content Radar email reply — youtube:L9mMfAFwbl4"
score: 9
status: selected
created: 2026-08-27T00:06:45+05:30
selected: 2026-08-27
---

## Hook

DeepSeek removed a constraint researchers assumed they had to live with.

## Verdicts

- 2026-08-27: Selected by email reply — the fifth will be fire.
`);
  write(join(src.contentOs, "pipeline", "03-scripts", "2026-08-27-deepseek.md"), `---
id: 2026-08-27-deepseek
title: DeepSeek ne ek limit hata di
status: draft
format: Reel / Short, talking head
language: hinglish
duration: 55-65 seconds
---

# DeepSeek ne ek limit hata di

## Script

**0-3s, hook, talking head**

"DeepSeek ne woh limit hata di jo researchers maan ke chalte the."

**3-10s, setup**

"Ab model same hardware par double context sambhal leta hai."

## Shoot Plan

- Scene 1: desk, 30s
`);
  write(join(src.contentOs, "pipeline", "03-scripts", "2026-08-14-shoot-day.md"), `# SHOOT DAY — 14 Aug 2026\n\nPlanning doc, not a script.\n`);
  write(join(src.contentOs, "pipeline", "04-shoot", "README.md"), "# 04-shoot\n");
  const edit = join(src.contentOs, "pipeline", "06-edits", "2026-08-27-deepseek");
  write(join(edit, "final", "reel.mp4"), "not really video");
  write(join(src.contentOs, "pipeline", "06-edits", "README.md"), "# edits\n");
  write(join(src.contentOs, "state", "learnings.md"), `# Learnings

## Verdict log
- 2026-08-27 — idea 2026-08-27-deepseek: Alex approved: content bana do
- 2026-08-05 — idea 2026-08-02-gpt-5-vs-claude: Interested: wants three strong hooks before deciding.
`);
  write(join(src.contentOs, "state", "prefs.json"), JSON.stringify({ language: "hinglish", topics: ["claude code"] }));
  const proj = join(src.reelStudio, "ai-fifteen-tv-boxes-2026-10-15");
  write(join(proj, "SCRIPT.md"), `# They ran AI on fifteen TV boxes

Revision 2: conversational Roman Hinglish.
140 words; estimated 52-65 seconds.

## Spoken script

Ye jo TV ke saath Android box lagaate hain na, researchers ne aise pandrah boxes jode aur unpe AI chala diya.

Anthropic ki team ne ye boxes khareede aur ek network pe connect kar diye.

## Sources

- [Anthropic](https://www.anthropic.com/research/self-replicating-ai)
`);
  write(join(proj, "TELEPROMPTER.txt"), "Ye jo TV ke saath Android box lagaate hain na, researchers ne aise pandrah boxes jode aur unpe AI chala diya.\n\nAnthropic ki team ne ye boxes khareede.\n");
  write(join(proj, "BRIEF.md"), "# Fifteen cheap TV boxes\n\nBrand: Northwind Studio / @northwindstudio\nLanguage: Roman Hinglish\n");
  write(join(proj, "SCRIPT.v1-rejected.md"), "# rejected\n");
  write(join(src.reelStudio, "empty-project", "BRIEF.md"), "no script here");
  write(join(src.reelStudio, "northwind-ai-five-2026-10-15.md"), "# batch index\n");
  write(join(src.craft, "INDEX.md"), `# Craft Inbox

## C. Instagram reels — video (2 unique)  →  reels\\<code>.mp4
| # | Note / title | code | Craft id |
|---|------|------|----------|
| 9 | "Use this for video creation" | DZqghOOt0bJ | 481d0104 |
| 10 | (untitled) | DYsXjskT0x5 | 1475b991 |
`);
  write(join(src.craft, "reels", "DZqghOOt0bJ.mp4"), "x");
  write(join(src.craft, "reels", "DYsXjskT0x5.mp4"), "x");
  write(join(src.codex, "2026-10-14", "nice-my-reels", "outputs", "northwind-six-reel-scripts.md"), `# Six reels

## 1. The slash that made Google flag every result

### Hooks

- Google ne ek slash se poori search tod di.

### Clean script

Google ne 2009 mein ek slash galat jagah daal di, aur har result ko malware bol diya.

Ye hua kaise, aur usse hum kya seekhte hain.

### Recording beats

| 0-5s | hook |

## 2. They ran AI on fifteen TV boxes

### Clean script

Duplicate of the Reel Lab project: skipped by title.
`);
  write(join(src.codex, "2026-10-14", "nice-my-reels", "outputs", "notes.md"), "not a script pack");
});

const importArgs = ["content", "import", "--content-os", src.contentOs, "--reel-lab", src.reelStudio, "--craft", src.craft, "--codex", src.codex];

describe("content: helpers", () => {
  test("frontmatter and spoken text", () => {
    const { fm, body } = frontmatter(`---\nid: x\ntitle: "Quoted"\n---\n\n# Quoted\n\n## Script\n\n**0-3s**\n\n"Line one."\n\n"Line two."\n`);
    expect(fm).toEqual({ id: "x", title: "Quoted" });
    expect(spokenText(body)).toBe("Line one.\n\nLine two.");
    expect(spokenText("# T\n\n## Spoken script\n\nPara one.\n\nPara two.\n\n## Sources\n\n- x")).toBe("Para one.\n\nPara two.");
  });
  test("scoring explains itself and prefers verdicts, scripts and fresh ideas", () => {
    const today = "2026-10-18";
    const a = scoreIdea({ score: 9, verdict: "Alex approved: content bana do", status: "scripted", source: "import", created_at: "2026-08-02T00:00:00Z", title: "x" }, { hasScript: true, hasCard: false, topics: [], today });
    expect(a.score).toBe(9.5);
    expect(a.why).toContain("your verdict was positive");
    expect(a.why).toContain("older than six weeks");
    const b = scoreIdea({ score: null, verdict: null, status: "inbox", source: "evidence", created_at: "2026-10-17T00:00:00Z", title: "Claude Code mods" }, { hasScript: false, hasCard: true, topics: ["claude code"], today });
    expect(b.score).toBe(9);
    expect(b.why).toEqual(["from your work (build in public)", "reference card analysed", "fresh this week", "matches a learned topic"]);
  });
});

describe("content: the CLI on a temp content.db", () => {
  test("import consolidates the four sources once, idempotently, and reports counts", () => {
    const r = json(...importArgs);
    expect(r.ok).toBe(true);
    expect(r.added).toEqual({ ideas: 5, scripts: 3, references: 2, edits: 1, learnings: 2 });
    expect(r.sources.contentOs).toMatchObject({ found: true, ideas: 3, scripts: 1, edits: 1, learnings: 2, skipped: 1 });
    expect(r.sources.reelStudio).toMatchObject({ ideas: 1, scripts: 1, skipped: 2 });
    expect(r.sources.craft).toMatchObject({ references: 2 });
    expect(r.sources.codex).toMatchObject({ ideas: 1, scripts: 1, skipped: 1 });
    expect(r.errors).toBe(0);
    // the selected idea outranks its inbox copy, carries its verdict, and its script makes it "scripted"
    const deep = sql("SELECT * FROM content_ideas WHERE external_id = 'content-os:idea:2026-08-27-deepseek'")[0];
    expect(deep.status).toBe("scripted");
    expect(deep.verdict).toContain("content bana do");
    const script = sql("SELECT * FROM content_scripts WHERE external_id = 'content-os:script:2026-08-27-deepseek'")[0];
    expect(script.idea_id).toBe(deep.id);
    expect(script.seconds).toBe(60);
    expect(script.words).toBe(22);
    const edit = sql("SELECT * FROM content_edits")[0];
    expect(edit.script_id).toBe(script.id);
    expect(edit.status).toBe("review");
    expect(edit.render_path.endsWith("reel.mp4")).toBe(true);
    const rs = sql("SELECT * FROM content_scripts WHERE external_id LIKE 'reel-lab:%'")[0];
    expect(rs.teleprompter_path.endsWith("TELEPROMPTER.txt")).toBe(true);
    expect(rs.words).toBe(140);
    expect(rs.seconds).toBe(59);
    const refs = sql("SELECT shortcode, note, transcript_status FROM content_references ORDER BY shortcode");
    expect(refs).toEqual([{ shortcode: "DYsXjskT0x5", note: null, transcript_status: "pending" }, { shortcode: "DZqghOOt0bJ", note: "Use this for video creation", transcript_status: "pending" }]);
    expect(sql("SELECT count(*) n FROM content_channels")[0].n).toBe(2);
    const again = json(...importArgs);
    expect(again.added).toEqual({ ideas: 0, scripts: 0, references: 0, edits: 0, learnings: 0 });
    expect(sql("PRAGMA user_version")[0].user_version).toBe(2);   // v2: posts from the ledger, rule switches, revisions, the ops outbox
  }, SLOW);

  test("capture files an idea; a link also makes a reference card with the transcript pending", () => {
    const r = json("content", "capture", "Try this format for the agentos launch", "--link", "https://www.instagram.com/reel/DaLNttLhWxY/", "--source", "share");
    expect(r.ok).toBe(true);
    expect(r.idea).toMatchObject({ status: "inbox", source: "share", channel: "northwindstudio", reference: r.reference.id, transcript: "pending" });
    expect(r.reference).toMatchObject({ shortcode: "DaLNttLhWxY", note: "Try this format for the agentos launch" });
    const dup = json("content", "capture", "Same thing", "--external-id", "task:t99", "--channel", "example");
    expect(dup.ok).toBe(true);
    expect(dup.idea.channel).toBe("example_creator");
    expect(json("content", "capture", "Same thing", "--external-id", "task:t99").already).toBe(true);
    const bad = cli("content", "capture", "x", "--source", "nope", "--json");
    expect(bad.code).toBe(2);
    expect(JSON.parse(bad.text).ok).toBe(false);
  }, SLOW);

  test("plan picks N per channel with take codes, reuses existing scripts, and is idempotent per date", () => {
    const r = json("content", "plan", "--date", "2026-10-20");
    expect(r.ok).toBe(true);
    expect(r.shootDay).toBe("d1");
    expect(r.picks.length).toBe(1);                       // northwindstudio defaults to 1, example_creator to 0
    expect(r.skipped).toEqual([{ channel: "example_creator", reason: "reels per day not set (default 0)" }]);
    const p = r.picks[0];
    expect(p.takeCode).toBe("R1");
    expect(p.script).not.toBeNull();                      // the highest score has a draft script already
    expect(p.why).toContain("your verdict was positive");
    expect(r.needsNumber).toContain("reels_per_day.northwindstudio");
    expect(json("content", "plan", "--date", "2026-10-20").already).toBe(true);
    const pack = json("content", "pack", "--date", "2026-10-20", "--full");
    expect(pack.scripts.length).toBe(1);
    expect(pack.scripts[0]).toMatchObject({ id: p.script, take: "R1" });
    expect(pack.scripts[0].teleprompter).toContain("DeepSeek ne woh limit hata di");
    expect(pack.setups).toEqual([{ key: "Desk · Tripod talking head, graphics stage on top", location: "Desk", framing: "Tripod talking head, graphics stage on top", props: "PC setup behind", scripts: [p.script] }]);
    // two per day: the second pick has no script yet, so it is pending until the server writes one
    expect(json("content", "settings", "set", "reels_per_day.northwindstudio", "2").ok).toBe(true);
    const r2 = json("content", "plan", "--date", "2026-10-20", "--fresh");
    expect(r2.picks.map((x: any) => x.takeCode)).toEqual(["R1", "R2"]);
    expect(r2.toWrite.length).toBeGreaterThanOrEqual(1);
    const pack2 = json("content", "pack", "--date", "2026-10-20");
    expect(pack2.pending.length).toBe(r2.toWrite.length);
    expect(sql("SELECT count(*) n FROM content_shoot_days")[0].n).toBe(1);
  }, SLOW);

  test("script add files a written script into the day's pack and the shoot list groups by setup", () => {
    const pack = json("content", "pack", "--date", "2026-10-20");
    const pending = pack.pending[0];
    const body = join(dir, "script.md"), tele = join(dir, "script.txt");
    writeFileSync(body, "---\ntitle: Test\n---\n\n# Test\n\n## Spoken script\n\nPehli line yahan.\n\nDoosri line yahan.\n");
    writeFileSync(tele, "Pehli line yahan.\n\nDoosri line yahan.\n");
    const r = json("content", "script", "add", "--idea", pending.idea, "--date", "2026-10-20", "--take-code", pending.takeCode, "--title", "Test script", "--body-file", body, "--teleprompter-file", tele, "--hook", "Pehli line yahan.", "--cta", "Comment AGENT", "--seconds", "40", "--external-id", "test:1");
    expect(r.ok).toBe(true);
    expect(r.script).toMatchObject({ idea: pending.idea, take: pending.takeCode, seconds: 40, words: 6, status: "draft" });
    expect(json("content", "script", "add", "--idea", pending.idea, "--body-file", body, "--external-id", "test:1").already).toBe(true);
    const after = json("content", "pack", "--date", "2026-10-20", "--full");
    expect(after.pending).toEqual([]);
    expect(after.scripts.map((s: any) => s.take)).toEqual(["R1", "R2"]);
    expect(after.scripts[1].teleprompter).toBe("Pehli line yahan.\n\nDoosri line yahan.");
    expect(after.setups[0].scripts.length).toBe(2);
    expect(json("content", "show", pending.idea).idea.status).toBe("scripted");
    const ok = json("content", "script", r.script.id, "--status", "approved", "--verdict", "good, shoot it");
    expect(ok.script.status).toBe("approved");
    expect(json("content", "show", pending.idea).idea.status).toBe("approved");
    expect(sql("SELECT count(*) n FROM content_learnings WHERE source = 'verdict'")[0].n).toBe(1);
  }, SLOW);

  test("approve records a dry-run post without slots, a scheduled one with a RealFlow id; a note sends the edit back", () => {
    const edits = json("content", "edits");
    expect(edits.count).toBe(1);
    const e = edits.edits[0];
    expect(e.status).toBe("review");
    const dry = json("content", "approve", e.id);
    expect(dry).toMatchObject({ ok: true, dryRun: true });
    expect(dry.post).toMatchObject({ status: "dry-run", at: null, channel: "northwindstudio" });
    expect(dry.note).toContain("dry run");
    expect(json("content", "approve", e.id).already).toBe(true);
    expect(json("content", "settings", "set", "slots.northwindstudio", "12:30,19:00").ok).toBe(true);
    const real = json("content", "approve", e.id, "--post-id", "rf-123");
    expect(real.post).toMatchObject({ status: "scheduled", realflow: "rf-123" });
    expect(real.post.at).toMatch(/T(07:00|13:30):00\.000Z$/);
    expect(json("content", "posts").posts.length).toBe(1);
    const n = json("content", "note", e.id, "cut the second beat shorter");
    expect(n.edit.status).toBe("redo");
    expect(n.edit.notes.length).toBe(1);
    const added = json("content", "edit", "add", "--script", "s1", "--render", join(dir, "r.mp4"), "--external-id", "e:test");
    expect(added.edit.status).toBe("review");
    expect(json("content", "edit", "add", "--script", "s1", "--external-id", "e:test").already).toBe(true);
    expect(cli("content", "settings", "set", "slots.example_creator", "noon", "--json").code).toBe(2);
  }, SLOW);

  test("sweep moves content: tasks and the Content ideas list into ideas; candidates lists done work with evidence", () => {
    expect(json("capture", "content: reel on the agentos share sheet https://youtube.com/shorts/abc123xyz").ok).toBe(true);
    expect(json("add", "Plain task that stays").ok).toBe(true);
    const done = json("add", "Ship the content module");
    expect(json("done", done.task.id, "--evidence", "commit 9f55d56 on feat/mod-content").ok).toBe(true);
    const s = json("content", "sweep");
    expect(s.moved.length).toBe(1);
    expect(s.moved[0]).toMatchObject({ title: "reel on the agentos share sheet https://youtube.com/shorts/abc123xyz", source: "keyword" });
    const moved = json("content", "show", s.moved[0].idea);
    expect(moved.idea.link).toBe("https://youtube.com/shorts/abc123xyz");
    expect(moved.idea.transcript).toBe("pending");
    const task = json("show", s.moved[0].task).task;
    expect(task.status).toBe("dropped");
    expect(task.evidence).toBe(`moved to content idea ${s.moved[0].idea}`);
    expect(json("content", "sweep").moved).toEqual([]);
    const c = json("content", "candidates");
    expect(c.candidates.length).toBe(1);
    expect(c.candidates[0]).toMatchObject({ task: done.task.id, idea: null });
    const bip = json("content", "capture", "Shipped the content module in one night", "--source", "evidence", "--external-id", `task:${done.task.id}:bip`, "--evidence", "commit 9f55d56", "--tag", "from your work", "--hook", "Ek raat mein poora module.");
    expect(bip.idea.tags).toEqual(["from your work"]);
    expect(json("content", "candidates").candidates[0].idea).toBe(bip.idea.id);
  }, SLOW);

  test("overview carries the four tabs in one call; the registry check still passes with content.db apart", () => {
    const o = json("content", "overview", "--date", "2026-10-20");
    expect(o.counts.ideas.inbox).toBeGreaterThan(0);
    expect(o.pack.scripts.length).toBe(2);
    expect(o.edits.length).toBe(2);
    expect(o.posts.length).toBe(1);
    expect(o.settings.reels_per_day.northwindstudio).toBe(2);
    expect(o.settings.needs).toEqual(["reels_per_day.example_creator", "slots.example_creator", "shoot_at"]);
    expect(o.channels.map((c: any) => c.handle)).toEqual(["northwindstudio", "example_creator"]);
    const check = json("mods", "check");
    expect(check.modules.find((m: any) => m.name === "content")).toEqual({ name: "content", tables: [], indexes: [] });
    const core = new Database(dbPath);
    try { expect(core.query("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'content_%'").get()).toEqual({ n: 0 }); } finally { core.close(); }
  }, SLOW);
});
