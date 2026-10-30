import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attachKey, canPublish, cleanQuery, fromTmdb, MAX_RESULTS, pickAttachment, postBody, recentFromLibrary, recentTitles, searchResults,
  searchTitles, validAttachment,
} from "../src/attach.js";

const DUNE = { kind: "movie", tmdbId: 693134, title: "Dune: Parte dos", year: 2024, poster: "https://image.tmdb.org/t/p/w342/d.jpg" };
const ST = { kind: "series", tmdbId: 66732, title: "Stranger Things", year: 2016, poster: "https://image.tmdb.org/t/p/w342/s.jpg" };

const MULTI = { results: [
  { media_type: "movie", id: 693134, title: "Dune: Parte dos", release_date: "2024-02-27", poster_path: "/d.jpg" },
  { media_type: "person", id: 5, name: "Zendaya" },
  { media_type: "tv", id: 66732, name: "Stranger Things", first_air_date: "2016-07-15", poster_path: "/s.jpg" },
  { media_type: "movie", id: 7, title: "Algo 18+", adult: true, poster_path: "/x.jpg" },
  { media_type: "movie", id: 693134, title: "Dune: Parte dos (dup)" },
  { media_type: "movie", id: 8, title: "", release_date: "2020" },
  { media_type: "movie", id: -1, title: "Bad id" },
  { media_type: "movie", id: 9, title: "Sin fecha", release_date: "", poster_path: "javascript:alert(1)" },
] };

test("search results: movies and series only, never adult, deduplicated, with year and TMDB poster", () => {
  assert.deepEqual(searchResults(MULTI), [DUNE, ST, { kind: "movie", tmdbId: 9, title: "Sin fecha" }]);
  assert.deepEqual(searchResults(null), []);
  assert.deepEqual(searchResults({ results: "no" }), []);
  const many = { results: Array.from({ length: 30 }, (_, i) => ({ media_type: "movie", id: i + 1, title: "T" + i })) };
  assert.equal(searchResults(many).length, MAX_RESULTS);
  // /search/movie or /search/tv answers carry no media_type: the kind comes from the caller.
  assert.deepEqual(searchResults({ results: [{ id: 66732, name: "Stranger Things", first_air_date: "2016-07-15" }] }, "series"),
    [{ kind: "series", tmdbId: 66732, title: "Stranger Things", year: 2016 }]);
});

test("a TMDB details object becomes the same shape titlelink builds", () => {
  assert.deepEqual(fromTmdb({ id: 693134, title: "Dune: Parte dos", release_date: "2024-02-27", poster_path: "/d.jpg" }, "movie"), DUNE);
  assert.equal(fromTmdb({ id: 1, title: "X", adult: true }, "movie"), null);
  assert.equal(fromTmdb({ id: 1, title: "X" }, "person"), null);
  assert.equal(fromTmdb(null, "movie"), null);
  assert.equal(fromTmdb({ id: 1, title: "x".repeat(300) }, "movie").title.length, 120);
});

test("recent titles from the library: only with a TMDB id, newest first, once each", () => {
  const entries = [
    { title: "Dune", kind: "movie", ids: { tmdb: 693134 }, progress: 0.4 },
    { title: "Sin id", kind: "movie", ids: {} },
    { title: "ST", kind: "series", ids: { tmdb: 66732 }, season: 4, episode: 2 },
    { title: "Dune otra vez", kind: "movie", ids: { tmdb: 693134 } },
    { title: "Raro", kind: "episode", ids: { tmdb: 3 } },
  ];
  assert.deepEqual(recentFromLibrary(entries), [{ kind: "movie", tmdbId: 693134 }, { kind: "series", tmdbId: 66732 }]);
  assert.deepEqual(recentFromLibrary(undefined), []);
});

test("recentTitles asks TMDB for each and leaves out 18+ and unknown titles", async () => {
  globalThis.kino = {
    library: { watched: async () => [
      { title: "Dune", kind: "movie", ids: { tmdb: 693134 } },
      { title: "X", kind: "movie", ids: { tmdb: 1 } },
      { title: "Lost", kind: "movie", ids: { tmdb: 404 } },
      { title: "ST", kind: "series", ids: { tmdb: 66732 } },
    ] },
    tmdb: async (path) => {
      if (path === "/movie/693134") return { id: 693134, title: "Dune: Parte dos", release_date: "2024-02-27", poster_path: "/d.jpg" };
      if (path === "/tv/66732") return { id: 66732, name: "Stranger Things", first_air_date: "2016-07-15", poster_path: "/s.jpg" };
      if (path === "/movie/1") return { id: 1, title: "X", adult: true };
      throw new Error("404");
    },
  };
  assert.deepEqual(await recentTitles(), [DUNE, ST]);
  globalThis.kino = { tmdb: async () => ({}) };
  assert.deepEqual(await recentTitles(), []);
  globalThis.kino = { library: { watched: async () => { throw new Error("permission_denied"); } }, tmdb: async () => ({}) };
  assert.deepEqual(await recentTitles(), []);
});

test("searchTitles asks /search/multi without adult titles", async () => {
  let asked;
  globalThis.kino = { tmdb: async (path, params) => { asked = { path, params }; return MULTI; } };
  assert.equal((await searchTitles("dune")).length, 3);
  assert.equal(asked.path, "/search/multi");
  assert.equal(asked.params.include_adult, false);
  assert.equal(asked.params.query, "dune");
  globalThis.kino = {};
  assert.deepEqual(await searchTitles("dune"), []);
});

test("cleanQuery waits for two letters", () => {
  assert.equal(cleanQuery(" d "), "");
  assert.equal(cleanQuery("  dune   parte "), "dune parte");
  assert.equal(cleanQuery("x".repeat(200)).length, 80);
  assert.equal(cleanQuery(undefined), "");
});

test("picking and clearing an attachment", () => {
  const results = searchResults(MULTI);
  assert.deepEqual(pickAttachment(attachKey(ST), results, null), ST);
  assert.deepEqual(pickAttachment("movie:693134", null, [DUNE]), DUNE);
  assert.equal(pickAttachment("movie:5", results, [DUNE]), null);
  assert.equal(pickAttachment(undefined, results), null);
  assert.equal(validAttachment(DUNE), true);
  assert.equal(validAttachment(null), false);
  assert.equal(validAttachment({ ...DUNE, kind: "tv" }), false);
  assert.equal(validAttachment({ ...DUNE, title: " " }), false);
});

test("a post needs text or an attached title", () => {
  assert.equal(canPublish("", null), false);
  assert.equal(canPublish("  \n ", undefined), false);
  assert.equal(canPublish("hola", null), true);
  assert.equal(canPublish("", DUNE), true);
  assert.equal(canPublish("", { kind: "person", tmdbId: 1, title: "x" }), false);
});

test("the post body: the attachment is the title unless a TMDB or IMDb link in the text brought one", () => {
  assert.deepEqual(postBody({ text: "La vi\nanoche", attach: DUNE }), { text: "La vi\nanoche", title: DUNE });
  assert.deepEqual(postBody({ text: "", attach: ST, communityId: "12" }), { text: "", title: ST, communityId: 12 });
  assert.deepEqual(postBody({ text: "hola" }), { text: "hola" });
  const linked = { ...DUNE, tmdbId: 1, title: "Del enlace" };
  assert.deepEqual(postBody({ text: "https://www.themoviedb.org/movie/1", linkTitle: linked, attach: ST }).title, linked);
  const link = { url: "https://youtu.be/x", title: "Tráiler" };
  assert.deepEqual(postBody({ text: "https://youtu.be/x", link, attach: DUNE }), { text: "https://youtu.be/x", title: DUNE, link });
  assert.deepEqual(postBody({ text: "x", link: { url: "https://a.example" } }), { text: "x" });
  assert.deepEqual(postBody({ text: "x", attach: { kind: "movie" } }), { text: "x" });
});
