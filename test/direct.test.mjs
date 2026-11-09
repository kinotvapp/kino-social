import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { allowedPublishers, isAllowed, withAllowed } from "../src/direct.js";
import { screenEvent } from "../src/events.js";
import { cleanLocal } from "../src/swear.js";
import { meView } from "../src/ui/views.js";
import { proto_wall_card, proto_wall_share, readDrafts } from "../src/wall.js";

let store;
let sent;
let cfg;
let answerPost;
beforeEach(() => {
  store = new Map([["session", "s1"]]);
  sent = [];
  cfg = {};
  answerPost = (json) => ({ type: "post", id: 9, text: json && json.text, user: { id: 1, name: "Ana" } });
  globalThis.kino = {
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    notifications: { post: async () => 0 },
    config: { get: (k) => cfg[k] },
    tmdb: async (path) => {
      if (path === "/tv/209867") return { id: 209867, name: "Frieren", first_air_date: "2023-09-29", poster_path: "/f.jpg" };
      throw new Error("404");
    },
    fetch: async (url, opts) => {
      const json = opts && opts.body && opts.body.json;
      sent.push({ path: url.replace(/^https:\/\/[^/]+/, ""), json, timeoutMs: opts && opts.timeoutMs });
      return { status: 200, ok: true, headers: {}, json: () => answerPost(json) };
    },
  };
});

const CALLER = { caller: { id: "share-test-opener", repo: "kinotvapp/kino-plugin-share-test/opener@v2", name: "Prueba", adult: false } };
const FRIEREN = { kind: "series", tmdb: 209867, season: 1, episode: 3 };

// ---- the brief's tests -----------------------------------------------------------------------------------------------

test("an allowed caller publishes directly through the same server path", async () => {
  cfg.directPublishers = [{ repo: "KinoTVApp/kino-plugin-share-test/opener", name: "Prueba" }];
  const out = await proto_wall_card({ title: "Frieren", text: "qué mierda", publish: true }, CALLER); // CALLER's repo ends in @v2
  assert.deepEqual(out, { status: "published", postId: 9 });
  assert.equal(sent.at(-1).path, "/posts");
  assert.equal(sent.at(-1).json.text, "qué xxxx");
  assert.equal(sent.at(-1).json.card.plugin.repo, "kinotvapp/kino-plugin-share-test/opener");
  assert.equal(readDrafts().length, 0);
});

test("a pinned caller matches its allowed entry; a share publishes its TMDB title", async () => {
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener", name: "Prueba" }];
  const out = await proto_wall_share({ text: "Viendo", title: FRIEREN, link: "https://example.com/x", publish: true }, CALLER);
  assert.equal(out.status, "published");
  assert.equal(sent.at(-1).json.title.tmdbId, 209867);
  assert.equal(sent.at(-1).json.text, "Viendo\nhttps://example.com/x");
  assert.equal(sent.at(-1).json.link, undefined);
});

test("not allowed, no ctx, 18+ or publish not asked: a draft, never a post", async () => {
  cfg.directPublishers = undefined;
  assert.equal((await proto_wall_card({ title: "a", publish: true }, CALLER)).status, "draft");
  assert.equal(readDrafts()[0].direct, true);
  assert.equal((await proto_wall_share({ text: "b", publish: true })).status, "draft");
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener" }];
  assert.equal((await proto_wall_share({ text: "c", publish: true }, { caller: { ...CALLER.caller, adult: true } })).status, "draft");
  assert.equal((await proto_wall_card({ title: "d" }, CALLER)).status, "draft");
  assert.equal(sent.length, 0);
});

test("a refused direct publish lands as a draft", async () => {
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener" }];
  for (const answer of [{ status: 403, json: () => ({ error: "muted", mutedUntil: 1 }) }, { status: 429, json: () => ({}) }, null]) {
    globalThis.kino.fetch = async () => { if (!answer) throw new Error("offline"); return { ok: false, headers: {}, ...answer }; };
    const out = await proto_wall_card({ title: "Frieren " + answer?.status, publish: true }, CALLER);
    assert.equal(out.status, "draft");
  }
  store.delete("session");
  assert.equal((await proto_wall_card({ title: "sin sesión", publish: true }, CALLER)).status, "draft");
  assert.equal(readDrafts().length, 4);
});

test("publishing a draft that asked to go direct asks to allow its plugin; Permitir writes the synced list", async () => {
  cfg.directPublishers = [{ repo: "otro/plugin", name: "Otro" }];
  await proto_wall_card({ title: "Frieren", publish: true }, { caller: { ...CALLER.caller, repo: "kinotvapp/x" } });
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  const out = await screenEvent({ name: "publish", values: { postText: "" }, state: review.state });
  assert.equal(out.dialog.title, "¿Permitir que Prueba publique directo en tu muro?");
  assert.deepEqual(out.dialog.buttons.map((b) => b.label), ["Permitir", "Solo esta vez"]);
  const allow = await screenEvent({ name: "allowDirect", arg: "kinotvapp/x", state: { askDirect: out.state.askDirect } });
  assert.deepEqual(allow.config.directPublishers, [{ repo: "otro/plugin", name: "Otro" }, { repo: "kinotvapp/x", name: "Prueba" }]);
  assert.equal(allow.toast, "Prueba ya puede publicar directo");
});

test("the list keeps at most 20, newest kept; the profile shows it to remove entries", () => {
  const list = Array.from({ length: 20 }, (_, i) => ({ repo: "o/p" + i, name: "P" + i }));
  const next = withAllowed(list, "o/new", "Nuevo");
  assert.equal(next.length, 20); assert.equal(next[0].repo, "o/p1"); assert.equal(next.at(-1).repo, "o/new");
  assert.equal(withAllowed(next, "O/NEW", "Nuevo").length, 20);
  const flat = JSON.stringify(meView({ me: { id: 1, name: "Ana", handle: "ana" }, profile: { user: { id: 1, name: "Ana" }, posts: [] } }, { device: "phone" }));
  assert.match(flat, /"type":"settings","keys":\["directPublishers"\]/);
  assert.match(flat, /Plugins que publican directo/);
});

// ---- more ------------------------------------------------------------------------------------------------------------

test("the allowed list: no kino.config is empty; entries compare without @ref and ignoring case", () => {
  delete globalThis.kino.config;
  assert.deepEqual(allowedPublishers(), []);
  assert.equal(isAllowed("a/b"), false);
  globalThis.kino.config = { get: () => { throw new Error("gone"); } };
  assert.deepEqual(allowedPublishers(), []);
  globalThis.kino.config = { get: (k) => cfg[k] };
  cfg.directPublishers = [{ repo: " Owner/Name@main ", name: "N" }, { name: "sin dirección" }, null, "x"];
  assert.deepEqual(allowedPublishers(), [{ repo: "Owner/Name@main", name: "N" }]);
  assert.equal(isAllowed("owner/name"), true);
  assert.equal(isAllowed("owner/name/sub"), false);
  assert.equal(isAllowed(null), false);
  // Moving an entry to the end keeps its newest name; an entry without a name keeps none.
  assert.deepEqual(withAllowed([{ repo: "a/b", name: "Viejo" }, { repo: "c/d" }], "A/B", "Nuevo"), [{ repo: "c/d" }, { repo: "A/B", name: "Nuevo" }]);
});

test("an 18+ share never keeps direct, so it is never asked about", async () => {
  await proto_wall_share({ text: "c", publish: true }, { caller: { ...CALLER.caller, adult: true } });
  assert.equal(readDrafts()[0].direct, false);
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  const out = await screenEvent({ name: "publish", values: { postText: "c" }, state: review.state });
  assert.equal(out.dialog, undefined);
  assert.equal(out.toast, "Publicado");
});

test("no ask without a repo, for an allowed plugin, or when moderation speaks first", async () => {
  // A share from a Kino without ctx: no caller, no ask.
  await proto_wall_share({ text: "sin ctx", publish: true });
  let review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  let out = await screenEvent({ name: "publish", values: { postText: "sin ctx" }, state: review.state });
  assert.equal(out.dialog, undefined);
  // A file-installed plugin (repo null): no address to allow.
  await proto_wall_card({ title: "Local", publish: true }, { caller: { ...CALLER.caller, repo: null } });
  review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  out = await screenEvent({ name: "publish", values: { postText: "" }, state: review.state });
  assert.equal(out.dialog, undefined);
  // The moderation dialog wins; the ask waits for the next one.
  answerPost = (json) => ({ type: "post", id: 10, text: json.text, user: { id: 1 }, moderation: { strikes: 1 } });
  await proto_wall_card({ title: "Otra", publish: true }, CALLER);
  review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  out = await screenEvent({ name: "publish", values: { postText: "" }, state: review.state });
  assert.ok(out.dialog);
  assert.notEqual(out.dialog.buttons && out.dialog.buttons[0] && out.dialog.buttons[0].event, "allowDirect");
  assert.equal(out.state.askDirect, undefined);
});

test("allowDirect needs its own ask: another address writes nothing", async () => {
  const out = await screenEvent({ name: "allowDirect", arg: "otro/x", state: { askDirect: { repo: "kinotvapp/x", name: "Prueba" } } });
  assert.equal(out.config, undefined);
  assert.equal(out.state.askDirect, null);
  const none = await screenEvent({ name: "allowDirect", arg: "kinotvapp/x", state: {} });
  assert.equal(none.config, undefined);
});

test("a direct publish keeps within the provider call's 10 s and replaces the same card's draft", async () => {
  await proto_wall_card({ title: "Frieren", route: { name: "item" } }, CALLER);
  assert.equal(readDrafts().length, 1);
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener", name: "Prueba" }];
  const out = await proto_wall_card({ title: "Frieren", route: { name: "item" }, publish: true }, CALLER);
  assert.equal(out.status, "published");
  assert.ok(sent.at(-1).timeoutMs > 0 && sent.at(-1).timeoutMs <= 8500, "the POST gives up before Kino's 10 s");
  assert.equal(readDrafts().length, 0, "the same card is on the wall now");
});

test("a share with nothing left to post (its title not found, no text) stays a draft", async () => {
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener" }];
  const out = await proto_wall_share({ title: { kind: "movie", tmdb: 1 }, publish: true }, CALLER);
  assert.equal(out.status, "draft");
  assert.equal(sent.length, 0);
});

// ---- fix round 1 -----------------------------------------------------------------------------------------------------

/** A server for `open`: the person, an empty feed and no notices; a POST /posts answers [answerPost]. */
function serveOpen() {
  globalThis.kino.fetch = async (url, opts) => {
    const path = url.replace(/^https:\/\/[^/]+/, "");
    const json = opts && opts.body && opts.body.json;
    sent.push({ path, json, timeoutMs: opts && opts.timeoutMs });
    const body = path === "/posts" ? answerPost(json)
      : path === "/me" ? { id: 1, name: "Ana", handle: "ana" }
      : path.startsWith("/feed") ? { items: [], next: null }
      : path === "/notifications" ? { unread: 0, items: [] }
      : {};
    return { status: 200, ok: true, headers: {}, json: () => body };
  };
}

test("a direct post's moderation warning shows once, the next time the screen opens", async () => {
  serveOpen();
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener", name: "Prueba" }];
  answerPost = (json) => ({ type: "post", id: 11, text: json.text, user: { id: 1 }, moderation: { strikes: 2, limit: 3 } });
  const out = await proto_wall_card({ title: "Frieren", text: "qué mierda", publish: true }, CALLER);
  assert.equal(out.status, "published");
  assert.ok(store.get("directWarning").length < 200, "a tiny note");
  // A tick cannot carry a dialog: the warning waits.
  const tick = await screenEvent({ name: "tick", state: { view: "main", feed: [] }, route: { name: "main" } });
  assert.equal(tick && tick.dialog, undefined);
  const first = await screenEvent({ name: "open", state: {}, route: { name: "main" } });
  assert.match(first.dialog.body, /Llevas 2 de 3 avisos/);
  const again = await screenEvent({ name: "open", state: {}, route: { name: "main" } });
  assert.equal(again.dialog, undefined, "once");
});

test("a direct post that started a mute brings the mute in", async () => {
  serveOpen();
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener" }];
  const until = Date.now() + 3600000;
  answerPost = (json) => ({ type: "post", id: 12, text: json.text, user: { id: 1 }, moderation: { strikes: 3, limit: 3, mutedUntil: until } });
  await proto_wall_card({ title: "Frieren", text: "mierda", publish: true }, CALLER);
  const next = await screenEvent({ name: "refresh", state: { view: "main", feed: [] }, route: { name: "main" } });
  assert.equal(next.state.mutedUntil, until);
  assert.ok(next.dialog, "the mute dialog");
});

test("a direct POST that was sent but never answered marks the draft: its review says it may be out already", async () => {
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener" }];
  globalThis.kino.fetch = async () => { throw new Error("timeout"); };
  await proto_wall_card({ title: "Frieren", publish: true }, CALLER);
  assert.equal(readDrafts()[0].maybeSent, true);
  const review = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: {} });
  assert.equal(review.state.maybeSent, true);
  const tree = JSON.stringify(meView({ ...review.state, me: { id: 1, name: "Ana", handle: "ana" }, profile: { user: { id: 1 }, posts: [] } }, { device: "phone" }));
  assert.doesNotMatch(tree, /Puede que ya se haya publicado/, "only the composer says it");
  const { mainView } = await import("../src/ui/views.js");
  const main = JSON.stringify(mainView({ ...review.state, me: { id: 1, name: "Ana", handle: "ana" }, view: "main", feed: [] }, { device: "phone" }));
  assert.match(main, /Puede que ya se haya publicado; revisa tu muro/);
  assert.match(main, /It may already be on your wall; check it/);
  // A refusal (the server answered) or no session sent nothing that could be out: no mark.
  globalThis.kino.fetch = async () => ({ ok: false, status: 429, headers: {}, json: () => ({}) });
  await proto_wall_card({ title: "Otra", publish: true }, CALLER);
  assert.equal(readDrafts()[0].maybeSent, undefined);
  store.delete("session");
  await proto_wall_card({ title: "Sin sesión", publish: true }, CALLER);
  assert.equal(readDrafts()[0].maybeSent, undefined);
  // Another draft's review does not keep the mark.
  const other = await screenEvent({ name: "reviewDraft", arg: readDrafts()[0].id, state: review.state });
  assert.equal(other.state.maybeSent, false);
});

test("a twin published or discarded during a failed direct publish is not brought back", async () => {
  await proto_wall_card({ title: "Frieren", route: { name: "item" } }, CALLER);
  const old = readDrafts()[0].id;
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener" }];
  globalThis.kino.fetch = async () => {
    // Meanwhile the person published (or discarded) the twin from the composer.
    store.set("wallDrafts1", JSON.stringify(readDrafts().filter((d) => d.id !== old)));
    return { ok: false, status: 429, headers: {}, json: () => ({}) };
  };
  // The proposal was kept (into its twin) before the network; the person's discard meanwhile holds.
  const out = await proto_wall_card({ title: "Frieren", route: { name: "item" }, publish: true }, CALLER);
  assert.equal(out.status, "draft");
  assert.equal(readDrafts().length, 0, "the discarded draft is not brought back");
  // Same for a share.
  await proto_wall_share({ text: "Hola" }, CALLER);
  const oldShare = readDrafts()[0].id;
  globalThis.kino.fetch = async () => {
    store.set("wallDrafts1", JSON.stringify(readDrafts().filter((d) => d.id !== oldShare)));
    throw new Error("offline");
  };
  await proto_wall_share({ text: "Hola", publish: true }, CALLER);
  assert.equal(readDrafts().length, 0);
});

test("a direct publish Kino cuts off at its 10 s still leaves the proposal in storage, marked", async () => {
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener" }];
  globalThis.kino.fetch = () => new Promise(() => {}); // never answers: Kino's timeout ends the call
  const pending = proto_wall_card({ title: "Frieren", publish: true }, CALLER);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(readDrafts().length, 1);
  assert.equal(readDrafts()[0].card.title, "Frieren");
  assert.equal(readDrafts()[0].maybeSent, true, "marked right before the POST");
  void pending;
  // A share whose TMDB lookup hangs: kept before the lookup, not marked (nothing went out).
  globalThis.kino.tmdb = () => new Promise(() => {});
  void proto_wall_share({ text: "Viendo", title: FRIEREN, publish: true }, CALLER);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(readDrafts().length, 2);
  assert.equal(readDrafts()[0].text, "Viendo");
  assert.equal(readDrafts()[0].maybeSent, undefined);
});

test("a direct share asks Kino's TMDB once (no poster hunt): the call has 10 s", async () => {
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener" }];
  const asked = [];
  globalThis.kino.tmdb = async (path) => { asked.push(path); return { id: 209867, name: "Frieren" }; }; // no poster
  const out = await proto_wall_share({ text: "Viendo", title: FRIEREN, publish: true }, CALLER);
  assert.equal(out.status, "published");
  assert.deepEqual(asked, ["/tv/209867"]);
  assert.equal(sent.at(-1).json.title.tmdbId, 209867);
});

test("an answer that saved nothing clears the mark; a twin's earlier mark stays", async () => {
  cfg.directPublishers = [{ repo: "kinotvapp/kino-plugin-share-test/opener" }];
  globalThis.kino.fetch = async () => ({ ok: false, status: 429, headers: {}, json: () => ({}) });
  await proto_wall_card({ title: "Frieren", publish: true }, CALLER);
  assert.equal(readDrafts()[0].maybeSent, undefined);
  globalThis.kino.fetch = async () => { throw new Error("timeout"); };
  await proto_wall_card({ title: "Frieren", publish: true }, CALLER);
  assert.equal(readDrafts()[0].maybeSent, true);
  globalThis.kino.fetch = async () => ({ ok: false, status: 429, headers: {}, json: () => ({}) });
  await proto_wall_card({ title: "Frieren", publish: true }, CALLER);
  assert.equal(readDrafts().length, 1);
  assert.equal(readDrafts()[0].maybeSent, true, "the earlier attempt may still be out");
});

test("the allowed list folds the case of owner/name only, never of the sub-path", () => {
  cfg.directPublishers = [{ repo: "Owner/Repo/plugins/A" }];
  assert.equal(isAllowed("owner/repo/plugins/A"), true);
  assert.equal(isAllowed("owner/repo/plugins/a"), false);
  assert.equal(withAllowed([{ repo: "o/r/plugins/A" }], "o/r/plugins/a", "x").length, 2);
  assert.equal(withAllowed([{ repo: "O/R/plugins/A" }], "o/r/plugins/A", "x").length, 1);
});

test("a share twin takes the newer direct; a share without ctx never stores direct", async () => {
  await proto_wall_share({ text: "Hola" }, CALLER);
  assert.equal(readDrafts()[0].direct, false);
  await proto_wall_share({ text: "Hola", publish: true }, CALLER); // not allowed: still a draft, now asking to go direct
  assert.equal(readDrafts().length, 1);
  assert.equal(readDrafts()[0].direct, true);
  await proto_wall_share({ text: "Sin ctx", publish: true });
  assert.equal(readDrafts()[0].direct, false);
});

test("the profile's section has one heading; the form draws the setting's own hint", () => {
  const tree = meView({ me: { id: 1, name: "Ana", handle: "ana" }, profile: { user: { id: 1, name: "Ana" }, posts: [] } }, { device: "tv" });
  const flat = JSON.stringify(tree);
  assert.equal(flat.match(/Plugins que publican directo/g).length, 1);
  assert.doesNotMatch(flat, /Publican en tu muro sin pasar por tu revisión/);
});

test("cleanLocal masks the local list only, never asks Kino's AI", () => {
  let asked = false;
  globalThis.kino.ai = { ask: async () => { asked = true; return { text: '{"words":["feo"]}' }; } };
  assert.equal(cleanLocal("qué mierda tan feo"), "qué xxxx tan feo");
  assert.equal(asked, false);
});
