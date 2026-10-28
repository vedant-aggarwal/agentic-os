import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachedPaths, claudeContent, codexInput, openAttachments, withAttachments } from "./attachments";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const up = (body: Buffer | string, name: string) => new Request(`http://x/jobs/attachments?name=${encodeURIComponent(name)}`, { method: "POST", body });

describe("attachments", () => {
  const dir = mkdtempSync(join(tmpdir(), "att-"));
  const a = openAttachments(dir);

  test("stores files, fixes image names from the bytes, and names them in the prompt", async () => {
    const img = await a.put(up(PNG, "image"));
    expect(img.image).toBe(true);
    expect(img.name).toBe("image.png");
    const doc = await a.put(up("hello", "../../notes:v2.txt"));
    expect(doc.image).toBe(false);
    expect(doc.name).toBe("notes_v2.txt");
    const text = withAttachments("Look at these", a.resolve([img.id, doc.id]));
    expect(attachedPaths(text)).toEqual([img.path, doc.path]);
    const c = claudeContent(text) as any[];
    expect(c[0]).toEqual({ type: "text", text });
    expect(c[1].source.media_type).toBe("image/png");
    expect(c).toHaveLength(2);
    expect(codexInput(text).slice(1)).toEqual([{ type: "localImage", path: img.path }]);
    expect(withAttachments("", a.resolve([doc.id]))).toStartWith("See the attached files.");
  });

  test("plain text stays plain, bad ids fail", async () => {
    expect(claudeContent("hi")).toBe("hi");
    expect(codexInput("hi")).toHaveLength(1);
    const fake = await a.put(up("not a picture", "x.png"));
    expect(fake.image).toBe(false);
    expect(claudeContent(withAttachments("hi", [fake]))).toBeTypeOf("string");
    expect(() => a.resolve(["a_0000000000000000"])).toThrow();
    expect(() => a.resolve(["../x"])).toThrow();
    expect(a.resolve(undefined)).toEqual([]);
  });

  test("the block can sit mid-prompt", async () => {
    const img = await a.put(up(PNG, "s.png"));
    const ctx = withAttachments("Fix the header", [img]) + "\n\nWorking folder: C:\\x";
    expect(attachedPaths(ctx)).toEqual([img.path]);
    rmSync(dir, { recursive: true, force: true });
  });
});
