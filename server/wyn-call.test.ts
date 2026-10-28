import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWynDb } from "./wyn-tools";
import { callAudio, callRules, closeRing, DEAD_CALL_SEC, deadCall, failRing, lateCall, logRing, missedRings, RING_WINDOW_MS, sweepCalls, voiceTools, callSettings } from "./wyn-call";

test("rang-out scheduled calls retry once, then fall back to chat", () => {
  const n = openWynDb(mkdtempSync(join(tmpdir(), "nc-")));
  const retries: string[] = [], msgs: string[] = [];
  logRing(n, "in_a", "Morning check-in");
  n.exec("UPDATE call_attempts SET rang_at = '" + new Date(Date.now() - 120_000).toISOString() + "'");
  missedRings(n, null, (r) => retries.push(r), (r) => msgs.push(r));
  expect(retries).toEqual(["Morning check-in"]);
  logRing(n, "in_b", "Morning check-in");
  missedRings(n, null, (r) => retries.push(r), (r) => msgs.push(r)); // still ringing, too fresh
  n.exec("UPDATE call_attempts SET rang_at = '" + new Date(Date.now() - 120_000).toISOString() + "' WHERE incoming_id = 'in_b'");

  missedRings(n, null, (r) => retries.push(r), (r) => msgs.push(r));
  expect(msgs).toEqual(["Morning check-in"]);
  logRing(n, "in_c", "Night");
  closeRing(n, "in_c", "answered");
  n.exec("UPDATE call_attempts SET rang_at = '2020-01-01T00:00:00Z' WHERE incoming_id = 'in_c'");
  missedRings(n, null, (r) => retries.push(r), (r) => msgs.push(r));
  expect(retries.length).toBe(1);
});
test("stuck live calls are swept", () => {
  const n = openWynDb(mkdtempSync(join(tmpdir(), "nc-")));
  n.query("INSERT INTO calls (id, status, started_at) VALUES ('a', 'live', '2020-01-01T00:00:00Z'), ('b', 'live', ?), ('c', 'live', '2020-01-01T00:00:00Z')").run(new Date().toISOString());
  const ended: string[] = [];
  sweepCalls(n, new Set(["b", "c"]), (id) => ended.push(id));
  expect((n.query("SELECT status FROM calls WHERE id = 'a'").get() as any).status).toBe("dropped");
  expect((n.query("SELECT status FROM calls WHERE id = 'b'").get() as any).status).toBe("live");
  expect(ended).toEqual(["c"]);
});
test("call tools and settings", () => {
  const n = openWynDb(mkdtempSync(join(tmpdir(), "nc-")));
  const names = voiceTools().map((t) => t.name);
  expect(names).toContain("add_idea"); expect(names).toContain("ask_wyn"); expect(names).toContain("session_new");
  expect(callSettings(n).voice).toBe("marin");
  n.query("INSERT INTO prefs (key, value) VALUES ('call_voice', 'Coral'), ('voice', 'cedar')").run();
  expect(callSettings(n).voice).toBe("coral");
});
test("call hearing and turn-taking defaults", () => {
  const n = openWynDb(mkdtempSync(join(tmpdir(), "nc-")));
  const a = callAudio(n, true) as any;
  expect(a.input.transcription.model).toBe("gpt-4o-transcribe"); // the only one that keeps Hindi in Roman script
  expect(a.input.transcription.prompt).toContain("Roman Hindi");
  expect(a.input.turn_detection).toMatchObject({ type: "semantic_vad", eagerness: "high", interrupt_response: true });
  expect(a.input.format).toEqual({ type: "audio/pcm", rate: 24000 });
  const t = Object.fromEntries(voiceTools().map((x: any) => [x.name, x.description]));
  expect(t.add_task).toContain("his words only");
  expect(t.session_new).toContain("Codex ko bolo");
  const r = callRules("Alex");
  expect(r).toContain("These rules win over anything above");
  expect(r).toContain("never say them");
});
test("a ring nobody answered before its window passed is only marked missed: no retry, no message", () => {
  const n = openWynDb(mkdtempSync(join(tmpdir(), "nc-")));
  const retries: string[] = [], msgs: string[] = [];
  logRing(n, "in_night", "Night shutdown: close the day and journal");
  // The PC was asleep overnight: the next look at it is nine hours later.
  n.exec("UPDATE call_attempts SET rang_at = '" + new Date(Date.now() - 9 * 3600_000).toISOString() + "'");
  missedRings(n, null, (r) => retries.push(r), (r) => msgs.push(r));
  expect(retries).toEqual([]);
  expect(msgs).toEqual([]);
  expect((n.query("SELECT status FROM call_attempts WHERE incoming_id = 'in_night'").get() as any).status).toBe("missed");
  // A ring that is still on his screen is left alone, whatever its age says.
  logRing(n, "in_now", "Morning check-in");
  n.exec("UPDATE call_attempts SET rang_at = '" + new Date(Date.now() - 120_000).toISOString() + "' WHERE incoming_id = 'in_now'");
  missedRings(n, "in_now", (r) => retries.push(r), (r) => msgs.push(r));
  expect((n.query("SELECT status FROM call_attempts WHERE incoming_id = 'in_now'").get() as any).status).toBe("ringing");
});
test("a call that died within seconds sends its ring back to the missed-call logic", () => {
  const n = openWynDb(mkdtempSync(join(tmpdir(), "nc-")));
  const retries: string[] = [];
  expect(deadCall(1)).toBe(true);
  expect(deadCall(DEAD_CALL_SEC - 1)).toBe(true);
  expect(deadCall(DEAD_CALL_SEC)).toBe(false);
  logRing(n, "in_d", "Morning check-in");
  closeRing(n, "in_d", "answered");
  failRing(n, "in_d");
  expect((n.query("SELECT status FROM call_attempts WHERE incoming_id = 'in_d'").get() as any).status).toBe("failed");
  missedRings(n, null, (r) => retries.push(r), () => {});
  expect(retries).toEqual(["Morning check-in"]);
  expect((n.query("SELECT status FROM call_attempts WHERE incoming_id = 'in_d'").get() as any).status).toBe("missed");
  // A call that went fine stays answered.
  logRing(n, "in_ok", "Night");
  closeRing(n, "in_ok", "answered");
  missedRings(n, null, (r) => retries.push(r), () => {});
  expect(retries.length).toBe(1);
});
test("a scheduled call is let go once it's more than its window late", () => {
  const now = Date.now();
  expect(lateCall(new Date(now - 5 * 60_000).toISOString(), now)).toBe(false);
  expect(lateCall(new Date(now - RING_WINDOW_MS - 60_000).toISOString(), now)).toBe(true);
});
