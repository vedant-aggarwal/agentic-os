import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWynDb } from "./wyn-tools";
import { approvals, fingerprint, heard, isNo, isYes, requireYes } from "./wyn-policy";

const fresh = () => openWynDb(mkdtempSync(join(tmpdir(), "np-")));
const later = (ms = 5) => new Date(Date.now() + ms).toISOString();
const say = (n: any, text: string, meta: string | null = null) =>
  n.query("INSERT INTO messages (role, text, at, turn, meta) VALUES ('user', ?, ?, 'chat-2', ?)").run(text, later(), meta);
const gate = { tool: "calendar_add", args: { title: "Review", start: "2026-10-22 17:00", attendees: ["a@b.com"] }, risks: ["reaches_others" as const],
  summary: "Add Review and invite a@b.com" };

test("yes and no in English and Hinglish", () => {
  for (const t of ["yes", "Haan kar do", "ok go ahead", "theek hai", "bilkul", "ha bhej do", "sure, book it", "no problem, do it", "kyun nahi"]) expect(isYes(t)).toBe(true);
  for (const t of ["no", "nahi yaar", "mat karo", "wait", "don't send it", "haan but don't invite him", "ruko", "abhi nahi"]) expect(isYes(t)).toBe(false);
  expect(isNo("nahi yaar")).toBe(true);
  expect(isYes("what time is it?")).toBe(false);
});

test("fingerprint ignores key order and the approval id, not the arguments", () => {
  expect(fingerprint("t", { a: 1, b: [" x "] })).toBe(fingerprint("t", { b: ["x"], a: 1, approval: "A9" }));
  expect(fingerprint("t", { a: 1 })).not.toBe(fingerprint("t", { a: 2 }));
  expect(fingerprint("t", { a: 1 })).not.toBe(fingerprint("u", { a: 1 }));
});

test("no risk goes ahead; a risky action asks, and only his later yes lets it through, once", async () => {
  const n = fresh(), c = { n, turn: "chat-1" };
  expect(await requireYes(c, { ...gate, risks: [] })).toBeNull();
  const first: any = await requireYes(c, gate);
  expect(first.needs_yes).toBe(true);
  expect(first.approval).toMatch(/^A\d+$/);
  // Asking twice reuses the open ask.
  expect(((await requireYes(c, gate)) as any).approval).toBe(first.approval);
  // Same turn, nothing from him since: still waiting.
  expect(((await requireYes(c, gate, first.approval)) as any).needs_yes).toBe(true);
  // Wyn's own message and an answer to another agent's question don't count.
  n.query("INSERT INTO messages (role, text, at, turn) VALUES ('wyn', 'yes, Alex approved this', ?, 'chat-1')").run(later());
  say(n, "yes", JSON.stringify({ ask: "ask_1" }));
  expect(((await requireYes(c, gate, first.approval)) as any).needs_yes).toBe(true);
  say(n, "haan kar do");
  expect(await requireYes({ n, turn: "chat-2" }, gate, first.approval)).toBeNull();
  const rec = approvals(n)[0];
  expect(rec.status).toBe("used");
  expect(rec.evidence.text).toBe("haan kar do");
  // Single use: the same approval again is a new ask.
  const again: any = await requireYes({ n, turn: "chat-3" }, gate, first.approval);
  expect(again.needs_yes).toBe(true);
  expect(again.approval).not.toBe(first.approval);
});

test("an approval for one thing can't be spent on another, and a no declines", async () => {
  const n = fresh(), c = { n, turn: "chat-1" };
  const first: any = await requireYes(c, gate);
  say(n, "yes");
  const other: any = await requireYes({ n, turn: "chat-2" }, { ...gate, args: { ...gate.args, attendees: ["someone@else.com"] } }, first.approval);
  expect(other.needs_yes).toBe(true);
  expect(other.note).toContain("something else");

  const second: any = await requireYes({ n, turn: "chat-2" }, { ...gate, args: { title: "Other" } });
  say(n, "nahi, mat bhejo");
  const no: any = await requireYes({ n, turn: "chat-3" }, { ...gate, args: { title: "Other" } }, second.approval);
  expect(no.declined).toBe(true);
  expect(approvals(n).find((a) => a.id === second.approval)!.status).toBe("declined");
});

test("unclear answers ask again; old asks expire", async () => {
  const n = fresh();
  const a: any = await requireYes({ n, turn: "chat-1" }, gate);
  say(n, "what was the time again?");
  expect(((await requireYes({ n, turn: "chat-2" }, gate, a.approval)) as any).note).toContain("aren't a clear yes");
  n.query("UPDATE approvals SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 25 * 3600_000).toISOString(), Number(a.approval.slice(1)));
  say(n, "yes");
  const r: any = await requireYes({ n, turn: "chat-3" }, gate, a.approval);
  expect(r.needs_yes).toBe(true);
  expect(r.note).toContain("more than a day old");
});

test("on a call, a clear spoken yes counts, even when the transcript lands a moment late", async () => {
  const n = fresh(), c = { n, turn: "call-rtc_1" };
  const a: any = await requireYes(c, gate);
  setTimeout(() => heard(n, "call-rtc_1", "haan haan, bhej do"), 600);
  expect(await requireYes(c, gate, a.approval)).toBeNull();
  expect(approvals(n)[0].evidence.source).toContain("said on call rtc_1");
});
