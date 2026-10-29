// A TMDB or IMDb link in a post: those sites refuse the server's preview, so the plugin asks Kino's TMDB for the title and
// sends it along (the server checks it and keeps only a TMDB poster). The card then opens the title in Kino.

const IMAGES = "https://image.tmdb.org/t/p/w342";
const TMDB_LINK = /https?:\/\/(?:www\.)?themoviedb\.org\/(movie|tv)\/(\d{1,9})/i;
const IMDB_LINK = /https?:\/\/(?:www\.|m\.)?imdb\.com\/title\/(tt\d{7,10})/i;

/** `{ kind, tmdbId, title, year, poster }` for the first TMDB or IMDb link of [text], or null. Never throws. */
export async function titleHint(text) {
  if (typeof kino.tmdb !== "function") return null;
  try {
    let kind;
    let id;
    const t = TMDB_LINK.exec(text);
    if (t) {
      kind = t[1].toLowerCase() === "tv" ? "series" : "movie";
      id = Number(t[2]);
    } else {
      const i = IMDB_LINK.exec(text);
      if (!i) return null;
      const found = await kino.tmdb("/find/" + i[1], { external_source: "imdb_id" });
      const movie = found && found.movie_results && found.movie_results[0];
      const show = found && found.tv_results && found.tv_results[0];
      if (movie) [kind, id] = ["movie", movie.id];
      else if (show) [kind, id] = ["series", show.id];
      else return null;
    }
    const d = await kino.tmdb((kind === "movie" ? "/movie/" : "/tv/") + id, { language: "es" });
    if (!d || d.adult) return null;
    const title = String((kind === "movie" ? d.title : d.name) || "").trim();
    if (!title) return null;
    const year = Number(String((kind === "movie" ? d.release_date : d.first_air_date) || "").slice(0, 4));
    const out = { kind, tmdbId: id, title: title.slice(0, 120) };
    if (Number.isInteger(year) && year > 1870) out.year = year;
    if (d.poster_path) out.poster = IMAGES + d.poster_path;
    return out;
  } catch (_) {
    return null;
  }
}
