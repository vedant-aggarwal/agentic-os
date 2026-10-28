import { expect, test } from "bun:test";
import { deliver, splitReply, typingMs } from "./wyn-reply";

test("one paragraph stays one message", () => {
  expect(splitReply("Done. Moved gym to 18:00.")).toEqual(["Done. Moved gym to 18:00."]);
  expect(splitReply("  ")).toEqual([]);
});

test("blank lines split into up to three messages", () => {
  const t = "Haan, done.\n\nMoved gym to 18:00 so it doesn't clash with the lab.\n\nWant me to call at 22:15 to close the day?";
  expect(splitReply(t)).toEqual(["Haan, done.", "Moved gym to 18:00 so it doesn't clash with the lab.", "Want me to call at 22:15 to close the day?"]);
});

test("more than three pieces merge down to three, smallest neighbours first", () => {
  const parts = splitReply("First thought here, fairly long one.\n\nSecond one is short-ish.\n\nThird one.\n\nAnd a fourth, the closing line of it.");
  expect(parts.length).toBe(3);
  expect(parts.join("\n\n")).toContain("Third one.");
});

test("a list stays with its intro and is never cut", () => {
  const t = "Here's the plan for today:\n\n- 09:00 Algebra\n- 11:00 Corner Market reels\n\n- 14:00 Gym\n\nSound good?";
  const parts = splitReply(t);
  expect(parts[0]).toBe("Here's the plan for today:\n\n- 09:00 Algebra\n- 11:00 Corner Market reels\n\n- 14:00 Gym");
  expect(parts[1]).toBe("Sound good?");
});

test("a code block with blank lines inside is one piece", () => {
  const t = "Run this:\n\n```\nagentos add \"x\"\n\nagentos done 3\n```\n\nThen tell me.";
  const parts = splitReply(t);
  expect(parts[0]).toContain("agentos add");
  expect(parts[0]).toContain("agentos done 3");
  expect(parts[0].startsWith("Run this:")).toBe(true);
});

test("tiny fragments join a neighbour", () => {
  expect(splitReply("Okay, I moved the gym block to the evening.\n\n:)")).toEqual(["Okay, I moved the gym block to the evening.\n\n:)"]);
  expect(splitReply("Ok\n\nI moved the gym block to the evening.")).toEqual(["Ok\n\nI moved the gym block to the evening."]);
  expect(splitReply("Haan!\n\nI moved the gym block to the evening.")).toEqual(["Haan!", "I moved the gym block to the evening."]);
});

test("deliver sends in order with typing between", async () => {
  const log: string[] = [];
  await deliver(["a", "b", "c"], (t, i, last) => { log.push(`${t}${last ? "!" : ""}`); }, { onTyping: (on) => log.push(on ? "typing" : "idle"), sleep: async () => {} });
  expect(log).toEqual(["a", "typing", "b", "typing", "c!", "idle"]);
  expect(typingMs("x")).toBe(700);
  expect(typingMs("x".repeat(1000))).toBe(2400);
});
