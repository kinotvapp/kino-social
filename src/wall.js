// The "wall" door of the plugin protocol (apiVersion 20, manifest enhancements["20"].provides): any installed plugin may
// propose a post for the person's wall with `kino.plugins.call(<alias>, "share", { text?, title?, link?, from? })`.
//
// Nothing is ever published by another plugin. A share only keeps a DRAFT here (kino.storage, at most MAX_DRAFTS, the oldest
// dropped); the person reviews it in Kino Social's composer and presses Publicar themselves. Kino gives a provider call no
// bell (kino.notifications answers only in screen, screenEvent and job), so the "notices" job turns each new draft into one
// notice that opens it, and the feed shows the pending drafts at its top with Revisar and Descartar.
//
// Kino does not tell a provider who called: `from` is the sender's own word, shown as "dice venir de" material only.

import { fromTmdb, withPoster } from "./attach.js";

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

function writeDrafts(list) {
  try { kino.storage.set(DRAFTS_KEY, JSON.stringify(list.slice(0, MAX_DRAFTS))); } catch (_) { /* full storage: nothing kept */ }
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
 * `proto_wall_share(arg)`: keeps [arg] as a draft and answers `{ status: "draft", draftId, pending }`. The same proposal
 * twice (text, title and link alike) keeps one draft. Throws (Kino answers the caller `provider_failed`) when it is unusable.
 */
export async function proto_wall_share(arg) {
  await null;
  const share = checkShare(arg);
  if (typeof share === "string") throw new Error(share);
  const now = Date.now();
  const same = (d) => d.text === share.text && d.link === share.link && JSON.stringify(d.title) === JSON.stringify(share.title);
  const kept = readDrafts(now);
  const twin = kept.find(same);
  const draft = twin || { id: newId(now), at: now, ...share };
  writeDrafts([draft, ...kept.filter((d) => d.id !== draft.id)]);
  return { status: "draft", draftId: draft.id, pending: Math.min(kept.length + (twin ? 0 : 1), MAX_DRAFTS) };
}

/** The bell's notice for a draft: it opens Kino Social on that draft's review. */
export function draftNotice(d) {
  const who = d.from || "";
  const excerpt = (d.text || d.link || "").slice(0, 120);
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
 * The composer filled with draft [d]: `{ state, ui }` for an answer. The title comes back from Kino's TMDB with its name,
 * year and poster (as the person's own pick would); the link goes at the end of the text, where the composer reads links.
 */
export async function reviewState(d) {
  let attach = null;
  if (d.title && typeof kino.tmdb === "function") {
    try {
      const info = await kino.tmdb((d.title.kind === "movie" ? "/movie/" : "/tv/") + d.title.tmdb, { language: "es" });
      attach = fromTmdb(info && { ...info, id: d.title.tmdb }, d.title.kind);
      if (attach) attach = await withPoster(attach);
      // An episode travels on the title (the server makes its card «T1 E3»); only a series has them.
      if (attach && d.title.season && d.title.episode) attach = { ...attach, season: d.title.season, episode: d.title.episode };
    } catch (_) {
      attach = null; // the text still goes; the person can attach it again
    }
  }
  const text = [d.text, d.link && !(d.text || "").includes(d.link) ? d.link : ""].filter(Boolean).join("\n").slice(0, MAX_TEXT);
  return {
    state: { attach, draftId: d.id, picking: false, inputs: { postText: text, titleSearch: "" } },
    ui: [{ open: "composer" }],
  };
}
