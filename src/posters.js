// A card of a TMDB title the server kept without a poster (the post was written when TMDB gave none): the poster is found
// here, by the title's id through Kino's TMDB, and drawn from the device. The server's copy is not touched. Best effort.

import { withPoster } from "./attach.js";

const KEY = "tmdbPosters";
const TTL_MS = 30 * 24 * 3600000;
const MAX_LOOKUPS = 6; // a call's worth; the rest next time
const MAX_KEPT = 200;
const missed = new Set(); // asked this run and nothing found: not asked again until the next start

const readKept = () => {
  try { const o = JSON.parse(kino.storage.get(KEY) || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch (_) { return {}; }
};

/** Every post of [json] (a page's items, a post, a thread's post) whose card has a TMDB title and no picture. */
function bare(json) {
  const out = [];
  const visit = (o) => {
    if (!o || typeof o !== "object") return;
    if (o.link && o.link.tmdb && o.link.title && !o.link.image) out.push(o);
    if (Array.isArray(o.items)) o.items.forEach(visit);
    if (o.post) visit(o.post);
  };
  visit(json);
  return out;
}

/** Fills `link.image` in place for the posts of [json] that came without one. Never throws. */
export async function fillPosters(json) {
  try {
    const posts = bare(json);
    if (!posts.length || typeof kino.tmdb !== "function") return json;
    const kept = readKept();
    let lookups = 0;
    let changed = false;
    for (const post of posts) {
      const { kind, id } = post.link.tmdb;
      const k = kind + ":" + id;
      let poster = kept[k] && kept[k].poster;
      if (!poster && !missed.has(k) && lookups < MAX_LOOKUPS) {
        lookups++;
        const found = await withPoster({ kind, tmdbId: id, title: post.link.title });
        if (found && found.poster) {
          poster = found.poster;
          kept[k] = { poster, at: Date.now() };
          changed = true;
        } else missed.add(k);
      }
      if (poster) post.link.image = poster;
    }
    if (changed) {
      const fresh = Object.entries(kept).filter(([, v]) => v && Date.now() - v.at < TTL_MS).slice(-MAX_KEPT);
      kino.storage.set(KEY, JSON.stringify(Object.fromEntries(fresh)));
    }
  } catch (_) {
    // the cards stay as the server sent them
  }
  return json;
}
