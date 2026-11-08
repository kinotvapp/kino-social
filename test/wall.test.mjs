import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";

import { screenEvent } from "../src/events.js";
import { draftsBanner } from "../src/ui/views.js";
import { DRAFTS_KEY, MAX_DRAFTS, checkShare, cleanLink, postDraftNotices, proto_wall_share, readDrafts } from "../src/wall.js";

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
    tmdb: async (path) => {
      if (path === "/tv/209867") return { id: 209867, name: "Frieren", first_air_date: "2023-09-29", poster_path: "/f.jpg" };
      throw new Error("404");
    },
    fetch: async (url, opts) => {
      const json = opts && opts.body && opts.body.json;
      sent.push({ path: url.replace(/^https:\/\/[^/]+/, ""), json });
      return { status: 200, ok: true, headers: {}, json: () => ({ type: "post", id: 9, text: json && json.text, user: { id: 1, name: "Ana" } }) };
    },
  };
});

const FRIEREN = { kind: "series", tmdb: 209867, season: 1, episode: 3 };

test("a share is checked for meaning: something to post, a real title, an https link", () => {
  assert.equal(checkShare({}), "empty");
  assert.equal(checkShare({ text: "   " }), "empty");
  assert.equal(checkShare({ title: { kind: "song", tmdb: 1 } }), "bad_title");
  assert.equal(checkShare({ title: { kind: "movie", tmdb: 1.5 } }), "bad_title");
  assert.equal(checkShare({ link: "http://x.com/a" }), "bad_link");
  assert.equal(checkShare({ link: "https://user:pw@x.com" }), "bad_link");
  assert.equal(cleanLink("https://localhost/a"), null);
  const ok = checkShare({ text: "Mira\n\n\n\nesto\u0007", title: FRIEREN, from: "  Megaplay   anime " });
  assert.deepEqual(ok, { text: "Mira\n\nesto", title: { kind: "series", tmdb: 209867, season: 1, episode: 3 }, link: null, from: "Megaplay anime" });
  assert.equal(checkShare({ text: "x".repeat(900) }).text.length, 500);
  // A movie never carries an episode.
  assert.deepEqual(checkShare({ title: { kind: "movie", tmdb: 129, season: 1, episode: 2 } }).title, { kind: "movie", tmdb: 129 });
});

test("share keeps a draft, never posts, and answers what Kino validates", async () => {
  const out = await proto_wall_share({ text: "Viendo Frieren", title: FRIEREN, from: "Megaplay" });
  assert.equal(out.status, "draft");
  assert.equal(typeof out.draftId, "string");
  assert.equal(out.pending, 1);
  assert.equal(sent.length, 0, "nothing reaches the server");
  assert.equal(readDrafts()[0].from, "Megaplay");
  // The same proposal twice keeps one draft.
  const again = await proto_wall_share({ text: "Viendo Frieren", title: FRIEREN, from: "Megaplay" });
  assert.equal(again.draftId, out.draftId);
  assert.equal(readDrafts().length, 1);
  await assert.rejects(proto_wall_share({}), /empty/);
});

test("at most MAX_DRAFTS are kept, the oldest dropped", async () => {
  for (let i = 0; i < MAX_DRAFTS + 2; i++) await proto_wall_share({ text: "n" + i });
  const kept = readDrafts();
  assert.equal(kept.length, MAX_DRAFTS);
  assert.equal(kept[0].text, "n" + (MAX_DRAFTS + 1));
});

test("the job announces each draft once, opening its review", async () => {
  await proto_wall_share({ text: "Primero", from: "Megaplay" });
  await proto_wall_share({ link: "https://example.com/x" });
  assert.equal(await postDraftNotices(), 2);
  // Oldest first, so the newest ends on top of the bell.
  assert.equal(posted[0].title, "Megaplay quiere publicar en tu muro");
  assert.equal(posted[0].titleEn, "Megaplay wants to post on your wall");
  assert.equal(posted[1].title, "Tienes una publicación por revisar");
  assert.deepEqual(posted[0].go, { screen: { route: "draft", args: { id: readDrafts()[1].id } } });
  assert.equal(await postDraftNotices(), 0, "announced once");
});

test("Revisar fills the composer; Publicar sends it and the draft is gone", async () => {
  await proto_wall_share({ text: "Viendo Frieren", title: FRIEREN, link: "https://example.com/r", from: "Megaplay" });
  const id = readDrafts()[0].id;
  const review = await screenEvent({ name: "reviewDraft", arg: id, state: { feed: [] } });
  assert.deepEqual(review.ui, [{ open: "composer" }]);
  assert.equal(review.state.inputs.postText, "Viendo Frieren\nhttps://example.com/r");
  assert.equal(review.state.attach.title, "Frieren");
  assert.equal(review.state.attach.poster, "https://image.tmdb.org/t/p/w342/f.jpg");
  assert.equal(review.state.attach.season, 1);
  assert.equal(review.state.draftId, id);
  const out = await screenEvent({ name: "publish", state: { ...review.state, feed: [] } });
  assert.equal(sent.at(-1).path, "/posts");
  assert.equal(sent.at(-1).json.title.tmdbId, 209867);
  assert.equal(sent.at(-1).json.title.episode, 3);
  assert.equal(readDrafts().length, 0);
  assert.equal(out.state.draftId, null);
  assert.deepEqual(out.state.drafts, []);
});

test("Descartar drops a draft; a draft that is gone says so", async () => {
  await proto_wall_share({ text: "Algo" });
  const id = readDrafts()[0].id;
  const out = await screenEvent({ name: "discardDraft", arg: id, state: {} });
  assert.deepEqual(out.state.drafts, []);
  assert.equal(store.get(DRAFTS_KEY), "[]");
  const gone = await screenEvent({ name: "reviewDraft", arg: id, state: {} });
  assert.equal(gone.toast, "Ese borrador ya no está");
});

test("the feed's banner lists the drafts with their sender and both buttons", () => {
  assert.equal(draftsBanner({ drafts: [] }), null);
  const card = draftsBanner({ drafts: [{ id: "a", from: "Megaplay", text: "Hola", titled: true }] });
  const flat = JSON.stringify(card);
  assert.match(flat, /1 publicación por revisar/);
  assert.match(flat, /De Megaplay/);
  assert.match(flat, /"event":"reviewDraft","arg":"a"/);
  assert.match(flat, /"event":"discardDraft","arg":"a"/);
});

test("the manifest opens the wall door for Kino 0.9.81 without refusing older ones", () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  assert.equal(m.provides, undefined, "a top-level block would need apiVersion 20");
  const wall = m.enhancements["20"].provides.wall;
  assert.ok(wall.summary.length <= 120);
  assert.deepEqual(Object.keys(wall.calls), ["share"]);
});
