import assert from "node:assert/strict";
import { test } from "node:test";

import { call } from "../src/api.js";

const bare = (id, extra = {}) => ({ type: "post", id, text: "", link: { url: "https://www.themoviedb.org/movie/76600", title: "Avatar 2", site: "TMDB", tmdb: { kind: "movie", id: 76600 }, ...extra } });

function fakeKino(items, asked) {
  const store = new Map([["session", "s1"]]);
  globalThis.kino = {
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    tmdb: async (path, opts) => {
      asked.push([path, opts && opts.language]);
      return opts && opts.language === "en" ? { poster_path: "/t6HIsrkSEQJAgiJO8aavRHFXgGM.jpg" } : { poster_path: null };
    },
    fetch: async () => ({ status: 200, ok: true, headers: {}, json: () => ({ items: JSON.parse(JSON.stringify(items)) }) }),
  };
}

test("a card of a TMDB title the server kept without a poster gets it from Kino's TMDB, once, then from the device's memory", async () => {
  const asked = [];
  fakeKino([bare(1), bare(2), bare(3, { image: "https://image.tmdb.org/t/p/w342/has.jpg" })], asked);
  const page = await call("/feed");
  assert.equal(page.items[0].link.image, "https://image.tmdb.org/t/p/w342/t6HIsrkSEQJAgiJO8aavRHFXgGM.jpg");
  assert.equal(page.items[1].link.image, page.items[0].link.image);
  assert.equal(page.items[2].link.image, "https://image.tmdb.org/t/p/w342/has.jpg", "a card that has one is left alone");
  const first = asked.length;
  assert.ok(first > 0 && first <= 2, "one title is asked once for all its cards");
  await call("/feed");
  assert.equal(asked.length, first, "the second page comes from the saved poster");
});

test("no TMDB, or a TMDB that fails: the cards stay as the server sent them and nothing throws", async () => {
  fakeKino([bare(1)], []);
  delete globalThis.kino.tmdb;
  assert.equal((await call("/feed")).items[0].link.image, undefined);
  fakeKino([bare(1)], []);
  globalThis.kino.tmdb = async () => { throw new Error("offline"); };
  assert.equal((await call("/feed")).items[0].link.image, undefined);
});

test("the posts of a profile (its own feed of posts) get their posters too", async () => {
  const asked = [];
  const store = new Map([["session", "s1"]]);
  globalThis.kino = {
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    tmdb: async (path, opts) => { asked.push(path); return opts && opts.language === "en" ? { poster_path: "/p.jpg" } : { poster_path: null }; },
    fetch: async () => ({ status: 200, ok: true, headers: {}, json: () => ({ user: { id: 10 }, posts: [bare(1, { tmdb: { kind: "movie", id: 603 } })], activity: [] }) }),
  };
  const profile = await call("/users/10");
  assert.equal(profile.posts[0].link.image, "https://image.tmdb.org/t/p/w342/p.jpg");
});
