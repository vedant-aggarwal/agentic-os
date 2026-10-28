import { describe, expect, test } from "bun:test";
import { applyTool, fromChecklist, withState } from "./progress";

const plan = { id: "fix", title: "Fix voice", stages: [
  { name: "Find", steps: [{ title: "Read recorder" }, { title: "Find cause" }] },
  { name: "Fix", steps: [{ title: "Patch caret" }, { title: "Test" }] },
] };

describe("plan_progress", () => {
  test("create makes the first step active", () => {
    const p = applyTool(null, plan).progress!;
    expect(p.total).toBe(4);
    expect(p.done).toBe(0);
    expect(p.active).toBe("Read recorder");
    expect(p.stage).toBe("Find");
    expect(p.state).toBe("running");
  });
  test("next moves on, done+active jumps, all done finishes", () => {
    let p = applyTool(null, plan).progress!;
    p = applyTool(p, { next: true }).progress!;
    expect(p.done).toBe(1);
    expect(p.active).toBe("Find cause");
    p = applyTool(p, { done: ["Find cause"], active: "Test" }).progress!;
    expect(p.active).toBe("Test");
    expect(p.done).toBe(2);
    p = applyTool(p, { done: ["Patch caret", "Test"] }).progress!;
    expect(p.done).toBe(4);
    expect(p.state).toBe("done");
  });
  test("unknown step is refused with the step list", () => {
    const p = applyTool(null, plan).progress!;
    const r = applyTool(p, { done: ["Nope"] });
    expect(r.progress).toBeUndefined();
    expect(r.error).toContain("Read recorder");
  });
  test("short call with no bar is refused", () => {
    expect(applyTool(null, { next: true }).error).toContain("no bar");
  });
  test("resent plan keeps finished steps", () => {
    let p = applyTool(null, plan).progress!;
    p = applyTool(p, { next: true }).progress!;
    p = applyTool(p, { ...plan, stages: [...plan.stages, { name: "Ship", steps: [{ title: "Commit" }] }] }).progress!;
    expect(p.total).toBe(5);
    expect(p.done).toBe(1);
    expect(p.active).toBe("Find cause");
  });
  test("failed and needs_input set the state; the next call clears them", () => {
    let p = applyTool(null, plan).progress!;
    p = applyTool(p, { failed: "Read recorder", note: "file missing" }).progress!;
    expect(p.state).toBe("error");
    expect(p.note).toBe("file missing");
    p = applyTool(p, { active: "Find cause" }).progress!;
    expect(p.state).toBe("running");
    p = applyTool(p, { state: "needs_input", note: "which fix?" }).progress!;
    expect(p.state).toBe("needs_input");
    expect(withState(p, "running")!.state).toBe("running");
  });
  test("todo kind is one stage", () => {
    const p = applyTool(null, { kind: "todo", steps: ["a", "b"] }).progress!;
    expect(p.stages.length).toBe(1);
    expect(p.total).toBe(2);
  });
  test("a checklist makes a bar, but never replaces the agent's own open bar", () => {
    const t = fromChecklist(null, [{ content: "One", status: "completed" }, { content: "Two", status: "in_progress" }, { content: "Three", status: "pending" }])!;
    expect(t.source).toBe("todo");
    expect(t.done).toBe(1);
    expect(t.active).toBe("Two");
    const own = applyTool(null, plan).progress!;
    expect(fromChecklist(own, [{ content: "x", status: "pending" }])).toBe(own);
  });
});
