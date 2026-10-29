// track(event): Kino tells the plugin what the person plays on this device. A title the person finished (`watched`, Kino's
// own 90 % rule) becomes their activity on its own, with the episode's still and name and the show's poster. Kino never
// sends live channels, radio or 18+ titles here.

import { ApiError, call, savedSession } from "./api.js";

const IMAGES = "https://image.tmdb.org/t/p/";

/** What TMDB says of the title, or {} when Kino's TMDB is not reachable from here (the item goes out without pictures). */
async function pictures(kind, id, season, episode) {
  if (typeof kino.tmdb !== "function") return {};
  const out = {};
  try {
    const t = await kino.tmdb((kind === "movie" ? "/movie/" : "/tv/") + id, { language: "es" });
    if (t && t.adult) return null;
    if (t && t.poster_path) out.poster = IMAGES + "w342" + t.poster_path;
    if (kind === "series") {
      const e = await kino.tmdb(`/tv/${id}/season/${season}/episode/${episode}`, { language: "es" });
      if (e && e.still_path) out.still = IMAGES + "w300" + e.still_path;
      if (e && typeof e.name === "string" && e.name.trim()) out.episodeTitle = e.name.trim().slice(0, 200);
    }
  } catch (_) { /* no pictures this time */ }
  return out;
}

export async function track(event) {
  if (!event || event.type !== "watched" || !savedSession()) return { ok: true, skipped: true };
  const episodeOf = event.kind === "episode";
  const id = Number(episodeOf ? event.show && event.show.ids && event.show.ids.tmdb : event.ids && event.ids.tmdb);
  if (!Number.isInteger(id) || id <= 0) return { ok: true, skipped: true };
  const kind = episodeOf ? "series" : "movie";
  const title = String((episodeOf ? event.show && event.show.title : event.title) || "").trim();
  if (!title) return { ok: true, skipped: true };
  const item = { kind, tmdbId: id, title: title.slice(0, 200), watchedAtMs: Number(event.at) || Date.now() };
  if (episodeOf) {
    if (!Number.isInteger(event.season) || !Number.isInteger(event.episode)) return { ok: true, skipped: true };
    item.season = event.season;
    item.episode = event.episode;
  }
  const pics = await pictures(kind, id, item.season, item.episode);
  if (pics === null) return { ok: true, skipped: true }; // TMDB says 18+
  Object.assign(item, pics);
  if (episodeOf && !item.episodeTitle && typeof event.title === "string" && event.title.trim()) {
    item.episodeTitle = event.title.trim().slice(0, 200);
  }
  try {
    await call("/activity", { method: "POST", json: { items: [item] } });
  } catch (e) {
    // Kino retries these later, in order; a lost session or a refusal drops the event.
    if (e instanceof ApiError && (e.code === "offline" || e.code === "rate_limited")) throw kino.error(e.code === "offline" ? "network" : "rate_limited");
    throw kino.error("auth_required");
  }
  return { ok: true };
}
