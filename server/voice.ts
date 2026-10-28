// Voice recordings: the phone (and the keyboard, through the app) uploads audio in chunks while it records, so a
// crash, a closed app or a dead phone loses nothing. Finish joins the chunks and transcribes them. Unfinished or failed
// recordings can be retried.
// Transcription (v2, DECISIONS): Codex dictation on the owner's ChatGPT login (server/dictation-provider.mjs, vendored from
// codex-dictation-bridge): the take becomes mono 24 kHz Opus WebM, cut at pauses into pieces of up to 5 minutes, two
// pieces at a time. OpenAI (gpt-transcribe, hi + en) is only a fallback, and only when OPENAI_API_KEY is set; with
// VOICE_PROVIDER=openai it is the only path (the 1.0 behaviour).
// Storage: <DATA_DIR>/voice/<userId>/<id>/ meta.json, chunk-<n>, audio.<ext>
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { ApiError } from "./store";
import { transcribe as codexDictation, readCodexAuth } from "./dictation-provider.mjs";

export type Recording = {
  id: string; source: string; purpose: string | null; mime: string; createdAt: string; updatedAt: string;
  durationMs: number | null; bytes: number; chunks: number;
  status: "recording" | "interrupted" | "uploaded" | "transcribing" | "done" | "failed"; text: string | null; error: string | null;
  reviewRequired?: boolean;
  /** v2: who transcribed it ("codex" | "openai"), and on failure a code the app acts on (login_expired → "Open Codex on the PC"). */
  provider?: string | null; errorCode?: string | null;
  /** v2: the words as the provider wrote them (Codex writes Hindi in Devanagari) when `text` was put in Roman Hinglish. */
  textOriginal?: string | null;
};
const SOURCES = ["app", "capture", "widget", "siri", "keyboard", "desktop", "composer", "job", "settings", "voice"];
const EXT: Record<string, string> = {
  "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/aac": "aac", "audio/webm": "webm", "audio/ogg": "ogg",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "video/mp4": "m4a", "video/webm": "webm",
};
const STALE_MS = 90_000;
const MAX_CHUNK = 20 * 1024 * 1024;
const iso = () => new Date().toISOString();
const baseMime = (m: string) => String(m ?? "").split(";")[0].trim().toLowerCase();

const cfgPath = join(import.meta.dir, "config.json");
const cfg = (() => { try { return existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {}; } catch { return {}; } })();
const conf = (k: string, d: string) => process.env[k] ?? cfg[k] ?? d;

/** Codex dictation: one piece is at most 5 minutes (the endpoint takes 10; shorter pieces keep a retry cheap). */
export const CODEX_PIECE_S = 300;
const CODEX_PARALLEL = 2;
/** Errors that mean "Codex can't do this right now" (not "this audio is bad"): the OpenAI fallback may try. */
const CODEX_UNAVAILABLE = new Set(["login_required", "login_expired", "upstream_error", "network_error", "invalid_response"]);
export type VoiceError = Error & { code?: string; quality?: boolean };
const fail = (message: string, code: string, extra: Record<string, unknown> = {}): VoiceError => Object.assign(new Error(message), { code, ...extra });

/** The Codex login on this PC, for the app's "Open Codex on the PC" banner. Never returns the token. */
export async function dictationStatus(): Promise<{ provider: string; login: "ok" | "expired" | "missing"; expiresAt: string | null; message: string | null; fallback: boolean }> {
  const provider = conf("VOICE_PROVIDER", "codex") === "openai" ? "openai" : "codex";
  const fallback = !!conf("OPENAI_API_KEY", "");
  try {
    const { token } = await readCodexAuth();
    let exp: number | null = null;
    try { exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp ?? null; } catch {}
    return { provider, login: "ok", expiresAt: exp ? new Date(exp * 1000).toISOString() : null, message: null, fallback };
  } catch (e: any) {
    return { provider, login: e?.code === "login_expired" ? "expired" : "missing", expiresAt: null, message: e?.message ?? String(e), fallback };
  }
}

/** The repeated-phrase guard and the [unclear] marks, for either provider. */
export function cleanTranscript(raw: string): string {
  const text = String(raw ?? "").trim();
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ") + " ";
  if (/((?:\S+\s+){1,5})\1{7,}/u.test(normalized))
    throw fail("The provider returned repetitive text. Audio is kept; this needs listening review.", "repetitive", { quality: true });
  return text.replace(/(?:(?:\.{3}|…)\s*)+/g, " [unclear] ").replace(/[ \t]{2,}/g, " ").trim();
}

/** Pause-aware cut points (seconds) for a long take: each piece ends in a silence near the limit, never past it. */
export function cutPoints(duration: number, silences: Array<[number, number]>, piece = CODEX_PIECE_S): number[] {
  const cuts: number[] = [];
  let last = 0;
  while (duration - last > piece) {
    const lo = last + piece * 0.6, hi = last + piece;
    const mids = silences.map(([a, b]) => (a + b) / 2).filter((m) => m >= lo && m <= hi);
    // the latest pause in the window keeps pieces long; without one, cut at the limit
    const at = mids.length ? Math.max(...mids) : hi;
    cuts.push(Math.round(at * 100) / 100);
    last = at;
  }
  return cuts;
}

type CodexFn = (audio: Uint8Array, o: { type: string; filename: string }) => Promise<string>;
type RomanizeFn = (text: string) => Promise<string>;
const DEVANAGARI = /[ऀ-ॿ]/;

/** Codex dictation writes the Hindi in a Hinglish take in Devanagari; the owner types Hinglish in Roman script, and so do his
 *  tasks. Haiku on his subscription rewrites it word for word (English words in English spelling). VOICE_SCRIPT=as-heard
 *  keeps the provider's script. On any failure the original stays: words are never lost to this step. */
function defaultRomanize(dataDir: string): RomanizeFn {
  let ai: any = null;
  return async (text) => {
    ai ??= (await import("./ai")).openAI(dataDir);
    const r = await ai.claude({ model: "haiku", timeout: 60_000,
      system: "You turn a Hindi or Hinglish speech transcript into Roman-script Hinglish, the way an Indian types on WhatsApp. "
        + "Write English words in normal English spelling (code, add, PDF, high quality, task). Keep every word and the order; "
        + "do not translate, summarise, correct, censor or add anything (swear words stay as said). Keep punctuation, numbers, names and any [unclear] marks.",
      prompt: `Transcript:
${text}`,
      schema: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } } });
    const out = String(r?.out?.text ?? "").trim();
    // a rewrite that lost a lot of words is worse than Devanagari
    if (!out || out.length < text.length * 0.5) throw new Error("romanize: short or empty");
    return out;
  };
}

export function openVoice(o: { dataDir: string; openaiKey: () => string; provider?: () => string; codex?: CodexFn; romanize?: RomanizeFn | null }) {
  const providerOf = () => ((o.provider ?? (() => conf("VOICE_PROVIDER", "codex")))() === "openai" ? "openai" : "codex");
  const codex: CodexFn = o.codex ?? ((audio, x) => codexDictation(audio, x));
  const romanize: RomanizeFn | null = o.romanize === undefined ? (conf("VOICE_SCRIPT", "latin") === "as-heard" ? null : defaultRomanize(o.dataDir)) : o.romanize;
  const dirOf = (userId: number, id?: string) => join(o.dataDir, "voice", String(userId), ...(id ? [id] : []));
  const validId = (id: string) => /^v_[A-Za-z0-9]{6,32}$/.test(id);
  function readMeta(userId: number, id: string): Recording {
    if (!validId(id)) throw new ApiError(404, "No such recording.");
    const f = join(dirOf(userId, id), "meta.json");
    if (!existsSync(f)) throw new ApiError(404, "No such recording.");
    return JSON.parse(readFileSync(f, "utf8"));
  }
  function writeMeta(userId: number, r: Recording) {
    const f = join(dirOf(userId, r.id), "meta.json");
    writeFileSync(f + ".tmp", JSON.stringify(r, null, 1));
    renameSync(f + ".tmp", f);
    return r;
  }
  /** What the client sees: a recording with no chunk for 90 s is shown as interrupted. */
  const view = (r: Recording): Recording =>
    r.status === "recording" && Date.now() - Date.parse(r.updatedAt) > STALE_MS ? { ...r, status: "interrupted" } : r;
  const chunkFiles = (userId: number, id: string) =>
    readdirSync(dirOf(userId, id)).map((f) => f.match(/^chunk-(\d+)$/)).filter(Boolean).map((m) => Number(m![1])).sort((a, b) => a - b);

  function createAt(userId: number, b: any, id: string) {
    if (!validId(id)) throw new ApiError(404, "No such recording.");
    const mime = baseMime(b.mime || "audio/mp4");
    if (!EXT[mime]) throw new ApiError(400, `Unsupported audio type ${mime}. Use audio/mp4, audio/webm, audio/wav, audio/mpeg or audio/ogg.`);
    mkdirSync(dirOf(userId, id), { recursive: true });
    const stamp = iso();
    return writeMeta(userId, { id, source: SOURCES.includes(b.source) ? b.source : "app", purpose: b.purpose ? String(b.purpose).slice(0, 40) : null,
      mime, createdAt: stamp, updatedAt: stamp, durationMs: null, bytes: 0, chunks: 0, status: "recording", text: null, error: null });
  }
  function create(userId: number, b: any) {
    return createAt(userId, b, `v_${randomBytes(9).toString("base64url").replace(/[-_]/g, "x")}`);
  }

  /** Chunk n (0, 1, 2…). PUT again replaces it, so retries are safe and a WAV header can be rewritten at the end. */
  async function putChunk(userId: number, id: string, n: number, req: Request) {
    if (!(Number.isInteger(n) && n >= 0 && n < 100_000)) throw new ApiError(400, "Chunk number is 0, 1, 2…");
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_CHUNK) throw new ApiError(413, "Chunk too large (20 MB max).");
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length > MAX_CHUNK) throw new ApiError(413, "Chunk too large (20 MB max).");
    let r: Recording;
    try { r = readMeta(userId, id); }
    catch (e) {
      // Older installed apps keep the PC id after its record disappears. Recover from chunk zero,
      // in this signed-in user's directory only, so their one-record-at-a-time uploader can proceed.
      if (!(e instanceof ApiError) || e.status !== 404 || n !== 0 || !buf.length) throw e;
      r = createAt(userId, { mime: req.headers.get("content-type") || "audio/mp4", source: "app" }, id);
    }
    writeFileSync(join(dirOf(userId, id), `chunk-${n}`), buf);
    const ns = chunkFiles(userId, id);
    r.chunks = Math.max(r.chunks, n + 1, (ns.at(-1) ?? -1) + 1);
    r.bytes = ns.reduce((sum, k) => sum + statSync(join(dirOf(userId, id), `chunk-${k}`)).size, 0);
    r.updatedAt = iso();
    // A chunk arriving after a finish (a late retry) reopens nothing; it is used by the next retry.
    if (r.status === "interrupted") r.status = "recording";
    writeMeta(userId, r);
    return { ok: true, bytes: buf.length, total: r.bytes, chunks: r.chunks };
  }

  /** Joins chunk-0..chunk-(n-1) into audio.<ext>. Missing chunks: an error listing them, unless `lenient` (retry of an interrupted one). */
  function join_(userId: number, r: Recording, want: number | null, lenient: boolean) {
    const dir = dirOf(userId, r.id);
    const have = chunkFiles(userId, r.id);
    const count = want ?? (have.at(-1) ?? -1) + 1;
    const missing = Array.from({ length: count }, (_, i) => i).filter((i) => !have.includes(i));
    if (!count || (missing.length && !lenient)) {
      throw Object.assign(new ApiError(409, count ? `Missing chunks: ${missing.slice(0, 20).join(", ")}. Upload them, then finish again.` : "No audio was uploaded."), { missing });
    }
    const parts = Array.from({ length: count }, (_, i) => i).filter((i) => have.includes(i)).map((i) => readFileSync(join(dir, `chunk-${i}`)));
    const all = Buffer.concat(parts);
    if (EXT[r.mime] === "wav") fixWav(all);
    const out = join(dir, `audio.${EXT[r.mime]}`);
    writeFileSync(out, all);
    return { path: out, bytes: all.length };
  }

  /** Text for an audio file on disk. Codex first; OpenAI only as the fallback (a key set) or when VOICE_PROVIDER=openai. */
  async function transcribeFile(path: string): Promise<string> { return (await transcribeWith(path)).text; }
  async function transcribeWith(path: string): Promise<{ text: string; provider: string; original?: string }> {
    const got = await heard(path);
    if (!romanize || !DEVANAGARI.test(got.text)) return got;
    try {
      const t0 = Date.now();
      const text = await romanize(got.text);
      console.log(`[voice] Roman Hinglish in ${Date.now() - t0}ms`);
      return { ...got, text, original: got.text };
    } catch (e) { console.error(`[voice] kept the provider's script: ${e instanceof Error ? e.message : e}`); return got; }
  }
  async function heard(path: string): Promise<{ text: string; provider: string }> {
    const key = o.openaiKey();
    if (providerOf() === "openai") {
      if (!key) throw fail("No OpenAI key in server/config.json (OPENAI_API_KEY).", "no_key");
      return { text: await openaiFile(path, key), provider: "openai" };
    }
    try {
      return { text: await codexFile(path), provider: "codex" };
    } catch (e: any) {
      if (e?.quality || !key || !CODEX_UNAVAILABLE.has(e?.code)) throw e;
      console.error(`[voice] Codex dictation unavailable (${e.code}): trying the OpenAI fallback`);
      try { return { text: await openaiFile(path, key), provider: "openai" }; }
      catch (e2) { console.error(`[voice] OpenAI fallback failed: ${e2 instanceof Error ? e2.message : e2}`); throw e; }   // the Codex reason is the one to act on
    }
  }

  /** Runs a command without blocking the event loop (sync, health and chunk uploads keep being served). */
  async function run(args: string[]) {
    const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const text = (s: any) => (s ? new Response(s).text().catch(() => "") : Promise.resolve(""));
    const [code, out, err] = await Promise.all([p.exited, text(p.stdout), text(p.stderr)]);
    return { code, out, err };
  }
  const SAFE_IN = ["-protocol_whitelist", "file,pipe"];

  async function codexFile(path: string): Promise<string> {
    const work = join(tmpdir(), `aos-voice-${randomBytes(6).toString("hex")}`);
    mkdirSync(work, { recursive: true });
    try {
      // How long is it, and where are the pauses (only a take longer than one piece needs cutting).
      const probe = await run(["ffprobe", "-v", "error", ...SAFE_IN, "-show_entries", "format=duration", "-of", "csv=p=0", path]);
      let duration = probe.code === 0 ? Number(String(probe.out).trim()) : NaN;
      let cuts: number[] = [];
      // A recorder's WebM often has no duration in its header (MediaRecorder): decoding it once finds both the length
      // and the pauses. Only when ffprobe could read the file at all.
      if (probe.code === 0 && (!Number.isFinite(duration) || duration > CODEX_PIECE_S)) {
        const sd = await run(["ffmpeg", "-hide_banner", "-nostdin", ...SAFE_IN, "-i", path, "-vn", "-af", "silencedetect=noise=-35dB:d=0.4", "-f", "null", "-"]);
        const err = String(sd.err);
        if (!Number.isFinite(duration)) {
          const t = [...err.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].at(-1);
          if (t) duration = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
        }
        const starts = [...err.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
        const ends = [...err.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
        if (Number.isFinite(duration)) cuts = cutPoints(duration, starts.map((s0, i) => [s0, ends[i] ?? s0] as [number, number]));
      }
      const out = join(work, "part-%03d.webm");
      const ff = await run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...SAFE_IN, "-i", path, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "24000",
        "-c:a", "libopus", "-b:a", "48k", "-f", "segment", "-segment_format", "webm", ...(cuts.length ? ["-segment_times", cuts.join(",")] : ["-segment_time", "100000"]),
        "-reset_timestamps", "1", out]);
      let pieces: { file: string; type: string; name: string }[] = [];
      if (ff.code === 0) pieces = readdirSync(work).filter((f) => f.startsWith("part-")).sort().map((f) => join(work, f))
        .filter((f) => statSync(f).size > 600).map((f) => ({ file: f, type: "audio/webm", name: "dictation.webm" }));
      if (!pieces.length) {
        console.error(`[voice] ffmpeg could not read ${path}: ${String(ff.err).trim().split("\n").slice(-2).join(" ")}`);
        // As sent: the endpoint also reads WAV and M4A. Too big to send whole means it can't be read at all.
        if (statSync(path).size > 24 * 1024 * 1024) throw fail("The audio could not be read.", "invalid_audio");
        const ext = path.split(".").pop() ?? "m4a";
        pieces = [{ file: path, type: Object.entries(EXT).find(([, x]) => x === ext)?.[0] ?? "audio/mp4", name: `dictation.${ext}` }];
      }
      const texts: string[] = new Array(pieces.length);
      let next = 0, failed: unknown;
      const workers = await Promise.allSettled(Array.from({ length: Math.min(CODEX_PARALLEL, pieces.length) }, async () => {
        try {
          while (!failed && next < pieces.length) {
            const n = next++;
            let raw: string;
            try { raw = await codex(new Uint8Array(readFileSync(pieces[n].file)), { type: pieces[n].type, filename: pieces[n].name }); }
            catch (e: any) { throw fail(e?.message ?? String(e), e?.code ?? "upstream_error"); }
            texts[n] = cleanTranscript(raw);
          }
        } catch (e) { failed = e; throw e; }
      }));
      const failure = workers.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      if (failure) throw failure.reason;
      return texts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  async function openaiFile(path: string, key: string): Promise<string> {
    // Decode to lossless PCM in short sections. No denoising or previous-transcript feedback: quiet passages
    // must not seed invented text in later sections. The original uploaded file is never changed.
    const work = join(tmpdir(), `aos-voice-${randomBytes(6).toString("hex")}`);
    mkdirSync(work, { recursive: true });
    try {
      let pieces: string[] = [];
      // Conversion can take seconds for a long take. Keep serving sync, health and
      // chunk uploads while ffmpeg works, rather than blocking the Bun event loop.
      const ff = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        "-f", "segment", "-segment_time", "60", "-reset_timestamps", "1", join(work, "part-%03d.wav")], { stdout: "ignore", stderr: "pipe" });
      const [exitCode, conversionError] = await Promise.all([ff.exited, new Response(ff.stderr).text()]);
      if (exitCode === 0) pieces = readdirSync(work).filter((f) => f.startsWith("part-")).sort().map((f) => join(work, f)).filter((f) => statSync(f).size > 1000);
      if (!pieces.length) {
        console.error(`[voice] ffmpeg could not read ${path}: ${conversionError.trim().split("\n").slice(-2).join(" ")}`);
        if (statSync(path).size > 24 * 1024 * 1024) throw new Error("The audio could not be read.");
        pieces = [path];
      }
      const texts: string[] = new Array(pieces.length);
      let next = 0;
      let failed: unknown;
      const workers = await Promise.allSettled(Array.from({ length: Math.min(3, pieces.length) }, async () => {
        try { while (!failed && next < pieces.length) { const n = next++; texts[n] = await transcribeOne(pieces[n], key); } }
        catch (e) { failed = e; throw e; }
      }));
      const failure = workers.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (failure) throw failure.reason;
      return texts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  async function transcribeOne(path: string, key: string): Promise<string> {
    const name = path.split(/[\\/]/).pop()!;
    let lastErr = "";
    for (const model of ["gpt-transcribe", "gpt-4o-transcribe"]) {
      const form = new FormData();
      form.append("file", new File([readFileSync(path)], name));
      form.append("model", model);
      if (model === "gpt-transcribe") { form.append("languages[]", "hi"); form.append("languages[]", "en"); }
      else form.append("response_format", "json");
      try {
        const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
          signal: AbortSignal.timeout(180_000) });
        const j: any = await res.json().catch(() => ({}));
        if (res.ok) return cleanTranscript(String(j.text ?? ""));
        lastErr = `${model}: ${res.status} ${j.error?.message ?? ""}`.trim();
        if (res.status === 401 || res.status === 429) break;
      } catch (e) { if ((e as any)?.quality) throw e; lastErr = `${model}: ${e instanceof Error ? e.message : String(e)}`; }
      console.error(`[voice] ${lastErr}`);
    }
    throw fail(`Transcription failed (${lastErr.slice(0, 200)}).`, "openai_error");
  }

  /** Transcriptions under way, by user and recording: GET /voice/:id?wait= waits on these. */
  const running = new Map<string, Promise<Recording>>();
  const runKey = (userId: number, id: string) => `${userId}:${id}`;
  /** Joins the audio (409 on missing chunks, status untouched), marks it transcribing, and starts writing it down.
   *  Returns the promise of the finished recording. */
  function begin(userId: number, r: Recording, want: number | null, lenient: boolean) {
    join_(userId, r, want, lenient);
    if (r.text) {
      const history = join(dirOf(userId, r.id), "transcript-history"); mkdirSync(history, { recursive: true });
      writeFileSync(join(history, `${Date.now()}-${randomBytes(4).toString("hex")}.json`), JSON.stringify(r, null, 1));
    }
    r.status = "uploaded"; r.updatedAt = iso();
    writeMeta(userId, r);
    r.status = "transcribing"; r.error = null; r.updatedAt = iso();
    writeMeta(userId, r);
    const key = runKey(userId, r.id);
    const p: Promise<Recording> = writeDown(userId, { ...r }).finally(() => { if (running.get(key) === p) running.delete(key); });
    running.set(key, p);
    return p;
  }
  async function writeDown(userId: number, r: Recording) {
    try {
      const t0 = Date.now();
      const got = await transcribeWith(join(dirOf(userId, r.id), `audio.${EXT[r.mime]}`));
      r.text = got.text; r.provider = got.provider; r.errorCode = null; r.textOriginal = got.original ?? null;
      r.reviewRequired = /\[unclear\]/i.test(r.text);
      r.status = "done";
      console.log(`[voice] ${r.id} transcribed by ${got.provider} in ${Date.now() - t0}ms (${r.text.length} chars)`);
    } catch (e) {
      r.status = "failed";
      r.reviewRequired = true;
      r.error = e instanceof Error ? e.message : String(e);
      r.errorCode = (e as VoiceError)?.code ?? null;
    }
    r.updatedAt = iso();
    return writeMeta(userId, r);
  }

  async function finish(userId: number, id: string, b: any) {
    const want = b.chunks == null ? null : Number(b.chunks);
    if (want != null && !(Number.isInteger(want) && want >= 0)) throw new ApiError(400, "chunks is the number of chunks sent.");
    let r: Recording;
    try { r = readMeta(userId, id); }
    catch (e) {
      if (!(e instanceof ApiError) || e.status !== 404 || want !== 0) throw e;
      r = createAt(userId, { mime: "audio/mp4", source: "app" }, id);
    }
    // An empty interrupted take must not block every later upload forever. A terminal failed
    // receipt acknowledges zero bytes only; any saved audio still requires normal completeness checks.
    if (want === 0 && r.bytes === 0 && chunkFiles(userId, id).length === 0) {
      r.status = "failed"; r.reviewRequired = true; r.chunks = 0; r.updatedAt = iso();
      r.error = "No audio was saved for this recording. Please record again.";
      return writeMeta(userId, r);
    }
    // async: true (the app since 2026-10-23) gets its receipt at once, status "transcribing", and the words from
    // GET /voice/:id?wait=; the same finish sent again (its answer was lost) gets the receipt again instead of a 409.
    // Without it (older app builds, the keyboard) the answer waits for the words, as before.
    // "transcribing" with nothing under way here: the server restarted mid-way, so this finish starts it again.
    const quick = b.async === true, stale = r.status === "transcribing" && !running.has(runKey(userId, id));
    if (quick && !stale && ["transcribing", "done"].includes(r.status) && (want == null || r.chunks === want) && existsSync(join(dirOf(userId, id), `audio.${EXT[r.mime]}`))) return view(r);
    if (b.durationMs != null && Number.isFinite(Number(b.durationMs))) r.durationMs = Math.round(Number(b.durationMs));
    if (r.status === "transcribing" && !stale) throw new ApiError(409, "Already transcribing.");
    if (want != null) r.chunks = want;
    const done = begin(userId, r, want, false);
    if (quick) { done.catch((e) => console.error(`[voice] ${id}: ${e instanceof Error ? e.message : e}`)); return view(r); }
    return view(await done);
  }
  async function retry(userId: number, id: string) {
    const r = readMeta(userId, id);
    if (r.status === "transcribing" && Date.now() - Date.parse(r.updatedAt) < 5 * 60_000) throw new ApiError(409, "Already transcribing.");
    return view(await begin(userId, r, null, true));
  }
  /** The recording; while it is being written down, waits up to `waitS` seconds (at most 30) for the words. */
  async function getWait(userId: number, id: string, waitS = 0) {
    const r = readMeta(userId, id);
    const s = Math.min(30, Math.max(0, Number(waitS) || 0));
    if (r.status !== "transcribing" || !s) return view(r);
    const p = running.get(runKey(userId, id));
    // not under way here (the server restarted mid-way): wait the time anyway, so a waiting app doesn't spin
    await Promise.race([p ? p.catch(() => null) : Bun.sleep(s * 1000), Bun.sleep(s * 1000)]);
    return view(readMeta(userId, id));
  }
  function list(userId: number) {
    const dir = dirOf(userId);
    if (!existsSync(dir)) return [];
    const out: Recording[] = [];
    for (const id of readdirSync(dir)) { try { out.push(view(readMeta(userId, id))); } catch {} }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const get = (userId: number, id: string) => view(readMeta(userId, id));
  function audio(userId: number, id: string) {
    const r = readMeta(userId, id);
    const f = join(dirOf(userId, id), `audio.${EXT[r.mime]}`);
    const path = existsSync(f) && r.status !== "recording" ? f : join_(userId, r, null, true).path;
    return new Response(Bun.file(path), { headers: { "Content-Type": r.mime, "Cache-Control": "no-store" } });
  }
  function remove(userId: number, id: string) {
    readMeta(userId, id);
    rmSync(dirOf(userId, id), { recursive: true, force: true });
    return { ok: true };
  }
  return { create, putChunk, finish, retry, list, get, getWait, audio, remove, transcribeFile, transcribeWith, status: dictationStatus };
}

/** A WAV recorder that was cut off leaves 0xFFFFFFFF (or 0) sizes in its header; set them from the real length. */
export function fixWav(b: Buffer) {
  if (b.length < 44 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return;
  b.writeUInt32LE(b.length - 8, 4);
  let p = 12;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === "data") { b.writeUInt32LE(b.length - p - 8, p + 4); return; }
    if (size === 0xffffffff || p + 8 + size > b.length) return;
    p += 8 + size + (size & 1);
  }
}
