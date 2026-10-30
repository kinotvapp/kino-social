// «Adjuntar película o serie»: a movie or series attached to a new post, picked from Kino's TMDB search or from what the
// person watched lately (kino.library). The attachment has the shape titlelink.js builds for a pasted TMDB or IMDb link,
// `{ kind, tmdbId, title, year?, poster? }`, and travels as the post's `title`: the server checks it and makes the card.
// Never an 18+ title: TMDB is asked with include_adult=false and any result marked adult is dropped anyway.

const IMAGES = "https://image.tmdb.org/t/p/w342";
export const MAX_RESULTS = 10;
export const MAX_RECENT = 8;
export const MIN_QUERY = 2;
export const MAX_QUERY = 80;

const yearOf = (date) => {
  const y = Number(String(date || "").slice(0, 4));
  return Number.isInteger(y) && y > 1870 && y < 2100 ? y : undefined;
};

/**
 * One TMDB result or details object as an attachment, or null (not a movie or series, 18+, no id or no title).
 * [kind] is used when the object has no `media_type` (a /movie or /tv details answer).
 */
export function fromTmdb(r, kind) {
  if (!r || typeof r !== "object" || r.adult === true) return null;
  const k = r.media_type === "movie" ? "movie" : r.media_type === "tv" ? "series" : r.media_type ? null : kind;
  if (k !== "movie" && k !== "series") return null;
  const id = r.id;
  if (!Number.isInteger(id) || id <= 0 || id >= 1e9) return null;
  const title = String((k === "movie" ? r.title || r.original_title : r.name || r.original_name) || "").trim();
  if (!title) return null;
  const out = { kind: k, tmdbId: id, title: title.slice(0, 120) };
  const year = yearOf(k === "movie" ? r.release_date : r.first_air_date);
  if (year) out.year = year;
  if (typeof r.poster_path === "string" && /^\/[A-Za-z0-9._-]{1,200}$/.test(r.poster_path)) out.poster = IMAGES + r.poster_path;
  return out;
}

export const attachKey = (t) => t.kind + ":" + t.tmdbId;

function dedupe(list, max) {
  const seen = new Set();
  const out = [];
  for (const t of list) {
    if (!t || seen.has(attachKey(t))) continue;
    seen.add(attachKey(t));
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** A /search/multi answer (or /search/movie, /search/tv with [kind]) as at most MAX_RESULTS attachments, people dropped. */
export function searchResults(json, kind) {
  const results = json && Array.isArray(json.results) ? json.results : [];
  return dedupe(results.map((r) => fromTmdb(r, kind)), MAX_RESULTS);
}

/** kino.library entries as `{ kind, tmdbId }` to look up: only titles with a TMDB id, newest first, at most MAX_RECENT. */
export function recentFromLibrary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return dedupe(list.map((e) => {
    const id = Number(e && e.ids && e.ids.tmdb);
    if (!e || (e.kind !== "movie" && e.kind !== "series") || !Number.isInteger(id) || id <= 0 || id >= 1e9) return null;
    return { kind: e.kind, tmdbId: id };
  }), MAX_RECENT);
}

/** Whether [a] is an attachment this plugin made: a movie or series with an id and a title. */
export function validAttachment(a) {
  return !!a && (a.kind === "movie" || a.kind === "series") && Number.isInteger(a.tmdbId) && a.tmdbId > 0 && a.tmdbId < 1e9
    && typeof a.title === "string" && a.title.trim().length > 0;
}

/** The candidate named [key] in the picker's lists (search results first), or null. */
export function pickAttachment(key, ...lists) {
  for (const list of lists) {
    const hit = (list || []).find((t) => t && attachKey(t) === String(key));
    if (hit && validAttachment(hit)) return hit;
  }
  return null;
}

/** A post needs some text or an attached title. */
export const canPublish = (text, attach) => String(text || "").trim().length > 0 || validAttachment(attach);

/**
 * The POST /posts body. A TMDB or IMDb link in the text wins ([linkTitle]); without one, the attachment is the title.
 * Another link's preview ([link]) goes along as before: the server lets the link decide when the text has one.
 */
export function postBody({ text, linkTitle = null, link = null, attach = null, communityId = null }) {
  const title = linkTitle || (validAttachment(attach) ? attach : null);
  return {
    text,
    ...(title ? { title } : {}),
    ...(link && link.title ? { link } : {}),
    ...(communityId ? { communityId: Number(communityId) } : {}),
  };
}

/** The search query from what the person typed, or "" while it is too short. */
export function cleanQuery(value) {
  const q = String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  return q.length >= MIN_QUERY ? q : "";
}

/** Kino's TMDB search for [q]: movies and series only, never adult. Throws when TMDB could not answer. */
export async function searchTitles(q) {
  if (typeof kino.tmdb !== "function") return [];
  const json = await kino.tmdb("/search/multi", { query: q, include_adult: false, language: "es", page: 1 });
  return searchResults(json);
}

/** What the person watched lately (continue watching and finished), with TMDB's poster and year. Never throws. */
export async function recentTitles() {
  if (typeof kino.library !== "object" || !kino.library || typeof kino.tmdb !== "function") return [];
  let entries;
  try {
    entries = await kino.library.watched({ limit: 30 });
  } catch (_) {
    return [];
  }
  const out = [];
  for (const r of recentFromLibrary(entries)) {
    try {
      // Unknown is left out: only what TMDB says is not 18+ is offered.
      const d = await kino.tmdb((r.kind === "movie" ? "/movie/" : "/tv/") + r.tmdbId, { language: "es" });
      const t = fromTmdb(d && { ...d, id: r.tmdbId }, r.kind);
      if (t) out.push(t);
    } catch (_) {
      // skipped; the rest still show
    }
  }
  return out;
}
