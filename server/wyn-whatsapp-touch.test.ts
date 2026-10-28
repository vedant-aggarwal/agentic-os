// The cloud transport's reactions and voice notes, against a fake Graph API on a local port.
import { afterAll, expect, test } from "bun:test";
import { waRoute } from "./wyn-whatsapp";

const hits: { path: string; body: any; form?: Record<string, string> }[] = [];
const graph = Bun.serve({ port: 0, async fetch(req) {
  const path = new URL(req.url).pathname;
  if (path.endsWith("/media")) {
    const f = await req.formData();
    const file = f.get("file") as File;
    hits.push({ path, body: null, form: { messaging_product: String(f.get("messaging_product")), type: String(f.get("type")), file: `${file.type}:${file.size}` } });
    return Response.json({ id: "media-1" });
  }
  const body = await req.json();
  hits.push({ path, body });
  if (body.audio?.voice) return Response.json({ error: { code: 100, message: "Unexpected key voice" } }, { status: 400 });
  return Response.json({ messages: [{ id: `wamid.OUT${hits.length}` }] });
} });
afterAll(() => graph.stop(true));

const conf = (vals: Record<string, string>) => (k: string, d: string) => vals[k] ?? d;
const route = waRoute(conf({ WA_TRANSPORT: "cloud", WA_OWNER: "15555550100", WA_SECRET: "x".repeat(32), WA_PHONE_ID: "111", WA_TOKEN: "tok",
  WA_GRAPH_URL: `http://127.0.0.1:${graph.port}/v20.0` }));

test("a reaction goes as Meta's reaction message", async () => {
  const r = await route.transport!.react("15555550100", "wamid.IN1", "👍");
  expect(r.id).toMatch(/^wamid\.OUT/);
  expect(hits.at(-1)).toEqual({ path: "/v20.0/111/messages", body: { messaging_product: "whatsapp", to: "15555550100", type: "reaction", reaction: { message_id: "wamid.IN1", emoji: "👍" } } });
});

test("a voice note is uploaded, then sent as audio (without voice: true when the API refuses it)", async () => {
  hits.length = 0;
  const r = await route.transport!.sendAudio("15555550100", new Uint8Array(1234));
  expect(r.id).toMatch(/^wamid\.OUT/);
  expect(hits[0]).toMatchObject({ path: "/v20.0/111/media", form: { messaging_product: "whatsapp", type: "audio/ogg", file: "audio/ogg:1234" } });
  expect(hits[1].body.audio).toEqual({ id: "media-1", voice: true });
  expect(hits[2].body.audio).toEqual({ id: "media-1" });
});

test("read receipts can skip the typing dots", async () => {
  hits.length = 0;
  await route.transport!.markRead("wamid.IN2", false);
  await route.transport!.markRead("wamid.IN3");
  expect(hits[0].body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.IN2" });
  expect(hits[1].body.typing_indicator).toEqual({ type: "text" });
});
