import assert from "node:assert/strict";
import { test } from "node:test";

import { panel, panelAction } from "../src/panel.js";

/** A fake Kino: a session store (empty for "signed out"), and a server that echoes `/me`, `/communities`, `/posts`. */
function fakeKino(sent, { session = "s1", me = { id: 1, handle: "ana", name: "Ana" } } = {}) {
  const store = new Map(session ? [["session", session]] : []);
  globalThis.kino = {
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    fetch: async (url, opts) => {
      const path = url.replace(/^https:\/\/[^/]+/, "");
      const method = opts.method || "GET";
      sent.push({ path, method, json: opts.body && opts.body.json });
      if (path === "/me" && method === "GET") return { status: 200, ok: true, headers: {}, json: () => me };
      if (path === "/communities") return { status: 200, ok: true, headers: {}, json: () => ({ mine: [{ id: 7, name: "Anime" }], discover: [] }) };
      if (path === "/posts") {
        const json = opts.body && opts.body.json;
        return { status: 200, ok: true, headers: {}, json: () => ({ type: "post", id: 1, text: json.text, title: json.title, user: { id: 1, name: "Ana" } }) };
      }
      return { status: 404, ok: false, headers: {}, json: () => ({}) };
    },
  };
}

test("signed out: shows the no-identity message, sends nothing", async () => {
  const sent = [];
  fakeKino(sent, { session: null });
  const out = await panel({ features: ["screen"], state: {} });
  assert.equal(out.format, "screen");
  const texts = JSON.stringify(out.root);
  assert.ok(texts.includes(T_noIdentity()));
  assert.equal(sent.length, 0);
});

test("signed in, handle-less: shows the handle picker", async () => {
  const sent = [];
  fakeKino(sent, { me: { id: 1, handle: null, name: "Ana" } });
  const out = await panel({ features: ["screen"], state: {}, device: "phone", size: "md", lang: "es" });
  assert.equal(out.format, "screen");
  // welcomeView's own Form, wired to checkHandle/pickHandle.
  assert.equal(out.root.type, "SingleChildScrollView");
  const asJson = JSON.stringify(out.root);
  assert.ok(asJson.includes("\"onSubmit\":\"pickHandle\""));
  assert.ok(asJson.includes("\"onChanged\":\"checkHandle\""));
  assert.equal(sent.length, 1); // only the /me probe, no /communities (never reached the composer)
});

test("sends text with season/episode attached, from the panel's own context", async () => {
  const sent = [];
  fakeKino(sent);
  const context = {
    kind: "series", title: "Stranger Things", year: 2016, season: 4, episode: 3,
    ids: { tmdb: 66732 }, state: { text: "Qué capítulo" },
  };
  await panelAction({ event: { trigger: "press", name: "send" }, context });
  assert.deepEqual(sent.at(-1).json, {
    text: "Qué capítulo",
    title: { kind: "series", tmdbId: 66732, title: "Stranger Things", year: 2016, season: 4, episode: 3 },
  });
});

test("no TMDB id: posts plain text with the name, no attached-title object", async () => {
  const sent = [];
  fakeKino(sent);
  const context = { kind: "series", title: "Some Anime", season: 1, episode: 5, ids: {}, state: { text: "" } };
  await panelAction({ event: { trigger: "press", name: "like" }, context }); // the "Me gusta" button, no TMDB id
  assert.ok(!("title" in sent.at(-1).json) && sent.at(-1).json.text.includes("Some Anime"));
});

function T_noIdentity() {
  return "Kino Social necesita tu cuenta de Telegram";
}
