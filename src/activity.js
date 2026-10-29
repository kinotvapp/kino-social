// What the person watched, sent to the server so their followers see it: at most every 10 minutes, only titles with a
// TMDB id, a series only when its latest episode changed, with the poster from Kino's TMDB.

import { call } from "./api.js";

const LAST_KEY = "activityLastSync";
const SENT_KEY = "activitySent";
const POSTERS_KEY = "posters";
const EVERY_MS = 10 * 60 * 1000;
const DAY_MS = 86_400_000;
const MAX_SENT = 500;
const MAX_POSTER_LOOKUPS = 8;
/** Kino's own "watched" mark is 90 % played (kino.d.ts, tracking's `watched`). */
const FINISHED = 0.9;

const readJson = (key, fallback) => {
  try {
    const v = JSON.parse(kino.storage.get(key) || "null");
    return v && typeof v === "object" ? v : fallback;
  } catch (_) {
    return fallback;
  }
};

/** TMDB poster and adult flag for one title, cached for 30 days; null when TMDB could not answer. */
async function tmdbInfo(kind, id, cache) {
  const key = kind + ":" + id;
  if (cache[key]) return cache[key];
  // Unknown (no kino.tmdb, or it failed) is null: the title waits for a run where TMDB can say it is not 18+.
  if (typeof kino.tmdb !== "function") return null;
  let d;
  try {
    d = await kino.tmdb((kind === "movie" ? "/movie/" : "/tv/") + id, { language: "es" });
  } catch (_) {
    return null;
  }
  const info = { poster: d && d.poster_path ? "https://image.tmdb.org/t/p/w342" + d.poster_path : null, adult: !!(d && d.adult) };
  cache[key] = info;
  return info;
}

/** Sends what is new since the last sync. Never throws: activity is best effort. */
export async function syncActivity(now = Date.now()) {
  if (typeof kino.library !== "object") return 0;
  const last = Number(kino.storage.get(LAST_KEY) || 0);
  if (now - last < EVERY_MS) return 0;
  let watched;
  try {
    watched = await kino.library.watched({ limit: 50, sinceMs: last ? last - DAY_MS : undefined });
  } catch (_) {
    return 0;
  }
  const sent = readJson(SENT_KEY, {});
  const posters = readJson(POSTERS_KEY, {});
  const items = [];
  let lookups = 0;
  for (const w of watched) {
    const tmdb = Number(w.ids && w.ids.tmdb);
    if (!Number.isInteger(tmdb) || tmdb <= 0 || (w.kind !== "movie" && w.kind !== "series")) continue;
    if (!(Number(w.progress) >= FINISHED)) continue; // only what the person already watched, never what they are watching
    const sig = w.kind === "series" ? `${w.season ?? ""}x${w.episode ?? ""}` : "m";
    const key = w.kind + ":" + tmdb;
    if (sent[key] === sig) continue;
    if (!posters[key] && lookups++ >= MAX_POSTER_LOOKUPS) continue; // the rest next time
    const info = await tmdbInfo(w.kind, tmdb, posters);
    if (!info) continue; // not sent and not marked: asked again next time
    if (info.adult) {
      sent[key] = sig;
      continue;
    }
    const item = { kind: w.kind, tmdbId: tmdb, title: w.title, watchedAtMs: w.watchedAtMs || now, poster: info.poster || undefined };
    if (w.kind === "series" && Number.isInteger(w.season) && Number.isInteger(w.episode)) {
      item.season = w.season;
      item.episode = w.episode;
    }
    items.push({ item, key, sig });
  }
  kino.storage.set(POSTERS_KEY, JSON.stringify(trim(posters, 200)), { ttlMs: 30 * DAY_MS });
  if (items.length) {
    try {
      await call("/activity", { method: "POST", json: { items: items.map((i) => i.item) } });
    } catch (_) {
      return 0;
    }
    for (const i of items) sent[i.key] = i.sig;
  }
  kino.storage.set(SENT_KEY, JSON.stringify(trim(sent, MAX_SENT)));
  kino.storage.set(LAST_KEY, String(now));
  return items.length;
}

function trim(map, max) {
  const keys = Object.keys(map);
  return keys.length <= max ? map : Object.fromEntries(keys.slice(-max).map((k) => [k, map[k]]));
}
