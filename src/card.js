// A share card: what a plugin proposes with the wall door's `card` call (a title, a picture, a route that reopens it). It
// carries its sender's real name and address, which Kino gives the provider as `ctx.caller` (Kino 0.9.84); the sender
// cannot write them. Lengths are cut here; what is malformed is refused. The server (app/cards.py) checks the same rules
// strictly, so what leaves this file must already obey them.

import { BASE } from "./api.js";
import { T } from "./i18n.js";
import { decodeBase64, imageSize } from "./imagesize.js";

export const MAX = { title: 120, description: 200, query: 100, text: 500, image: 500, imageBytes: 16384, imageWidth: 200, argsBytes: 1024 };
const MAX_NAME = 60;
const MAX_REPO = 200;
// base64 of MAX.imageBytes: anything longer is refused before decoding.
const MAX_B64 = Math.ceil(MAX.imageBytes / 3) * 4;

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}(\/[A-Za-z0-9._-]{1,100})*$/;
const ROUTE = /^[A-Za-z0-9._~-]{1,64}$/;
const HTTPS_IMAGE = /^https:\/\/[^/\s@]+\.[^/\s@]+\S*$/;
const DATA_IMAGE = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;

const ok = (v) => v !== undefined && v !== null;
/** Lone UTF-16 surrogates out (the server cannot store them). */
const wellFormed = (s) => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
/** Control characters out, whitespace runs folded to one space, trimmed: the server's own tidying of a card's words. */
const oneLine = (s) => wellFormed(String(s)).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
/** Like share's text: control characters out (newlines kept), blank-line runs folded, trimmed. */
const tidy = (s) => wellFormed(String(s)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\n{3,}/g, "\n\n").trim();
/** The first [n] UTF-16 units, never ending on half a surrogate pair. */
export function cut(s, n) {
  if (s.length <= n) return s;
  const c = s.charCodeAt(n - 1);
  return (c >= 0xd800 && c <= 0xdbff ? s.slice(0, n - 1) : s.slice(0, n)).trimEnd();
}

/** `owner/name[/path]` from an install address with any `@ref` cut off; null when it is not one (a file or URL install). */
export function plainRepo(repo) {
  if (typeof repo !== "string") return null;
  const at = repo.indexOf("@");
  const plain = at >= 0 ? repo.slice(0, at) : repo;
  if (plain.length > MAX_REPO || plain.includes("://") || !REPO.test(plain)) return null;
  if (plain.split("/").some((seg) => seg === "." || seg === "..")) return null;
  return plain;
}

/**
 * The plugin calling, from Kino's `ctx`: `{ id, repo, name, adult }`, or null on a Kino that gives no `ctx`. Fails closed:
 * a caller is 18+ unless Kino says plainly it is not (`adult: false`).
 */
export function callerOf(ctx) {
  const c = ctx && ctx.caller;
  if (!c || typeof c !== "object") return null;
  const id = String(c.id || "");
  const name = cut(oneLine(c.name || ""), MAX_NAME) || cut(id, MAX_NAME);
  return { id, repo: plainRepo(c.repo), name, adult: c.adult !== false };
}

/** A card image as the server takes it (an https URL or a checked data-URI thumbnail), or null. */
export function checkImage(v) {
  const s = String(v);
  if (s.startsWith("data:")) {
    const m = s.length <= MAX_B64 + 40 ? DATA_IMAGE.exec(s) : null;
    if (!m || m[2].length > MAX_B64) return null;
    const bytes = decodeBase64(m[2]);
    const size = bytes && imageSize(bytes);
    if (!size || size.mime !== "image/" + m[1] || bytes.length > MAX.imageBytes || size.width > MAX.imageWidth) return null;
    return s;
  }
  return s.length <= MAX.image && HTTPS_IMAGE.test(s) && !PY_SPACE.test(s) && !adultHost(s) ? s : null;
}

// What the server refuses that HTTPS_IMAGE lets by (app/preview.py `_image`), so a card is refused here as `bad_image`
// instead of an unexplained «Esta tarjeta no se puede publicar»:
// - characters Python's `\S` reads as spaces and JavaScript's `\s` does not;
const PY_SPACE = /[\u001C-\u001F\u0085]/;
// - a host on its ADULT_DOMAINS list, or under one (urlsplit's hostname: no port, lower case, trailing dots off).
const ADULT_DOMAINS = ["pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "onlyfans.com", "redtube.com", "youporn.com", "chaturbate.com"];
function adultHost(url) {
  const netloc = url.slice("https://".length).split(/[/?#]/)[0];
  const host = netloc.replace(/:\d*$/, "").toLowerCase().replace(/\.+$/, "");
  return ADULT_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

/** UTF-8 length of [s] (QuickJS may have no TextEncoder). */
export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** Whether every string (and key) in [v] is storable: no NUL, no lone surrogate. */
function storable(v) {
  if (typeof v === "string") return !v.includes("\u0000") && wellFormed(v) === v;
  if (Array.isArray(v)) return v.every(storable);
  if (v && typeof v === "object") return Object.keys(v).every((k) => storable(k) && storable(v[k]));
  return true;
}

function checkRoute(r) {
  if (!r || typeof r !== "object" || typeof r.name !== "string" || !ROUTE.test(r.name)) return null;
  let args = {};
  if (ok(r.argsJson)) {
    // Longer than the limit as sent: refused without parsing it (cheap; the compact size is checked below).
    if (String(r.argsJson).length > MAX.argsBytes) return null;
    try { args = JSON.parse(String(r.argsJson)); } catch (_) { return null; }
    if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  }
  if (utf8Length(JSON.stringify(args)) > MAX.argsBytes || !storable(args)) return null;
  return { name: r.name, args };
}

/**
 * What a `card` call asks for, checked: `{ card, text }` (the card has only the fields that came: `title`, and maybe
 * `description`, `image`, `route: { name, args }`, `query`), or `"bad_title"`, `"bad_image"` or `"bad_route"`. Kino has
 * already checked the types against the door (a `null` reads as absent); this checks the meaning.
 */
export function checkCard(arg) {
  const a = arg && typeof arg === "object" ? arg : {};
  const title = ok(a.title) ? cut(oneLine(a.title), MAX.title) : "";
  if (!title) return "bad_title";
  const card = { title };
  const description = ok(a.description) ? cut(oneLine(a.description), MAX.description) : "";
  if (description) card.description = description;
  if (ok(a.image)) {
    const image = checkImage(a.image);
    if (!image) return "bad_image";
    card.image = image;
  }
  if (ok(a.route)) {
    const route = checkRoute(a.route);
    if (!route) return "bad_route";
    card.route = route;
  }
  const query = ok(a.query) ? cut(oneLine(a.query), MAX.query) : "";
  if (query) card.query = query;
  const text = ok(a.text) ? cut(tidy(a.text), MAX.text) : "";
  return { card, text };
}

// --- A card in the feed ---------------------------------------------------------------------------------------------
//
// The screen state (Kino caps it at 64 KB) holds the feed (80 posts), the newer ones, a community's feed, a person's and
// your own posts, and the open post, at most about 90 posts at a time (events.js caps the lists). A card as the server
// sends it can weigh about 2.3 KB (a 1 KB route, a 500-character image URL, a 200-character description...), so it never enters the state
// whole: `slimCard` keeps what the feed draws, under compact keys and within CARD_STATE_BYTES, in this order of need:
// the plugin's name and the title (always), the picture, what the button opens when it is short (an id or two), the
// description (cut with «…» to what is left), and a longer route if it still fits. A route that does not fit is marked
// `m` and read again from the server when the person presses the button (`cardTap`).
//
// Slim form: { n: name, t: title, i?: image, d?: description, g?: { r: repo, o?: route, a?: args, q?: query }, m?: 1 }.

/**
 * At most this many UTF-8 bytes of a card, as JSON, stay in the screen state: about 25 KB for the ~90 posts the state can
 * hold, so the whole state with every post carrying a maximal card stays under 48 KB (test/cards.test.mjs).
 */
export const CARD_STATE_BYTES = 280;
// Bytes (as JSON) of the name, the title and a route kept before the description; the description's characters.
const SLIM = { name: 48, title: 150, go: 128, description: 100 };
const MEDIA = /^\/media\/[A-Za-z0-9_-]{1,128}$/;

const sizeOf = (v) => utf8Length(JSON.stringify(v));
/** Bytes of [s] inside a JSON string (quotes and backslashes escaped), without its own two quotes. */
const jsonBytes = (s) => sizeOf(s) - 2;

/** The start of [s] that takes at most [n] bytes inside a JSON string, never splitting a character. */
function cutBytes(s, n) {
  if (jsonBytes(s) <= n) return s;
  let out = "";
  let used = 0;
  for (const ch of s) {
    const b = jsonBytes(ch);
    if (used + b > n) break;
    out += ch;
    used += b;
  }
  return out.trimEnd();
}

const plainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Whether this Kino honours `go.plugin`. It came in the same Kino as `kino.image` (0.9.84); an older Kino drops the `go`
 * without a word, so there the button asks for an update instead.
 */
export function goPluginReady() {
  const k = typeof kino === "object" && kino ? kino : null;
  return !!k && typeof k.image === "object" && k.image !== null && typeof k.image.thumbnail === "function";
}

/** A card's picture as Kino draws it: the server's `/media/<id>` on its host, an https URL as is, else undefined. */
export function cardImageUrl(image) {
  if (typeof image !== "string") return undefined;
  if (MEDIA.test(image)) return BASE + image;
  return image.length <= MAX.image && HTTPS_IMAGE.test(image) ? image : undefined;
}

/** What the card's button opens, as a server card says it (`{ repo, route?, args?, query }`), or null with no plain repo. */
function goOf(card) {
  const repo = plainRepo(card.plugin && card.plugin.repo);
  // Only an address go.plugin takes as it is (Kino drops one with an `@ref` or a `://` without a word).
  if (!repo || repo !== card.plugin.repo) return null;
  const go = { repo };
  const route = card.route;
  if (route && typeof route.name === "string" && ROUTE.test(route.name)) {
    go.route = route.name;
    if (plainObject(route.args) && Object.keys(route.args).length) go.args = route.args;
  }
  const query = cut(oneLine(card.query || card.title || ""), MAX.query);
  if (query) go.query = query;
  return go;
}

/** A server card in its slim state form (a slim one comes back as it is). */
export function slimCard(card) {
  if (!plainObject(card)) return null;
  // Already slim (it has the slim form's own keys); anything that is neither form draws nothing.
  if (typeof card.n === "string" && typeof card.t === "string" && !("plugin" in card)) return card;
  if (!plainObject(card.plugin) || typeof card.title !== "string") return null;
  const name = cutBytes(oneLine((card.plugin && card.plugin.name) || ""), SLIM.name) || T.pluginFallback[0];
  const out = { n: name, t: cutBytes(oneLine(card.title || ""), SLIM.title) };
  const fits = (extra) => sizeOf({ ...out, ...extra }) <= CARD_STATE_BYTES;
  const image = cardImageUrl(card.image) && card.image;
  if (image && fits({ i: image })) out.i = image;
  const go = goOf(card);
  let g = null;
  if (go) {
    g = { r: go.repo };
    if (go.route) g.o = go.route;
    if (go.args) g.a = go.args;
    // The usual query is the title itself: not kept twice.
    if (go.query && go.query !== cut(out.t, MAX.query)) g.q = go.query;
    // A usual route (an id or two) goes before the description: the button then opens without asking the server again.
    if (sizeOf({ g }) <= SLIM.go && fits({ g })) out.g = g;
  }
  const desc = card.description ? cut(oneLine(card.description), SLIM.description) : "";
  // The description takes what is left (keeping room for the `m` mark a card whose route waits may need); a scrap of
  // under 16 bytes is not worth drawing.
  const room = CARD_STATE_BYTES - sizeOf({ ...out, d: "", ...(g && !out.g ? { m: 1 } : {}) });
  const d = desc && room >= 16 ? shorten(desc, room) : "";
  if (d) out.d = d;
  if (g && !out.g) {
    if (fits({ g })) out.g = g;
    else out.m = 1;
  }
  return out;
}

/** [s] in at most [n] bytes of JSON string: whole, or cut at a word with «…». */
function shorten(s, n) {
  if (jsonBytes(s) <= n) return s;
  const head = cutBytes(s, n - 3);
  const word = head.replace(/\s+\S*$/, "");
  return (word.length >= head.length / 2 ? word : head).replace(/[\s.,;:]+$/, "") + "…";
}

/** A post's card slimmed in place, for every post of a server answer (a page's items, a profile's posts, a post). */
export function slimCards(json) {
  const visit = (o) => {
    if (!o || typeof o !== "object") return;
    if (o.type === "post" && o.card) o.card = slimCard(o.card);
    if (Array.isArray(o.items)) o.items.forEach(visit);
    if (Array.isArray(o.posts)) o.posts.forEach(visit);
    if (o.post) visit(o.post);
  };
  visit(json);
  return json;
}

/** The `go.plugin` of a slim card (the state's), or null when it has none. */
function goOfSlim(c) {
  if (!c || !c.g) return null;
  const go = { repo: c.g.r };
  if (c.g.o) go.route = c.g.o;
  if (c.g.a) go.args = c.g.a;
  go.query = c.g.q || cut(c.t, MAX.query);
  return go;
}

/**
 * The press of a card post: Kino's `go.plugin` when this Kino has it and the card names a plain repo whose route the state
 * kept; otherwise the event `cardTap`, which answers a toast (an older Kino, a plugin with no repo) or reads the route again.
 */
export function cardGo(post) {
  const go = goPluginReady() ? goOfSlim(slimCard(post.card)) : null;
  return go ? { go: { plugin: go } } : { event: "cardTap", arg: String(post.id) };
}

/** `cardTap`'s answer for a server card read again: its go, or null with no repo. */
export const fullCardGo = (card) => (plainObject(card) && card.plugin ? goOf(card) : null);
