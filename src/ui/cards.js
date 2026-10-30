// One feed item as a card: a post (author, text, link preview, likes and comments), what someone watched (with the
// poster), or the people worth following while the person follows few.

import { T, watchedLine } from "../i18n.js";
import { Avatar, Button, IconBtn, NameBlock, Raw, TextBtn, Txt, count, isTv } from "./kit.js";

function authorRow(post, ctx, me, pfx) {
  const mine = me && post.user.id === me.id;
  return {
    type: "Row", gap: 12, crossAxisAlignment: "center",
    children: [
      { type: "Stack", key: `${pfx}av-${post.type}-${post.id}`, onTap: { event: "openUser", arg: String(post.user.id) }, children: [Avatar(post.user)] },
      NameBlock(post.user, post.community && String(post.community.id) !== String(ctx.community)
        ? [Txt([`en ${post.community.name}`, `in ${post.community.name}`], { style: "caption", color: "primary", maxLines: 1 })] : [],
      { time: post.createdAt }),
      ...(mine && !isTv(ctx) ? [IconBtn("more_vert", T.postMenu, { event: "postMenu", arg: String(post.id) }, { key: pfx + "menu-" + post.id })] : []),
    ],
  };
}

/** The link's card, as Kino's stories look: the picture edge to edge, the site, the title, two lines of description. */
function linkCard(post, ctx, pfx) {
  const link = post.link;
  if (!link) return null;
  const host = (link.url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || link.url;
  const https = /^https:\/\//i.test(link.url);
  if (link.tmdb && link.title) {
    // A TMDB or IMDb title Kino knows: its poster, and a tap opens it in Kino (on the TV too).
    return { type: "Card", key: pfx + "link-" + post.id, variant: "outlined", padding: 12,
      onTap: { go: { titleByIds: { tmdb: link.tmdb.id, kind: link.tmdb.kind, title: link.title.slice(0, 120) } } },
      children: [{ type: "Row", gap: 12, crossAxisAlignment: "center", children: [
        { type: "Image", width: { compact: 64, expanded: 80 }, aspect: "2:3", borderRadius: "small", alt: link.title, altEn: link.title,
          ...(link.image ? { url: link.image } : {}),
          fallback: { type: "Stack", color: "primaryContainer", children: [{ type: "Icon", name: link.tmdb.kind === "movie" ? "movie" : "tv", margin: 12 }] } },
        { type: "Column", flex: 1, gap: 4, children: [
          Raw(link.title, { style: "h5", bold: true, maxLines: 2 }),
          ...(link.desc ? [Raw(link.desc, { style: "caption", color: "muted" })] : []),
          Txt(["Ver en Kino", "Watch in Kino"], { style: "label", color: "primary" }),
        ] },
        { type: "Icon", name: "play", color: "primary" },
      ] }] };
  }
  const tap = https && !isTv(ctx) ? { go: { url: { href: link.url, title: (link.title || host).slice(0, 60) } } } : undefined;
  if (!link.title) {
    return { type: "Card", key: pfx + "link-" + post.id, variant: "outlined", padding: 12, onTap: tap,
      children: [{ type: "Row", gap: 8, crossAxisAlignment: "center", children: [{ type: "Icon", name: "link", color: "primary" }, Raw(host, { color: "primary", maxLines: 1, flex: 1 })] }] };
  }
  return {
    type: "Card", key: pfx + "link-" + post.id, variant: "outlined", flush: true, onTap: tap,
    children: [
      ...(link.image ? [{ type: "Image", url: link.image, aspect: "16:9", alt: link.title, altEn: link.title,
        fallback: { type: "Stack", color: "surfaceVariant", children: [{ type: "Icon", name: "link", margin: 16 }] } }] : []),
      { type: "Column", padding: 12, gap: 4, children: [
        Raw((link.site || host).toUpperCase(), { style: "label", color: "muted", maxLines: 1 }),
        Raw(link.title, { style: "h5", bold: true, maxLines: 2 }),
        ...(link.desc ? [Raw(link.desc, { style: "caption", color: "muted", maxLines: 2 })] : []),
      ] },
    ],
  };
}

function actionsRow(post, ctx, pfx, full) {
  const likeLabel = post.liked ? ["Ya no me gusta", "Unlike"] : ["Me gusta", "Like"];
  return {
    type: "Row", gap: 4, crossAxisAlignment: "center",
    children: [
      { type: "TextButton", key: pfx + "like-" + post.id, icon: "heart", labelText: post.likes ? count(post.likes) : likeLabel[0],
        labelTextEn: post.likes ? count(post.likes) : likeLabel[1], selected: !!post.liked, color: post.liked ? "primary" : "muted", tooltip: likeLabel[0], tooltipEn: likeLabel[1],
        onPressed: { event: post.liked ? "unlike" : "like", arg: String(post.id) } },
      ...(full ? [] : [{ type: "TextButton", key: pfx + "comments-" + post.id, color: "muted",
        labelText: post.comments ? `${count(post.comments)} ${post.comments === 1 ? "comentario" : "comentarios"}` : T.comment[0],
        labelTextEn: post.comments ? `${count(post.comments)} ${post.comments === 1 ? "comment" : "comments"}` : T.comment[1],
        onPressed: { event: "openPost", arg: String(post.id) } }]),
    ],
  };
}

export function postCard(post, ctx, me, { selected = false, full = false } = {}) {
  const tv = isTv(ctx);
  const pfx = full ? "t-" : "";
  return {
    type: "Card", key: pfx + "post-" + post.id, padding: { x: 16, y: 12 }, gap: 12, elevation: 1,
    // On the TV the whole card is one stop: OK opens it beside the feed (its likes and comments live there).
    ...(tv && !full ? { onTap: { event: "openPost", arg: String(post.id) }, selected } : {}),
    children: [
      authorRow(post, ctx, me, pfx),
      Raw(post.text, { maxLines: full ? undefined : tv ? 4 : 12 }),
      ...(post.link ? [linkCard(post, ctx, pfx)] : []),
      ...(!tv || full ? [actionsRow(post, ctx, pfx, full)] : [{ type: "Row", gap: 16, children: [
        { type: "Row", gap: 4, crossAxisAlignment: "center", children: [{ type: "Icon", name: "heart", color: post.liked ? "error" : "muted" }, Raw(count(post.likes || 0), { style: "caption", color: "muted" })] },
        ...(post.comments ? [Txt([`${count(post.comments)} ${post.comments === 1 ? "comentario" : "comentarios"}`, `${count(post.comments)} ${post.comments === 1 ? "comment" : "comments"}`], { style: "caption", color: "muted" })] : []),
      ] }]),
    ],
  };
}

export function activityCard(item) {
  const line = watchedLine(item);
  const many = item.episodes > 1 ? [` · ${item.episodes} episodios`, ` · ${item.episodes} episodes`] : ["", ""];
  const open = { go: { titleByIds: { tmdb: item.tmdbId, kind: item.kind, title: item.title.slice(0, 120) } } };
  if (item.still) {
    // An episode with its own picture: shown big, like a story, with who watched it above and what it was below.
    return {
      type: "Card", key: "act-" + item.id, flush: true, elevation: 1, onTap: open,
      children: [
        { type: "Row", gap: 8, crossAxisAlignment: "center", padding: { x: 16, y: 12 }, children: [
          Avatar(item.user, 16),
          { type: "Column", flex: 1, gap: 0, children: [
            Raw(item.user.name, { style: "label", bold: true, maxLines: 1 }),
            Txt([line[0] + many[0], line[1] + many[1]], { style: "caption", color: "muted", maxLines: 1 }),
          ] },
          { type: "Text", time: item.createdAt, style: "caption", color: "muted" },
        ] },
        { type: "Image", url: item.still, aspect: "16:9", alt: item.episodeTitle || item.title, altEn: item.episodeTitle || item.title,
          fallback: { type: "Stack", color: "surfaceVariant", children: [{ type: "Icon", name: "tv", margin: 16 }] } },
        { type: "Row", gap: 12, crossAxisAlignment: "center", padding: { x: 16, y: 12 }, children: [
          { type: "Column", flex: 1, gap: 4, children: [
            Raw(item.title, { style: "h5", bold: true, maxLines: 1 }),
            ...(item.episodeTitle ? [Raw(item.episodeTitle, { style: "caption", color: "muted", maxLines: 1 })] : []),
          ] },
          { type: "Icon", name: "play", color: "primary" },
        ] },
      ],
    };
  }
  return {
    type: "Card", key: "act-" + item.id, background: "surfaceVariant", padding: 12, elevation: 0, onTap: open,
    children: [{
      type: "Row", gap: 12, crossAxisAlignment: "center",
      children: [
        { type: "Image", width: { compact: 64, expanded: 80 }, aspect: "2:3", borderRadius: "small", alt: item.title, altEn: item.title,
          ...(item.poster ? { url: item.poster } : {}),
          fallback: { type: "Stack", color: "primaryContainer", children: [{ type: "Icon", name: item.kind === "movie" ? "movie" : "tv", margin: 12 }] } },
        { type: "Column", flex: 1, gap: 4, children: [
          { type: "Row", gap: 8, crossAxisAlignment: "center", children: [Avatar(item.user, 12), Raw(item.user.name, { style: "label", bold: true, maxLines: 1, flex: 1 })] },
          Txt([line[0] + many[0], line[1] + many[1]], { style: "caption", color: "muted" }),
          Raw(item.title, { style: "h4", maxLines: 2 }),
          { type: "Text", time: item.createdAt, style: "caption", color: "muted" },
        ] },
        { type: "Icon", name: "play", color: "primary" },
      ],
    }],
  };
}

export function suggestionsCard(item, ctx) {
  return {
    type: "Card", key: "sugg", variant: "outlined", padding: 16, gap: 12,
    children: [
      Txt(["Personas que podrías seguir", "People you could follow"], { style: "h5", bold: true }),
      ...item.people.map((p) => ({
        type: "Row", key: "sugg-" + p.id, gap: 12, crossAxisAlignment: "center",
        children: [
          { type: "Stack", onTap: { event: "openUser", arg: String(p.id) }, children: [Avatar(p, 18)] },
          NameBlock(p, p.bio ? [Raw(p.bio, { style: "caption", color: "muted", maxLines: 1 })] : []),
          Button(T.follow, { event: "follow", arg: String(p.id) }, { key: "sfollow-" + p.id }),
        ],
      })),
    ],
  };
}

export function feedItem(item, ctx, me, selectedId) {
  if (item.type === "post") return postCard(item, ctx, me, { selected: String(item.id) === String(selectedId) });
  if (item.type === "activity") return activityCard(item);
  if (item.type === "suggestions") return suggestionsCard(item, ctx);
  return null;
}

/** A comment: the avatar, then a bubble with the name, the text and when. */
export function commentRow(c, me) {
  const mine = me && c.user.id === me.id;
  return {
    type: "Row", key: "c" + c.id, gap: 8, crossAxisAlignment: "start",
    children: [
      { type: "Stack", onTap: { event: "openUser", arg: String(c.user.id) }, children: [Avatar(c.user, 16)] },
      { type: "Card", flex: 1, color: mine ? "primaryContainer" : "surfaceVariant", padding: { x: 12, y: 8 }, gap: 4,
        borderRadius: { topStart: "small", topEnd: "large", bottomStart: "large", bottomEnd: "large" },
        children: [
          { type: "Row", gap: 8, children: [Raw(c.user.name, { style: "label", bold: true, maxLines: 1, flex: 1 }), { type: "Text", time: c.createdAt, style: "caption", color: "muted" }] },
          Raw(c.text),
        ] },
    ],
  };
}

export { TextBtn };
