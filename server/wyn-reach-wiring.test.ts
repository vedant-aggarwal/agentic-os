// Her scheduler (tick) end to end on a temp data folder, with the clock moved by hand: rings that go unanswered,
// calls that die at once, and what she holds back after he writes.
import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWyn } from "./wyn";
import { setPref } from "./wyn-tools";

const ist = (s: string) => new Date(`${s}${s.length === 16 ? ":00" : ""}+05:30`);
const saved = { owner: process.env.WYN_OWNER_CODEX_HOME, sched: process.env.MOD_SCHEDULER, hb: process.env.WYN_HEARTBEAT };
afterEach(() => {
  setSystemTime();
  for (const [k, v] of [["WYN_OWNER_CODEX_HOME", saved.owner], ["MOD_SCHEDULER", saved.sched], ["WYN_HEARTBEAT", saved.hb]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "wyn-reach-"));
  process.env.WYN_OWNER_CODEX_HOME = join(dir, "no-codex");   // no login to link: nothing here may think anyway
  process.env.MOD_SCHEDULER = "off"; delete process.env.WYN_HEARTBEAT;
  let open = true;
  const user = { id: 779, name: "Alex Fixture", role: "owner", agentos_db: join(dir, "fixture.db") } as any;
  const boot = () => ({ today: { date: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), weekday: "Fri", tasks: [], events: [] }, week: { days: [] },
    sleep: { bed: "23:30", wake: "06:00" } });
  const wyn = openWyn({ dataDir: dir, ai: { agentsFor: async () => ({}) } as any, storeFor: () => ({ bootstrap: boot, tasks: () => [] }) as any,
    userById: () => user, owners: () => (open ? [user] : []) });
  const n = wyn.db(user);
  for (const [k, v] of [["onboard.done", "fixture"], ["proactive_level", "off"], ["memory.consolidated", "9999-12-31"], ["review.week", "9999-12-31"]]) setPref(n, k, v);
  const rings = () => n.query("SELECT incoming_id, reason, attempt, status, rang_at FROM call_attempts ORDER BY id").all() as any[];
  const pending = () => n.query("SELECT reason, at FROM schedule WHERE status = 'pending'").all() as any[];
  // Her timers keep running after a test: they stop seeing this owner, background work from the last tick finishes,
  // then her db closes.
  const close = async () => { open = false; await Bun.sleep(30); n.close(); };
  return { wyn, user, n, rings, pending, close };
}

test("an unanswered night ring is retried that night, then given up; nothing of it rings in the morning", async () => {
  const { wyn, n, rings, pending, close } = setup();
  setPref(n, "night_call", "22:15");
  try {
    setSystemTime(ist("2026-10-22T22:15")); await wyn.tick();
    expect(rings()).toMatchObject([{ attempt: 1, status: "ringing" }]);
    // 90 s later the ring is off his screen. Nothing else has rung, and it still counts as missed.
    setSystemTime(ist("2026-10-22T22:17")); await wyn.tick();
    expect(rings()[0].status).toBe("missed");
    expect(pending()).toHaveLength(1);
    setSystemTime(ist("2026-10-22T22:27:30")); await wyn.tick();
    expect(rings().map((r) => r.attempt)).toEqual([1, 2]);
    setSystemTime(ist("2026-10-22T22:29:30")); await wyn.tick();
    expect(rings()[1].status).toBe("gave_up");
    expect((n.query("SELECT text FROM messages WHERE turn LIKE 'reach-missed-%'").get() as any).text).toContain("I tried calling twice");
    // 10-23 rang him at 06:53, 07:30 and 07:40 with the night script. Now the morning has only the morning call.
    for (const hm of ["06:53", "07:30", "07:40"]) { setSystemTime(ist(`2026-10-23T${hm}`)); await wyn.tick(); }
    const night = rings().filter((r) => r.reason.startsWith("Night"));
    expect(night.map((r) => r.rang_at)).toEqual([ist("2026-10-22T22:15").toISOString(), ist("2026-10-22T22:27:30").toISOString()]);
    expect(rings().slice(2).map((r) => r.reason)).toEqual(["Morning check-in: today's plan"]);
    expect(pending().filter((r) => r.reason.startsWith("Night"))).toEqual([]);
  } finally { await close(); }
});

test("after a night with the PC asleep, last night's ring and its retry are let go, not rung", async () => {
  const { wyn, n, rings, pending, close } = setup();
  setPref(n, "night_call", "22:15");
  try {
    setSystemTime(ist("2026-10-22T22:15")); await wyn.tick();
    // The retry was booked before the PC slept (the old code also left the ring "ringing" until the next one).
    n.query("INSERT INTO schedule (kind, at, reason, created_at) VALUES ('call', ?, ?, ?)").run(ist("2026-10-22T22:27").toISOString(), "Night shutdown: close the day and journal", ist("2026-10-22T22:17").toISOString());
    setSystemTime(ist("2026-10-23T06:53")); await wyn.tick();
    expect(rings()).toMatchObject([{ attempt: 1, status: "missed" }]);
    expect(pending()).toEqual([]);
    expect((n.query("SELECT status FROM schedule WHERE at = ?").get(ist("2026-10-22T22:27").toISOString()) as any).status).toBe("missed");
    expect(n.query("SELECT 1 FROM messages WHERE turn LIKE 'reach-missed-%'").get()).toBeNull();
  } finally { await close(); }
});

test("a call that dies within seconds is failed, and its ring is tried again", async () => {
  const { wyn, user, n, rings, pending, close } = setup();
  setPref(n, "morning_call", "07:30");
  try {
    setSystemTime(ist("2026-10-23T07:30")); await wyn.tick();
    const inc = rings()[0].incoming_id;
    const { callId } = await wyn.voiceTurn(user, { start: true, incomingId: inc }) as any;
    setSystemTime(ist("2026-10-23T07:30:02")); await wyn.voiceTurn(user, { callId, hangup: true });
    expect((n.query("SELECT status, seconds FROM calls WHERE id = ?").get(callId) as any)).toEqual({ status: "failed", seconds: 2 });
    expect(rings()[0].status).toBe("failed");
    expect((n.query("SELECT text FROM messages WHERE role = 'call' ORDER BY id DESC LIMIT 1").get() as any).text).toBe("The call dropped.");
    setSystemTime(ist("2026-10-23T07:31")); await wyn.tick();
    expect(pending()).toMatchObject([{ reason: "Morning check-in: today's plan" }]);
  } finally { await close(); }
});

test("when he rings her, her call doesn't carry the phone's \"You called\" as its reason", async () => {
  const { wyn, user, n, close } = setup();
  try {
    setSystemTime(ist("2026-10-23T15:00"));
    const r = await wyn.voiceTurn(user, { start: true, reason: "You called" }) as any;
    expect(r.reply).toBe("Hey Alex, bolo, what's up?");
    expect((n.query("SELECT direction, reason FROM calls WHERE id = ?").get(r.callId) as any)).toEqual({ direction: "outgoing", reason: "" });
  } finally { await close(); }
});

test("her own turns wait 20 minutes after he writes; a call he scheduled still rings", async () => {
  const { wyn, user, n, rings, close } = setup();
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => ({ stdout: new Response(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Arre, noted." } }) + "\n").body,
    stderr: new Response("").body, exited: Promise.resolve(0), exitCode: 0, kill() {} }) as any);
  try {
    // The roast-me onboarding comes due with his first message (onboard.done not set yet).
    n.query("DELETE FROM prefs WHERE key = 'onboard.done'").run();
    setSystemTime(ist("2026-10-23T10:00"));
    const done = new Promise<void>((r) => wyn.onTurn({ done: (_u, turn) => { if (turn.startsWith("chat-")) r(); } }));
    wyn.send(user, "No classes till the 25th, autumn break");
    await done;
    n.query("INSERT INTO schedule (kind, at, reason, created_at) VALUES ('call', ?, 'Call me about the Atlas ERP quote', ?)").run(ist("2026-10-23T10:05").toISOString(), ist("2026-10-23T10:00").toISOString());
    setSystemTime(ist("2026-10-23T10:05")); await wyn.tick();
    expect(n.query("SELECT 1 FROM messages WHERE turn LIKE 'onboard-%'").get()).toBeNull();
    expect(rings().map((r) => r.reason)).toEqual(["Call me about the Atlas ERP quote"]);
    setSystemTime(ist("2026-10-23T10:21")); await wyn.tick();
    const roast = new Promise<void>((r) => wyn.onTurn({ done: (_u, turn) => { if (turn.startsWith("onboard-")) r(); } }));
    await roast;
    expect(n.query("SELECT 1 FROM messages WHERE turn LIKE 'onboard-%'").get()).not.toBeNull();
  } finally { spawn.mockRestore(); await close(); }
});
