// Files he attaches to a job (photos, screenshots, PDFs, anything). Uploaded one at a time as raw bytes, kept under
// <DATA_DIR>/jobs/att/<attId>/<name> (outside the job's folder, so they never land in a commit), and named in the
// prompt as an "Attached files" block of absolute paths. The block keeps queue, steer, fork and rewind text-only;
// the drivers read it back and hand images to the model directly (Claude: image blocks, Codex: localImage).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { ApiError } from "./store";

export const MAX_ATTACHMENT = 25 * 1024 * 1024;
const KEEP_MS = 30 * 864e5;
const HEAD = "Attached files (saved on the PC; read them):";
const IMAGE_EXT: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };
/** Claude takes up to 5 MB per image after base64; bigger ones are left for it to open from the path. */
const MAX_INLINE = 3.7 * 1024 * 1024;

export type Attachment = { id: string; name: string; path: string; size: number; image: boolean };

const safeName = (n: string) => {
  const s = basename(String(n || "file")).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^\.+/, "").trim().slice(-120);
  return s || "file";
};
const sniff = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 ? ".jpg" : b.toString("hex", 0, 4) === "89504e47" ? ".png"
  : b.toString("ascii", 0, 4) === "GIF8" ? ".gif" : b.toString("ascii", 8, 12) === "WEBP" ? ".webp"
  : b.toString("ascii", 4, 8) === "ftyp" && /^(heic|heix|hevc|mif1|msf1)$/.test(b.toString("ascii", 8, 12)) ? ".heic" : null;

export function openAttachments(dataDir: string) {
  const root = join(dataDir, "jobs", "att");
  const folder = (id: string) => {
    if (!/^a_[a-f0-9]{16}$/.test(id)) throw new ApiError(400, `Bad attachment id ${id}.`);
    return join(root, id);
  };
  function get(id: string): Attachment {
    const d = folder(id);
    const f = existsSync(d) ? readdirSync(d)[0] : null;
    if (!f) throw new ApiError(404, `Attachment ${id} is gone. Attach it again.`);
    const path = join(d, f);
    return { id, name: f, path, size: statSync(path).size, image: !!IMAGE_EXT[extname(f).toLowerCase()] };
  }
  function sweep() {
    if (!existsSync(root)) return;
    for (const d of readdirSync(root)) { try { if (Date.now() - statSync(join(root, d)).mtimeMs > KEEP_MS) rmSync(join(root, d), { recursive: true, force: true }); } catch {} }
  }

  /** Raw bytes as the body, the file's name in ?name= (a query, so the iPhone app needs no extra CORS header).
   *  HEIC becomes JPEG so both engines can see it. */
  async function put(req: Request): Promise<Attachment> {
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) throw new ApiError(400, "Send the file's bytes as the body.");
    if (buf.length > MAX_ATTACHMENT) throw new ApiError(413, "That file is over 25 MB.");
    let name = safeName(new URL(req.url).searchParams.get("name") ?? "");
    const kind = sniff(buf);
    // Pasted or camera images often come as "image.png" or with no extension: trust the bytes.
    if (kind && extname(name).toLowerCase() !== kind && !(kind === ".jpg" && /\.jpe?g$/i.test(name))) name = `${name.replace(/\.[^.]*$/, "") || "image"}${kind}`;
    // Named like an image but isn't one: never hand it to the model as an image.
    if (!kind && IMAGE_EXT[extname(name).toLowerCase()]) name += ".bin";
    sweep();
    const id = `a_${randomBytes(8).toString("hex")}`;
    const d = folder(id);
    mkdirSync(d, { recursive: true });
    let path = join(d, name);
    writeFileSync(path, buf);
    if (kind === ".heic") {
      const jpg = path.replace(/\.heic$/i, ".jpg");
      const r = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-frames:v", "1", "-q:v", "3", jpg], { stdout: "pipe", stderr: "pipe" });
      if (r.exitCode === 0 && existsSync(jpg)) { rmSync(path); path = jpg; }
      else console.error(`[att] could not convert heic: ${r.stderr.toString().slice(-300)}`);
    }
    return get(id);
  }

  /** Ids from the app, checked; at most 10 per message. */
  function resolve(ids: unknown): Attachment[] {
    if (ids == null) return [];
    if (!Array.isArray(ids)) throw new ApiError(400, "attachments is a list of ids.");
    if (ids.length > 10) throw new ApiError(400, "Ten attachments at most per message.");
    return [...new Set(ids.map(String))].map(get);
  }

  /** The image itself, for thumbnails in the job's chat. */
  function file(id: string) {
    const a = get(id);
    const type = IMAGE_EXT[extname(a.name).toLowerCase()] ?? "application/octet-stream";
    return new Response(Bun.file(a.path), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${a.image ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}` } });
  }

  return { put, resolve, file, root };
}
export type Attachments = ReturnType<typeof openAttachments>;

/** The prompt text with its attachments named at the end. No text: just the files. */
export function withAttachments(text: string, list: Attachment[]) {
  if (!list.length) return text;
  const lines = list.map((a) => `- ${a.name}: ${a.path}`);
  return `${text.trim() || "See the attached files."}\n\n${HEAD}\n${lines.join("\n")}`;
}

/** Paths named in a prompt's attachment block (drivers use this to send the images themselves). */
export function attachedPaths(text: string): string[] {
  const i = text.lastIndexOf(HEAD);
  if (i < 0) return [];
  return text.slice(i + HEAD.length).split(/\r?\n/).map((l) => l.match(/^- .+?: ([A-Za-z]:\\.+|\/.+)$/)?.[1]?.trim()).filter((p): p is string => !!p && /[\\/]jobs[\\/]att[\\/]a_[a-f0-9]{16}[\\/]/.test(p));
}
export const isImagePath = (p: string) => !!IMAGE_EXT[extname(p).toLowerCase()];

/** Claude content blocks: the text, then each attached image that fits inline. */
export function claudeContent(text: string): string | any[] {
  const imgs = attachedPaths(text).filter(isImagePath).flatMap((p) => {
    try {
      if (statSync(p).size > MAX_INLINE) return [];
      return [{ type: "image", source: { type: "base64", media_type: IMAGE_EXT[extname(p).toLowerCase()], data: readFileSync(p).toString("base64") } }];
    } catch { return []; }
  });
  return imgs.length ? [{ type: "text", text }, ...imgs] : text;
}

/** Codex turn input: the text, then each attached image as a localImage. */
export function codexInput(text: string) {
  return [{ type: "text", text, text_elements: [] }, ...attachedPaths(text).filter((p) => isImagePath(p) && existsSync(p)).map((path) => ({ type: "localImage", path }))];
}
