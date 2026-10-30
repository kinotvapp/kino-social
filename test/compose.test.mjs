import assert from "node:assert/strict";
import { test } from "node:test";

import { screenEvent } from "../src/events.js";

const DUNE = { kind: "movie", tmdbId: 693134, title: "Dune: Parte dos", year: 2024, poster: "https://image.tmdb.org/t/p/w342/d.jpg" };

/** A fake Kino: a saved session, no AI, a TMDB that knows Dune, and a server that echoes the post it got. */
function fakeKino(sent) {
  const store = new Map([["session", "s1"]]);
  globalThis.kino = {
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    tmdb: async (path) => {
      if (path === "/search/multi") return { results: [{ media_type: "movie", id: 693134, title: "Dune: Parte dos", release_date: "2024-02-27", poster_path: "/d.jpg" }] };
      throw new Error("404");
    },
    fetch: async (url, opts) => {
      const json = opts.body && opts.body.json;
      sent.push({ path: url.replace(/^https:\/\/[^/]+/, ""), json });
      return { status: 200, ok: true, headers: {}, json: () => ({ type: "post", id: 1, text: json.text, user: { id: 1, name: "Ana" } }) };
    },
  };
}

test("searching, attaching, and posting a title with no text", async () => {
  const sent = [];
  fakeKino(sent);
  const found = await screenEvent({ name: "searchTitles", value: "dune", state: { inputs: {} } });
  assert.deepEqual(found.state.pickResults, [DUNE]);
  const picked = await screenEvent({ name: "attachTitle", arg: "movie:693134", state: { pickResults: found.state.pickResults } });
  assert.deepEqual(picked.state.attach, DUNE);
  assert.equal(picked.state.picking, false);
  const out = await screenEvent({ name: "publish", state: { attach: DUNE, feed: [], inputs: { postText: "  " } } });
  assert.deepEqual(sent.at(-1), { path: "/posts", json: { text: "", title: DUNE } });
  assert.equal(out.state.attach, null);
  assert.equal(out.state.inputs.postText, "");
});

test("line breaks reach the server as written", async () => {
  const sent = [];
  fakeKino(sent);
  await screenEvent({ name: "publish", state: { attach: DUNE, feed: [], inputs: { postText: "Primera línea\nSegunda\n\nTercera" } } });
  assert.equal(sent.at(-1).json.text, "Primera línea\nSegunda\n\nTercera");
  await screenEvent({ name: "sendComment", state: { thread: { postId: "1", post: { id: 1 }, items: [] }, inputs: { commentText: "uno\ndos" } } });
  assert.deepEqual(sent.at(-1), { path: "/posts/1/comments", json: { text: "uno\ndos" } });
});

test("nothing is posted without text or a title, and clearing drops the attachment", async () => {
  const sent = [];
  fakeKino(sent);
  const out = await screenEvent({ name: "publish", state: { feed: [], inputs: { postText: " " } } });
  assert.equal(sent.length, 0);
  assert.ok(out.toast);
  assert.deepEqual((await screenEvent({ name: "clearAttach", state: { attach: DUNE } })).state, { attach: null });
  assert.equal(await screenEvent({ name: "attachTitle", arg: "movie:1", state: { pickResults: [DUNE] } }), null);
});
