// checkpoints.has(): a job whose store isn't on this PC (a copied data folder, deleted snapshots) is told apart from a real
// failure, so jobs.ts answers 409 with a sentence instead of a 500.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCheckpoints } from "./checkpoints";

test("has() is true for a snapshot in the job's store and false when the store or the tree is missing", async () => {
  const data = mkdtempSync(join(tmpdir(), "aos-ckpt-data-"));
  const cwd = mkdtempSync(join(tmpdir(), "aos-ckpt-cwd-"));
  writeFileSync(join(cwd, "a.txt"), "one\n");
  const ck = openCheckpoints(data);
  const snap = await ck.snapshot(7, cwd);
  expect(snap.tree).toBeTruthy();
  expect(await ck.has(7, cwd, snap.tree!)).toBe(true);
  expect(await ck.has(8, cwd, snap.tree!)).toBe(false);                       // no store for job 8
  expect(await ck.has(7, cwd, "0123456789abcdef0123456789abcdef01234567")).toBe(false);   // a tree the store never had
  expect(await ck.has(7, join(cwd, "gone"), snap.tree!)).toBe(true);           // the folder can be gone; the store answers
  ck.drop(7);
  expect(await ck.has(7, cwd, snap.tree!)).toBe(false);
});
