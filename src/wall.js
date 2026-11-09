// The "wall" door of the plugin protocol (apiVersion 20, manifest enhancements["20"].provides): any installed plugin may
// propose a post for the person's wall with `kino.plugins.call(<alias>, "share", { text?, title?, link?, from? })`.
//
// Nothing is published by another plugin on its own. A share keeps a DRAFT here (kino.storage, at most MAX_DRAFTS, the
// oldest dropped); the person reviews it in Kino Social's composer and presses Publicar themselves. Kino gives a provider
// call no bell (kino.notifications answers only in screen, screenEvent and job), so the "notices" job turns each new draft
// into one notice that opens it, and the feed shows the pending drafts at its top with Revisar and Descartar.
//
// From Kino 0.9.84 every call also gets `ctx.caller`, the real calling plugin `{ id, repo, name, adult }`: a draft then keeps
// it and shows its name. On an older Kino, `share`'s `from` is the sender's own word. `card` (a share card naming and
// reopening its sender) needs `ctx` and refuses an 18+ caller. `publish: true` asks to skip the review: only a plugin the
// person allowed (direct.js) publishes at once; otherwise, or when that fails, the proposal is a draft kept with `direct`,
// and publishing it asks the person whether to allow that plugin. An 18+ caller never publishes directly nor is asked.

import { fromTmdb, withPoster } from "./attach.js";
import { MAX, callerOf, checkCard, checkImage, cut } from "./card.js";
import { isAllowed, publishDirect } from "./direct.js";
import { T } from "./i18n.js";

export const DRAFTS_KEY = "wallDrafts1";
export const MAX_DRAFTS = 5;
export const MAX_TEXT = 500; // the composer's own limit
const MAX_LINK = 500;
const MAX_FROM = 40;
const DRAFT_TTL_MS = 14 * 24 * 3600 * 1000;

const ok = (v) => v !== undefined && v !== null;
/** Control characters out, runs of blank lines folded, trimmed. */
const tidy = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\n{3,}/g, "\n\n").trim();

/** An https address of a public-looking host, or null. */
export function cleanLink(v) {
  if (!ok(v)) return null;
  const s = String(v).trim();
  if (s.length > MAX_LINK) return null;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return null;
  return u.toString();
}

/**
 * What a share asks for, checked: `{ text, title, link, from }` with what is usable, or a string naming why it cannot be a
 * draft. Kino has already checked the types against the door; this checks the meaning.
 */
export function checkShare(arg) {
  const a = arg && typeof arg === "object" ? arg : {};
  const text = ok(a.text) ? tidy(a.text).slice(0, MAX_TEXT) : "";
  let title = null;
  if (ok(a.title)) {
    const t = a.title;
    const tmdb = Number(t.tmdb);
    if ((t.kind !== "movie" && t.kind !== "series") || !Number.isInteger(tmdb) || tmdb <= 0 || tmdb >= 1e9) return "bad_title";
    title = { kind: t.kind, tmdb };
    if (t.kind === "series" && Number.isInteger(t.season) && t.season > 0 && Number.isInteger(t.episode) && t.episode > 0) {
      title.season = t.season;
      title.episode = t.episode;
    }
  }
  const link = ok(a.link) ? cleanLink(a.link) : null;
  if (ok(a.link) && !link) return "bad_link";
  const from = ok(a.from) ? tidy(a.from).replace(/\s+/g, " ").slice(0, MAX_FROM) : "";
  if (!text && !title && !link) return "empty";
  return { text, title, link, from };
}

/** The drafts kept, newest first; expired or malformed ones dropped. */
export function readDrafts(now = Date.now()) {
  let list;
  try { list = JSON.parse(kino.storage.get(DRAFTS_KEY) || "[]"); } catch (_) { list = []; }
  return (Array.isArray(list) ? list : []).filter((d) => d && typeof d.id === "string" && now - Number(d.at || 0) < DRAFT_TTL_MS);
}

/** Writes the drafts; false when the storage refused them (full: nothing changed). */
function writeDrafts(list) {
  try {
    kino.storage.set(DRAFTS_KEY, JSON.stringify(list.slice(0, MAX_DRAFTS)));
    return true;
  } catch (_) {
    return false;
  }
}

/** Changes the kept draft [id] (gone meanwhile: nothing comes back). */
function patchDraft(id, change) {
  writeDrafts(readDrafts().map((d) => (d.id === id ? { ...d, ...change } : d)));
}

export const draftById = (id) => readDrafts().find((d) => d.id === String(id)) || null;

/** Drops draft [id] (published or discarded). */
export function removeDraft(id) {
  writeDrafts(readDrafts().filter((d) => d.id !== String(id)));
}

/** Marks drafts [ids] as already announced in the bell. */
export function markNoticed(ids) {
  const set = new Set(ids);
  writeDrafts(readDrafts().map((d) => (set.has(d.id) ? { ...d, noticed: true } : d)));
}

const newId = (now) => now.toString(36) + Math.floor(Math.random() * 1e6).toString(36);

/**
 * Keeps [draft] on top (in place of a kept one with its id); answers what the door's `Answer` says. A full storage (five
 * card drafts with pictures take about 110 KB of a plugin's 256 KB) first loses the new draft's picture; when even that
 * cannot be kept it throws `storage_full` (the sender gets `provider_failed`), never a draftId for a draft that is not there.
 */
function keepDraft(draft, kept) {
  const isNew = !kept.some((d) => d.id === draft.id);
  const rest = kept.filter((d) => d.id !== draft.id);
  if (!writeDrafts([draft, ...rest])) {
    const card = draft.card && draft.card.image ? (({ image, ...c }) => c)(draft.card) : null;
    if (!card || !writeDrafts([{ ...draft, card }, ...rest])) throw new Error("storage_full");
  }
  return { status: "draft", draftId: draft.id, pending: Math.min(kept.length + (isNew ? 1 : 0), MAX_DRAFTS) };
}

const stamp = (caller) => ({ id: caller.id, repo: caller.repo, name: caller.name });

/**
 * Whether [arg] asks to skip the review, from a [caller] that may: never without `ctx` (no caller to allow), never an 18+
 * caller (it is never asked about).
 */
const wantsDirect = (arg, caller) => !!caller && !caller.adult && !!arg && arg.publish === true;

/**
 * Keeps proposal [fresh] as a draft (into its twin, found by [same], with [intoTwin]) BEFORE any network: Kino's 10 s may
 * end the call at any await, and the proposal must survive that. Then, when its caller is allowed, publishes it at once:
 * `{ status: "published", postId }` and the draft goes. The draft is marked `maybeSent` right before the POST; an answer
 * that says nothing was saved takes the mark away again (unless an earlier attempt left it). Any failure answers the draft.
 */
async function keepOrPublish(fresh, caller, same, intoTwin, now, started) {
  const kept = readDrafts(now);
  const twin = kept.find(same);
  const draft = twin ? intoTwin(twin) : { id: newId(now), at: now, ...fresh };
  const answer = keepDraft(draft, kept);
  if (!fresh.direct || !caller || caller.adult || !isAllowed(caller.repo)) return answer;
  const report = {};
  let marked = false;
  const mark = () => { marked = true; patchDraft(draft.id, { maybeSent: true }); };
  const postId = await publishDirect(fresh, started, report, mark);
  if (postId !== null) {
    removeDraft(draft.id);
    return { status: "published", postId };
  }
  if (marked && !report.maybeSent && draft.maybeSent !== true) patchDraft(draft.id, { maybeSent: undefined });
  return answer;
}

/**
 * `proto_wall_share(arg, ctx)`: keeps [arg] as a draft and answers `{ status: "draft", draftId, pending }`. The same proposal
 * twice (text, title and link alike) keeps one draft. Throws (Kino answers the caller `provider_failed`) when it is unusable.
 * With `ctx` (Kino 0.9.84) the draft keeps the real caller and shows its name instead of `from`; an allowed caller's
 * `publish: true` answers `{ status: "published", postId }` instead.
 */
export async function proto_wall_share(arg, ctx) {
  const started = Date.now();
  await null;
  const share = checkShare(arg);
  if (typeof share === "string") throw new Error(share);
  const caller = callerOf(ctx);
  const now = Date.now();
  const same = (d) => d.kind !== "card" && d.text === share.text && d.link === share.link && JSON.stringify(d.title) === JSON.stringify(share.title);
  const fresh = {
    ...share,
    ...(caller ? { from: caller.name || share.from, caller: stamp(caller) } : {}),
    direct: wantsDirect(arg, caller),
  };
  // A twin keeps its words, id and age; the newer proposal's wish to go direct (and its caller, when it has one) wins.
  const intoTwin = (twin) => ({ ...twin, direct: fresh.direct, ...(caller ? { from: fresh.from, caller: fresh.caller } : {}) });
  return keepOrPublish(fresh, caller, same, intoTwin, now, started);
}

/**
 * `proto_wall_card(arg, ctx)`: keeps a share card as a draft, stamped with the real caller, and answers `{ status: "draft",
 * draftId, pending }`. Throws `no_caller` on a Kino without `ctx`, `adult_caller` for an 18+ caller, and `bad_title`,
 * `bad_image` or `bad_route` for a malformed card. The same card from the same plugin twice keeps one draft (the newer one's
 * words). An allowed caller's `publish: true` answers `{ status: "published", postId }` instead.
 */
export async function proto_wall_card(arg, ctx) {
  const started = Date.now();
  await null;
  const caller = callerOf(ctx);
  if (!caller) throw new Error("no_caller");
  if (caller.adult) throw new Error("adult_caller");
  const checked = checkCard(arg);
  if (typeof checked === "string") throw new Error(checked);
  const { card, text } = checked;
  const now = Date.now();
  // A plugin installed from a file or URL has no repo: its id keeps it apart from another such plugin.
  const who = (c) => (c.repo ? "r:" + c.repo : "i:" + c.id);
  const route = JSON.stringify(card.route);
  const same = (d) => d.kind === "card" && d.caller && d.card && who(d.caller) === who(caller) && d.card.title === card.title && JSON.stringify(d.card.route) === route;
  const fresh = { kind: "card", card, text, from: caller.name, caller: stamp(caller), direct: wantsDirect(arg, caller) };
  // A twin keeps its id, age and bell state but takes the newer card's words.
  return keepOrPublish(fresh, caller, same, (twin) => ({ ...twin, ...fresh }), now, started);
}

/** What a draft says in a line: its text, else its card's title, else its link. */
export const draftExcerpt = (d) => d.text || (d.card && d.card.title) || d.link || "";

/** The bell's notice for a draft: it opens Kino Social on that draft's review. */
export function draftNotice(d) {
  const who = d.from || "";
  const excerpt = draftExcerpt(d).slice(0, 120);
  return {
    id: "dr" + d.id,
    title: who ? `${who} quiere publicar en tu muro` : "Tienes una publicación por revisar",
    titleEn: who ? `${who} wants to post on your wall` : "You have a post to review",
    text: excerpt ? excerpt : "Revísala y publícala si quieres", textEn: excerpt ? excerpt : "Review it and post it if you like",
    go: { screen: { route: "draft", args: { id: d.id } } },
  };
}

/** The job's part: one notice per draft not announced yet. Returns how many the bell took. */
export async function postDraftNotices() {
  if (typeof kino.notifications !== "object") return 0;
  const fresh = readDrafts().filter((d) => !d.noticed).reverse(); // oldest first, so the newest ends on top
  const done = [];
  for (const d of fresh) {
    try {
      await kino.notifications.post(draftNotice(d));
    } catch (_) {
      break; // the bell's hourly cap: tried again on the next run
    }
    done.push(d.id);
  }
  if (done.length) markNoticed(done);
  return done.length;
}

/**
 * A share's `{ kind, tmdb, season?, episode? }` as the composer's attachment, from Kino's TMDB with its name, year and
 * poster (as the person's own pick would), or null (no TMDB, not found, 18+). Never throws. `poster: false` asks TMDB once
 * and does not hunt a missing poster (a direct publish has Kino's 10 s).
 */
export async function titleAttachment(title, { poster = true } = {}) {
  if (!title || typeof kino.tmdb !== "function") return null;
  try {
    const info = await kino.tmdb((title.kind === "movie" ? "/movie/" : "/tv/") + title.tmdb, { language: "es" });
    let attach = fromTmdb(info && { ...info, id: title.tmdb }, title.kind);
    if (attach && poster) attach = await withPoster(attach);
    // An episode travels on the title (the server makes its card «T1 E3»); only a series has them.
    if (attach && title.season && title.episode) attach = { ...attach, season: title.season, episode: title.episode };
    return attach;
  } catch (_) {
    return null; // the text still goes; the person can attach it again
  }
}

/** The stored card draft [draftId]'s image (an https URL or a data-URI thumbnail), for the composer; else null. */
export function draftImage(draftId) {
  const d = draftById(draftId);
  return (d && d.card && typeof d.card.image === "string" && d.card.image) || null;
}

/**
 * Card draft [d] as the POST /posts `card`: its plugin (the real caller's address and name), the card's own fields as
 * stored (the image maybe already a thumbnail), and `query` defaulting to the title cut to the query's limit. The name is
 * never empty (the server requires one): the caller's name, the sender's word, the caller's id, else «Plugin».
 */
export function draftCard(d) {
  const c = d.card;
  const caller = d.caller || {};
  return {
    plugin: { repo: caller.repo || null, name: caller.name || d.from || caller.id || T.pluginFallback[0] },
    title: c.title,
    ...(c.description ? { description: c.description } : {}),
    ...(c.image ? { image: c.image } : {}),
    ...(c.route ? { route: { name: c.route.name, args: c.route.args || {} } } : {}),
    query: c.query || cut(c.title, MAX.query),
  };
}

const THUMBNAIL = { maxWidth: 200, maxBytes: 16384 };

/**
 * A card draft's https image as a small thumbnail made by Kino (`kino.image.thumbnail`), written into the stored draft. On
 * an older Kino, a failure or an answer out of rule, the https URL stays.
 */
async function thumbnailDraft(d) {
  const image = d.card && d.card.image;
  if (typeof image !== "string" || !image.startsWith("https://")) return;
  if (!kino.image || typeof kino.image !== "object" || typeof kino.image.thumbnail !== "function") return;
  let thumb;
  try {
    thumb = await kino.image.thumbnail(image, { ...THUMBNAIL });
  } catch (_) {
    return;
  }
  if (typeof thumb !== "string" || !thumb.startsWith("data:") || !checkImage(thumb)) return;
  writeDrafts(readDrafts().map((x) => (x.id === d.id && x.card ? { ...x, card: { ...x.card, image: thumb } } : x)));
}

/** A share's words as the composer gets them: its text, then its link at the end (where the composer reads links). */
export const reviewText = (d) =>
  [d.text, d.link && !(d.text || "").includes(d.link) ? d.link : ""].filter(Boolean).join("\n").slice(0, MAX_TEXT);

/**
 * The composer filled with draft [d] (`maybeSent`: its direct publish went out unanswered, so the composer warns it may
 * already be on the wall): `{ state, ui }` for an answer. A share's title comes back from Kino's TMDB; its link
 * goes at the end of the text, where the composer reads links. A card shows under the person's own words; the state holds
 * only its few short fields (never its image: a thumbnail would eat the screen state's 64 KB), the rest is read from the
 * stored draft.
 */
export async function reviewState(d) {
  if (d.kind === "card" && d.card) {
    await thumbnailDraft(d);
    const { plugin } = draftCard(d);
    const attachCard = { draftId: d.id, title: d.card.title, ...(d.card.description ? { description: d.card.description } : {}), plugin };
    return {
      state: { attach: null, attachCard, draftId: d.id, maybeSent: d.maybeSent === true, picking: false, inputs: { postText: d.text || "", titleSearch: "" } },
      ui: [{ open: "composer" }],
    };
  }
  const attach = await titleAttachment(d.title);
  const text = reviewText(d);
  return {
    state: { attach, attachCard: null, draftId: d.id, maybeSent: d.maybeSent === true, picking: false, inputs: { postText: text, titleSearch: "" } },
    ui: [{ open: "composer" }],
  };
}
