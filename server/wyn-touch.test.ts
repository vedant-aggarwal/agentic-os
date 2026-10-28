import { expect, test } from "bun:test";
import { ackKind, asksSomething, speakable, spokenText, takeReaction, voiceMode, wantsVoice } from "./wyn-touch";

test("plain acks are spotted, in English, Hinglish and emoji", () => {
  for (const t of ["ok", "Ok.", "okay!", "k", "haan", "theek hai", "thik h", "cool", "👍", "👍🏽", "ok 👍", "achha", "got it"]) expect(ackKind(t)).toBe("ok");
  for (const t of ["thanks", "Thank you!", "thanks yaar", "ty", "shukriya", "🙏", "❤️", "ok thanks", "thanks 🙏"]) expect(ackKind(t)).toBe("thanks");
  for (const t of ["haha", "hahaha", "lol", "😂", "😂😂"]) expect(ackKind(t)).toBe("laugh");
  for (const t of ["done", "ho gaya", "Ho gya!", "kar diya", "ok done", "done ✅", "✅"]) expect(ackKind(t)).toBe("done");
});

test("anything with more to it is not an ack", () => {
  for (const t of ["ok but move gym to 7", "thanks, also add a task", "done with the deck, now what?", "ok?", "haan kal 7 baje", "", "no", "what",
    "ok ".repeat(20), "ho gaya kya?", "theek hai but remind me tomorrow"]) expect(ackKind(t)).toBeNull();
});

test("a question she asked makes his ok an answer", () => {
  expect(asksSomething("Gym 7 baje kar doon?")).toBe(true);
  expect(asksSomething("Task add kar doon")).toBe(true);
  expect(asksSomething("Kal ka plan batao")).toBe(true);
  expect(asksSomething("Phone pe dekh lo aur jo pasand aaye uska naam bata dena.")).toBe(true);
  expect(asksSomething("Kaunsa number? +91 ke saath bhej do.")).toBe(true);
  expect(asksSomething("Done, gym 7 baje pe hai.")).toBe(false);
  expect(asksSomething(null)).toBe(false);
});

test("reaction tags come off the reply", () => {
  expect(takeReaction("[react: 👍]")).toEqual({ emoji: "👍", text: "" });
  expect(takeReaction("[react:✅]\nGym ticked off.")).toEqual({ emoji: "✅", text: "Gym ticked off." });
  expect(takeReaction("Badhiya! [react: 🔥]")).toEqual({ emoji: "🔥", text: "Badhiya!" });
  expect(takeReaction("[Reaction: ❤️]")).toEqual({ emoji: "❤️", text: "" });
  expect(takeReaction("No tag here")).toEqual({ emoji: null, text: "No tag here" });
  expect(takeReaction("[react: ok]").emoji).toBeNull();
});

test("voice replies: mirror by default, never for links or long lists", () => {
  expect(voiceMode(undefined)).toBe("mirror");
  expect(voiceMode("always")).toBe("always");
  expect(voiceMode("loud")).toBe("mirror");
  expect(wantsVoice("mirror", true, "Haan, ho jayega.")).toBe(true);
  expect(wantsVoice("mirror", false, "Haan, ho jayega.")).toBe(false);
  expect(wantsVoice("always", false, "Haan, ho jayega.")).toBe(true);
  expect(wantsVoice("off", true, "Haan")).toBe(false);
  expect(speakable("Dekho https://x.com")).toBe(false);
  expect(speakable("- a\n- b\n- c\n- d")).toBe(false);
  expect(speakable("x".repeat(1300))).toBe(false);
  expect(spokenText("[react: 👍] Badhiya 🔥 kaam\n\n\nkal milte")).toBe("Badhiya kaam\n\nkal milte");
});
