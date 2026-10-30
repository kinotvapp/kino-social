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

// Critical-2 regression: Kino's wire `kind` for an episode is "episode", never "series" — panel.js must translate
// it at its boundary before it ever reaches postBody/attach.js, which only understand "movie"/"series".
test("a series episode (wire kind \"episode\") posts a title with kind \"series\" and the season/episode", async () => {
  const sent = [];
  fakeKino(sent);
  const context = {
    kind: "episode", title: "Stranger Things", year: "2016", season: 4, episode: 3,
    ids: { tmdb: 66732 }, state: {},
  };
  await panelAction({ trigger: "press", name: "send", values: { text: "Qué capítulo" } }, context);
  assert.deepEqual(sent.at(-1).json, {
    text: "Qué capítulo",
    title: { kind: "series", tmdbId: 66732, title: "Stranger Things", year: 2016, season: 4, episode: 3 },
  });
});

test("no TMDB id: posts plain text with the name, no attached-title object", async () => {
  const sent = [];
  fakeKino(sent);
  const context = { kind: "episode", title: "Some Anime", season: 1, episode: 5, ids: {}, state: {} };
  await panelAction({ trigger: "press", name: "like", values: { text: "" } }, context); // the "Me gusta" button, no TMDB id
  assert.ok(!("title" in sent.at(-1).json) && sent.at(-1).json.text.includes("Some Anime"));
});

// Important 3/4: the text box's live value travels in event.values.text, never context.state.text; Send clears
// the box (state.inputs.text: ""), Like must leave an unsent draft alone.
test("Send's response clears inputs.text but Like's response does not", async () => {
  const sentSend = [];
  fakeKino(sentSend);
  const sendContext = { kind: "movie", title: "Dune", ids: { tmdb: 1 }, state: { me: { id: 1 }, communities: { mine: [] } } };
  const sendOut = await panelAction({ trigger: "press", name: "send", values: { text: "hola" } }, sendContext);
  assert.deepEqual(sendOut.state.inputs, { text: "" });

  const sentLike = [];
  fakeKino(sentLike);
  const likeContext = { kind: "movie", title: "Dune", ids: { tmdb: 1 }, state: { me: { id: 1 }, communities: { mine: [] } } };
  const likeOut = await panelAction({ trigger: "press", name: "like", values: { text: "un borrador sin enviar" } }, likeContext);
  assert.ok(!("inputs" in likeOut.state));
});

test("setText no longer exists: panelAction returns null for it", async () => {
  const sent = [];
  fakeKino(sent);
  const out = await panelAction({ trigger: "change", name: "setText", value: "a" }, { state: {} });
  assert.equal(out, null);
});

test("pickCommunity caches me/communities instead of re-fetching them every call", async () => {
  const sent = [];
  fakeKino(sent);
  // No state yet (as if this were the first action after opening the panel): pickCommunity must fetch and cache both.
  const first = await panelAction({ trigger: "change", name: "pickCommunity", value: "7" }, { state: {} });
  assert.ok(first.state.me && first.state.communities);
  assert.equal(sent.filter((s) => s.path === "/me").length, 1);
  assert.equal(sent.filter((s) => s.path === "/communities").length, 1);
  // The next action, given that cached state back, must not fetch either again.
  const second = await panelAction({ trigger: "change", name: "pickCommunity", value: "8" }, { state: first.state });
  assert.deepEqual(second.state.me, first.state.me);
  assert.deepEqual(second.state.communities, first.state.communities);
  assert.equal(sent.filter((s) => s.path === "/me").length, 1);
  assert.equal(sent.filter((s) => s.path === "/communities").length, 1);
});

test('picking "Feed general" sends with no communityId, not the literal string "feed"', async () => {
  const sent = [];
  fakeKino(sent);
  const context = { kind: "movie", title: "Dune", ids: {}, state: { communityId: "7" } };
  const picked = await panelAction({ trigger: "change", name: "pickCommunity", value: "feed" }, context);
  assert.equal(picked.state.communityId, "feed");
  const sentState = { ...context.state, ...picked.state };
  await panelAction({ trigger: "press", name: "send", values: { text: "hola" } }, { ...context, state: sentState });
  assert.ok(!("communityId" in sent.at(-1).json));
});

// Important 5: handle_taken/bad_handle are expected sign-up rejections, not connectivity problems — they must not
// collapse into the generic "offline" toast.
test('pickHandle maps "handle_taken" to its own toast, not the generic offline one', async () => {
  const sent = [];
  globalThis.kino = {
    storage: { get: () => "s1", set: () => {}, remove: () => {} },
    fetch: async (url, opts) => {
      const path = url.replace(/^https:\/\/[^/]+/, "");
      sent.push({ path, method: opts.method || "GET" });
      if (path === "/me" && opts.method === "PATCH") {
        return { status: 409, ok: false, headers: {}, json: () => ({ error: "handle_taken" }) };
      }
      return { status: 404, ok: false, headers: {}, json: () => ({}) };
    },
  };
  const out = await panelAction(
    { trigger: "submit", name: "pickHandle", values: { handleText: "ana", nameText: "Ana" } },
    { state: {} },
  );
  assert.equal(out.toast, "Ese @usuario ya existe: prueba otro");
});

// No response may echo back a stale/unrelated field from a prior state: every panelAction answer is a minimal
// patch, never `{ ...state, ... }`.
test("no panelAction response ever echoes an unrelated field already in state", async () => {
  const sent = [];
  fakeKino(sent);
  const staleState = { me: { id: 1 }, communities: { mine: [] }, handleCheck: { available: false }, communityId: "7" };
  const context = { kind: "movie", title: "Dune", ids: { tmdb: 1 }, state: staleState };
  const out = await panelAction({ trigger: "press", name: "send", values: { text: "hola" } }, context);
  assert.ok(!("handleCheck" in out.state), "send must not echo back handleCheck from a stale state");
  assert.ok(!("communityId" in out.state), "send must not echo back communityId from a stale state");
});

function T_noIdentity() {
  return "Kino Social necesita tu cuenta de Telegram";
}
