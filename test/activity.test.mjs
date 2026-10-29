import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { syncActivity } from "../src/activity.js";

let sent;
let watched;
beforeEach(() => {
  sent = [];
  const store = new Map([["session", "s"]]);
  globalThis.kino = {
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    library: { watched: async () => watched },
    tmdb: async () => ({ poster_path: "/p.jpg", adult: false }),
    fetch: async (url, init) => { sent.push(init.body.json); return { status: 200, ok: true, headers: {}, json: () => ({ ok: true }) }; },
  };
});

test("only what the person finished goes out, whatever type the TMDB id comes as", async () => {
  watched = [
    { title: "Matrix", kind: "movie", ids: { tmdb: 603 }, progress: 1, watchedAtMs: 1 },
    { title: "Dune", kind: "movie", ids: { tmdb: "438631" }, progress: 0.95, watchedAtMs: 1 },
    { title: "Half", kind: "movie", ids: { tmdb: 11 }, progress: 0.4, watchedAtMs: 1 },
    { title: "Dark", kind: "series", ids: { tmdb: 70523 }, progress: 0.3, season: 1, episode: 2, watchedAtMs: 1 },
  ];
  assert.equal(await syncActivity(1e12), 2);
  assert.deepEqual(sent[0].items.map((i) => i.tmdbId), [603, 438631]);
});

test("when TMDB cannot say whether a title is 18+, it does not go out and is asked again later", async () => {
  watched = [{ title: "?", kind: "movie", ids: { tmdb: 77 }, progress: 1, watchedAtMs: 1 }];
  kino.tmdb = async () => { throw new Error("offline"); };
  assert.equal(await syncActivity(1e12), 0);
  assert.equal(sent.length, 0);
  kino.tmdb = async () => ({ poster_path: null, adult: false });
  assert.equal(await syncActivity(1e12 + 11 * 60_000), 1);
});
