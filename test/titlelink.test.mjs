import assert from "node:assert/strict";
import { test } from "node:test";

import { titleHint } from "../src/titlelink.js";

const tmdb = async (path, params) => {
  if (path === "/movie/693134") return { id: 693134, title: "Dune: Parte dos", release_date: "2024-02-27", poster_path: "/d.jpg" };
  if (path === "/tv/66732") return { id: 66732, name: "Stranger Things", first_air_date: "2016-07-15", poster_path: "/s.jpg" };
  if (path === "/find/tt15239678" && params.external_source === "imdb_id") return { movie_results: [{ id: 693134 }], tv_results: [] };
  if (path === "/movie/1") return { id: 1, title: "X", adult: true };
  throw new Error("404");
};

test("a TMDB or IMDb link gets its title, year and poster from Kino's TMDB", async () => {
  globalThis.kino = { tmdb };
  const dune = { kind: "movie", tmdbId: 693134, title: "Dune: Parte dos", year: 2024, poster: "https://image.tmdb.org/t/p/w342/d.jpg" };
  assert.deepEqual(await titleHint("Brutal https://www.themoviedb.org/movie/693134-dune-part-two?language=es"), dune);
  assert.deepEqual(await titleHint("https://www.imdb.com/title/tt15239678/"), dune);
  assert.equal((await titleHint("https://www.themoviedb.org/tv/66732")).title, "Stranger Things");
});

test("nothing for other links, 18+ titles, or when TMDB fails", async () => {
  globalThis.kino = { tmdb };
  assert.equal(await titleHint("https://letterboxd.com/film/dune/"), null);
  assert.equal(await titleHint("https://www.themoviedb.org/movie/1"), null);
  assert.equal(await titleHint("https://www.themoviedb.org/movie/999"), null);
  globalThis.kino = {};
  assert.equal(await titleHint("https://www.themoviedb.org/movie/693134"), null);
});
