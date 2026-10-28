// The keyboard's AI: rewrite his draft or draft a reply from a screenshot. Codex runs it on the ChatGPT login and
// answers in KB_SCHEMA, so the text to insert is always separate from the note. A thread keeps every version:
// each assistant turn is one version, and a follow-up only sends the new message (the thread lives here).
// Storage: <DATA_DIR>/kb/<userId>/<threadId>.json and <DATA_DIR>/kb/<userId>/img/<imageId>.<ext>
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ApiError } from "./store";
import { KB_SCHEMA, kbPrompt, REPLY_MODES, REWRITE_ACTIONS, type KbTurn } from "./kb-prompts";
import type { CodexOpts, CodexResult } from "./codex";

type Option = { text: string; label: string };
type Thread = {
  id: string; mode: "rewrite" | "reply"; text: string | null; action: string | null; style: string | null; custom: string | null;
  imageIds: string[]; createdAt: string; updatedAt: string;
  turns: { role: "user" | "assistant"; content: string; options?: Option[]; note?: string; at: string }[];
};
const MAX_IMAGE = 15 * 1024 * 1024;
const id = (p: string) => `${p}${randomBytes(9).toString("base64url").replace(/[-_]/g, "x")}`;

export function openKb(o: { dataDir: string; codex: (o: CodexOpts) => Promise<CodexResult> }) {
  const dir = (userId: number, ...rest: string[]) => join(o.dataDir, "kb", String(userId), ...rest);
  const threadPath = (userId: number, t: string) => {
    if (!/^k_[A-Za-z0-9]{6,32}$/.test(t)) throw new ApiError(404, "No such thread.");
    return dir(userId, `${t}.json`);
  };
  function load(userId: number, t: string): Thread {
    const f = threadPath(userId, t);
    if (!existsSync(f)) throw new ApiError(404, "No such thread.");
    return JSON.parse(readFileSync(f, "utf8"));
  }
  function save(userId: number, th: Thread) {
    mkdirSync(dir(userId), { recursive: true });
    const f = threadPath(userId, th.id);
    writeFileSync(f + ".tmp", JSON.stringify(th));
    renameSync(f + ".tmp", f);
  }
  function imagePath(userId: number, imageId: string) {
    if (!/^img_[A-Za-z0-9]{6,32}$/.test(imageId)) throw new ApiError(400, `Bad image id ${imageId}.`);
    const d = dir(userId, "img");
    const f = existsSync(d) ? readdirSync(d).find((x) => x.startsWith(imageId + ".")) : null;
    if (!f) throw new ApiError(404, `No image ${imageId}. Upload it again.`);
    return join(d, f);
  }

  /** Raw image bytes (jpeg, png, heic, webp). HEIC is converted to JPEG with ffmpeg, since Codex reads jpeg/png. */
  async function putImage(userId: number, req: Request) {
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) throw new ApiError(400, "Send the image bytes as the body.");
    if (buf.length > MAX_IMAGE) throw new ApiError(413, "Image too large (15 MB max).");
    const ext = buf[0] === 0xff && buf[1] === 0xd8 ? "jpg" : buf.toString("hex", 0, 4) === "89504e47" ? "png"
      : buf.toString("ascii", 8, 12) === "WEBP" ? "webp" : buf.toString("ascii", 4, 8) === "ftyp" ? "heic" : null;
    if (!ext) throw new ApiError(415, "Send a JPEG, PNG, WebP or HEIC image.");
    const imageId = id("img_");
    const d = dir(userId, "img");
    mkdirSync(d, { recursive: true });
    // Old screenshots go after a day.
    for (const f of readdirSync(d)) { try { if (Date.now() - statSync(join(d, f)).mtimeMs > 864e5) rmSync(join(d, f)); } catch {} }
    let path = join(d, `${imageId}.${ext}`);
    writeFileSync(path, buf);
    if (ext === "heic" || ext === "webp") {
      const jpg = join(d, `${imageId}.jpg`);
      const r = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-frames:v", "1", "-q:v", "3", jpg], { stdout: "pipe", stderr: "pipe" });
      if (r.exitCode === 0 && existsSync(jpg)) { rmSync(path); path = jpg; }
      else console.error(`[kb] could not convert ${ext}: ${r.stderr.toString().slice(-300)}`);
    }
    return { imageId };
  }

  const describe = (th: Thread) => {
    if (th.mode === "rewrite") return `Rewrite my draft${th.action ? ` (${REWRITE_ACTIONS[th.action]?.label ?? th.action})` : ""}${th.custom ? `: ${th.custom}` : ""}.`;
    return `Draft my reply${th.style ? ` (${REPLY_MODES[th.style]?.label ?? th.style})` : ""}${th.custom ? `: ${th.custom}` : ""}.`;
  };
  const optionsText = (opts: Option[], note?: string) =>
    opts.map((x, i) => `Option ${i + 1} (${x.label}): ${x.text}`).join("\n") + (note ? `\nNote: ${note}` : "");

  async function chat(userId: number, b: any) {
    const str = (v: unknown, max: number) => (v == null || String(v).trim() === "" ? null : String(v).slice(0, max));
    let th: Thread;
    let message = str(b.message, 4000);
    const fresh = !b.threadId;
    if (fresh) {
      const mode = b.mode === "reply" ? "reply" : b.mode === "rewrite" ? "rewrite" : null;
      if (!mode) throw new ApiError(400, 'mode is "rewrite" or "reply".');
      const imageIds = Array.isArray(b.imageIds) ? b.imageIds.map(String).slice(0, 4) : [];
      imageIds.forEach((x: string) => imagePath(userId, x));
      const stamp = new Date().toISOString();
      th = { id: id("k_"), mode, text: str(b.text, 20000), action: str(b.action, 40), style: str(b.style, 40), custom: str(b.custom, 2000),
        imageIds, createdAt: stamp, updatedAt: stamp, turns: [] };
      if (mode === "rewrite" && !th.text) throw new ApiError(400, "Give the text to rewrite.");
      if (mode === "reply" && !th.text && !imageIds.length && !th.custom) throw new ApiError(400, "Give a screenshot, the chat text or what you want to say.");
      if (th.action && !REWRITE_ACTIONS[th.action]) throw new ApiError(400, `Unknown action ${th.action}.`);
      if (th.style && th.style !== "custom" && !REPLY_MODES[th.style]) throw new ApiError(400, `Unknown reply mode ${th.style}.`);
    } else {
      th = load(userId, String(b.threadId));
      // A different chip on the same thread: switch the brief and say so.
      const action = str(b.action, 40), style = str(b.style, 40), custom = str(b.custom, 2000);
      if (action && action !== th.action) { if (!REWRITE_ACTIONS[action]) throw new ApiError(400, `Unknown action ${action}.`); th.action = action; message ??= `Now do this instead: ${REWRITE_ACTIONS[action].label}.`; }
      if (style && style !== th.style) { if (style !== "custom" && !REPLY_MODES[style]) throw new ApiError(400, `Unknown reply mode ${style}.`); th.style = style; message ??= `Now switch the style to: ${REPLY_MODES[style]?.label ?? "my custom request"}.`; }
      if (custom && custom !== th.custom) { th.custom = custom; message ??= custom; }
      if (b.text != null && str(b.text, 20000) !== th.text) { th.text = str(b.text, 20000); message ??= "I edited the text; redo it."; }
      if (Array.isArray(b.imageIds) && b.imageIds.length) {
        const add = b.imageIds.map(String).filter((x: string) => !th.imageIds.includes(x));
        add.forEach((x: string) => imagePath(userId, x));
        th.imageIds = [...th.imageIds, ...add].slice(-4);
        if (add.length) message ??= "I added another screenshot; use it.";
      }
      if (!message) throw new ApiError(400, "Say what to change.");
    }
    const history: KbTurn[] = th.turns.map((t) => ({ role: t.role, content: t.role === "assistant" && t.options ? optionsText(t.options, t.note) : t.content }));
    const images = th.imageIds.map((x) => { try { return imagePath(userId, x); } catch { return null; } }).filter(Boolean) as string[];
    const prompt = kbPrompt({ mode: th.mode, text: th.text ?? undefined, action: th.action ?? undefined, style: th.style ?? undefined,
      custom: th.custom ?? undefined, imageCount: images.length, history, message: fresh ? undefined : message ?? undefined });
    const r = await o.codex({ prompt, schema: KB_SCHEMA, images, effort: "low", timeoutMs: 120_000, model: process.env.KB_CODEX_MODEL || undefined });
    const options: Option[] = (Array.isArray(r.out?.options) ? r.out.options : [])
      .map((x: any) => ({ text: String(x?.text ?? "").trim(), label: String(x?.label ?? "").trim() || "Option" })).filter((x: Option) => x.text);
    if (!options.length) throw new ApiError(502, "Codex gave no options. Try again.");
    const note = String(r.out?.note ?? "").trim();
    const stamp = new Date().toISOString();
    th.turns.push({ role: "user", content: fresh ? describe(th) : message!, at: stamp });
    th.turns.push({ role: "assistant", content: "", options, note, at: stamp });
    th.updatedAt = stamp;
    save(userId, th);
    return { threadId: th.id, turn: th.turns.filter((t) => t.role === "assistant").length, options, note, ms: r.ms };
  }

  /** Every version of a thread, oldest first (for back/forward after the keyboard reloads). */
  function thread(userId: number, t: string) {
    const th = load(userId, t);
    return { threadId: th.id, mode: th.mode, text: th.text, action: th.action, style: th.style, custom: th.custom, imageIds: th.imageIds,
      versions: th.turns.flatMap((x, i) => x.role === "assistant" ? [{ turn: th.turns.slice(0, i + 1).filter((y) => y.role === "assistant").length,
        request: th.turns[i - 1]?.content ?? null, options: x.options ?? [], note: x.note ?? "", at: x.at }] : []) };
  }

  const modes = () => ({
    reply: [...Object.entries(REPLY_MODES).map(([key, m]) => ({ key, label: m.label })), { key: "custom", label: "Custom" }],
    rewrite: Object.entries(REWRITE_ACTIONS).map(([key, m]) => ({ key, label: m.label })),
  });
  return { putImage, chat, thread, modes };
}
