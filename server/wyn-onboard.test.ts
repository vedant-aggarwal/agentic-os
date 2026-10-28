import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { OB, onboardDue, onboardNote, replyParts, ROAST_RULES, signals } from "./wyn-onboard";
import { toolByName } from "./wyn-tools";

const db = () => { const n = new Database(":memory:"); n.exec("CREATE TABLE prefs (key TEXT PRIMARY KEY, value TEXT)"); return n; };
const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

test("onboarding runs once on its own, then only when asked", () => {
  const n = db();
  expect(onboardDue(n)).toBe(true);
  expect(onboardDue(n)).toBe(false);
  const m = db();
  m.query("INSERT INTO prefs VALUES (?, ?)").run(OB.done, ago(1));
  expect(onboardDue(m)).toBe(false);
});

test("his next three messages get the save-your-answers note, then it stops", () => {
  const n = db();
  n.query("INSERT INTO prefs VALUES (?, '3')").run(OB.open);
  expect(onboardNote(n)).toMatch(/remember term long/);
  expect(onboardNote(n)).not.toBe("");
  expect(onboardNote(n)).not.toBe("");
  expect(onboardNote(n)).toBe("");
});

test("the roast turn may use four messages, others three", () => {
  const n = db();
  n.query("INSERT INTO prefs VALUES (?, 'onboard-x')").run(OB.turn);
  expect(replyParts(n, "onboard-x")).toBe(4);
  expect(replyParts(n, "chat-y")).toBe(3);
});

test("signals count what's late, what's sat and what got done", () => {
  const tasks = [
    { title: "Old deck", status: "todo", due: "2026-10-01" }, { title: "Fresh", status: "todo", due: null },
    { title: "Shipped", status: "done", completedAt: ago(2) }, { title: "Ancient done", status: "done", completedAt: ago(20) },
  ];
  const s = signals(tasks, [{ status: "open" }, { status: "open" }, { status: "tasked" }], "2026-10-21", [{ title: "Old deck", created_at: ago(19) }, { title: "Fresh", created_at: ago(1) }]);
  expect(s).toMatchObject({ openTasks: 2, overdueCount: 1, overdue: [{ title: "Old deck", due: "2026-10-01" }], doneLast7Days: ["Shipped"], openIdeas: 2, ideasTurnedIntoTasks: 1 });
  expect(s.sittingLongest).toEqual([{ title: "Old deck", openForDays: 19 }]);
});

test("onboard_me is one of her tools and the rules hold her to the soul", () => {
  expect(toolByName.has("onboard_me")).toBe(true);
  expect(ROAST_RULES).toMatch(/tum/);
  expect(ROAST_RULES).toMatch(/no em dashes/);
  expect(ROAST_RULES).toMatch(/Only facts this tool returned/);
});
