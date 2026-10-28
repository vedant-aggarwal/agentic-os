// Content OS on the phone server. The data lives in content.db through `agentos content` (the CLI owns the
// schema and every write); this module adds what the CLI cannot do: the models (Sonnet writes scripts, Haiku
// writes reference cards and build-in-public drafts), reel downloads, transcription, files under
// <dataDir>/mod/content/, the three jobs, chunked uploads and the RealFlow hand-off.
//   GET  /overview            everything the four tabs show (one CLI call) plus job state and flags
//   POST /ideas               { text, link?, channel?, source? }  capture; a link becomes a reference card
//   POST /plan                { date?, fresh? }  the nightly routine now: picks, scripts, shoot task, push
//   GET  /pack?date=          the morning pack with teleprompter text
//   POST /edits/:id/approve   dry run unless CONTENT_POST=on (then content-axi schedule → RealFlow)
//   POST /uploads, PUT /uploads/:id?offset=, GET /uploads/:id   5 MB chunks, resume by offset → takes
// v2 (Agentic OS 2.0):
//   GET|PUT /ops[/:id]        the phone's offline outbox (svc/store collection): verdicts, captures, approvals, notes,
//                             rewrites, settings, rule switches… each applied once by its id; slow ones run in the background
//   GET  /deck /learnings     the swipe deck (scored like the plan, with reasons) and what the loop learned
//   GET  /edits/:e/media, /takes/:k/media → { url }: a signed link to the render or take (a <video> sends no token);
//   GET  /media/<token>       serves it with Range (publicPaths: the signature is the auth)
//   POST /realflow            reads the content-os RealFlow ledger into posts (also on start and every sweep)
// Jobs: content-sweep (15m: content: tasks → ideas, pending references), content-plan (02:30), content-buildpublic (21:30).
// Tools: the agent's verbs for Content (file, mine, verdict, write, rewrite, revert, plan, note, approve, settings).
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, writeSync } from "node:fs";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { mountCollection } from "./_collection";
import type { AgentTool, JobCtx, ModCtx, Module } from "./types";

type Row = Record<string, any>;
const CHUNK = 5 * 1024 * 1024;
const cli = (ctx: JobCtx, args: (string | number)[]) => ctx.agentos(["content", ...args.map(String)]);
const dirOf = (ctx: JobCtx, sub: string) => { const d = join(ctx.dataDir, "mod", "content", sub); mkdirSync(d, { recursive: true }); return d; };
const istDate = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "script";
const readText = (p: string | null | undefined, max = 60_000) => { try { return p && existsSync(p) ? readFileSync(p, "utf8").replace(/\r/g, "").slice(0, max) : null; } catch { return null; } };
/** A real OpenAI key (config.json or env); placeholders like "not-needed" count as none, so transcripts stay pending. */
const openaiKey = (ctx: JobCtx) => { const k = ctx.conf("OPENAI_API_KEY", ""); return /^sk-[A-Za-z0-9_-]{16,}$/.test(k) ? k : ""; };
const postingOn = (ctx: JobCtx) => ctx.conf("CONTENT_POST", "off") === "on";
const idOf = (s: string, prefix: string) => (new RegExp(`^${prefix}\\d+$`).test(s) ? s : null);

async function run(cmd: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; out: string; err: string }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v != null && !k.startsWith("CLAUDECODE") && !k.startsWith("CLAUDE_CODE_")) env[k] = v;
  const p = Bun.spawn(cmd, { cwd: opts.cwd, env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), opts.timeoutMs ?? 180_000);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  clearTimeout(timer);
  await p.exited;
  return { code: p.exitCode ?? 1, out, err };
}

// ── first start: consolidate once when content.db is empty and the sources exist ───────────────
const bootstrapped = new Set<string>();
async function ensureImported(ctx: JobCtx) {
  if (bootstrapped.has(ctx.contentDbPath)) return;
  bootstrapped.add(ctx.contentDbPath);
  syncLedger(ctx, true).catch(() => {});
  try {
    const s = await cli(ctx, ["settings"]);
    if (s.all?.["import.auto"]) return;
    const o = await cli(ctx, ["overview"]);
    const ideas = Object.values(o.counts?.ideas ?? {}).reduce((a: number, b: any) => a + Number(b), 0);
    if (ideas > 0) { await cli(ctx, ["settings", "set", "import.auto", `skipped:${istDate()}`]); return; }
    const home = homedir();
    if (![join(home, "content-os"), join(home, "Desktop", "Reel Lab", "projects"), join(home, "craft-inbox")].some((p) => existsSync(p))) return;
    const r = await cli(ctx, ["import"]);
    await cli(ctx, ["settings", "set", "import.auto", istDate()]);
    ctx.log(`first-start import: ${JSON.stringify(r.added)} (${r.skipped} skipped, ${r.errors} errors)`);
  } catch (e: any) { bootstrapped.delete(ctx.contentDbPath); ctx.log(`first-start import failed: ${e?.message ?? e}`); }
}

// ── doctrine for the models, read from the files that already hold it (no second doctrine) ─────
let doctrineCache: { at: number; text: string } | null = null;
function doctrine(): string {
  if (doctrineCache && Date.now() - doctrineCache.at < 10 * 60_000) return doctrineCache.text;
  const home = homedir();
  const pick = (file: string, from: RegExp, to: RegExp, max: number) => {
    const t = readText(file, 400_000) ?? "";
    const i = t.search(from);
    if (i < 0) return "";
    const rest = t.slice(i);
    const j = rest.slice(1).search(to);
    return (j < 0 ? rest : rest.slice(0, j + 1)).trim().slice(0, max);
  };
  const parts = [
    pick(join(home, "content-os", "doctrine", "script-writing.md"), /^## The first three seconds/m, /^## The body/m, 5000),
    pick(join(home, "content-os", "doctrine", "script-writing.md"), /^## The verdict/m, /^## Required output shape/m, 6000),
    (readText(join(home, ".codex", "skills", "natural-hinglish-scripts", "SKILL.md"), 8000) ?? "").replace(/^---[\s\S]*?---\n/, ""),
    pick(join(home, "studio-brain", "brand", "guardrails.md"), /^## NEVER/m, /^## (?!NEVER)/m, 2500),
  ].filter(Boolean);
  const fallback = `Rules: one idea per script; the hook is the thesis, a specific claim, no greeting, no meta-narration; natural spoken Roman Hinglish
(technical nouns stay English, switch at clause boundaries, keep connectors like agar, isliye, lekin); proof over assertion, numbers with a unit and
a baseline; a portable verdict; exactly one CTA that asks for a choice; never fake results, never guarantee reach, never show unshipped products as available.`;
  const text = (parts.length ? parts.join("\n\n---\n\n") : fallback).slice(0, 22_000);
  doctrineCache = { at: Date.now(), text };
  return text;
}
function prefsText(): string {
  const p = readText(join(homedir(), "content-os", "state", "prefs.json"), 50_000);
  if (!p) return "";
  try {
    const j = JSON.parse(p);
    const s = j?.scripting?.northwindstudio ?? {};
    return [j.language ? `Language preference: ${j.language}.` : "", Array.isArray(j.scenes) ? `Usual scenes: ${j.scenes.join("; ")}.` : "",
      ...Object.entries(s).filter(([k]) => k !== "context").map(([k, v]) => `${k}: ${String(v).slice(0, 400)}`)].filter(Boolean).join("\n").slice(0, 3000);
  } catch { return ""; }
}

// ── scripts: one Sonnet call per pick, then the CLI files it into the day's pack ───────────────
const SCRIPT_SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, hook: { type: "string" }, body: { type: "string" }, cta: { type: "string" }, seconds: { type: "integer" }, takeCode: { type: "string" } },
  required: ["title", "hook", "body", "cta", "seconds", "takeCode"],
};
/** The learning loop's rules the writer must follow: newest first, the ones he switched off left out (v2 CLI; none on an older one). */
async function loopRules(ctx: JobCtx, limit = 10): Promise<string> {
  try {
    const r = await cli(ctx, ["learnings", "--limit", String(limit * 2)]);
    const rules = ((r.rules ?? []) as Row[]).filter((x) => !x.muted).slice(0, limit).map((x) => `- ${String(x.text).replace(/\s+/g, " ").slice(0, 400)}`);
    return rules.length ? `WHAT ALEX TAUGHT THE LOOP (follow these; newest first)\n${rules.join("\n")}` : "";
  } catch { return ""; }
}
async function writeScript(ctx: JobCtx, date: string, pick: Row, channel: Row | null): Promise<Row> {
  const idea = (await cli(ctx, ["show", pick.idea])).idea as Row;
  const rules = await loopRules(ctx);
  const card = idea.card ? `Reference card (a reel he saved):\n${JSON.stringify(idea.card)}` : "";
  const lang = channel?.language ?? "hinglish";
  const system = `You write short-form scripts for ${channel?.name ?? "@northwindstudio"} (Instagram Reels, 9:16, the creator on camera;
${process.env.CREATOR_PROFILE || "a student who builds AI software at a small studio"}). Write in natural spoken Roman ${lang === "hinglish" ? "Hinglish" : lang}. Follow the doctrine below. Output only the fields asked for:
title (short, spoken-language), hook (the first spoken sentence or two), body (the spoken lines, plain paragraphs, no stage directions, no timecodes,
no quotes), cta (one spoken closing line with one keyword), seconds (your honest estimate at ~2.3 words per second), takeCode (echo it).
Do not invent numbers, dates, prices or results; where a fact is not in the idea, say so plainly inside the script or leave it out.
${prefsText()}
${rules}

DOCTRINE
${doctrine()}`;
  const prompt = `Date: ${date}. Take code to echo: ${pick.takeCode}. Target length: 45 to 60 seconds unless the idea needs less.
Idea c${String(pick.idea).replace(/^c/, "")}: ${idea.title}
Source: ${idea.source}${idea.link ? ` · link: ${idea.link}` : ""}${idea.evidence ? `\nEvidence (real, from his work): ${idea.evidence}` : ""}
${idea.hook ? `Draft hook: ${idea.hook}` : ""}${Array.isArray(idea.skeleton) && idea.skeleton.length ? `\nDraft skeleton:\n- ${idea.skeleton.join("\n- ")}` : ""}
${idea.raw ? `Notes:\n${String(idea.raw).slice(0, 3000)}` : ""}
${idea.verdict ? `Alex's verdict on this idea: ${String(idea.verdict).slice(0, 600)}` : ""}
${card}`;
  const r = await ctx.ai.claude({ model: "sonnet", system, prompt, schema: SCRIPT_SCHEMA, timeout: 180_000 });
  const o = r.out as Row;
  const title = String(o.title ?? idea.title).trim().slice(0, 200);
  const hook = String(o.hook ?? "").trim(), body = String(o.body ?? "").trim(), cta = String(o.cta ?? "").trim();
  if (!hook || !body) throw new Error("Sonnet returned an empty script.");
  const dir = dirOf(ctx, "scripts");
  const base = join(dir, `${date}-${pick.takeCode}-${slug(title)}`);
  const md = `---\ntitle: "${title.replace(/"/g, "'")}"\nidea: ${pick.idea}\nchannel: ${pick.channel}\ndate: ${date}\ntake: ${pick.takeCode}\nseconds: ${Number(o.seconds) || ""}\nmodel: sonnet (${r.ms} ms)\nstatus: draft\n---\n\n# ${title}\n\n## Spoken script\n\n${hook}\n\n${body}\n\n${cta}\n\n## Shoot Plan\n\n- Say the take code "${pick.takeCode}" once before the hook, then the hook.\n- ${channel?.setup ? `${channel.setup.location}: ${channel.setup.framing}${channel.setup.props ? `, ${channel.setup.props}` : ""}` : "Talking head"}\n`;
  writeFileSync(`${base}.md`, md);
  writeFileSync(`${base}.txt`, `${hook}\n\n${body}\n\n${cta}\n`);
  const words = `${hook} ${body} ${cta}`.split(/\s+/).filter(Boolean).length;
  const seconds = Number(o.seconds) > 0 ? Math.round(Number(o.seconds)) : Math.round(words / 2.3);
  const added = await cli(ctx, ["script", "add", "--idea", pick.idea, "--date", date, "--take-code", pick.takeCode, "--title", title, "--body-file", `${base}.md`, "--teleprompter-file", `${base}.txt`,
    "--hook", hook.slice(0, 480), "--cta", cta.slice(0, 480), "--seconds", seconds, "--words", words, "--external-id", `plan:${date}:${pick.idea}`]);
  ctx.log(`script ${added.script?.id} written for ${pick.idea} (${pick.takeCode}, ${seconds}s, Sonnet ${r.ms} ms)`);
  return added.script;
}
/** "Write a script" on one idea: it joins the day's pack with the next take code (a shoot day is created if the date has none). */
async function scriptForIdea(ctx: JobCtx, ideaId: string, date: string): Promise<Row> {
  const o = await cli(ctx, ["overview", "--date", date]);
  const idea = (await cli(ctx, ["show", ideaId])).idea as Row;
  const channel = (o.channels as Row[]).find((c) => c.handle === idea.channel) ?? null;
  const n = o.pack?.scripts?.length ?? 0;
  const used = new Set(((o.pack?.scripts ?? []) as Row[]).map((s) => s.take));
  let k = n + 1;
  while (used.has(`R${k}`)) k++;
  const script = await writeScript(ctx, date, { idea: ideaId, title: idea.title, channel: idea.channel, takeCode: `R${k}`, setup: channel?.setup ?? null }, channel);
  return { script, pack: await cli(ctx, ["pack", "--date", date, "--full"]) };
}
/** The nightly routine, also run by POST /plan: pick, write the missing scripts, file the Shoot block, push. */
async function runPlan(ctx: JobCtx, date: string, fresh = false): Promise<Row> {
  await ensureImported(ctx);
  const plan = await cli(ctx, ["plan", "--date", date, ...(fresh ? ["--fresh"] : [])]);
  let pack = await cli(ctx, ["pack", "--date", date, "--full"]);
  const channels = new Map<string, Row>(((await cli(ctx, ["overview", "--date", date])).channels as Row[]).map((c) => [c.handle, c]));
  const errors: string[] = [];
  for (const pick of pack.pending ?? []) {
    try { await writeScript(ctx, date, pick, channels.get(pick.channel) ?? null); }
    catch (e: any) { errors.push(`${pick.idea}: ${String(e?.message ?? e).slice(0, 200)}`); ctx.log(`script for ${pick.idea} failed: ${e?.message ?? e}`); }
  }
  pack = await cli(ctx, ["pack", "--date", date, "--full"]);
  const n = pack.scripts?.length ?? 0;
  if (n && !pack.task) {
    const codes = (pack.scripts as Row[]).map((s) => s.take).filter(Boolean).join(", ");
    const settings = (await cli(ctx, ["settings"])) as Row;
    const at = settings.shoot_at as string | null;
    const args = ["add", `Shoot: ${n} reel${n === 1 ? "" : "s"} (${codes})`, "--area", "content", "--due", date, "--source", "content", "--external-id", `shoot:${date}`,
      "--notes", `Morning pack for ${date}: ${(pack.scripts as Row[]).map((s) => `${s.take} ${s.title}`).join("; ")}. Open Content → Pack on the phone for the teleprompter.`];
    if (at) args.push("--at", at, "--for", String(n * 20));
    try {
      const t = await ctx.agentos(args);
      const id = t?.task?.id;
      if (id) { await cli(ctx, ["shootday", pack.shootDay, "--task", id]); pack.task = id; }
    } catch (e: any) { errors.push(`shoot task: ${String(e?.message ?? e).slice(0, 200)}`); }
  }
  if (n) await ctx.push("Shoot pack ready", `${n} script${n === 1 ? "" : "s"} · ${pack.setups?.length ?? 0} setup${pack.setups?.length === 1 ? "" : "s"} · ${date}`, { page: "content", tab: "pack" }).catch(() => {});
  return { ...pack, planned: plan.already ? "already" : plan.action, errors };
}

// ── references: download, transcribe when a key exists, one Haiku card ────────────────────────
const CARD_SCHEMA = {
  type: "object",
  properties: { hook: { type: "string" }, structure: { type: "string" }, format: { type: "string" }, why: { type: "string" }, summary: { type: "string" }, useFor: { type: "string" } },
  required: ["hook", "structure", "format", "why", "summary", "useFor"],
};
const ytdlpArgs = (ctx: JobCtx) => {
  const extra: string[] = [];
  const cookies = ctx.conf("YTDLP_COOKIES", "");
  if (cookies && existsSync(cookies)) extra.push("--cookies", cookies);
  const browser = ctx.conf("YTDLP_COOKIES_FROM_BROWSER", "");
  if (browser) extra.push("--cookies-from-browser", browser);
  return extra;
};
async function transcribe(ctx: JobCtx, media: string, outTxt: string): Promise<{ text: string; minutes: number } | null> {
  const key = openaiKey(ctx);
  if (!key) return null;
  const audio = media.replace(/\.[^.]+$/, "") + ".m4a";
  if (!existsSync(audio)) {
    const f = await run(["ffmpeg", "-y", "-loglevel", "error", "-i", media, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", audio], { timeoutMs: 300_000 });
    if (f.code !== 0) throw new Error(`ffmpeg: ${f.err.trim().slice(-200)}`);
  }
  let minutes = 0;
  try {
    const p = await run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio], { timeoutMs: 30_000 });
    minutes = Math.round((Number(p.out.trim()) / 60) * 100) / 100;
  } catch {}
  const form = new FormData();
  form.append("file", new Blob([readFileSync(audio)], { type: "audio/mp4" }), basename(audio));
  form.append("model", ctx.conf("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe"));
  form.append("response_format", "json");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(180_000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || typeof j.text !== "string") throw new Error(`transcribe ${r.status}: ${String(j?.error?.message ?? "").slice(0, 200)}`);
  writeFileSync(outTxt, j.text.trim() + "\n");
  // The plan logs minutes per run: this key is metered.
  appendFileSync(join(dirOf(ctx, "."), "transcribe.log"), `${new Date().toISOString()} ${minutes} min ${basename(media)}\n`);
  return { text: j.text, minutes };
}
async function processReference(ctx: JobCtx, id: string): Promise<Row> {
  const ref = (await cli(ctx, ["show", id])).reference as Row;
  const dir = dirOf(ctx, "references");
  const base = join(dir, id);
  let media = ref.media_path as string | null, info = ref.info_path as string | null;
  if (!media && ref.url) {
    const r = await run(["yt-dlp", "--no-playlist", "--no-warnings", "-f", "bv*[height<=1080]+ba/b", "--merge-output-format", "mp4", "--write-info-json", "-o", `${base}.%(ext)s`, ...ytdlpArgs(ctx), ref.url], { timeoutMs: 240_000 });
    const files = readdirSync(dir).filter((f) => f.startsWith(`${id}.`));
    media = files.filter((f) => /\.(mp4|mkv|webm|mov)$/i.test(f)).map((f) => join(dir, f))[0] ?? null;
    info = files.find((f) => f.endsWith(".info.json")) ? join(dir, `${id}.info.json`) : null;
    if (!media) {
      const msg = (r.err || r.out).trim().split("\n").filter(Boolean).at(-1)?.slice(0, 240) ?? `yt-dlp exit ${r.code}`;
      await cli(ctx, ["reference", id, "--error", `${new Date().toISOString()} ${msg}`]);
      ctx.log(`download failed for ${id}: ${msg}`);
      return { id, error: msg };
    }
    await cli(ctx, ["reference", id, "--media", media, ...(info ? ["--info", info] : []), "--error", "none"]);
  }
  let transcript = readText(ref.transcript_path, 20_000);
  if (media && ["pending", "failed"].includes(ref.transcript) && !transcript) {
    try {
      const t = await transcribe(ctx, media, `${base}.txt`);
      if (t) { transcript = t.text; await cli(ctx, ["reference", id, "--transcript", `${base}.txt`, "--transcript-status", "done"]); ctx.log(`transcribed ${id}: ${t.minutes} min`); }
    } catch (e: any) { await cli(ctx, ["reference", id, "--transcript-status", "failed", "--error", `${new Date().toISOString()} ${String(e?.message ?? e).slice(0, 200)}`]); }
  }
  const meta = info ? (() => { try { return JSON.parse(readFileSync(info, "utf8")); } catch { return null; } })() : null;
  const caption = meta ? [meta.title, meta.description].filter(Boolean).join("\n").slice(0, 3000) : "";
  const basis = transcript ? "transcript" : caption ? "caption" : "";
  const current = ref.analysis as Row | null;
  if (basis && (!current || (current.basis !== "transcript" && basis === "transcript"))) {
    const r = await ctx.ai.claude({
      model: "haiku", schema: CARD_SCHEMA,
      system: `You write a reference card for a saved short-form video so a creator can reuse its mechanics, not its words. Plain English, no hype.
hook: the opening device and its first line (quote if the transcript has it). structure: the beats in order with rough timing.
format: the production format (talking head, screen capture, text on screen, voiceover, cuts). why: why it holds attention, as mechanisms.
summary: two sentences on what it says. useFor: one line on how Alex (@northwindstudio, AI building content, Hinglish) could use the format.
When only a caption or note is available say so inside summary and keep every field short.`,
      prompt: `URL: ${ref.url ?? "(saved file)"}\nHis note: ${ref.note ?? "(none)"}\n${meta?.uploader ? `Creator: ${meta.uploader}\n` : ""}${meta?.duration ? `Duration: ${meta.duration}s\n` : ""}${caption ? `Caption:\n${caption}\n` : ""}${transcript ? `Transcript:\n${transcript.slice(0, 12_000)}` : "Transcript: pending (no key), judge from the caption and note."}`,
    });
    const card = { ...(r.out as Row), basis, model: "haiku", at: new Date().toISOString() };
    const file = `${base}.card.json`;
    writeFileSync(file, JSON.stringify(card, null, 1));
    await cli(ctx, ["reference", id, "--analysis-file", file]);
    ctx.log(`card written for ${id} from ${basis}`);
  }
  return (await cli(ctx, ["show", id])).reference;
}
async function processPending(ctx: JobCtx, limit = 3) {
  const refs = ((await cli(ctx, ["references", "--pending", "--full"])).references ?? []) as Row[];
  const dayAgo = Date.now() - 24 * 3600_000;
  let n = 0;
  for (const r of refs) {
    if (n >= limit) break;
    const errAt = r.error ? Date.parse(String(r.error).slice(0, 24)) : NaN;
    if (Number.isFinite(errAt) && errAt > dayAgo) continue;                      // tried in the last day
    const needsDownload = !r.media_path && !!r.url;
    const needsTranscript = !!r.media_path && ["pending", "failed"].includes(r.transcript) && !!openaiKey(ctx);
    const hasText = !!(r.transcriptText || r.info_path);                        // a note alone is too thin for a card
    const needsCard = !r.analysis && hasText && (r.transcript !== "pending" || !openaiKey(ctx) || !r.media_path);
    if (!needsDownload && !needsTranscript && !needsCard) continue;
    n++;
    try { await processReference(ctx, r.id); } catch (e: any) { ctx.log(`reference ${r.id}: ${e?.message ?? e}`); }
  }
  return n;
}

// ── build in public: done tasks with evidence become drafted ideas ─────────────────────────────
const BIP_SCHEMA = { type: "object", properties: { hook: { type: "string" }, skeleton: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 } }, required: ["hook", "skeleton"] };
async function buildInPublic(ctx: JobCtx, date: string): Promise<Row> {
  const c = await cli(ctx, ["candidates", "--date", date]);
  const made: string[] = [], errors: string[] = [];
  for (const t of (c.candidates as Row[]).filter((x) => !x.idea)) {
    try {
      const ev = String(t.evidence);
      const excerpt = /^[A-Za-z]:\\|^\//.test(ev) && existsSync(ev) && statSync(ev).isFile() ? readText(ev, 1500) : null;
      const r = await ctx.ai.claude({
        model: "haiku", schema: BIP_SCHEMA,
        system: `Alex builds AI software (Northwind) and records Reels about what he ships, in natural spoken Roman Hinglish. From one finished task and its
evidence, draft a hook (one or two spoken sentences, specific, a claim not a question, no greeting) and a five-line script skeleton (each line one beat:
what he did, the real artifact, the number or result if the evidence states one, what broke or what he learned, one CTA that asks for a choice).
Stay inside the evidence: never invent numbers, names or results; if the evidence is thin, say what is known and keep it honest. Journey, not playbook:
no internal prompts, keys or customer data.`,
        prompt: `Task: ${t.title}\nArea: ${t.area ?? "-"}\nDone at: ${t.doneAt}\nEvidence: ${ev}${excerpt ? `\nEvidence file excerpt:\n${excerpt}` : ""}`,
      });
      const hook = String(r.out.hook ?? "").trim().slice(0, 300);
      const lines = (r.out.skeleton as string[]).map((l) => String(l).trim()).filter(Boolean).slice(0, 5);
      if (!hook || lines.length < 3) throw new Error("thin draft");
      const dir = dirOf(ctx, "drafts");
      const file = join(dir, `${date}-${t.task}.txt`);
      writeFileSync(file, lines.join("\n") + "\n");
      const made1 = await cli(ctx, ["capture", `${t.title}\n\nEvidence: ${ev}`, "--title", hook, "--source", "evidence", "--external-id", `task:${t.task}:bip`, "--evidence", ev.slice(0, 1500),
        "--tag", "from your work", "--hook", hook, "--skeleton-file", file, "--channel", "northwindstudio"]);
      if (made1.idea?.id) made.push(made1.idea.id);
    } catch (e: any) { errors.push(`${t.task}: ${String(e?.message ?? e).slice(0, 160)}`); }
  }
  if (made.length) await ctx.push("From your work", `${made.length} content idea${made.length === 1 ? "" : "s"} drafted from today's evidence`, { page: "content", tab: "inbox" }).catch(() => {});
  return { date, candidates: c.candidates.length, made, errors };
}

// ── review and post (phase 5): approve → RealFlow only when CONTENT_POST=on ────────────────────
async function approveEdit(ctx: JobCtx, id: string, b: Row): Promise<Row> {
  // a slot he picked on the phone (an ISO time in the future), else the CLI books the next free one
  const pick = typeof b.at === "string" && !Number.isNaN(Date.parse(b.at)) && Date.parse(b.at) > Date.now() ? ["--at", new Date(b.at).toISOString()] : [];
  if (!postingOn(ctx)) return cli(ctx, ["approve", id, "--dry", ...pick]);
  const e = (await cli(ctx, ["show", id])).edit as Row;
  if (!e.render) throw Object.assign(new Error("This edit has no rendered video yet, so it cannot be scheduled."), { status: 400 });
  const settings = (await cli(ctx, ["settings"])) as Row;
  const channel = e.channel ?? "northwindstudio";
  if (!settings.slots?.[channel]) throw Object.assign(new Error(`Posting slot needs a number: set slots.${channel} first.`), { status: 400 });
  const dry = await cli(ctx, ["approve", id, "--dry", ...pick]);     // books the slot and marks the edit approved
  const at = dry.post?.at as string | null;
  if (!at) throw Object.assign(new Error("No free posting slot in the next 30 days."), { status: 400 });
  const script = e.script ? (await cli(ctx, ["show", e.script])).script as Row : null;
  const captionFile = join(dirOf(ctx, "captions"), `${id}.txt`);
  writeFileSync(captionFile, `${b.caption ?? [script?.hook, script?.cta].filter(Boolean).join("\n\n") ?? e.title}\n`);
  const item = String(e.external_id ?? "").replace(/^content-os:edit:/, "") || id;
  const r = await run(["content-axi", "schedule", "create", item, "--at", at, "--timezone", "Asia/Kolkata", "--account", `@${channel}`, "--video", e.render, "--caption-file", captionFile, "--json"], { timeoutMs: 600_000 });
  let j: any = null;
  try { j = JSON.parse(r.out.trim().split("\n").filter((l) => l.trim().startsWith("{")).at(-1) ?? ""); } catch {}
  if (r.code !== 0 || !j?.ok) throw Object.assign(new Error(`content-axi schedule failed: ${(j?.error ?? r.err ?? r.out).toString().slice(0, 300)}`), { status: 502 });
  const postId = String(j.post?.id ?? j.postId ?? j.id ?? "");
  return cli(ctx, ["approve", id, "--post-id", postId || `realflow:${Date.now()}`, "--at", at]);
}

// ── uploads (phase 3): 5 MB chunks, resume by offset, then a take row and the matcher ──────────
type Upload = { id: string; name: string; size: number; date: string | null; received: number; done: boolean; file: string; take?: string; createdAt: string; transcribeAttemptAt?: string;
  script?: string | null; n?: number | null };
const metaPath = (ctx: JobCtx, id: string) => join(dirOf(ctx, "uploads"), `${id}.json`);
const readUpload = (ctx: JobCtx, id: string): Upload | null => { try { return JSON.parse(readFileSync(metaPath(ctx, id), "utf8")); } catch { return null; } };
const saveUpload = (ctx: JobCtx, u: Upload) => writeFileSync(metaPath(ctx, u.id), JSON.stringify(u, null, 1));
function startUpload(ctx: JobCtx, b: Row): Upload {
  const name = String(b.name ?? "take.mp4").replace(/[^\w.-]+/g, "_").slice(0, 80);
  const size = Number(b.size);
  if (!Number.isInteger(size) || size <= 0 || size > 8 * 1024 ** 3) throw Object.assign(new Error("Send the file size in bytes (up to 8 GB)."), { status: 400 });
  // v2: the phone names its upload (so a start whose reply was lost resumes instead of starting a second file)
  const mine = typeof b.id === "string" && /^u[a-z0-9]{6,40}$/.test(b.id) ? b.id : null;
  if (mine) { const ex = readUpload(ctx, mine); if (ex) return ex; }
  const id = mine ?? `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const u: Upload = { id, name, size, date: typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : istDate(), received: 0, done: false, file: join(dirOf(ctx, "uploads"), `${id}.part`), createdAt: new Date().toISOString(),
    script: typeof b.script === "string" && /^s\d+$/.test(b.script) ? b.script : null, n: Number.isInteger(b.take) ? b.take : null };
  closeSync(openSync(u.file, "w"));
  saveUpload(ctx, u);
  return u;
}
async function appendChunk(ctx: JobCtx, u: Upload, offset: number, bytes: Uint8Array): Promise<Upload> {
  if (u.done) return u;
  if (offset !== u.received) throw Object.assign(new Error(`Resume at offset ${u.received}.`), { status: 409, offset: u.received });
  if (bytes.byteLength > CHUNK + 1024) throw Object.assign(new Error("Chunks are 5 MB at most."), { status: 413 });
  const fd = openSync(u.file, "a");
  try { writeSync(fd, bytes); } finally { closeSync(fd); }
  u.received += bytes.byteLength;
  if (u.received >= u.size) {
    const final = join(dirOf(ctx, "uploads"), `${u.id}-${u.name}`);
    renameSync(u.file, final);
    u.file = final; u.done = true;
    saveUpload(ctx, u);
    const t = await cli(ctx, ["take", "add", "--file", final, ...(u.date ? ["--date", u.date] : []), "--external-id", `upload:${u.id}`, ...(u.script ? ["--script", u.script, "--chosen"] : [])]);
    u.take = t.take?.id;
    saveUpload(ctx, u);
    matchTake(ctx, u).catch((e) => ctx.log(`take ${u.take}: ${e?.message ?? e}`));
    return u;
  }
  saveUpload(ctx, u);
  return u;
}
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
function similarity(a: string, b: string) {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size);
}
/** Match by the spoken take code first ("R3"), then by transcript similarity against the day's scripts. Without a key the take stays pending. */
const matchingTakes = new Map<string, Promise<void>>();
function matchTake(ctx: JobCtx, u: Upload): Promise<void> {
  if (!openaiKey(ctx)) return takeDuration(ctx, u);
  const key = `${ctx.contentDbPath}:${u.id}`;
  const active = matchingTakes.get(key);
  if (active) return active;
  const work = matchTakeOnce(ctx, u).finally(() => matchingTakes.delete(key));
  matchingTakes.set(key, work);
  return work;
}
async function matchTakeOnce(ctx: JobCtx, u: Upload) {
  u.transcribeAttemptAt = new Date().toISOString();
  saveUpload(ctx, u);
  if (!u.take) return;
  let duration: number | null = null;
  try { const p = await run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", u.file], { timeoutMs: 30_000 }); duration = Math.round(Number(p.out.trim()) * 10) / 10 || null; } catch {}
  if (duration) await cli(ctx, ["take", u.take, "--duration", duration]);
  const txt = u.file.replace(/\.[^.]+$/, "") + ".txt";
  let transcript: string | null = null;
  try { transcript = readText(txt) ?? (await transcribe(ctx, u.file, txt))?.text ?? null; } catch (e: any) { await cli(ctx, ["take", u.take, "--transcript-status", "failed"]); ctx.log(`transcribe ${u.take}: ${e?.message ?? e}`); return; }
  if (!transcript) return;                                                          // pending: no key
  await cli(ctx, ["take", u.take, "--transcript", txt, "--transcript-status", "done"]);
  if (u.script) return;                                                             // the phone filed it under its script
  const pack = await cli(ctx, ["pack", "--date", u.date ?? istDate(), "--full"]);
  const scripts = (pack.scripts ?? []) as Row[];
  if (!scripts.length) return;
  const spoken = transcript.match(/\b[Rr]\s?-?\s?(\d{1,2})\b/);
  let best: { s: Row; how: string; score: number } | null = null;
  if (spoken) { const s = scripts.find((x) => x.take === `R${Number(spoken[1])}`); if (s) best = { s, how: "take code", score: 1 }; }
  if (!best) {
    for (const s of scripts) {
      const sc = similarity(transcript, `${s.hook ?? ""} ${s.teleprompter ?? ""}`);
      if (!best || sc > best.score) best = { s, how: "transcript similarity", score: Math.round(sc * 100) / 100 };
    }
    if (best && best.score < 0.2) best = null;
  }
  if (best) await cli(ctx, ["take", u.take, "--script", best.s.id, "--line", "0", "--chosen", "--match", JSON.stringify({ how: best.how, score: best.score, code: spoken?.[0] ?? null })]);
  ctx.log(`take ${u.take} ${best ? `→ ${best.s.id} by ${best.how} (${best.score})` : "unmatched"}`);
}

/** Without a transcript key a take still gets its length (ffprobe is local and free). */
async function takeDuration(ctx: JobCtx, u: Upload) {
  if (!u.take) return;
  try { const p = await run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", u.file], { timeoutMs: 30_000 }); const d = Math.round(Number(p.out.trim()) * 10) / 10; if (d > 0) await cli(ctx, ["take", u.take, "--duration", d]); } catch {}
}
/** Resume uploads that waited for a key, or failed transiently. Never pay twice
 * for a completed transcript; retries also reuse the saved text after a DB error.
 */
async function processPendingUploads(ctx: JobCtx, limit: number) {
  if (!openaiKey(ctx) || limit <= 0) return 0;
  const takes = new Map<string, Row>(((await cli(ctx, ["takes"])).takes ?? []).map((t: Row) => [t.id, t]));
  let n = 0;
  for (const file of readdirSync(dirOf(ctx, "uploads")).filter(f => /^u[a-z0-9]+\.json$/.test(f))) {
    if (n >= limit) break;
    const u = readUpload(ctx, file.slice(0, -5));
    if (!u?.done || !u.take || !existsSync(u.file)) continue;
    const take = takes.get(u.take);
    if (!take || take.transcript === "done") continue;
    if (u.transcribeAttemptAt && Date.now() - Date.parse(u.transcribeAttemptAt) < 15 * 60_000) continue;
    await matchTake(ctx, u);
    n++;
  }
  return n;
}

// ── v2: the RealFlow ledger (what content-os scheduled) as posts, at start, on a sweep and at most every 10 minutes on view ──
const ledgerAt = new Map<string, number>();
async function syncLedger(ctx: JobCtx, force = false) {
  const last = ledgerAt.get(ctx.contentDbPath) ?? 0;
  if (!force && Date.now() - last < 10 * 60_000) return null;
  ledgerAt.set(ctx.contentDbPath, Date.now());
  try { return await cli(ctx, ["realflow"]); } catch (e: any) { ctx.log(`realflow ledger: ${e?.message ?? e}`); return null; }
}

// ── v2: rewrites. One Sonnet call; the CLI keeps the version before it, so Revert always brings it back ──
const REWRITE_KINDS: Record<string, { label: string; ask: string }> = {
  hook: { label: "Punchier hook", ask: "Rewrite only the hook so it lands in under two seconds: a specific claim, no greeting, no question. Keep the body and CTA as they are." },
  shorter: { label: "Shorter", ask: "Cut about a quarter of the words. Keep the hook, the proof and the payoff; drop repetition and filler." },
  hinglish: { label: "More Hinglish", ask: "Make it natural spoken Roman Hinglish the way he talks: technical nouns stay English, switch at clause boundaries, keep connectors like agar, isliye, lekin." },
  simpler: { label: "Simpler words", ask: "Use simpler, everyday words a first-time viewer gets at once. Same meaning, same length or shorter." },
  cta: { label: "Fix the CTA", ask: "Rewrite only the CTA: exactly one call to action that asks for a choice. No comment-keyword or DM promise unless the script already says the reply is set up." },
  english: { label: "In English", ask: "Rewrite it in plain spoken English with the same beats." },
};
const REWRITE_SCHEMA = { type: "object", properties: { hook: { type: "string" }, body: { type: "string" }, cta: { type: "string" } }, required: ["hook", "body", "cta"] };
async function rewriteScript(ctx: JobCtx, sid: string, kind: string, note: string | null, opId: string): Promise<Row> {
  const k = REWRITE_KINDS[kind] ?? (note ? { label: "Your note", ask: note } : null);
  if (!k) throw Object.assign(new Error(`Rewrite is one of ${Object.keys(REWRITE_KINDS).join(", ")}, or a note.`), { status: 400 });
  const s = (await cli(ctx, ["show", sid])).script as Row;
  const text = String(s.teleprompter ?? "").trim();
  if (!text) throw Object.assign(new Error(`${sid} has no spoken text to rewrite.`), { status: 400 });
  const rules = await loopRules(ctx, 8);
  const r = await ctx.ai.claude({
    model: "sonnet", schema: REWRITE_SCHEMA, timeout: 180_000,
    system: `You revise a short-form script for ${s.channel === "example_creator" ? "@example_creator" : "@northwindstudio"} (Instagram Reels, Alex on camera). Change only what the request asks.
Never invent numbers, dates, prices or results. Output hook (the first spoken line or two), body (the spoken lines as plain paragraphs, no stage directions, no timecodes), cta (one closing line).
${rules}

DOCTRINE
${doctrine()}`,
    prompt: `Request: ${k.ask}${note && k.label !== "Your note" ? `\nHis note: ${note}` : ""}\n\nScript ${sid}: ${s.title}\nCurrent hook: ${s.hook ?? "(first line)"}\nCurrent CTA: ${s.cta ?? "(last line)"}\n\nSpoken text now:\n${text.slice(0, 6000)}`,
  });
  const o = r.out as Row;
  const hook = String(o.hook ?? "").trim(), body = String(o.body ?? "").trim(), cta = String(o.cta ?? "").trim();
  if (!hook || !body) throw new Error("The rewrite came back empty.");
  const file = join(dirOf(ctx, "scripts"), `${sid}-${opId.replace(/[^\w-]/g, "").slice(-16)}.txt`);
  writeFileSync(file, `${hook}\n\n${body}${cta ? `\n\n${cta}` : ""}\n`);
  const out = await cli(ctx, ["script", sid, "revise", "--teleprompter-file", file, "--hook", hook.slice(0, 480), "--cta", cta.slice(0, 480), "--label", k.label, "--external-id", opId]);
  ctx.log(`rewrite ${sid} (${k.label}, Sonnet ${r.ms} ms)`);
  return out.script;
}

// ── v2: the phone's outbox. Every write the app makes is a doc in content_ops (the svc/store contract); the PC applies
//    each one once by its id and writes the outcome back onto the doc, so a resend after a lost reply changes nothing.
//    Slow ones (a model call, a RealFlow upload) answer at once with state "running" and finish in the background. ──
const OPS = mountCollection({ table: "content_ops", columns: { kind: "text", applied_at: "text", error: "text", source: "text" }, limit: 3000 });
const opsDbs = new Map<string, Database>();
function opsDb(ctx: JobCtx): Database {
  let db = opsDbs.get(ctx.contentDbPath);
  if (!db) { db = new Database(ctx.contentDbPath); db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;"); opsDbs.set(ctx.contentDbPath, db); }
  return db;
}
const migrated = new Set<string>();
async function ensureOps(ctx: JobCtx) {
  if (migrated.has(ctx.contentDbPath)) return;
  await cli(ctx, ["settings"]);                                       // the CLI owns the schema: any call migrates content.db
  if (!opsDb(ctx).query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_ops'").get())
    throw Object.assign(new Error("Content OS on this PC needs the 2.0 agentos (content_ops is missing)."), { status: 503 });
  migrated.add(ctx.contentDbPath);
}
const SLOW_KINDS = new Set(["rewrite", "plan", "write"]);
const OP_KINDS = new Set(["verdict", "capture", "idea", "approve", "unapprove", "note", "script", "rewrite", "revert", "settings", "rule", "plan", "write", "take", "sync"]);
const running = new Map<string, Promise<void>>();
const later = (iso: unknown) => { const t = Date.parse(String(iso ?? "")); return new Date(Math.max(Date.now(), Number.isFinite(t) ? t + 1 : 0)).toISOString(); };
const str = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const need = (v: unknown, re: RegExp, what: string) => { const s = typeof v === "string" ? v.trim() : ""; if (!re.test(s)) throw Object.assign(new Error(`Send ${what}.`), { status: 400 }); return s; };
/** What each op does on the PC. Returns a small result for the doc (and the agent's feed). */
async function runOp(ctx: JobCtx, op: Row): Promise<Row> {
  const date = typeof op.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(op.date) ? op.date : istDate();
  switch (op.kind) {
    case "verdict": {
      const idea = need(op.idea, /^c\d+$/, "the idea (c12)");
      const v = need(op.v, /^(keep|kill|script|restore)$/, "the verdict: keep, kill, script or restore");
      const r = await cli(ctx, ["verdict", idea, v, ...(str(op.why, 300) ? ["--why", str(op.why, 300)!] : []), ...(str(op.was, 20) ? ["--was", str(op.was, 20)!] : []),
        ...(str(op.undo, 80) ? ["--undo", str(op.undo, 80)!] : []), "--external-id", op.id]);
      return { idea, status: r.idea?.status ?? null, write: !!r.write };
    }
    case "write": {                                                   // "script it now": the writer joins the day's pack
      const idea = need(op.idea, /^c\d+$/, "the idea (c12)");
      const r = await scriptForIdea(ctx, idea, date);
      return { idea, script: r.script?.id ?? null, take: r.script?.take ?? null };
    }
    case "capture": {
      const text = str(op.text, 20_000), link = str(op.link ?? op.url, 2000);
      if (!text && !link) throw Object.assign(new Error("Type an idea or paste a link."), { status: 400 });
      const source = ["email", "share", "keyword", "radar", "agent", "chat", "reel"].includes(op.from) ? op.from : op.source === "agent" ? "agent" : link ? "share" : "chat";
      const r = await cli(ctx, ["capture", text || link!, ...(link ? ["--link", link] : []), ...(str(op.channel, 40) ? ["--channel", str(op.channel, 40)!.replace(/^@/, "")] : []),
        ...(str(op.title, 300) ? ["--title", str(op.title, 300)!] : []), "--source", source, "--external-id", `op:${op.id}`]);
      if (r.reference?.id && !r.already) processReference(ctx, r.reference.id).catch((e) => ctx.log(`reference ${r.reference.id}: ${e?.message ?? e}`));
      return { idea: r.idea?.id ?? null, reference: r.reference?.id ?? null };
    }
    case "idea": {
      const idea = need(op.idea, /^c\d+$/, "the idea (c12)");
      const args = [idea];
      if (str(op.channel, 40)) args.push("--channel", str(op.channel, 40)!.replace(/^@/, ""));
      if (str(op.title, 300)) args.push("--title", str(op.title, 300)!);
      if (str(op.status, 20)) args.push("--status", str(op.status, 20)!);
      const r = await cli(ctx, ["idea", ...args]);
      return { idea, channel: r.idea?.channel ?? null };
    }
    case "approve": {
      const edit = need(op.edit, /^e\d+$/, "the edit (e3)");
      const r = await approveEdit(ctx, edit, { caption: str(op.caption, 2200), at: str(op.at, 40) });
      return { edit, post: r.post?.id ?? null, at: r.post?.at ?? null, dryRun: !!r.dryRun, note: r.note ?? null };
    }
    case "unapprove": { const edit = need(op.edit, /^e\d+$/, "the edit (e3)"); await cli(ctx, ["unapprove", edit]); return { edit }; }
    case "note": {
      const edit = need(op.edit, /^e\d+$/, "the edit (e3)");
      const text = str(op.text, 2000);
      if (!text) throw Object.assign(new Error("Write what should change."), { status: 400 });
      await cli(ctx, ["note", edit, text]);
      return { edit };
    }
    case "script": {
      const sid = need(op.script, /^s\d+$/, "the script (s12)");
      const status = need(op.status, /^(draft|approved|shot|rejected)$/, "the status: draft, approved, shot or rejected");
      await cli(ctx, ["script", sid, "--status", status]);
      return { script: sid, status };
    }
    case "rewrite": {
      const sid = need(op.script, /^s\d+$/, "the script (s12)");
      const s = await rewriteScript(ctx, sid, String(op.rewrite ?? op.how ?? ""), str(op.note, 600), op.id);
      return { script: sid, words: s?.words ?? null, seconds: s?.seconds ?? null, label: s?.previous?.label ?? null };
    }
    case "revert": { const sid = need(op.script, /^s\d+$/, "the script (s12)"); const r = await cli(ctx, ["script", sid, "revert"]); return { script: sid, label: r.label ?? null, already: !!r.already }; }
    case "settings": {
      const vals = op.values && typeof op.values === "object" ? op.values : {};
      const keys = Object.keys(vals);
      if (!keys.length) throw Object.assign(new Error("Send the settings to change."), { status: 400 });
      for (const k of keys) {
        if (!/^(reels_per_day|slots)\.(northwindstudio|example_creator)$|^shoot_at$/.test(k)) throw Object.assign(new Error(`Bad setting "${k}".`), { status: 400 });
        const v = vals[k];
        await cli(ctx, v == null || v === "" ? ["settings", "unset", k] : ["settings", "set", k, String(v)]);
      }
      return { keys };
    }
    case "rule": {
      const l = need(op.learning, /^l\d+$/, "the learning (l12)");
      const r = await cli(ctx, ["learning", l, op.on === false ? "--mute" : "--unmute"]);
      return { learning: l, muted: op.on === false, rows: r.rows ?? 0 };
    }
    case "plan": { const r = await runPlan(ctx, date, !!op.fresh); if (r.errors?.length) throw new Error(`Pack incomplete: ${r.errors.join("; ")}`); return { date, scripts: r.scripts?.length ?? 0, task: r.task ?? null }; }
    case "take": {
      const k = need(op.take, /^k\d+$/, "the take (k3)");
      const args = [k];
      if (str(op.script, 20)) args.push("--script", need(op.script, /^(s\d+|none)$/, "the script (s12)"));
      if (op.chosen === true) args.push("--chosen"); else if (op.chosen === false) args.push("--unchosen");
      await cli(ctx, ["take", ...args]);
      return { take: k };
    }
    case "sync": { const r = await syncLedger(ctx, true); return { posts: r?.posts ?? 0, added: r?.added ?? 0 }; }
  }
  throw Object.assign(new Error(`Unknown op "${op.kind}".`), { status: 400 });
}
/** PUT /ops/:id (or POST /ops with an id): apply once, record the outcome on the doc. */
async function applyOp(ctx: ModCtx, id: string | null, body: Row): Promise<Response> {
  await ensureOps(ctx);
  const db = opsDb(ctx);
  const opId = id ?? (typeof body.id === "string" ? body.id : null);
  if (!opId || !/^[A-Za-z0-9_.:-]{1,80}$/.test(opId)) return ctx.fail(400, "Bad id.");
  if (id && body.id != null && String(body.id) !== id) return ctx.fail(400, "The id in the body doesn't match the path.");
  const cur = OPS.get(db, opId);
  // a replay (the reply was lost, or the phone sent it again): the PC already has it
  if (cur && (cur.applied_at || cur.state === "refused" || (cur.state === "running" && (running.has(opId) || Date.now() - Date.parse(cur.updated_at) < 15 * 60_000))))
    return ctx.json({ item: cur });
  const kind = String(body.kind ?? "");
  if (!OP_KINDS.has(kind)) return ctx.fail(400, `Unknown op "${kind}".`);
  const doc: Row = { ...body, id: opId, kind, source: body.source === "agent" ? "agent" : "phone" };
  const slow = SLOW_KINDS.has(kind) || (kind === "approve" && postingOn(ctx)) || (kind === "verdict" && body.v === "script");
  if (slow) {
    const startDoc = { ...doc, state: "running", applied_at: null, error: null, updated_at: later(doc.updated_at) };
    OPS.upsert(db, startDoc);
    running.set(opId, (async () => {
      let end: Row;
      try { const result = await runOp(ctx, doc); end = { ...startDoc, state: "done", result, applied_at: new Date().toISOString() };
        // "script it now" is a keep plus the writer: the verdict lands at once, the script when Sonnet answers
        if (kind === "verdict" && result.write) { const w = await runOp(ctx, { ...doc, kind: "write" }); end.result = { ...result, ...w }; }
      } catch (e: any) { end = { ...startDoc, state: e?.status && e.status < 500 ? "refused" : "failed", error: String(e?.message ?? e).slice(0, 400), applied_at: new Date().toISOString() }; ctx.log(`op ${opId} (${kind}) failed: ${e?.message ?? e}`); }
      OPS.upsert(db, { ...end, updated_at: later(OPS.get(db, opId)?.updated_at) });
    })().finally(() => running.delete(opId)));
    return ctx.json({ item: OPS.get(db, opId) });
  }
  try {
    const result = await runOp(ctx, doc);
    OPS.upsert(db, { ...doc, state: "done", result, error: null, applied_at: new Date().toISOString(), updated_at: later(doc.updated_at) });
    return ctx.json({ item: OPS.get(db, opId) });
  } catch (e: any) {
    const status = e?.status ?? 500;
    if (status < 500) {   // refused: recorded, so a resend gets the same answer; the phone drops it and says why
      OPS.upsert(db, { ...doc, state: "refused", error: String(e?.message ?? e).slice(0, 400), applied_at: new Date().toISOString(), updated_at: later(doc.updated_at) });
      return ctx.fail(status, String(e?.message ?? "Refused."));
    }
    ctx.log(`op ${opId} (${kind}) failed: ${e?.message ?? e}`);
    return ctx.fail(502, String(e?.message ?? "Content OS failed on the PC."));   // not recorded: the phone retries
  }
}
/** The agent's actions go through the same log, so the app's feed shows them and nothing runs twice. */
async function agentOp(ctx: JobCtx, op: Row): Promise<Row> {
  await ensureOps(ctx);
  const id = `ag_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
  const doc: Row = { ...op, id, source: "agent", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  try {
    const result = await runOp(ctx, doc);
    OPS.upsert(opsDb(ctx), { ...doc, state: "done", result, applied_at: new Date().toISOString(), updated_at: later(doc.updated_at) });
    return { ok: true, op: id, ...result };
  } catch (e: any) {
    OPS.upsert(opsDb(ctx), { ...doc, state: e?.status && e.status < 500 ? "refused" : "failed", error: String(e?.message ?? e).slice(0, 400), applied_at: new Date().toISOString(), updated_at: later(doc.updated_at) });
    return { ok: false, op: id, error: String(e?.message ?? e) };
  }
}

// ── v2: media. A <video> can't send the session token, so the app asks for a signed link (10 minutes) and plays that ──
let mediaKey: Buffer | null = null;
function keyOf(ctx: JobCtx): Buffer {
  if (mediaKey) return mediaKey;
  const f = join(dirOf(ctx, "."), "media.key");
  try { mediaKey = Buffer.from(readFileSync(f, "utf8").trim(), "hex"); if (mediaKey.length >= 32) return mediaKey; } catch {}
  mediaKey = randomBytes(32);
  writeFileSync(f, mediaKey.toString("hex"));
  return mediaKey;
}
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function signMedia(ctx: JobCtx, ref: string, ttlMs = 10 * 60_000): string {
  const body = b64u(JSON.stringify({ r: ref, x: Date.now() + ttlMs }));
  return `${body}.${b64u(createHmac("sha256", keyOf(ctx)).update(body).digest())}`;
}
function verifyMedia(ctx: JobCtx, token: string): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = b64u(createHmac("sha256", keyOf(ctx)).update(body).digest());
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { const j = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); return typeof j.r === "string" && j.x > Date.now() ? j.r : null; } catch { return null; }
}
const MEDIA_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".jpg": "image/jpeg", ".png": "image/png" };
async function mediaPath(ctx: JobCtx, ref: string): Promise<string | null> {
  if (/^e\d+$/.test(ref)) return ((await cli(ctx, ["show", ref])).edit?.render as string | null) ?? null;
  if (/^k\d+$/.test(ref)) return ((await cli(ctx, ["show", ref])).take?.file as string | null) ?? null;
  return null;
}
function serveFile(req: Request, path: string): Response {
  const f = Bun.file(path);
  const size = f.size;
  const type = MEDIA_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const head = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" };
  const m = (req.headers.get("range") ?? "").match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return new Response(f, { headers: { ...head, "Content-Length": String(size) } });
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  let end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...head, "Content-Range": `bytes */${size}` } });
  return new Response(f.slice(start, end + 1), { status: 206, headers: { ...head, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
}

// ── v2: what the agent can do in Content (Wyn's MCP server aggregates these; DECISIONS 2 sets auto) ──
const S = (props: Record<string, any>, required: string[] = []) => ({ type: "object", properties: props, required });
const tools: AgentTool[] = [
  { name: "content_overview", auto: true, description: "Content OS at a glance: ideas to sort, today's shoot pack, edits waiting for Alex, the next posts, settings that still need a number.",
    input: S({}), run: async (ctx) => { const o = await cli(ctx, ["overview"]); return { date: o.date, counts: o.counts, pack: { shootDay: o.pack?.shootDay, scripts: (o.pack?.scripts ?? []).map((s: Row) => ({ id: s.id, take: s.take, title: s.title, status: s.status })), pending: o.pack?.pending ?? [] },
      editsWaiting: (o.edits ?? []).filter((e: Row) => e.status === "review").map((e: Row) => ({ id: e.id, title: e.title })), nextPosts: (o.posts ?? []).filter((p: Row) => p.status === "scheduled" && p.at && Date.parse(p.at) > Date.now()).slice(-5).map((p: Row) => ({ title: p.title, at: p.at })),
      deck: o.deck?.count ?? null, needsNumber: o.settings?.needs ?? [] }; } },
  { name: "content_list_ideas", auto: true, description: "List Content ideas (status inbox, picked, scripted, dropped or all) with the plan's score and reasons for new ones.",
    input: S({ status: { type: "string" }, channel: { type: "string", enum: ["northwindstudio", "example_creator"] }, limit: { type: "integer" } }),
    run: async (ctx, a) => (a?.status ?? "inbox") === "inbox" ? cli(ctx, ["deck", "--limit", String(Math.min(60, Number(a?.limit) || 20)), ...(a?.channel ? ["--channel", a.channel] : [])])
      : cli(ctx, ["ideas", "--status", String(a.status), ...(a?.channel ? ["--channel", a.channel] : []), "--limit", String(Math.min(200, Number(a?.limit) || 40))]) },
  { name: "content_file_idea", auto: true, description: "File a reel idea, a thought or a reel/link he shared into Content's Ideas (a link becomes a reference card).",
    input: S({ text: { type: "string" }, link: { type: "string" }, channel: { type: "string", enum: ["northwindstudio", "example_creator"] } }, ["text"]),
    run: (ctx, a) => agentOp(ctx, { kind: "capture", text: a?.text, link: a?.link, channel: a?.channel, from: "agent" }) },
  { name: "content_mine_work", auto: true, description: "Turn today's finished tasks with evidence (build in public) into drafted reel ideas with a hook and a five-line skeleton.",
    input: S({ date: { type: "string", description: "YYYY-MM-DD, default today" } }), run: (ctx, a) => buildInPublic(ctx, typeof a?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : istDate()) },
  { name: "content_verdict", auto: false, description: "Keep or kill an idea for Alex (his verdicts teach the loop, so ask him first unless he said which).",
    input: S({ idea: { type: "string" }, verdict: { type: "string", enum: ["keep", "kill", "restore"] }, why: { type: "string" } }, ["idea", "verdict"]),
    run: (ctx, a) => agentOp(ctx, { kind: "verdict", idea: a?.idea, v: a?.verdict, why: a?.why }) },
  { name: "content_write_script", auto: true, description: "Write a script for one idea now (Sonnet, his doctrine and the loop's rules); it joins that day's shoot pack with the next take code.",
    input: S({ idea: { type: "string" }, date: { type: "string" } }, ["idea"]), run: (ctx, a) => agentOp(ctx, { kind: "write", idea: a?.idea, date: a?.date }) },
  { name: "content_rewrite_script", auto: true, description: "Rewrite a script: hook (punchier), shorter, hinglish, simpler, cta, english, or a note. The version before it is kept; content_revert_script brings it back.",
    input: S({ script: { type: "string" }, how: { type: "string", enum: Object.keys(REWRITE_KINDS) }, note: { type: "string" } }, ["script"]),
    run: (ctx, a) => agentOp(ctx, { kind: "rewrite", script: a?.script, rewrite: a?.how ?? "", note: a?.note }) },
  { name: "content_revert_script", auto: true, description: "Undo the last rewrite of a script.", input: S({ script: { type: "string" } }, ["script"]), run: (ctx, a) => agentOp(ctx, { kind: "revert", script: a?.script }) },
  { name: "content_plan_pack", auto: true, description: "Run the nightly plan now for a date: pick ideas per channel, write the missing scripts, file the Shoot block on Today.",
    input: S({ date: { type: "string" }, fresh: { type: "boolean" } }), run: (ctx, a) => agentOp(ctx, { kind: "plan", date: a?.date, fresh: !!a?.fresh }) },
  { name: "content_note_edit", auto: true, description: "Send an edit back to the editor with a note (what to change); it comes back as the next version.",
    input: S({ edit: { type: "string" }, text: { type: "string" } }, ["edit", "text"]), run: (ctx, a) => agentOp(ctx, { kind: "note", edit: a?.edit, text: a?.text }) },
  { name: "content_approve_edit", auto: false, description: "Approve an edit: it books the next posting slot through RealFlow (a dry run while CONTENT_POST is off). Public, so ask first.",
    input: S({ edit: { type: "string" }, caption: { type: "string" } }, ["edit"]), run: (ctx, a) => agentOp(ctx, { kind: "approve", edit: a?.edit, caption: a?.caption }) },
  { name: "content_set_setting", auto: false, description: "Set reels a day (reels_per_day.<channel>), posting slots (slots.<channel>, e.g. 12:30,19:00) or the shoot time (shoot_at).",
    input: S({ key: { type: "string" }, value: { type: "string" } }, ["key", "value"]), run: (ctx, a) => agentOp(ctx, { kind: "settings", values: { [String(a?.key ?? "")]: a?.value ?? null } }) },
];

// ── job state for the UI ──────────────────────────────────────────────────────────────────────
function jobState(ctx: JobCtx) {
  try {
    const runs = JSON.parse(readFileSync(join(ctx.dataDir, "mod", "jobs.json"), "utf8"));
    return Object.fromEntries(["content-sweep", "content-plan", "content-buildpublic"].map((k) => [k.replace("content-", ""), runs[`content:${k}`] ?? null]));
  } catch { return { sweep: null, plan: null, buildpublic: null }; }
}
const ok = (ctx: ModCtx) => (ctx.owner ? null : ctx.fail(403, "Content OS is the owner's."));

export const content: Module = {
  name: "content",
  publicPaths: ["/media/"],
  tools,
  async handle(ctx) {
    // a signed media link (publicPaths): the signature is the auth, nothing else is served without a session
    const media = ctx.path.match(/^\/media\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
    if (media && ctx.method === "GET") {
      const ref = verifyMedia(ctx, media[1]);
      if (!ref) return ctx.fail(403, "This link has expired.");
      try { const path = await mediaPath(ctx, ref); return path && existsSync(path) ? serveFile(ctx.req, path) : ctx.fail(404, "That file isn't on the PC any more."); }
      catch { return ctx.fail(404, "No such file."); }
    }
    const denied = ok(ctx);
    if (denied) return denied;
    const p = ctx.path, m = ctx.method;
    const q = ctx.url.searchParams;
    const date = q.get("date") && /^\d{4}-\d{2}-\d{2}$/.test(q.get("date")!) ? q.get("date")! : istDate();
    let mm: RegExpMatchArray | null;
    try {
      if (p === "/ops" || p.startsWith("/ops/")) {
        const rest = p.slice(4).replace(/^\//, "");
        if (m === "GET") { await ensureOps(ctx); return OPS.handle({ ...ctx, db: () => opsDb(ctx) } as ModCtx, "/ops"); }
        if ((m === "PUT" && rest && !rest.includes("/")) || (m === "POST" && !rest)) return applyOp(ctx, rest ? decodeURIComponent(rest) : null, await ctx.body());
        return ctx.fail(405, "Ops are applied, not deleted: send the undo as a new op.");
      }
      if (p === "/deck" && m === "GET") return ctx.json(await cli(ctx, ["deck", "--limit", String(Math.min(200, Number(q.get("limit") ?? 40) || 40)), ...(q.get("channel") ? ["--channel", q.get("channel")!] : [])]));
      if (p === "/learnings" && m === "GET") return ctx.json(await cli(ctx, ["learnings", "--limit", String(Math.min(300, Number(q.get("limit") ?? 60) || 60))]));
      if ((mm = p.match(/^\/(edits|takes)\/([ek]\d+)\/media$/)) && m === "GET") {
        const path = await mediaPath(ctx, mm[2]);
        if (!path || !existsSync(path)) return ctx.fail(404, mm[1] === "edits" ? "This edit has no render on the PC yet." : "That take isn't on the PC.");
        return ctx.json({ url: `/api/v1/mod/content/media/${signMedia(ctx, mm[2])}`, type: MEDIA_TYPES[extname(path).toLowerCase()] ?? null, bytes: statSync(path).size, expires: Date.now() + 10 * 60_000 });
      }
      if (p === "/realflow" && m === "POST") return ctx.json((await syncLedger(ctx, true)) ?? { ok: false, error: "The ledger could not be read." });
      if (p === "/overview" && m === "GET") {
        await ensureImported(ctx);
        syncLedger(ctx).catch(() => {});
        const o = await cli(ctx, ["overview", "--date", date]);
        return ctx.json({ ...o, jobs: jobState(ctx), flags: { post: postingOn(ctx), transcribe: !!openaiKey(ctx), chunk: CHUNK } });
      }
      if (p === "/ideas" && m === "GET") return ctx.json(await cli(ctx, ["ideas", "--status", q.get("status") ?? "inbox", ...(q.get("channel") ? ["--channel", q.get("channel")!] : [])]));
      if (p === "/ideas" && m === "POST") {
        const b = await ctx.body();
        const text = String(b.text ?? "").trim(), link = String(b.link ?? b.url ?? "").trim();
        if (!text && !link) return ctx.fail(400, "Type an idea or paste a link.");
        const r = await cli(ctx, ["capture", text || link, ...(link ? ["--link", link] : []), ...(b.channel ? ["--channel", String(b.channel)] : []), "--source", ["email", "share", "keyword", "radar", "agent", "chat"].includes(b.source) ? b.source : "chat"]);
        if (r.reference?.id) processReference(ctx, r.reference.id).catch((e) => ctx.log(`reference ${r.reference.id}: ${e?.message ?? e}`));
        return ctx.json(r, 201);
      }
      if ((mm = p.match(/^\/ideas\/(c\d+)$/)) && m === "GET") return ctx.json(await cli(ctx, ["show", mm[1]]));
      if ((mm = p.match(/^\/ideas\/(c\d+)$/)) && m === "POST") {
        const b = await ctx.body();
        const args = [mm[1]];
        for (const k of ["status", "channel", "verdict", "title"]) if (typeof b[k] === "string" && b[k].trim()) args.push(`--${k}`, b[k].trim());
        return ctx.json(await cli(ctx, ["idea", ...args]));
      }
      if ((mm = p.match(/^\/ideas\/(c\d+)\/script$/)) && m === "POST") {
        const b = await ctx.body().catch(() => ({}));
        const d = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : date;
        return ctx.json(await scriptForIdea(ctx, mm[1], d), 201);
      }
      if (p === "/pack" && m === "GET") return ctx.json(await cli(ctx, ["pack", "--date", date, "--full"]));
      if (p === "/plan" && m === "POST") {
        const b = await ctx.body().catch(() => ({}));
        const d = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : date;
        const pack = await runPlan(ctx, d, !!b.fresh);
        return pack.errors?.length
          ? ctx.json({ ...pack, error: `Pack incomplete: ${pack.errors.join("; ")}` }, 502)
          : ctx.json(pack);
      }
      if ((mm = p.match(/^\/scripts\/(s\d+)$/)) && m === "GET") return ctx.json(await cli(ctx, ["show", mm[1]]));
      if ((mm = p.match(/^\/scripts\/(s\d+)$/)) && m === "POST") {
        const b = await ctx.body();
        const args = [mm[1]];
        for (const k of ["status", "verdict", "take-code"]) if (typeof b[k] === "string" && b[k].trim()) args.push(`--${k}`, b[k].trim());
        return ctx.json(await cli(ctx, ["script", ...args]));
      }
      if (p === "/edits" && m === "GET") return ctx.json(await cli(ctx, ["edits", ...(q.get("status") ? ["--status", q.get("status")!] : [])]));
      if ((mm = p.match(/^\/edits\/(e\d+)\/approve$/)) && m === "POST") return ctx.json(await approveEdit(ctx, mm[1], await ctx.body().catch(() => ({}))));
      if ((mm = p.match(/^\/edits\/(e\d+)\/note$/)) && m === "POST") {
        const b = await ctx.body();
        if (!String(b.text ?? "").trim()) return ctx.fail(400, "Write what should change.");
        return ctx.json(await cli(ctx, ["note", mm[1], String(b.text).trim()]));
      }
      if ((mm = p.match(/^\/edits\/(e\d+)$/)) && m === "GET") return ctx.json(await cli(ctx, ["show", mm[1]]));
      if (p === "/posts" && m === "GET") return ctx.json(await cli(ctx, ["posts"]));
      if (p === "/settings" && m === "GET") return ctx.json(await cli(ctx, ["settings"]));
      if (p === "/settings" && (m === "PUT" || m === "POST")) {
        const b = await ctx.body();
        let last: any = null;
        for (const [k, v] of Object.entries(b)) {
          if (!/^[a-z_.]+$/.test(k)) return ctx.fail(400, `Bad setting "${k}".`);
          last = v == null || v === "" ? await cli(ctx, ["settings", "unset", k]) : await cli(ctx, ["settings", "set", k, String(v)]);
        }
        return ctx.json(last ?? (await cli(ctx, ["settings"])));
      }
      if ((mm = p.match(/^\/references\/(r\d+)$/)) && m === "GET") return ctx.json(await cli(ctx, ["show", mm[1]]));
      if ((mm = p.match(/^\/references\/(r\d+)\/process$/)) && m === "POST") return ctx.json(await processReference(ctx, mm[1]));
      if (p === "/import" && m === "POST") { const r = await cli(ctx, ["import"]); await cli(ctx, ["settings", "set", "import.auto", istDate()]); return ctx.json(r); }
      if (p === "/sweep" && m === "POST") { const s = await cli(ctx, ["sweep"]); const limit = Number(q.get("limit") ?? 3); const refs = await processPending(ctx, limit); const takes = await processPendingUploads(ctx, limit - refs); return ctx.json({ ...s, referencesProcessed: refs, takesProcessed: takes }); }
      if (p === "/buildpublic" && m === "POST") return ctx.json(await buildInPublic(ctx, date));
      if (p === "/takes" && m === "GET") return ctx.json(await cli(ctx, ["takes", ...(q.get("date") ? ["--date", date] : [])]));
      // chunked, resumable uploads
      if (p === "/uploads" && m === "POST") {
        const u = startUpload(ctx, await ctx.body());   // the phone's id again: the same upload, at the offset the PC has
        return ctx.json({ id: u.id, offset: u.received, chunk: CHUNK, size: u.size, done: u.done, take: u.take ?? null }, u.received || u.done ? 200 : 201);
      }
      if ((mm = p.match(/^\/uploads\/(u[a-z0-9]+)$/)) && m === "GET") {
        const u = readUpload(ctx, mm[1]);
        return u ? ctx.json({ id: u.id, offset: u.received, size: u.size, done: u.done, take: u.take ?? null, chunk: CHUNK }) : ctx.fail(404, "No such upload.");
      }
      if ((mm = p.match(/^\/uploads\/(u[a-z0-9]+)$/)) && m === "PUT") {
        const u = readUpload(ctx, mm[1]);
        if (!u) return ctx.fail(404, "No such upload.");
        const offset = Number(q.get("offset") ?? u.received);
        const bytes = new Uint8Array(await ctx.req.arrayBuffer());
        try {
          const r = await appendChunk(ctx, u, offset, bytes);
          return ctx.json({ id: r.id, offset: r.received, size: r.size, done: r.done, take: r.take ?? null });
        } catch (e: any) { return ctx.json({ error: e.message, offset: e.offset ?? u.received }, e.status ?? 500); }
      }
      return null;
    } catch (e: any) {
      if (e?.status && e.status < 500) return ctx.fail(e.status, e.message);
      ctx.log(`${m} ${p} failed: ${e?.message ?? e}`);
      return ctx.fail(e?.status ?? 500, String(e?.message ?? "Content OS failed on the PC."));
    }
  },
  jobs: [
    { id: "content-sweep", every: "15m", async run(ctx) { await ensureImported(ctx); await syncLedger(ctx, true); const s = await cli(ctx, ["sweep"]); const n = await processPending(ctx, 3); const takes = await processPendingUploads(ctx, 3 - n); if (s.moved?.length || n || takes) ctx.log(`sweep: ${s.moved?.length ?? 0} task(s) moved, ${n} reference(s), ${takes} take(s) processed`); } },
    { id: "content-plan", at: "02:30", catchUpMinutes: 1440, retry: { attempts: 3, delayMinutes: 5 }, async run(ctx) {
      const r = await runPlan(ctx, istDate());
      if (r.errors?.length) throw new Error(`Pack incomplete: ${r.errors.join("; ")}`);
      ctx.log(`plan ${r.date}: ${r.scripts?.length ?? 0} script(s), task ${r.task ?? "none"}`);
    } },
    { id: "content-buildpublic", at: "21:30", async run(ctx) { const r = await buildInPublic(ctx, istDate()); ctx.log(`build in public ${r.date}: ${r.made.length} of ${r.candidates} candidate(s)${r.errors.length ? `, errors: ${r.errors.join("; ")}` : ""}`); } },
  ],
};
