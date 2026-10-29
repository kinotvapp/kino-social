import assert from "node:assert/strict";
import { test } from "node:test";

import { firstUrl, linkPreview } from "../src/linkpreview.js";

const PAGE = `<html><head><title>Fallback</title>
<meta property="og:title" content="Dune: Part Two &amp; more">
<meta name="description" content="  A free
film ">
<meta property="og:site_name" content="Letterboxd">
<meta property="og:image" content="/img/poster.jpg">
</head><body>x</body></html>`;

function fetcher(routes, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const r = routes[url];
    if (!r) return { ok: false, status: 404, url, headers: {}, text: () => "", json: () => null };
    return { ok: true, status: 200, url, headers: { "content-type": r.type }, text: () => r.body, json: () => JSON.parse(r.body) };
  };
}

test("the first link of a text, without trailing punctuation", () => {
  assert.equal(firstUrl("mira https://a.example/x?y=1). ok"), "https://a.example/x?y=1");
  assert.equal(firstUrl("nada aquí"), null);
});

test("a page's Open Graph head becomes the preview, its picture made absolute and https", async () => {
  const calls = [];
  globalThis.kino = { fetch: fetcher({ "https://letterboxd.example/film/dune/": { type: "text/html", body: PAGE } }, calls) };
  assert.deepEqual(await linkPreview("Mira https://letterboxd.example/film/dune/"), {
    url: "https://letterboxd.example/film/dune/", title: "Dune: Part Two & more", desc: "A free film", site: "Letterboxd",
    image: "https://letterboxd.example/img/poster.jpg",
  });
  assert.equal(calls[0].init.stopAt, "</head>");
});

test("YouTube answers through its oEmbed", async () => {
  const yt = "https://www.youtube.com/watch?v=abc";
  globalThis.kino = { fetch: fetcher({ ["https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(yt)]: {
    type: "application/json", body: JSON.stringify({ title: "Trailer", author_name: "Warner", thumbnail_url: "https://i.ytimg.com/vi/abc/hq.jpg" }) } }) };
  assert.deepEqual(await linkPreview(yt), { url: yt, title: "Trailer", desc: "Warner", site: "YouTube", image: "https://i.ytimg.com/vi/abc/hq.jpg" });
});

test("no title, an error or no link: just the url, or nothing", async () => {
  globalThis.kino = { fetch: async () => { throw new Error("offline"); } };
  assert.deepEqual(await linkPreview("https://down.example/"), { url: "https://down.example/" });
  assert.equal(await linkPreview("hola"), null);
});
