import { expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWyn } from "./wyn";
import { setPref } from "./wyn-tools";
import { istDate } from "./store";

test("chat passes Jev hints and history into Wyn, records status, and still replies after provider failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wyn-guide-wiring-"));
  const savedKey = process.env.OPENROUTER_API_KEY, savedMode = process.env.WYN_JEV, savedFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "fixture-not-a-real-key"; process.env.WYN_JEV = "on";
  const today = istDate(), user = { id: 777, name: "Fixture", role: "owner", agentos_db: join(dir, "fixture.db") } as any;
  const boot = { today: { date: today, weekday: "Fri", tasks: [], events: [] }, week: { days: [] }, goals: { goals: [] }, areas: [] };
  const prompts: Promise<string>[] = [], providerRequests: any[] = [];
  const spawn = spyOn(Bun, "spawn").mockImplementation((_args, opts: any) => {
    prompts.push(opts.stdin.text());
    return { stdout: new Response(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "I checked the plan." } }) + "\n").body,
      stderr: new Response("").body, exited: Promise.resolve(0), exitCode: 0, kill() {} } as any;
  });
  let fail = false;
  globalThis.fetch = (async (_url, init) => {
    const req = JSON.parse(String(init?.body)); providerRequests.push(req);
    if (fail) throw new Error("private provider failure");
    return Response.json({ answers: Object.fromEntries(Object.keys(req.questions).map(app => [app, { noul: app === "calendar" ? 0.98 : 0.04 }])), usage: { cost: 0.00002 } });
  }) as typeof fetch;
  const wyn = openWyn({ dataDir: dir, ai: {} as any, storeFor: () => ({ bootstrap: () => boot }) as any, userById: () => user, owners: () => [] });
  const n = wyn.db(user); setPref(n, "onboard.done", "fixture");
  const run = async (text: string) => {
    const done = new Promise<void>(resolve => wyn.onTurn({ done: () => resolve() }));
    wyn.send(user, text); await done;
    return (n.query("SELECT text,meta FROM messages WHERE role='wyn' ORDER BY id DESC LIMIT 1").get() as any);
  };
  try {
    const first = await run("No classes for the next two days");
    expect(JSON.parse(first.meta).jev.status).toBe("ok");
    expect((await prompts[0])).toContain("calendar_cancel (ask)");
    const second = await run("Correction: only tomorrow, keep Friday unchanged");
    expect(second.text).toBe("I checked the plan.");
    expect(providerRequests[1].state.data.history.some((m: any) => m.role === "user" && m.text.includes("No classes"))).toBe(true);
    expect(providerRequests[1].state.data.message).toContain("only tomorrow");
    fail = true;
    const third = await run("Please check the plan again");
    expect(JSON.parse(third.meta).jev.status).toBe("unavailable");
    expect(third.text).toBe("I checked the plan.");
    expect(await prompts[2]).toContain("Independently check useful follow-through");
    expect(await prompts[2]).not.toContain("private provider failure");
  } finally {
    spawn.mockRestore(); globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
    if (savedMode === undefined) delete process.env.WYN_JEV; else process.env.WYN_JEV = savedMode;
    // openWyn retains its user DB for background call bookkeeping. Like the existing Wyn
    // policy fixtures, keep this synthetic temp folder until the test process releases it.
    n.close();
  }
});
