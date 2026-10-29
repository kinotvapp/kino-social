import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { track } from "../src/track.js";

let sent;
let status;
beforeEach(() => {
  sent = [];
  status = 200;
  const store = new Map([["session", "s"]]);
  globalThis.kino = {
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    tmdb: async (path) => (path.includes("/episode/") ? { still_path: "/still.jpg", name: "El final" } : { poster_path: "/p.jpg", adult: false }),
    fetch: async (url, init) => { sent.push(init.body.json); return { status, ok: status < 300, headers: {}, json: () => ({ added: 1 }) }; },
    error: (code, message) => Object.assign(new Error(message || code), { code }),
  };
});

const episode = { id: "e1", type: "watched", at: 5, kind: "episode", ids: {}, title: "Chapter Nine", season: 4, episode: 9,
  show: { title: "Stranger Things", ids: { tmdb: 66732 } }, progress: 0.97 };

test("a finished episode goes out on its own, with its still, name and the show's poster", async () => {
  await track(episode);
  const item = sent[0].items[0];
  assert.deepEqual({ ...item }, { kind: "series", tmdbId: 66732, title: "Stranger Things", season: 4, episode: 9,
    watchedAtMs: 5, poster: "https://image.tmdb.org/t/p/w342/p.jpg", still: "https://image.tmdb.org/t/p/w300/still.jpg", episodeTitle: "El final" });
});

test("only `watched` counts, and a title without a TMDB id is skipped", async () => {
  await track({ ...episode, type: "progress" });
  await track({ ...episode, show: { title: "X", ids: {} } });
  assert.equal(sent.length, 0);
});

test("without TMDB it still goes out, and a network failure asks Kino to retry", async () => {
  kino.tmdb = async () => { throw new Error("not_allowed"); };
  await track({ id: "m1", type: "watched", at: 7, kind: "movie", ids: { tmdb: 603 }, title: "Matrix" });
  assert.deepEqual({ ...sent[0].items[0] }, { kind: "movie", tmdbId: 603, title: "Matrix", watchedAtMs: 7 });
  status = 503;
  await assert.rejects(track({ id: "m2", type: "watched", at: 8, kind: "movie", ids: { tmdb: 604 }, title: "Reloaded" }), (e) => e.code === "network");
});
