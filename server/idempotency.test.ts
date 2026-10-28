import { expect, test } from "bun:test";
import { idempotency } from "./idempotency";

const req = (key?: string, method = "POST", path = "/api/v1/tasks") => new Request(`http://x${path}`, { method, headers: key ? { "Idempotency-Key": key } : {} });

test("a resent create gets the first answer and runs once", async () => {
  const idem = idempotency("", { file: ":memory:" });
  let runs = 0;
  const run = async () => { runs++; return Response.json({ id: `t${runs}` }, { status: 201 }); };
  const a = await idem.wrap(req("task:1:n1"), { id: 1 }, run);
  const b = await idem.wrap(req("task:1:n1"), { id: 1 }, run);
  expect(runs).toBe(1);
  expect(await a.json()).toEqual({ id: "t1" });
  expect(b.status).toBe(201);
  expect(b.headers.get("Idempotent-Replay")).toBe("true");
  expect(await b.json()).toEqual({ id: "t1" });
  idem.close();
});

test("keys are per user and per path; no key, or a read, passes straight through", async () => {
  const idem = idempotency("", { file: ":memory:" });
  let runs = 0;
  const run = async () => { runs++; return Response.json({ n: runs }); };
  await idem.wrap(req("k"), { id: 1 }, run);
  await idem.wrap(req("k"), { id: 2 }, run);
  await idem.wrap(req("k", "POST", "/api/v1/goals"), { id: 1 }, run);
  await idem.wrap(req(), { id: 1 }, run);
  await idem.wrap(req(), { id: 1 }, run);
  await idem.wrap(req("k", "GET"), { id: 1 }, run);
  expect(runs).toBe(6);
  idem.close();
});

test("two copies at once wait for the first; a 5xx is not kept, so a retry runs", async () => {
  const idem = idempotency("", { file: ":memory:" });
  let runs = 0;
  const slow = async () => { runs++; await new Promise((r) => setTimeout(r, 30)); return Response.json({ ok: true }, { status: 201 }); };
  const [a, b] = await Promise.all([idem.wrap(req("same"), { id: 1 }, slow), idem.wrap(req("same"), { id: 1 }, slow)]);
  expect(runs).toBe(1);
  expect([a.status, b.status]).toEqual([201, 201]);
  let fails = 0;
  const flaky = async () => (++fails === 1 ? Response.json({ error: "locked" }, { status: 500 }) : Response.json({ id: "t9" }, { status: 201 }));
  expect((await idem.wrap(req("retry"), { id: 1 }, flaky)).status).toBe(500);
  expect((await idem.wrap(req("retry"), { id: 1 }, flaky)).status).toBe(201);
  expect(fails).toBe(2);
  idem.close();
});

test("an answer older than 48 hours is forgotten", async () => {
  let t = 1_000_000;
  const idem = idempotency("", { file: ":memory:", now: () => t });
  let runs = 0;
  const run = async () => Response.json({ n: ++runs });
  await idem.wrap(req("old"), { id: 1 }, run);
  t += 49 * 3600_000;
  await idem.wrap(req("old"), { id: 1 }, run);
  expect(runs).toBe(2);
  idem.close();
});
