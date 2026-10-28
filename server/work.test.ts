// The Work build's store rules (ideas, inbox, projects) on a temp agentos db, and the WAV header repair.
// Needs an agentos CLI with schema v7: AGENTOS_BIN (default: the agentos-work-core build next to this repo).
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = process.env.AGENTOS_BIN ?? join(import.meta.dir, "..", "..", "agentos-work-core", "dist", "agentos.exe");
// store.ts reads AGENTOS_BIN when it loads, so it (and voice.ts, which imports it) are imported after this line.
if (existsSync(BIN)) process.env.AGENTOS_BIN = BIN;

test("an interrupted WAV gets real RIFF and data sizes", async () => {
  const { fixWav } = await import("./voice");
  const b = Buffer.alloc(44 + 100);
  b.write("RIFF", 0); b.writeUInt32LE(0xffffffff, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16);
  b.write("data", 36); b.writeUInt32LE(0xffffffff, 40);
  fixWav(b);
  expect(b.readUInt32LE(4)).toBe(b.length - 8);
  expect(b.readUInt32LE(40)).toBe(100);
});

test.skipIf(!existsSync(BIN))("ideas, the task inbox rule and project fields", async () => {
  const { ensureDb, openStore } = await import("./store");
  const dir = mkdtempSync(join(tmpdir(), "aos-work-"));
  const db = join(dir, "agentos.db");
  try {
    ensureDb(db, "member");
    const s = openStore(db, null);
    expect(s.hasV7()).toBe(true);
    expect(s.createTask({ title: "loose" }).status).toBe("inbox");
    expect(s.createTask({ title: "dated", due: "2026-11-01" }).status).toBe("todo");
    const p = s.upsertProject(null, { name: "My App", folder: "C:/code/my-app/", icon: "📱" });
    expect(p).toMatchObject({ slug: "my-app", folder: "C:\\code\\my-app", icon: "📱", counts: { tasks: 0, ideas: 0, jobs: 0 } });
    expect(s.upsertProject(null, { name: "My App" }).slug).toBe("my-app-2");
    expect(() => s.upsertProject("my-app", { status: "nope" })).toThrow();
    const i = s.createIdea({ title: "in a project", project: "my-app", source: "siri" });
    expect(i).toMatchObject({ project: "my-app", status: "open", source: "siri" });
    const { idea, task } = s.ideaToTask(i.id, {});
    expect(idea).toMatchObject({ status: "tasked", taskId: task.id });
    expect(task).toMatchObject({ status: "todo", project: "my-app", ideaId: i.id, jobIds: [] });
    expect(s.ideaToTask(i.id, {}).task.id).toBe(task.id);
    const inbox = s.createIdea({ title: "loose idea" });
    expect(s.ideas({ project: "none" }).map((x) => x.id)).toEqual([inbox.id]);
    expect(s.ideaToTask(inbox.id, {}).task.status).toBe("inbox");
    expect(s.projectDetail("my-app").tasks.map((t) => t.title)).toEqual(["in a project"]);
    s.close();
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
});
