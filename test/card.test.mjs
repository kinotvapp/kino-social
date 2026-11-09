import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { postBody } from "../src/attach.js";
import { callerOf, checkCard, plainRepo } from "../src/card.js";
import { screenEvent } from "../src/events.js";
import { decodeBase64, imageSize } from "../src/imagesize.js";
import { draftsBanner, mainView } from "../src/ui/views.js";
import { draftCard, draftImage, postDraftNotices, proto_wall_card, proto_wall_share, readDrafts } from "../src/wall.js";

let store;
let posted;
let sent;
beforeEach(() => {
  store = new Map([["session", "s1"]]);
  posted = [];
  sent = [];
  globalThis.kino = {
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    notifications: { post: async (n) => posted.push(n) },
    fetch: async (url, opts) => {
      sent.push({ path: url.replace(/^https:\/\/[^/]+/, ""), json: opts && opts.body && opts.body.json });
      return { status: 200, ok: true, headers: {}, json: () => ({}) };
    },
  };
});

const CALLER = { caller: { id: "share-test-opener", repo: "kinotvapp/kino-plugin-share-test/opener@v2", name: "Prueba", adult: false } };

// ---- real images, built byte by byte ---------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A PNG of [w]x[h] (header, an IDAT of [idat] bytes and IEND: enough for any header reader), as base64. */
function pngB64(w, h, idat = 0) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", Buffer.alloc(idat, 7)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
const pngUri = (w, h, idat = 0) => "data:image/png;base64," + pngB64(w, h, idat);
/** A JPEG of [w]x[h] whose frame header sits after an APP1 (EXIF-like) segment of [appBytes] bytes. */
function jpegBytes(w, h, appBytes) {
  const app = Buffer.alloc(2 + 2 + appBytes);
  app.set([0xff, 0xe1], 0);
  app.writeUInt16BE(appBytes + 2, 2);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), app, sof, Buffer.from([0xff, 0xd9])]));
}

// ---- tests -----------------------------------------------------------------------------------------------------------

test("imageSize reads PNG and JPEG headers, past APP segments", () => {
  assert.deepEqual(imageSize(decodeBase64(pngB64(120, 180))), { mime: "image/png", width: 120, height: 180 });
  assert.deepEqual(imageSize(jpegBytes(200, 300, 9000)), { mime: "image/jpeg", width: 200, height: 300 });
  assert.equal(imageSize(new Uint8Array([0x47, 0x49, 0x46])), null);
  assert.equal(decodeBase64("!!"), null);
  assert.deepEqual([...decodeBase64("aGk=")], [104, 105]);
  assert.equal(decodeBase64("aGk"), null, "unpadded base64 is refused, as the server does");
});

test("callerOf cuts @ref and needs ctx", () => {
  assert.deepEqual(callerOf(CALLER), { id: "share-test-opener", repo: "kinotvapp/kino-plugin-share-test/opener", name: "Prueba", adult: false });
  assert.equal(callerOf(undefined), null);
  assert.equal(callerOf({ caller: { id: "x", repo: null, name: "Local", adult: false } }).repo, null);
  assert.equal(plainRepo("Owner/Name@main"), "Owner/Name");
  assert.equal(plainRepo("https://x.com/a"), null);
  assert.equal(plainRepo("owner/../x"), null);
  assert.equal(plainRepo("owner"), null);
});

test("callerOf fails closed on 18+: only an explicit adult: false is not 18+", () => {
  assert.equal(callerOf({ caller: { id: "x", repo: "a/b", name: "X" } }).adult, true);
  assert.equal(callerOf({ caller: { id: "x", repo: "a/b", name: "X", adult: null } }).adult, true);
  assert.equal(callerOf({ caller: { id: "x", repo: "a/b", name: "X", adult: "false" } }).adult, true);
  assert.equal(callerOf({ caller: { id: "x", repo: "a/b", name: "X", adult: false } }).adult, false);
});

test("a route's argsJson longer than 1 KB is refused before it is parsed", () => {
  // Compact it would fit; as sent it is too long, and is never parsed.
  assert.equal(checkCard({ title: "x", route: { name: "item", argsJson: '{"id":"42"' + " ".repeat(1100) + "}" } }), "bad_route");
});

test("checkCard cuts lengths and refuses what is malformed", () => {
  const ok = checkCard({ title: "  Frieren ", description: "d".repeat(300), query: "q".repeat(150), text: "t".repeat(900),
    image: "https://image.tmdb.org/t/p/w780/x.jpg", route: { name: "item", argsJson: '{"id":"42"}' } });
  assert.equal(ok.card.title, "Frieren");
  assert.equal(ok.card.description.length, 200);
  assert.equal(ok.card.query.length, 100);
  assert.equal(ok.text.length, 500);
  assert.equal(ok.card.image, "https://image.tmdb.org/t/p/w780/x.jpg");
  assert.deepEqual(ok.card.route, { name: "item", args: { id: "42" } });
  assert.equal(checkCard({ title: "   " }), "bad_title");
  assert.equal(checkCard({ title: "x", image: "http://a.com/x.jpg" }), "bad_image");
  assert.equal(checkCard({ title: "x", image: pngUri(201, 10) }), "bad_image");
  assert.equal(checkCard({ title: "x", image: "data:image/jpeg;base64," + pngB64(10, 10) }), "bad_image", "the mime must match the bytes");
  assert.equal(checkCard({ title: "x", image: pngUri(200, 10) }).card.image, pngUri(200, 10));
  assert.equal(checkCard({ title: "x", route: { name: "bad route" } }), "bad_route");
  assert.equal(checkCard({ title: "x", route: { name: "item", argsJson: "[1]" } }), "bad_route");
  assert.equal(checkCard({ title: "x", route: { name: "item", argsJson: "{" } }), "bad_route");
  assert.equal(checkCard({ title: "x", route: { name: "item", argsJson: JSON.stringify({ k: "x".repeat(1100) }) } }), "bad_route");
  assert.deepEqual(checkCard({ title: "x", route: { name: "item" } }).card.route, { name: "item", args: {} });
  assert.deepEqual(checkCard({ title: "x" }).card, { title: "x" });
  // Kino's door reads null as absent.
  assert.deepEqual(checkCard({ title: "x", description: null, image: null, route: null, query: null, text: null }), { card: { title: "x" }, text: "" });
});

test("card keeps a draft stamped with the real caller, never posts", async () => {
  const out = await proto_wall_card({ title: "Frieren", text: "Mírala", route: { name: "item", argsJson: '{"id":"42"}' } }, CALLER);
  assert.deepEqual(Object.keys(out).sort(), ["draftId", "pending", "status"]);
  assert.equal(out.status, "draft");
  assert.equal(sent.length, 0);
  const d = readDrafts()[0];
  assert.equal(d.kind, "card");
  assert.deepEqual(d.caller, { id: "share-test-opener", repo: "kinotvapp/kino-plugin-share-test/opener", name: "Prueba" });
  assert.equal(d.from, "Prueba");
  assert.equal(d.direct, false);
  assert.equal((await proto_wall_card({ title: "Frieren", text: "Mírala", route: { name: "item", argsJson: '{"id":"42"}' } }, CALLER)).draftId, out.draftId);
  assert.equal(readDrafts().length, 1);
  assert.equal((await proto_wall_card({ title: "Frieren", publish: true }, CALLER)).pending, 2);
  assert.equal(readDrafts()[0].direct, true);
});

test("card refuses an 18+ caller, a Kino without ctx, and a bad card", async () => {
  await assert.rejects(proto_wall_card({ title: "x" }, { caller: { ...CALLER.caller, adult: true } }), /adult_caller/);
  await assert.rejects(proto_wall_card({ title: "x" }), /no_caller/);
  await assert.rejects(proto_wall_card({ title: "" }, CALLER), /bad_title/);
  assert.equal(readDrafts().length, 0);
});

test("share keeps working without ctx and names the real caller with it", async () => {
  await proto_wall_share({ text: "a", from: "Dice ser otro" });
  assert.equal(readDrafts()[0].from, "Dice ser otro");
  assert.equal(readDrafts()[0].caller, undefined);
  await proto_wall_share({ text: "b", from: "Dice ser otro", publish: true }, CALLER);
  assert.equal(readDrafts()[0].from, "Prueba");
  assert.deepEqual(readDrafts()[0].caller, { id: "share-test-opener", repo: "kinotvapp/kino-plugin-share-test/opener", name: "Prueba" });
  assert.equal(readDrafts()[0].direct, true);
});

test("a card draft's notice and banner name the card", async () => {
  await proto_wall_card({ title: "Frieren" }, CALLER);
  await postDraftNotices();
  assert.equal(posted[0].title, "Prueba quiere publicar en tu muro");
  assert.equal(posted[0].text, "Frieren");
  const flat = JSON.stringify(draftsBanner({ drafts: [{ id: "a", from: "Prueba", text: "Frieren", carded: true }] }));
  assert.match(flat, /Con una tarjeta de Prueba/);
  assert.match(flat, /With a card from Prueba/);
});

// ---- review and publish (Task 4) -------------------------------------------------------------------------------------

test("review turns an https image into a thumbnail and keeps the state small", async () => {
  globalThis.kino.image = { thumbnail: async (url, o) => { assert.deepEqual(o, { maxWidth: 200, maxBytes: 16384 }); return pngUri(200, 300); } };
  await proto_wall_card({ title: "Frieren", text: "Mírala", image: "https://image.tmdb.org/t/p/w780/x.jpg" }, CALLER);
  const id = readDrafts()[0].id;
  const review = await screenEvent({ name: "reviewDraft", arg: id, state: { feed: [] } });
  assert.equal(review.state.inputs.postText, "Mírala");
  assert.deepEqual(review.state.attachCard, { draftId: id, title: "Frieren", plugin: { repo: "kinotvapp/kino-plugin-share-test/opener", name: "Prueba" } });
  assert.ok(!JSON.stringify(review.state).includes("data:"), "review state never carries a data: image");
  assert.ok(draftImage(id).startsWith("data:image/png;base64,"));
});

test("a reviewed card with a 16 KB thumbnail leaves the screen state far under 64 KB", async () => {
  const big = pngUri(200, 300, 16000);
  assert.ok(decodeBase64(big.split(",")[1]).length > 16000);
  await proto_wall_card({ title: "Frieren", description: "d".repeat(200), text: "t".repeat(500), image: big }, CALLER);
  const id = readDrafts()[0].id;
  const review = await screenEvent({ name: "reviewDraft", arg: id, state: { feed: [] } });
  const size = JSON.stringify(review.state).length;
  assert.ok(size < 2048, "state is " + size + " characters");
  assert.ok(!JSON.stringify(review.state).includes("data:"));
  assert.equal(draftImage(id), big);
});

test("a thumbnail Kino answers out of rule is not kept", async () => {
  globalThis.kino.image = { thumbnail: async () => pngUri(400, 600) };
  await proto_wall_card({ title: "Frieren", image: "https://image.tmdb.org/t/p/w780/x.jpg" }, CALLER);
  await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  assert.equal(draftImage(readDrafts()[0].id), "https://image.tmdb.org/t/p/w780/x.jpg");
});

test("review keeps the https image when Kino cannot make a thumbnail", async () => {
  delete globalThis.kino.image;
  await proto_wall_card({ title: "Frieren", image: "https://image.tmdb.org/t/p/w780/x.jpg" }, CALLER);
  await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  assert.equal(draftImage(readDrafts()[0].id), "https://image.tmdb.org/t/p/w780/x.jpg");
  globalThis.kino.image = { thumbnail: async () => { throw new Error("no"); } };
  await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  assert.equal(draftImage(readDrafts()[0].id), "https://image.tmdb.org/t/p/w780/x.jpg");
  assert.equal(draftImage("nope"), null);
});

test("the composer shows the card under the text, without the attach button", async () => {
  await proto_wall_card({ title: "Frieren", description: "Una maga elfa" }, CALLER);
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  const flat = JSON.stringify(mainView({ me: { id: 1, name: "Ana", handle: "ana" }, feed: [], ...review.state }, { device: "phone" }));
  assert.match(flat, /Frieren/); assert.match(flat, /Una maga elfa/); assert.match(flat, /De Prueba/);
  assert.match(flat, /"key":"clearCard"/);
  assert.doesNotMatch(flat, /"key":"openAttach"/);
  assert.match(flat, /"key":"postText"[^}]*"required":false/);
  assert.match(flat, /Quitar tarjeta/);
});

test("the composer draws the card's image from the stored draft", async () => {
  await proto_wall_card({ title: "Frieren", image: pngUri(100, 150) }, CALLER);
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  const flat = JSON.stringify(mainView({ me: { id: 1, name: "Ana", handle: "ana" }, feed: [], ...review.state }, { device: "tv" }));
  assert.ok(flat.includes(pngUri(100, 150)));
});

test("Publicar sends the card and the person's own words; the draft goes", async () => {
  await proto_wall_card({ title: "Frieren", route: { name: "item", argsJson: '{"id":"42"}' } }, CALLER);
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: { feed: [] } });
  const out = await screenEvent({ name: "publish", values: { postText: "Mi comentario" }, state: { ...review.state, feed: [] } });
  const body = sent.at(-1).json;
  assert.equal(body.text, "Mi comentario");
  assert.deepEqual(body.card, { plugin: { repo: "kinotvapp/kino-plugin-share-test/opener", name: "Prueba" }, title: "Frieren",
    route: { name: "item", args: { id: "42" } }, query: "Frieren" });
  assert.equal(body.title, undefined); assert.equal(body.link, undefined);
  assert.equal(readDrafts().length, 0);
  assert.equal(out.state.attachCard, null);
});

test("Publicar sends the stored thumbnail and the card's own query", async () => {
  await proto_wall_card({ title: "Frieren", description: "Una maga elfa", query: "Sousou no Frieren", image: pngUri(100, 150) }, CALLER);
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  await screenEvent({ name: "publish", values: { postText: "" }, state: review.state });
  assert.deepEqual(sent.at(-1).json.card, { plugin: { repo: "kinotvapp/kino-plugin-share-test/opener", name: "Prueba" }, title: "Frieren",
    description: "Una maga elfa", image: pngUri(100, 150), query: "Sousou no Frieren" });
});

test("an empty comment is fine; a removed card posts text only; bad_card is a toast", async () => {
  await proto_wall_card({ title: "Frieren" }, CALLER);
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  await screenEvent({ name: "publish", values: { postText: "" }, state: review.state });
  assert.equal(sent.at(-1).json.text, "");
  assert.equal(sent.at(-1).json.card.title, "Frieren");
  const cleared = await screenEvent({ name: "clearCard", state: review.state });
  assert.deepEqual(cleared, { state: { attachCard: null, draftId: null }, focus: "openAttach" });
  // Without the card, the text alone goes, and never a `card: null` (the server refuses one).
  await screenEvent({ name: "publish", values: { postText: "Solo texto" }, state: { ...review.state, ...cleared.state } });
  assert.equal(sent.at(-1).json.text, "Solo texto");
  assert.ok(!("card" in sent.at(-1).json));
  assert.ok(!("card" in postBody({ text: "x" })));
  assert.ok(!("card" in postBody({ text: "x", card: null })));
});

test("a text-only post after «Quitar tarjeta» keeps the card draft", async () => {
  await proto_wall_card({ title: "Frieren" }, CALLER);
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  const cleared = await screenEvent({ name: "clearCard", state: review.state });
  await screenEvent({ name: "publish", values: { postText: "Otra cosa" }, state: { ...review.state, ...cleared.state } });
  assert.ok(!("card" in sent.at(-1).json));
  assert.equal(readDrafts().length, 1);
});

test("a long title with no query sends a query within the server's 100", async () => {
  const title = "T".repeat(110);
  await proto_wall_card({ title }, CALLER);
  assert.equal(readDrafts()[0].card.title, title);
  assert.equal(draftCard(readDrafts()[0]).query.length, 100);
  assert.equal(draftCard({ card: { title: "x", query: "q" }, caller: CALLER.caller }).query, "q");
});

test("the card's plugin name is never empty", () => {
  assert.equal(draftCard({ card: { title: "x" }, caller: { id: "local-id", repo: null, name: "" } }).plugin.name, "local-id");
  assert.equal(draftCard({ card: { title: "x" }, caller: { id: "", repo: null, name: "" }, from: "" }).plugin.name, "Plugin");
  assert.equal(draftCard({ card: { title: "x" } }).plugin.name, "Plugin");
  assert.equal(draftCard({ card: { title: "x" }, caller: { id: "i", repo: "a/b", name: "Prueba" } }).plugin.name, "Prueba");
});

test("a card whose draft is gone is a toast, not a post", async () => {
  await proto_wall_card({ title: "Frieren" }, CALLER);
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  store.delete("wallDrafts1");
  const out = await screenEvent({ name: "publish", values: { postText: "x" }, state: review.state });
  assert.equal(out.toast, "Ese borrador ya no está");
  assert.equal(sent.length, 0);
});

test("a card the server refuses is a toast, and the draft stays", async () => {
  await proto_wall_card({ title: "Frieren" }, CALLER);
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  globalThis.kino.fetch = async () => ({ status: 400, ok: false, headers: {}, json: () => ({ error: "bad_card" }) });
  const out = await screenEvent({ name: "publish", values: { postText: "x" }, state: review.state });
  assert.equal(out.toast, "Esta tarjeta no se puede publicar");
  assert.equal(out.toastEn, "This card can't be posted");
  assert.equal(out.state, undefined, "the composer keeps the card and the words");
  assert.equal(readDrafts().length, 1);
});

test("reviewing a share draft after a card leaves no card behind", async () => {
  await proto_wall_share({ text: "hola" });
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: { attachCard: { draftId: "x", title: "y" } } });
  assert.equal(review.state.attachCard, null);
});

// ---- final review ----------------------------------------------------------------------------------------------------

test("an https image on the server's 18+ list, or with a character Python reads as a space, is refused at card time", () => {
  for (const image of ["https://pornhub.com/a.jpg", "https://cdn.XVideos.com/a.jpg", "https://onlyfans.com./a.jpg",
    "https://chaturbate.com:443/a.jpg", "https://xnxx.com?x.jpg", "https://a.com/x\u001cy.jpg", "https://a.com/x\u001fy.jpg",
    "https://a.com/x\u0085y.jpg"]) {
    assert.equal(checkCard({ title: "x", image }), "bad_image", JSON.stringify(image));
  }
  // A look-alike host is not on the list.
  assert.equal(checkCard({ title: "x", image: "https://notpornhub.com/a.jpg" }).card.image, "https://notpornhub.com/a.jpg");
  assert.equal(checkCard({ title: "x", image: "https://img.example.com/pornhub.com.jpg" }).card.image, "https://img.example.com/pornhub.com.jpg");
});

test("a full storage never answers a draft that was not kept: the image goes first, then provider_failed", async () => {
  const set = globalThis.kino.storage.set;
  globalThis.kino.storage.set = (k, v) => { if (k === "wallDrafts1" && v.length > 4000) throw new Error("full"); return set(k, v); };
  const out = await proto_wall_card({ title: "Frieren", image: pngUri(100, 100, 6000) }, CALLER);
  assert.equal(out.status, "draft");
  const d = readDrafts().find((x) => x.id === out.draftId);
  assert.ok(d, "the answered draft is in storage");
  assert.equal(d.card.image, undefined, "kept without its picture");
  assert.equal(d.card.title, "Frieren");
  globalThis.kino.storage.set = () => { throw new Error("full"); };
  await assert.rejects(proto_wall_card({ title: "Otra" }, CALLER), /storage_full/);
  await assert.rejects(proto_wall_share({ text: "hola" }, CALLER), /storage_full/);
});
