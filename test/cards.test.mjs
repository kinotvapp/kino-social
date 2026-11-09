import assert from "node:assert/strict";
import { test } from "node:test";

import { postCard } from "../src/ui/cards.js";
import { screenEvent } from "../src/events.js";
import { CARD_STATE_BYTES, slimCard, utf8Length } from "../src/card.js";

test("a text-less, title-attached post reads as a like, not a blank bubble", () => {
  const post = { id: 1, user: { id: 2, name: "Cristian" }, text: "", likes: 0, comments: 0, createdAt: 1,
    link: { url: "https://www.themoviedb.org/tv/66732", tmdb: { kind: "series", id: 66732 }, title: "Stranger Things", season: 1, episode: 7 } };
  const card = postCard(post, { device: "phone" }, null);
  assert.ok(JSON.stringify(card).includes("le gustó"));
});

const CARD_POST = { id: 7, type: "post", user: { id: 2, name: "Ana" }, text: "Mírala", likes: 0, comments: 0, createdAt: 1,
  card: { plugin: { repo: "kinotvapp/kino-plugin-share-test/opener", name: "Prueba" }, title: "Frieren",
    description: "Una maga elfa", image: "/media/abc", route: { name: "item", args: { id: "42" } }, query: "Frieren" } };

test("new Kino: the card button opens its plugin with go.plugin", () => {
  globalThis.kino = { image: { thumbnail: async () => "" } };
  const flat = JSON.stringify(postCard(CARD_POST, { device: "phone" }, null));
  assert.match(flat, /"plugin":\{"repo":"kinotvapp\/kino-plugin-share-test\/opener","route":"item","args":\{"id":"42"\},"query":"Frieren"\}/);
  assert.match(flat, /https:\/\/129-158-250-81\.sslip\.io\/media\/abc/);
  assert.match(flat, /Abrir en Prueba/); assert.match(flat, /Una maga elfa/);
});

test("old Kino: the card button is a cardTap event that asks to update", async () => {
  globalThis.kino = {};
  const flat = JSON.stringify(postCard(CARD_POST, { device: "tv" }, null));
  assert.doesNotMatch(flat, /"plugin":\{"repo"/);
  assert.match(flat, /"event":"cardTap","arg":"7"/);
  const out = await screenEvent({ name: "cardTap", arg: "7", state: { feed: [CARD_POST] } });
  assert.equal(out.toast, "Actualiza Kino para abrir esto en Prueba");
  assert.equal(out.toastEn, "Update Kino to open this in Prueba");
  assert.equal(out.go, undefined);
});

test("no repo: a toast naming the plugin; no image or description: not drawn", async () => {
  globalThis.kino = { image: { thumbnail: async () => "" } };
  const bare = { ...CARD_POST, card: { plugin: { repo: null, name: "Local" }, title: "Solo" } };
  const flat = JSON.stringify(postCard(bare, { device: "phone" }, null));
  assert.match(flat, /"event":"cardTap"/);
  assert.doesNotMatch(flat, /"type":"Image"/);
  assert.doesNotMatch(flat, /"go":\{"plugin"/);
  const out = await screenEvent({ name: "cardTap", arg: "7", state: { feed: [bare] } });
  assert.equal(out.toast, "Local no se puede abrir desde aquí");
  assert.equal(out.toastEn, "Local can't be opened from here");
  assert.equal(out.go, undefined);
});

test("a card post without text draws the card only", () => {
  const flat = JSON.stringify(postCard({ ...CARD_POST, text: "" }, { device: "phone" }, null));
  assert.doesNotMatch(flat, /le gustó/);
  assert.match(flat, /"key":"card-7"/);
});

test("the TV: the post stays one stop; the card's button is the focus stop", () => {
  globalThis.kino = { image: { thumbnail: async () => "" } };
  const tree = postCard(CARD_POST, { device: "tv" }, null);
  const card = JSON.parse(JSON.stringify(tree)).children.find((c) => c.key === "card-7");
  assert.equal(card.onTap, undefined);
  assert.match(JSON.stringify(card), /"key":"open-7"/);
});

test("cardImageUrl: a server media path gets the host, an https URL stays, anything else is not drawn", async () => {
  const { cardImageUrl } = await import("../src/card.js");
  assert.equal(cardImageUrl("/media/abc"), "https://129-158-250-81.sslip.io/media/abc");
  assert.equal(cardImageUrl("https://img.example.com/a.jpg"), "https://img.example.com/a.jpg");
  assert.equal(cardImageUrl("http://img.example.com/a.jpg"), undefined);
  assert.equal(cardImageUrl("/media/../x"), undefined);
  assert.equal(cardImageUrl(undefined), undefined);
});

test("a card whose plugin address is not a plain repo never becomes a go.plugin", () => {
  globalThis.kino = { image: { thumbnail: async () => "" } };
  for (const repo of ["owner/name@v2", "https://github.com/a/b", "nope"]) {
    const post = { ...CARD_POST, card: { ...CARD_POST.card, plugin: { repo, name: "X" } } };
    assert.doesNotMatch(JSON.stringify(postCard(post, { device: "phone" }, null)), /"go":\{"plugin"/, repo);
  }
});

// A maximal card, as the server may send it: every field at its limit (title 120, description 200, an https image of 500,
// plugin name 60, repo 200, route name 64, args 1 KB as JSON, query 100).
const BIG_ARGS = { id: "x".repeat(1024 - '{"id":""}'.length) };
const repo200 = "a".repeat(39) + "/" + "b".repeat(100) + "/" + "c".repeat(59);
const maximalCard = (ch = "x") => ({ plugin: { repo: repo200, name: ch.repeat(60) }, title: ch.repeat(120), description: ch.repeat(200),
  image: "https://img.example.com/" + "p".repeat(500 - 24), route: { name: "r".repeat(64), args: BIG_ARGS }, query: ch.repeat(100) });
// A realistic author, as the server's feed sends it (name, handle, coins account).
const author = (i) => ({ id: 1000 + i, name: "Nombre de la persona " + i, handle: "handle_" + i, coinsAccount: "k".repeat(43) });

test("a card kept in the screen state never passes its byte budget, whatever its fields", () => {
  for (const ch of ["x", "ñ", "語", "😀", '"']) {
    const slim = slimCard(maximalCard(ch));
    assert.ok(utf8Length(JSON.stringify(slim)) <= CARD_STATE_BYTES, ch + ": " + utf8Length(JSON.stringify(slim)));
    assert.ok(slim.t && slim.n, "the title and the plugin's name always stay");
  }
  assert.equal(slimCard(slimCard(maximalCard())).t, slimCard(maximalCard()).t, "slimming twice changes nothing");
});

test("80 posts with maximal cards keep the feed state well under Kino's 64 KB", async () => {
  // The server's page answer goes through `call`, which slims every card before it can reach the state.
  const items = Array.from({ length: 80 }, (_, i) => ({ type: "post", id: i + 1, user: author(i), text: "", comments: 3, likes: 12,
    liked: false, createdAt: 1762560000000 + i, card: maximalCard(i % 2 ? "ñ" : "x") }));
  const store = new Map([["session", "s1"]]);
  globalThis.kino = { image: { thumbnail: async () => "" },
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    fetch: async () => ({ status: 200, ok: true, headers: {}, json: () => ({ items: JSON.parse(JSON.stringify(items)), next: null }) }) };
  const out = await screenEvent({ name: "refresh", state: { feed: [] } });
  const bytes = utf8Length(JSON.stringify({ feed: out.state.feed }));
  const bare = utf8Length(JSON.stringify({ feed: out.state.feed.map(({ card, ...p }) => p) }));
  // The feed alone: the 80 posts themselves (author, counts, no words) take about 18.5 KB, and each card adds at most
  // CARD_STATE_BYTES plus its key. The whole state (every list at once) is pinned by the two STATE_BOUND tests below.
  assert.ok(bytes - bare <= 80 * (CARD_STATE_BYTES + '"card":,'.length), "cards " + (bytes - bare) + " B");
  assert.ok(bytes <= 44 * 1024, "feed state " + bytes + " B");
  // Without slimming the same feed is several times the cap.
  assert.ok(utf8Length(JSON.stringify(items)) > 2 * 64 * 1024, "raw " + utf8Length(JSON.stringify(items)));
});

test("a typical card keeps everything in the state: picture, description and the button's go", () => {
  globalThis.kino = { image: { thumbnail: async () => "" } };
  const typical = { plugin: { repo: "kinotvapp/kino-plugin-megaplay", name: "MegaPlay" }, title: "Frieren: más allá del final del viaje",
    description: "Tras derrotar al Rey Demonio, la maga elfa Frieren emprende un nuevo viaje para entender a las personas que conoció.",
    image: "/media/" + "a".repeat(64), route: { name: "detail", args: { id: "frieren-2023", kind: "series" } }, query: "Frieren" };
  const slim = slimCard(typical);
  assert.ok(slim.i && slim.d && slim.g && !slim.m, JSON.stringify(slim));
  const flat = JSON.stringify(postCard({ ...CARD_POST, card: typical }, { device: "phone" }, null));
  assert.match(flat, /"go":\{"plugin":\{"repo":"kinotvapp\/kino-plugin-megaplay","route":"detail","args":\{"id":"frieren-2023","kind":"series"\},"query":"Frieren"\}\}/);
});

test("a card whose route did not fit the state opens after reading its post again", async () => {
  const store = new Map([["session", "s1"]]);
  const asked = [];
  const full = { ...CARD_POST, card: { ...CARD_POST.card, route: { name: "item", args: BIG_ARGS } } };
  globalThis.kino = { image: { thumbnail: async () => "" },
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    fetch: async (url) => { asked.push(url); return { status: 200, ok: true, headers: {}, json: () => JSON.parse(JSON.stringify(full)) }; } };
  const slim = { ...full, card: slimCard(full.card) };
  const flat = JSON.stringify(postCard(slim, { device: "phone" }, null));
  assert.doesNotMatch(flat, /"go":\{"plugin"/);
  assert.match(flat, /"event":"cardTap","arg":"7"/);
  const out = await screenEvent({ name: "cardTap", arg: "7", state: { feed: [slim] } });
  assert.deepEqual(asked, ["https://129-158-250-81.sslip.io/posts/7"]);
  assert.deepEqual(out.go, { plugin: { repo: "kinotvapp/kino-plugin-share-test/opener", route: "item", args: BIG_ARGS, query: "Frieren" } });
});

// --- Fix round 1 ------------------------------------------------------------------------------------------------------

/** A fake Kino with a session and a server answering [answer(path)] (a function may throw to fail the fetch). */
function fakeServer(answer) {
  const store = new Map([["session", "s1"]]);
  globalThis.kino = { image: { thumbnail: async () => "" },
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    fetch: async (url) => {
      const r = answer(url.replace(/^https:\/\/[^/]+/, ""));
      if (r instanceof Error) throw r;
      if (typeof r === "number") return { status: r, ok: false, headers: {}, json: () => ({}) };
      return { status: 200, ok: true, headers: {}, json: () => JSON.parse(JSON.stringify(r)) };
    } };
}

const bigRoutePost = () => ({ ...CARD_POST, card: slimCard({ ...CARD_POST.card, route: { name: "item", args: BIG_ARGS } }) });

test("an m card whose re-read fails offline answers a toast, never a rejection or a go", async () => {
  fakeServer(() => new Error("no network"));
  const out = await screenEvent({ name: "cardTap", arg: "7", state: { feed: [bigRoutePost()] } });
  assert.equal(out.go, undefined);
  assert.equal(out.toast, "No pudimos conectar con Kino Social");
});

test("an m card whose post is gone (404) says so, not «offline»", async () => {
  fakeServer(() => 404);
  const out = await screenEvent({ name: "cardTap", arg: "7", state: { feed: [bigRoutePost()] } });
  assert.equal(out.go, undefined);
  assert.equal(out.toast, "Esta publicación ya no está");
  assert.equal(out.toastEn, "This post is gone");
});

test("slimCard knows a slim card by its own keys, not by a missing plugin", () => {
  const slim = slimCard(CARD_POST.card);
  assert.equal(slimCard(slim), slim);
  // Neither slim nor a server card: nothing to draw.
  assert.equal(slimCard({ title: "x" }), null);
  assert.equal(postCard({ ...CARD_POST, card: { title: "x" } }, { device: "phone" }, null).children.some((c) => c && c.key === "card-7"), false);
});

/** Kino's merge of a state patch: key by key, null removes. */
const merge = (state, out) => {
  const next = { ...state };
  for (const [k, v] of Object.entries((out && out.state) || {})) if (v === null) delete next[k]; else next[k] = v;
  return next;
};

/** A server of posts that all carry a maximal card: every list a page of 20 (a profile's 20 posts too). */
function cardServer() {
  let n = 0;
  const posts = (k = 20) => Array.from({ length: k }, () => { n++; return { type: "post", id: n, user: author(n), text: "", comments: 3,
    likes: 12, liked: false, createdAt: 1762560000000 - n, card: maximalCard(n % 2 ? "ñ" : "x") }; });
  fakeServer((path) => {
    if (path.startsWith("/feed") || /^\/communities\/5\/feed/.test(path)) return { items: posts(), next: 1 };
    if (path === "/communities/5") return { id: 5, name: "Anime", slug: "anime", joined: true, posts: 300 };
    if (/^\/users\/\d+\/plugins/.test(path) || path.startsWith("/me/plugins")) return { plugins: [] };
    if (/^\/users\/\d+$/.test(path)) return { user: author(0), following: false, followers: 1, followingCount: 1, postCount: 20, activity: [], posts: posts() };
    if (path === "/me/activity") return { items: [] };
    if (/^\/posts\/\d+\/comments/.test(path)) return { items: [] };
    if (/^\/posts\/\d+$/.test(path)) return posts(1)[0];
    if (path === "/notifications") return { unread: 0, items: [] };
    if (path === "/me") return { id: 1, name: "Yo", handle: "yo" };
    return {};
  });
}

const stateBytes = (s) => utf8Length(JSON.stringify(s));
// The bound for the whole screen state with every list full of maximal cards: 44 KB (events.js STATE_LINE), about two
// thirds of Kino's 64 KB cap, so 20 KB stay free for what these tests leave out (the posts' own words, comments in the
// open thread, the composer).
const STATE_BOUND = 44 * 1024;

async function fullFeed() {
  cardServer();
  const me = { id: 1, name: "Yo", handle: "yo" };
  let s = { view: "main", me };
  const main = { name: "main", params: {} };
  s = merge(s, await screenEvent({ name: "refresh", state: s, route: main }));
  for (let i = 0; i < 4; i++) s = merge(s, await screenEvent({ name: "more", state: s, route: main }));
  for (let i = 0; i < 3; i++) s = merge(s, await screenEvent({ name: "tick", state: s, route: main }));
  return s;
}

test("the whole state on the main feed (80 posts, the newer ones, an open post) stays under 44 KB", async () => {
  let s = await fullFeed();
  assert.equal(s.feed.length, 80);
  assert.ok(s.newer.length <= 10, "newer " + s.newer.length);
  s = merge(s, await screenEvent({ name: "openPost", arg: "3", device: "tv", state: s, route: { name: "main", params: {} } }));
  assert.ok(s.thread && s.thread.post);
  assert.ok(stateBytes(s) <= STATE_BOUND, "main state " + stateBytes(s) + " B");
});

test("the whole state deep in a community (its feed, a person, your profile, a post) stays under 44 KB", async () => {
  let s = await fullFeed();
  const at = (name) => ({ name, params: {} });
  s = merge(s, await screenEvent({ name: "openCommunity", arg: "5", state: s, route: at("main") }));
  for (let i = 0; i < 4; i++) s = merge(s, await screenEvent({ name: "moreCommunity", state: s, route: at("community") }));
  s = merge(s, await screenEvent({ name: "openUser", arg: "9", state: s, route: at("community") }));
  s = merge(s, await screenEvent({ name: "openProfile", state: s, route: at("user") }));
  s = merge(s, await screenEvent({ name: "openPost", arg: "3", device: "phone", state: s, route: at("me") }));
  assert.ok(s.cfeed.length && s.user.posts.length && s.profile.posts.length && s.thread.post);
  assert.ok(stateBytes(s) <= STATE_BOUND, "community state " + stateBytes(s) + " B (feed " + s.feed.length + ", cfeed " + s.cfeed.length + ")");
});

test("back on the main feed, the pages left behind leave the state", async () => {
  cardServer();
  const s = { view: "main", me: { id: 1 }, feed: [], cfeed: [bigRoutePost()], cnext: 3, community: { id: 5 }, user: { posts: [bigRoutePost()] },
    profile: { posts: [] }, myActivity: [], myPlugins: [] };
  const out = await screenEvent({ name: "tab", value: "feed", state: s, route: { name: "main", params: {} } });
  const next = merge(s, out);
  for (const k of ["cfeed", "cnext", "community", "user", "profile", "myActivity", "myPlugins"]) assert.equal(next[k], undefined, k);
  // Inside a community nothing is dropped.
  const inside = await screenEvent({ name: "tab", value: "feed", state: s, route: { name: "community", params: {} } });
  assert.equal(inside.state.cfeed, undefined);
});

// --- Fix round 2 ------------------------------------------------------------------------------------------------------

const at = (name) => ({ name, params: {} });

test("entering a community keeps the main feed whole (80 posts, its cursor) when the state has room", async () => {
  cardServer();
  const feed = Array.from({ length: 80 }, (_, i) => ({ type: "post", id: 5000 + i, user: author(i), text: "hola", comments: 0, likes: 0, liked: false, createdAt: 1700000000000 - i }));
  let s = { view: "main", me: { id: 1, name: "Yo", handle: "yo" }, feed, next: 1699999999000 };
  s = merge(s, await screenEvent({ name: "openCommunity", arg: "5", state: s, route: at("main") }));
  assert.equal(s.feed.length, 80);
  assert.equal(s.next, 1699999999000);
  s = merge(s, await screenEvent({ name: "moreCommunity", state: s, route: at("community") }));
  assert.equal(s.feed.length, 80);
});

/** Into a community and deeper, then Kino's system Back to the feed: a route change that sends no event. */
async function deepThenSystemBack() {
  let s = await fullFeed();
  s = merge(s, await screenEvent({ name: "openCommunity", arg: "5", state: s, route: at("main") }));
  for (let i = 0; i < 4; i++) s = merge(s, await screenEvent({ name: "moreCommunity", state: s, route: at("community") }));
  s = merge(s, await screenEvent({ name: "openUser", arg: "9", state: s, route: at("community") }));
  assert.equal(s.view, "community");
  return s; // the system Back pops "user" and "community": no event, nothing changes in the state
}

test("after a system Back, the next event on the feed resets the view, drops the pages and the tick works again", async () => {
  let s = await deepThenSystemBack();
  const asked = [];
  const fetch = globalThis.kino.fetch;
  globalThis.kino.fetch = async (url, o) => { asked.push(url); return fetch(url, o); };
  const out = await screenEvent({ name: "tick", state: s, route: at("main") });
  s = merge(s, out);
  assert.equal(s.view, "main");
  for (const k of ["cfeed", "cnext", "community", "user"]) assert.equal(s[k], undefined, k);
  assert.ok(asked.some((u) => /\/feed\?limit=20$/.test(u)), "the tick asked for the feed: " + asked.join(" "));
  assert.ok(s.newer.length > 0);
  // And deeper again from the main route, everything at its most: still under the bound.
  for (let i = 0; i < 4; i++) s = merge(s, await screenEvent({ name: "more", state: s, route: at("main") }));
  s = merge(s, await screenEvent({ name: "openUser", arg: "9", state: s, route: at("main") }));
  s = merge(s, await screenEvent({ name: "openProfile", state: s, route: at("user") }));
  s = merge(s, await screenEvent({ name: "openPost", arg: "3", device: "phone", state: s, route: at("me") }));
  assert.ok(stateBytes(s) <= STATE_BOUND, "state " + stateBytes(s) + " B");
});

test("a notice's deep link into a community still opens it: its route decides, its view stays", async () => {
  cardServer();
  const out = await screenEvent({ name: "open", state: {}, route: { name: "community", params: {}, args: { id: "5" } } });
  assert.equal(out.state.view, "community");
  assert.equal(out.state.community.id, 5);
});

test("a post written on the main route goes to the general feed even when the state still names a community", async () => {
  const sent = [];
  fakeServer((path) => (path === "/posts" ? { type: "post", id: 77, user: author(1), text: "hola", likes: 0, comments: 0, createdAt: 1 } : {}));
  const fetch = globalThis.kino.fetch;
  globalThis.kino.fetch = async (url, o) => { sent.push({ url, json: o && o.body && o.body.json }); return fetch(url, o); };
  const stale = { view: "community", me: { id: 1 }, community: { id: 5, name: "Anime", posts: 3 }, cfeed: [], feed: [], inputs: { postText: "hola" } };
  await screenEvent({ name: "publish", state: stale, route: at("main") });
  const general = sent.find((x) => x.url.endsWith("/posts"));
  assert.equal(general.json.communityId, undefined);
  sent.length = 0;
  await screenEvent({ name: "publish", state: stale, route: at("community") });
  assert.equal(sent.find((x) => x.url.endsWith("/posts")).json.communityId, 5);
});

// --- final review: a screen opened from a draft notice ----------------------------------------------------------------

test("a screen opened at the draft route is the feed: its tick asks the feed", async () => {
  cardServer();
  const root = { name: "draft", params: {}, args: { id: "gone" } };
  let s = merge({}, await screenEvent({ name: "open", state: {}, route: root }));
  assert.equal(s.view, "main");
  const asked = [];
  const fetch = globalThis.kino.fetch;
  globalThis.kino.fetch = async (url, o) => { asked.push(url); return fetch(url, o); };
  s = merge(s, await screenEvent({ name: "tick", state: s, route: root }));
  assert.ok(asked.some((u) => /\/feed\?limit=20$/.test(u)), "the tick asked for the feed: " + asked.join(" "));
  assert.ok(s.newer.length > 0);
});

test("root draft, deep, system Back: the next feed event resets the view, drops the pages and stays bounded", async () => {
  let s = await fullFeed();
  const root = at("draft");
  s = merge(s, await screenEvent({ name: "openCommunity", arg: "5", state: s, route: root }));
  for (let i = 0; i < 4; i++) s = merge(s, await screenEvent({ name: "moreCommunity", state: s, route: at("community") }));
  s = merge(s, await screenEvent({ name: "openUser", arg: "9", state: s, route: at("community") }));
  // System Back to the root: no event. The next one comes from the root route.
  const out = await screenEvent({ name: "tick", state: s, route: root });
  s = merge(s, out);
  assert.equal(s.view, "main");
  for (const k of ["cfeed", "cnext", "community", "user"]) assert.equal(s[k], undefined, k);
  assert.ok(stateBytes(s) <= STATE_BOUND, "state " + stateBytes(s) + " B");
});

test("on the draft root the feed is on screen: a crowded state sheds what waits, never the feed itself", async () => {
  let s = await fullFeed();
  const root = at("draft");
  // A long thread open beside the feed on a TV (no page pushed) crowds the state with the feed full.
  s = { ...s, thread: { postId: "1", post: s.feed[0], items: Array.from({ length: 50 }, (_, i) => ({ id: i, text: "x".repeat(300), user: { id: 1, name: "Yo" } })) } };
  assert.ok(stateBytes(s) > STATE_BOUND, "crowded: " + stateBytes(s) + " B");
  s = merge(s, await screenEvent({ name: "tick", state: s, route: root }));
  assert.equal(s.feed.length, 80, "feed " + s.feed.length);
  assert.deepEqual(s.newer, [], "what waits behind «N nuevas» went first");
});
