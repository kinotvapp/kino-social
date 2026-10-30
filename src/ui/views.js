// The screens: the feed (one column on a phone, the feed and the open post side by side on a TV), the post with its
// comments, the person's profile, people (search and follow), another person's profile, and the first-time welcome
// that picks the @handle.

import { T } from "../i18n.js";
import { muteLine, mutedUntil } from "../moderation.js";
import { activityCard, commentRow, feedItem, postCard } from "./cards.js";
import { communitiesTab } from "./communities.js";
import { MAX_QUERY, attachKey } from "../attach.js";
import { Avatar, Button, IconBtn, NameBlock, Raw, Tag, TextBtn, Txt, isTv, pagePadding } from "./kit.js";

const MAX_TEXT = 500;

// ---- pieces ----------------------------------------------------------------------------------------------------------

/** While the server says the person is muted (moderation), the end of it; else 0. */
const muted = (s) => mutedUntil(s.mutedUntil);

function composerPrompt(s) {
  const until = muted(s);
  return {
    type: "Card", key: "prompt", variant: "outlined", padding: 12, borderRadius: "large",
    onTap: { ui: [{ open: "composer" }] }, ...(until ? { enabledAt: until } : {}),
    children: [{ type: "Row", gap: 12, crossAxisAlignment: "center", children: [
      Avatar(s.me), until ? muteLine(until, { flex: 1 }) : Txt(T.prompt, { color: "muted", flex: 1 }), { type: "Icon", name: "edit", color: "primary" },
    ] }],
  };
}

/** A title as a small card: its poster, title and «2024 · Película»; [trailing] goes at its end. */
export function titleRow(t, props = {}, trailing = []) {
  return {
    type: "Card", variant: "outlined", padding: 8, ...props,
    children: [{ type: "Row", gap: 12, crossAxisAlignment: "center", children: [
      { type: "Image", width: 40, aspect: "2:3", borderRadius: "small", alt: t.title, altEn: t.title, ...(t.poster ? { url: t.poster } : {}),
        fallback: { type: "Stack", color: "primaryContainer", children: [{ type: "Icon", name: t.kind === "movie" ? "movie" : "tv", margin: 8 }] } },
      { type: "Column", flex: 1, gap: 4, children: [
        Raw(t.title, { style: "h5", bold: true, maxLines: 2 }),
        Txt(T.titleLine(t), { style: "caption", color: "muted", maxLines: 1 }),
      ] },
      ...trailing,
    ] }],
  };
}

/** The picker inside the composer: a search field, then what the person watched lately or what the search found. */
function titlePicker(s) {
  const q = s.pickQuery || "";
  const pick = (t) => titleRow(t, { key: "pick-" + t.kind + "-" + t.tmdbId, onTap: { event: "attachTitle", arg: attachKey(t) } });
  const list = [];
  if (!q) {
    const recent = s.pickRecent || [];
    if (recent.length) list.push(Txt(T.watching, { style: "label", color: "muted" }), ...recent.map(pick));
    else list.push(Txt(T.searchTitlesHint, { style: "caption", color: "muted" }));
  } else if (s.pickError) list.push(Txt(s.pickError === "noTmdb" ? T.noTmdb : T.searchFailed, { style: "caption", color: "error" }));
  else if (s.pickResults == null) list.push({ type: "CircularProgressIndicator" });
  else if (!s.pickResults.length) list.push(Txt(T.noTitles, { style: "caption", color: "muted" }));
  else list.push(...s.pickResults.map(pick));
  return {
    type: "Card", key: "picker", background: "surfaceVariant", padding: 12, gap: 8,
    children: [
      { type: "Row", gap: 8, crossAxisAlignment: "center", children: [
        Txt(T.attach, { style: "h5", bold: true, flex: 1 }),
        IconBtn("close", T.cancel, "cancelAttach", { key: "cancelAttach" }),
      ] },
      { type: "TextField", key: "titleSearch", kind: "search", maxLength: MAX_QUERY, labelText: T.searchTitles[0], labelTextEn: T.searchTitles[1],
        onChanged: "searchTitles", autofocus: true },
      ...list,
    ],
  };
}

function composerSheet(s) {
  const until = muted(s);
  const lock = until ? { enabled: false } : {};
  const attach = s.attach || null;
  const attachment = attach
    ? titleRow(attach, { key: "attached" }, [IconBtn("close", T.removeAttach, "clearAttach", { key: "clearAttach", ...lock })])
    : s.picking ? titlePicker(s)
      : { type: "Button", variant: "secondary", key: "openAttach", icon: "movie", labelText: T.attach[0], labelTextEn: T.attach[1],
        onPressed: { event: "openAttach", timeoutMs: 20000 }, ...lock };
  return {
    type: "BottomSheet", key: "composer", title: T.compose[0], titleEn: T.compose[1],
    children: [{ type: "Form", key: "composeForm", gap: 12, onSubmit: { event: "publish", timeoutMs: 28000 }, children: [
      // Several lines (Enter is a new line); Kino draws a multi-line field 3 lines high, growing to 8.
      { type: "TextField", key: "postText", multiline: true, maxLines: 8, maxLength: MAX_TEXT, required: !attach,
        labelText: T.prompt[0], labelTextEn: T.prompt[1], hintText: T.postHint[0], hintTextEn: T.postHint[1], ...lock },
      attachment,
      until ? muteLine(until) : Txt(T.aiNote, { style: "caption", color: "muted" }),
      { type: "ElevatedButton", key: "publish", icon: "send", labelText: T.publish[0], labelTextEn: T.publish[1], submit: true, fill: true, ...lock },
    ] }],
  };
}

/** Where a feed list reads from: the general feed by default, or a community's ([communitySource]). */
export function generalSource(s) {
  return { items: s.feed, next: s.next, newer: s.newer, loadingMore: s.loadingMore, key: "feed", more: "more", canPost: true, header: null };
}

function newerBanner(s) {
  const n = (s.newer || []).length;
  if (!n) return null;
  const [es, en] = T.newPosts(n);
  return { type: "Row", key: "newerRow", mainAxisAlignment: "center", children: [
    { type: "Button", variant: "secondary", key: "showNewer", icon: "expand_less", labelText: es, labelTextEn: en, onPressed: "showNewer", autofocus: true },
  ] };
}

function moreButton(src) {
  if (!src.next) return null;
  return { type: "Row", key: src.key + "MoreRow", mainAxisAlignment: "center", children: [
    { type: "Button", variant: "secondary", key: src.key + "More", icon: "expand_more", labelText: T.more[0], labelTextEn: T.more[1],
      onPressed: { event: src.more, timeoutMs: 20000 }, loading: !!src.loadingMore },
  ] };
}

const emptyFeed = () => ({ type: "emptyState", icon: "edit", title: T.emptyFeed[0], titleEn: T.emptyFeed[1], text: T.emptyFeedText[0], textEn: T.emptyFeedText[1] });

function skeletonFeed() {
  return Array.from({ length: 3 }, (_, i) => ({ type: "Card", key: "sk" + i, padding: 16, gap: 12, children: [
    { type: "Row", gap: 12, children: [{ type: "Skeleton", width: 40, height: 40, borderRadius: "full" }, { type: "Skeleton", width: 160, height: 16 }] },
    { type: "Skeleton", height: 16, fill: true }, { type: "Skeleton", height: 16, width: 240 },
  ] }));
}

function feedList(s, ctx, src = generalSource(s)) {
  const items = [];
  if (src.header) items.push(src.header);
  if (!isTv(ctx) && src.canPost) items.push(composerPrompt(s));
  const newer = src.key === "feed" ? newerBanner(s) : null;
  if (newer) items.push(newer);
  if (src.items === undefined) items.push(...skeletonFeed());
  else if (!src.items.length && !(src.newer || []).length) items.push({ ...(src.empty || emptyFeed()), key: "emptyFeed" });
  // Inside a community its own name is not repeated on each post.
  const here = src.key === "cfeed" && s.community ? { ...ctx, community: s.community.id } : ctx;
  for (const it of src.items || []) {
    const node = feedItem(it, here, s.me, s.selected);
    if (node) items.push(node);
  }
  const more = moreButton(src);
  if (more) items.push(more);
  return { type: "ListView", key: src.key, flex: 1, gap: 12, padding: pagePadding, items,
    empty: src.empty || emptyFeed() };
}

/** The post and its comments, without the box to write one. */
function threadItems(s, ctx) {
  const th = s.thread;
  const comments = th.items || [];
  return [
    postCard(th.post, { ...ctx, device: "phone" }, s.me, { full: true }),
    Txt(T.comments, { key: "commentsTitle", style: "h5", bold: true, margin: { top: 4 } }),
    ...(comments.length ? comments.map((c) => commentRow(c, s.me)) : [Txt(T.noComments, { key: "noComments", color: "muted" })]),
  ];
}

/**
 * The box to write a comment: several lines (Enter is a new line), sent by its own "Enviar" button, so Kino shows it
 * busy while the comment is saved. Locked while muted.
 */
function commentBox(s) {
  const until = muted(s);
  if (until) return { type: "Column", key: "commentBox", gap: 4, children: [muteLine(until)] };
  return { type: "Column", key: "commentBox", gap: 4, children: [
    { type: "TextField", key: "commentText", multiline: true, maxLines: 6, maxLength: 300, labelText: T.commentHint[0], labelTextEn: T.commentHint[1],
      onSubmitted: "sendComment" },
    { type: "Row", mainAxisAlignment: "end", children: [
      { type: "Button", variant: "secondary", key: "sendComment", icon: "send", labelText: T.send[0], labelTextEn: T.send[1],
        onPressed: { event: "sendComment", timeoutMs: 20000 } },
    ] },
  ] };
}

function threadBody(s, ctx) {
  if (!s.thread || !s.thread.post) {
    return [{ type: "emptyState", icon: "list", title: T.pickPost[0], titleEn: T.pickPost[1], text: T.pickPostText[0], textEn: T.pickPostText[1] }];
  }
  return [...threadItems(s, ctx), commentBox(s)];
}

// ---- tabs ------------------------------------------------------------------------------------------------------------

export function feedTab(s, ctx, src = generalSource(s)) {
  if (!isTv(ctx)) {
    return { type: "Column", flex: 1, children: [
      feedList(s, ctx, src),
      composerSheet(s),
    ] };
  }
  // TV: the feed on the left, the chosen post on the right (OK on a card opens it there); writing from the FAB-like
  // app-bar button, in the side drawer Kino draws for a sheet.
  return { type: "Row", flex: 1, gap: 24, padding: { x: 32, y: 16 }, children: [
    { type: "Column", flex: 7, gap: 12, children: [
      // Writing lives in the app bar, next to the reload button; here only what the person should know before reading.
      ...(src.canPost && muted(s) || src.key === "feed" && newerBanner(s) ? [{ type: "Row", gap: 12, crossAxisAlignment: "center", children: [
        ...(src.canPost && muted(s) ? [muteLine(muted(s))] : []),
        ...(src.key === "feed" && newerBanner(s) ? [newerBanner(s)] : []),
      ] }] : []),
      { ...feedList(s, ctx, src), padding: 0 },
    ] },
    { type: "Card", key: "pane", flex: 5, background: "surfaceVariant", padding: 16, canRequestFocus: !(s.thread && s.thread.post),
      children: [{ type: "SingleChildScrollView", flex: 1, children: [{ type: "Column", gap: 12, children: threadBody(s, ctx) }] }] },
    composerSheet(s),
  ] };
}

/** At least one not-hidden attached plugin earns the badge -- never a thing the person switches on themselves. */
const isCreator = (plugins) => (plugins || []).some((pl) => !pl.hidden);

function profileHeader(p, own, ctx, plugins) {
  const u = p.user;
  const stat = (n, [es, en]) => ({ type: "Column", flex: 1, crossAxisAlignment: "center", children: [Raw(String(n), { style: "h4", bold: true }), Txt([es, en], { style: "caption", color: "muted" })] });
  return {
    type: "Card", key: "head-" + u.id, padding: 24, gap: 16, elevation: 1,
    children: [
      { type: "Row", gap: 16, crossAxisAlignment: "center", children: [
        Avatar(u, isTv(ctx) ? 48 : 36),
        { type: "Column", flex: 1, gap: 4, children: [
          { type: "Row", gap: 8, crossAxisAlignment: "center", children: [
            Raw(u.name, { style: "h3", maxLines: 1 }),
            ...(isCreator(plugins) ? [Tag(T.creatorTag, "bolt", { key: "creatorTag" })] : []),
          ] },
          ...(u.handle ? [Raw("@" + u.handle, { color: "muted" })] : []),
        ] },
      ] },
      ...(u.bio ? [Raw(u.bio)] : []),
      { type: "Row", gap: 8, children: [
        stat(p.postCount || 0, T.postsCount), stat(p.followers || 0, T.followers), stat(p.followingCount || 0, T.followingCount),
      ] },
      own
        ? { type: "Row", gap: 8, children: [Button(T.editProfile, { ui: [{ open: "editProfile" }] }, { key: "editProfileBtn", icon: "edit", variant: "secondary", type: "Button" })] }
        : { type: "Row", children: [p.following
          ? { type: "Button", variant: "secondary", key: "unfollow-" + u.id, icon: "check", labelText: T.following[0], labelTextEn: T.following[1], selected: true, onPressed: { event: "unfollow", arg: String(u.id) } }
          : Button(T.follow, { event: "follow", arg: String(u.id) }, { key: "follow-" + u.id, icon: "add" })] },
    ],
  };
}

function watchedGrid(items, ctx, { own = false } = {}) {
  if (!items.length) return [Txt(own ? T.noWatched : T.noPosts, { color: "muted" })];
  return [{ type: "GridView", key: own ? "myWatched" : "theirWatched", columns: { compact: 3, medium: 4, expanded: 6 }, gap: 8,
    children: items.slice(0, 18).map((a) => ({
      type: "Card", key: "w" + a.id, flush: true, onTap: { go: { titleByIds: { tmdb: a.tmdbId, kind: a.kind, title: a.title.slice(0, 120) } } },
      children: [
        { type: "Image", aspect: "2:3", alt: a.title, altEn: a.title, ...(a.poster ? { url: a.poster } : {}),
          fallback: { type: "Column", padding: 8, children: [{ type: "Icon", name: a.kind === "movie" ? "movie" : "tv" }, Raw(a.title, { style: "caption", maxLines: 3 })] } },
      ],
    })) }];
}

/** One attached plugin: tapping it opens Kino's own "install this plugin" screen, pre-filled with its address
 * (go.installPlugin, CREATOR-PROFILE-SPEC.md §4) -- never a search, since the row already names the exact repo. */
function pluginRow(pl, { own = false } = {}) {
  const addr = pl.repo;
  return {
    type: "Card", key: "plg" + addr, padding: 12, onTap: { go: { installPlugin: { repo: addr } } }, children: [
      { type: "Row", gap: 12, crossAxisAlignment: "center", children: [
        { type: "Column", flex: 1, gap: 2, children: [
          Raw(pl.name, { style: "h5", bold: true, maxLines: 1 }),
          ...(pl.description ? [Raw(pl.description, { style: "caption", color: "muted", maxLines: 2 })] : []),
          Txt([`★ ${pl.stars}`, `★ ${pl.stars}`], { style: "caption", color: "muted" }),
        ] },
        ...(own ? [TextBtn(pl.hidden ? T.unhidePlugin : T.hidePlugin,
          { event: pl.hidden ? "unhidePlugin" : "hidePlugin", arg: addr }, { key: "hideBtn" + addr })] : []),
      ] },
    ],
  };
}

/** "Plugins que ha creado" (§6): nothing at all when there is nothing attached -- never "no plugins yet", since most
 * people have none. On your own profile ([own]), a hidden one still gets its own "Ocultos" list to unhide from,
 * even when nothing is left to show up top. */
function creatorPluginsSection(plugins, { own = false } = {}) {
  const list = plugins || [];
  if (!list.length) return [];
  const visible = list.filter((pl) => !pl.hidden);
  const hidden = own ? list.filter((pl) => pl.hidden) : [];
  return [
    ...(visible.length ? [Txt(T.creatorPlugins, { style: "h4" }), ...visible.map((pl) => pluginRow(pl, { own }))] : []),
    ...(hidden.length ? [Txt(T.hiddenPlugins, { style: "caption", color: "muted" }), ...hidden.map((pl) => pluginRow(pl, { own }))] : []),
  ];
}

const MONTHS = [["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]];

/** "T1 · E7 · 17 oct" ([lang] 0 Spanish, 1 English): the episode, when there is one, and the day it was watched. */
function watchedLine(a, lang) {
  const parts = [];
  if (Number.isInteger(a.season) && Number.isInteger(a.episode)) parts.push(lang ? `S${a.season} · E${a.episode}` : `T${a.season} · E${a.episode}`);
  const d = new Date(Number(a.watchedAt) || 0);
  if (a.watchedAt) parts.push(lang ? `${MONTHS[1][d.getMonth()]} ${d.getDate()}` : `${d.getDate()} ${MONTHS[0][d.getMonth()]}`);
  return parts.join(" · ");
}

/** Your Kino coins and today's progress (1 every 10 minutes watched, up to the day's cap); nothing when unavailable. */
function coinsCard(coins) {
  if (!coins) return null;
  const cap = coins.capToday || 0;
  return { type: "Card", key: "coinsCard", padding: 16, gap: 8, children: [
    { type: "Row", gap: 12, crossAxisAlignment: "center", children: [
      { type: "Icon", name: "star", color: "primary" },
      { type: "Column", flex: 1, gap: 0, children: [
        Txt(T.coinTitle, { style: "caption", color: "muted" }),
        Txt(T.coinBalance(coins.balance), { style: "h4", bold: true }),
      ] },
    ] },
    ...(cap ? [{ type: "LinearProgressIndicator", value: Math.min(1, (coins.earnedToday || 0) / cap),
      labelText: T.coinToday(coins.earnedToday || 0, cap)[0], labelTextEn: T.coinToday(coins.earnedToday || 0, cap)[1] }] : []),
    Txt(T.coinHint, { style: "caption", color: "muted" }),
  ] };
}

function profileTab(s, ctx) {
  const p = s.profile;
  if (!p) return { type: "Column", padding: pagePadding, gap: 12, children: skeletonFeed().slice(0, 1) };
  const mine = s.myActivity || [];
  return { type: "SingleChildScrollView", flex: 1, children: [{ type: "Column", padding: pagePadding, gap: 16, maxWidth: 640, alignSelf: "center", fill: true, children: [
    profileHeader(p, true, ctx, s.myPlugins),
    ...(ctx.coins && s.coins ? [coinsCard(s.coins)] : []),
    { type: "Card", key: "shareCard", padding: 16, gap: 4, children: [
      { type: "Switch", key: "share", value: !!s.me.shareActivity, labelText: T.share[0], labelTextEn: T.share[1], onChanged: "toggleShare" },
      Txt(T.shareHint, { style: "caption", color: "muted" }),
    ] },
    Txt(T.watched, { style: "h4" }),
    Txt(T.watchedHint, { style: "caption", color: "muted" }),
    ...(mine.length ? mine.slice(0, 30).map((a) => ({
      type: "Row", key: "ma" + a.id, gap: 12, crossAxisAlignment: "center", children: [
        { type: "Image", width: 40, aspect: "2:3", borderRadius: "small", ...(a.poster ? { url: a.poster } : {}), alt: a.title, altEn: a.title,
          fallback: { type: "Stack", color: "surfaceVariant", children: [{ type: "Icon", name: a.kind === "movie" ? "movie" : "tv", margin: 8 }] } },
        // A labelled Switch fills its row, so the title is its label (flex 1) rather than a column beside it.
        { type: "Switch", key: "act" + a.id, flex: 1, value: !a.hidden, labelText: a.title || "—", labelTextEn: a.title || "—",
          hint: watchedLine(a, 0), hintEn: watchedLine(a, 1), onChanged: { event: "toggleActivity", arg: String(a.id) } },
      ] })) : [Txt(T.noWatched, { color: "muted" })]),
    Txt(T.posts, { style: "h4" }),
    ...((p.posts || []).length ? p.posts.map((post) => postCard(post, ctx, s.me)) : [Txt(T.noPosts, { color: "muted" })]),
    ...creatorPluginsSection(s.myPlugins, { own: true }),
    TextBtn(["Cerrar sesión en todos tus aparatos", "Log out on all your devices"], "logoutAll",
      { key: "logoutAll", confirm: "¿Cerrar sesión en todos tus aparatos?", confirmEn: "Log out on all your devices?" }),
    editProfileSheet(s),
  ] }] };
}

function editProfileSheet(s) {
  return { type: "BottomSheet", key: "editProfile", title: T.editProfile[0], titleEn: T.editProfile[1], children: [
    { type: "Form", key: "profileForm", gap: 12, onSubmit: "saveProfile", children: [
      { type: "TextField", key: "nameText", value: s.me.name, required: true, maxLength: 40, labelText: T.name[0], labelTextEn: T.name[1] },
      { type: "TextField", key: "handleText", value: s.me.handle || "", required: true, minLength: 3, maxLength: 20,
        pattern: "^@?[a-zA-Z0-9_.]{3,20}$", errorText: "3 a 20 letras, números, _ o .", errorTextEn: "3 to 20 letters, digits, _ or .",
        labelText: "@usuario", labelTextEn: "@username" },
      { type: "TextField", key: "bioText", value: s.me.bio || "", multiline: true, maxLines: 3, maxLength: 160,
        labelText: T.bio[0], labelTextEn: T.bio[1], hintText: T.bioHint[0], hintTextEn: T.bioHint[1] },
      { type: "ElevatedButton", key: "saveProfile", labelText: T.save[0], labelTextEn: T.save[1], submit: true, fill: true },
    ] },
  ] };
}

function personRow(p) {
  return { type: "Row", key: "p" + p.id, gap: 8, crossAxisAlignment: "center", children: [
    { type: "ListTile", flex: 1, title: p.name, titleEn: p.name, subtitle: p.handle ? "@" + p.handle + (p.bio ? " · " + p.bio : "") : p.bio || undefined,
      leading: Avatar(p), onTap: { event: "openUser", arg: String(p.id) } },
    p.following
      ? { type: "Button", variant: "secondary", key: "pf" + p.id, labelText: T.following[0], labelTextEn: T.following[1], selected: true, onPressed: { event: "unfollow", arg: String(p.id) } }
      : Button(T.follow, { event: "follow", arg: String(p.id) }, { key: "pf" + p.id }),
  ] };
}

function peopleTab(s, ctx) {
  const list = s.results !== undefined ? s.results : s.people;
  return { type: "Column", flex: 1, gap: 12, padding: pagePadding, children: [
    { type: "TextField", key: "searchText", kind: "search", maxLength: 40, labelText: "Buscar por nombre o @usuario", labelTextEn: "Search by name or @username",
      onSubmitted: "search", trailingIcon: "search", trailingLabel: "Buscar", trailingLabelEn: "Search", onTrailingTap: "search" },
    { type: "ListView", key: "people", flex: 1, gap: 4, items: (list || []).map(personRow),
      empty: list === undefined ? { type: "CircularProgressIndicator" }
        : { type: "emptyState", icon: "person", title: T.noPeople[0], titleEn: T.noPeople[1], text: T.noPeopleText[0], textEn: T.noPeopleText[1] } },
  ] };
}

// ---- the root --------------------------------------------------------------------------------------------------------

export function mainView(s, ctx) {
  const tab = ["feed", "communities", "people"].includes(s.tab) ? s.tab : "feed";
  const unread = s.unread || 0;
  const tabs = { type: "TabBar", key: "tabs", value: tab, onChanged: "tab", tabs: [
    { value: "feed", label: T.feed[0], labelEn: T.feed[1] },
    { value: "communities", label: T.communities[0], labelEn: T.communities[1] },
    { value: "people", label: T.people[0], labelEn: T.people[1] },
  ] };
  // Your profile, top right (as in most social apps), opens its own page; its badge says what is new for you.
  const me = IconBtn("person", T.profile, "openProfile", { key: "openProfile",
    ...(unread ? { badge: { text: String(Math.min(unread, 99)) } } : {}) });
  const body = tab === "people" ? peopleTab(s, ctx) : tab === "communities" ? communitiesTab(s, ctx) : feedTab(s, ctx);
  return {
    type: "Scaffold",
    every: { ms: 60000, event: "tick" },
    // One row: the tabs where the greeting used to be, then (on the TV, in the feed) write, reload and your avatar. A phone
    // writes from the prompt at the top of the feed.
    appBar: { type: "AppBar", title: tabs, actions: [
      ...(isTv(ctx) && tab === "feed" && generalSource(s).canPost
        ? [IconBtn("edit", T.compose, { ui: [{ open: "composer" }] }, { key: "tvCompose", ...(muted(s) ? { enabledAt: muted(s) } : {}) })]
        : []),
      IconBtn("refresh", T.refresh, { event: "refresh", timeoutMs: 20000 }, { key: "refresh", loading: !!s.refreshing }),
      me,
    ] },
    body,
  };
}

/** Your own profile: a page over the tabs, with the back arrow. */
export function meView(s, ctx) {
  return { type: "Scaffold", appBar: { type: "AppBar", title: T.profile[0], titleEn: T.profile[1],
    leading: IconBtn("arrow_back", T.back, "back") }, body: profileTab(s, ctx) };
}

/** A post as a chat: the post and its comments in a list that opens at, and follows, the newest; the box below it. */
export function postView(s, ctx) {
  const appBar = { type: "AppBar", title: T.post[0], titleEn: T.post[1], leading: IconBtn("arrow_back", T.back, "back") };
  if (!s.thread || !s.thread.post) return { type: "Scaffold", appBar, body: { type: "Column", padding: pagePadding, children: threadBody(s, ctx) } };
  return { type: "Scaffold", appBar, body: { type: "Column", flex: 1, children: [
    { type: "ListView", key: "threadList", flex: 1, gap: 12, padding: pagePadding, stickToBottom: true, newItemsHint: true, items: threadItems(s, ctx) },
    { type: "Column", padding: { x: 12, y: 8 }, children: [commentBox(s)] },
  ] } };
}

export function userView(s, ctx) {
  const p = s.user;
  const body = !p ? { type: "Column", padding: pagePadding, children: [{ type: "CircularProgressIndicator" }] }
    : { type: "SingleChildScrollView", flex: 1, children: [{ type: "Column", padding: pagePadding, gap: 16, maxWidth: 640, alignSelf: "center", fill: true, children: [
      profileHeader(p, s.me && p.user.id === s.me.id, ctx, p.plugins),
      Txt(T.theirWatched, { style: "h4" }),
      ...watchedGrid(p.activity || [], ctx),
      Txt(T.posts, { style: "h4" }),
      ...((p.posts || []).length ? p.posts.map((post) => postCard(post, ctx, s.me)) : [Txt(T.noPosts, { color: "muted" })]),
      ...creatorPluginsSection(p.plugins, { own: false }),
    ] }] };
  return { type: "Scaffold", appBar: { type: "AppBar", title: p ? p.user.name : T.profile[0], titleEn: p ? p.user.name : T.profile[1],
    leading: IconBtn("arrow_back", T.back, "back") }, body };
}

export function welcomeView(s, ctx) {
  const ok = s.handleCheck;
  return { type: "SingleChildScrollView", children: [{ type: "Column", padding: { x: 24, y: 32 }, gap: 16, maxWidth: 480, alignSelf: "center", fill: true, children: [
    { type: "Column", fill: true, crossAxisAlignment: "center", children: [Avatar(s.me || { name: "?" }, 40)] },
    Txt(["Bienvenido a Kino Social", "Welcome to Kino Social"], { style: "h2", textAlign: "center" }),
    Txt(["Elige tu @usuario: así te encuentran tus amigos. Es único y lo puedes cambiar después.", "Pick your @username: it's how friends find you. It's unique and you can change it later."], { textAlign: "center", color: "muted" }),
    { type: "Form", key: "welcomeForm", gap: 12, onSubmit: "pickHandle", children: [
      { type: "TextField", key: "handleText", required: true, minLength: 3, maxLength: 20, pattern: "^@?[a-zA-Z0-9_.]{3,20}$",
        errorText: "3 a 20 letras, números, _ o .", errorTextEn: "3 to 20 letters, digits, _ or .",
        labelText: "@usuario", labelTextEn: "@username", onChanged: "checkHandle" },
      ...(ok ? [{ type: "Row", gap: 8, crossAxisAlignment: "center", children: [
        { type: "Icon", name: ok.available ? "check" : "close", size: "sm", color: ok.available ? "secondary" : "error" },
        Txt(ok.available ? [`@${ok.handle} está libre`, `@${ok.handle} is free`] : [`@${ok.handle} no está disponible`, `@${ok.handle} is not available`],
          { style: "caption", color: ok.available ? "muted" : "error" }),
      ] }] : []),
      { type: "TextField", key: "nameText", required: true, maxLength: 40, labelText: T.name[0], labelTextEn: T.name[1] },
      { type: "ElevatedButton", key: "pickHandle", labelText: ["Empezar", "Start"][0], labelTextEn: "Start", submit: true, fill: true },
    ] },
  ] }] };
}

export function problemView(code) {
  if (code === "device_taken" || code === "too_many_devices") {
    const t = code === "device_taken" ? T.deviceTaken : T.tooManyDevices;
    return { type: "errorState", icon: "lock", title: t[0], titleEn: t[1], text: T.unbindText[0], textEn: T.unbindText[1],
      action: { label: T.retry[0], labelEn: T.retry[1], event: "open" } };
  }
  if (code === "no_identity" || code === "unofficial") {
    return { type: "errorState", icon: "lock", title: T.noIdentity[0], titleEn: T.noIdentity[1], text: T.noIdentityText[0], textEn: T.noIdentityText[1],
      action: { label: T.retry[0], labelEn: T.retry[1], event: "open" } };
  }
  return { type: "errorState", title: T.offline[0], titleEn: T.offline[1], text: T.offlineText[0], textEn: T.offlineText[1],
    action: { label: T.retry[0], labelEn: T.retry[1], event: "open" } };
}

export { NameBlock };
