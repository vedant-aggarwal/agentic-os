// Wyn's voice notes on WhatsApp: her reply read by OpenAI TTS (gpt-4o-mini-tts, the call voice), turned into the
// Ogg/Opus mono file WhatsApp plays as a voice note, then uploaded and sent by the transport (wyn-whatsapp.ts).
// Uses the same OPENAI_API_KEY as her calls and transcription. Without ffmpeg it asks OpenAI for Opus directly.
// Cost: OpenAI lists gpt-4o-mini-tts at about $0.015 a minute of audio, so a 20-second note is about half a US cent.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TTS_MODEL = process.env.WYN_TTS_MODEL || "gpt-4o-mini-tts";
/** Voices gpt-4o-mini-tts takes (platform.openai.com text-to-speech guide). Every call voice is one of them. */
export const TTS_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
/** She's a woman: the female TTS voices, none of them Indian-accented. */
export const FEMALE_VOICES = ["marin", "coral", "sage", "shimmer", "nova"];
/** Her call voice when it's a female TTS voice, else marin (the most natural one, American). A male call voice
 *  like cedar stays on calls only. */
export const ttsVoice = (callVoice: unknown) => { const v = String(callVoice ?? "").trim().toLowerCase(); return FEMALE_VOICES.includes(v) ? v : "marin"; };
export const TTS_INSTRUCTIONS = "Voice: a warm young woman, a close friend sending a quick WhatsApp voice note. " +
  "Tone: relaxed, natural and a little playful; never an announcer, never customer support. Pace: conversational, with small natural pauses between thoughts. " +
  "The text mixes Hindi and English in Roman script (Hinglish): say the Hindi words the way Hindi speakers say them, never spelled out letter by letter.";

const FFMPEG = () => process.env.FFMPEG || Bun.which("ffmpeg");
export const hasFfmpeg = () => !!FFMPEG();

/** Any audio (wav, mp3, m4a...) → Ogg/Opus, mono, 48 kHz, voice-tuned: what WhatsApp shows as a voice note. */
export async function toOggOpus(input: Uint8Array, ffmpeg = FFMPEG()): Promise<Uint8Array> {
  if (!ffmpeg) throw new Error("ffmpeg isn't on this PC.");
  const dir = mkdtempSync(join(tmpdir(), "wyn-voice-"));
  try {
    const src = join(dir, "in"), out = join(dir, "out.ogg");
    writeFileSync(src, input);
    const p = Bun.spawn([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "48000",
      "-c:a", "libopus", "-b:a", "32k", "-application", "voip", out], { stdout: "ignore", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), 30_000);
    const err = await new Response(p.stderr).text();
    clearTimeout(timer);
    if ((await p.exited) !== 0) throw new Error(`ffmpeg couldn't convert the audio: ${err.trim().slice(0, 200)}`);
    const bytes = new Uint8Array(readFileSync(out));
    if (!isOggOpus(bytes)) throw new Error("ffmpeg made something that isn't Ogg/Opus.");
    return bytes;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
/** An Ogg file whose first stream is Opus. */
export const isOggOpus = (b: Uint8Array) => b.length > 64 && Buffer.from(b.subarray(0, 4)).toString("latin1") === "OggS" &&
  Buffer.from(b.subarray(0, 200)).toString("latin1").includes("OpusHead");

type Speak = { key: string; voice: string; url?: string; fetch?: typeof fetch; ffmpeg?: string | null };
/** Her words as an Ogg/Opus voice note. */
export async function speak(text: string, o: Speak): Promise<Uint8Array> {
  if (!o.key) throw new Error("No OpenAI key for voice notes (OPENAI_API_KEY).");
  const ffmpeg = o.ffmpeg === undefined ? FFMPEG() : o.ffmpeg;
  const res = await (o.fetch ?? fetch)(o.url || "https://api.openai.com/v1/audio/speech", { method: "POST",
    headers: { Authorization: `Bearer ${o.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: ttsVoice(o.voice), input: text.slice(0, 4000), instructions: TTS_INSTRUCTIONS,
      // wav converts cleanly to a voice note; without ffmpeg, OpenAI's own Opus (Ogg) goes as it is.
      response_format: ffmpeg ? "wav" : "opus" }),
    signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const audio = new Uint8Array(await res.arrayBuffer());
  if (!ffmpeg) { if (!isOggOpus(audio)) throw new Error("OpenAI's Opus audio wasn't Ogg."); return audio; }
  return toOggOpus(audio, ffmpeg);
}
