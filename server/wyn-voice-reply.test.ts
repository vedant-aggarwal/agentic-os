import { expect, test } from "bun:test";
import { hasFfmpeg, isOggOpus, speak, toOggOpus, ttsVoice, TTS_INSTRUCTIONS } from "./wyn-voice-reply";

/** One second of a 440 Hz tone, 24 kHz mono 16-bit WAV: what OpenAI TTS returns with response_format wav. */
function wav(seconds = 1, rate = 24000) {
  const n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return new Uint8Array(b);
}

test("her voice: a female call voice carries over, a male one falls back to marin", () => {
  expect(ttsVoice("coral")).toBe("coral");
  expect(ttsVoice("Marin")).toBe("marin");
  expect(ttsVoice("cedar")).toBe("marin");
  expect(ttsVoice("")).toBe("marin");
});

test.skipIf(!hasFfmpeg())("WAV becomes a mono 48 kHz Ogg/Opus voice note", async () => {
  const ogg = await toOggOpus(wav(2));
  expect(isOggOpus(ogg)).toBe(true);
  // OpusHead: version, channel count at byte 9, input rate at bytes 12-15.
  const at = Buffer.from(ogg).indexOf("OpusHead");
  expect(ogg[at + 9]).toBe(1);
  expect(Buffer.from(ogg).readUInt32LE(at + 12)).toBe(48000);
  // 2 s at 32 kbit/s is about 8 KB; well under WhatsApp's 16 MB.
  expect(ogg.length).toBeLessThan(20_000);
});

test.skipIf(!hasFfmpeg())("garbage in fails clearly", async () => {
  await expect(toOggOpus(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/ffmpeg couldn't convert/);
});

test.skipIf(!hasFfmpeg())("speak asks gpt-4o-mini-tts for wav in her voice and returns Ogg/Opus", async () => {
  let sent: any = null, auth = "";
  const fake = (async (_url: string, init: any) => { sent = JSON.parse(init.body); auth = init.headers.Authorization; return new Response(wav(1)); }) as any;
  const ogg = await speak("Haan, ho jayega. Kal 7 baje.", { key: "sk-test", voice: "cedar", fetch: fake });
  expect(isOggOpus(ogg)).toBe(true);
  expect(auth).toBe("Bearer sk-test");
  expect(sent).toMatchObject({ model: "gpt-4o-mini-tts", voice: "marin", response_format: "wav", instructions: TTS_INSTRUCTIONS });
});

test("speak without ffmpeg takes OpenAI's own Opus, and refuses anything else", async () => {
  const fake = (async () => new Response(new Uint8Array([0, 1, 2]))) as any;
  await expect(speak("hi", { key: "sk-test", voice: "marin", fetch: fake, ffmpeg: null })).rejects.toThrow(/wasn't Ogg/);
  await expect(speak("hi", { key: "", voice: "marin", fetch: fake })).rejects.toThrow(/No OpenAI key/);
});
