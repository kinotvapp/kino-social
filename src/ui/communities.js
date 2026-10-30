// Communities: the tab (yours, then ones to discover, a search and "Crear"), the sheet that creates one, and a community's
// own page: its header (what it is, how many, join or leave) over its feed, the same feed list as the general one.

import { T } from "../i18n.js";
import { Avatar, Button, IconBtn, Raw, Txt, count, isTv, pagePadding } from "./kit.js";
import { feedTab } from "./views.js";

const membersLine = (c) => T.members(c.members);

const MARK_COLORS = ["secondary", "primaryContainer", "primary"];

/** A community's mark: its initial on a colour picked from its id, a rounded square so it never reads as a person. */
function Mark(c, radius = 24) {
  const letter = (String(c.name || "?").trim()[0] || "?").toUpperCase();
  return { type: "Column", width: radius * 2, height: radius * 2, color: MARK_COLORS[Math.abs(Number(c.id) || 0) % MARK_COLORS.length],
    borderRadius: "medium", mainAxisAlignment: "center", crossAxisAlignment: "center",
    children: [Raw(letter, { style: radius > 28 ? "h3" : "h4", bold: true })] };
}

/** Join or leave (a private one: ask, or withdraw the request); [strong]: the community's own page (filled), a row is quieter. */
function joinButton(c, key, strong = false) {
  if (c.owner) return null;
  if (c.private && !c.joined) {
    return c.requested
      ? { type: "Button", variant: "secondary", key, icon: "schedule", labelText: T.requested[0], labelTextEn: T.requested[1], selected: true,
        onPressed: { event: "leaveCommunity", arg: String(c.id) } }
      : strong ? Button(T.askToJoin, { event: "joinCommunity", arg: String(c.id) }, { key, icon: "lock" })
        : { type: "Button", variant: "secondary", key, icon: "lock", labelText: T.askToJoin[0], labelTextEn: T.askToJoin[1], onPressed: { event: "joinCommunity", arg: String(c.id) } };
  }
  return c.joined
    ? { type: "Button", variant: "secondary", key, icon: "check", labelText: T.joined[0], labelTextEn: T.joined[1], selected: true,
      onPressed: { event: "leaveCommunity", arg: String(c.id) } }
    : strong ? Button(T.join, { event: "joinCommunity", arg: String(c.id) }, { key, icon: "add" })
      : { type: "Button", variant: "secondary", key, icon: "add", labelText: T.join[0], labelTextEn: T.join[1], onPressed: { event: "joinCommunity", arg: String(c.id) } };
}

function communityRow(c) {
  const join = joinButton(c, "cj" + c.id);
  return { type: "Card", key: "c" + c.id, padding: 12, onTap: { event: "openCommunity", arg: String(c.id) }, children: [
    { type: "Row", gap: 12, crossAxisAlignment: "center", children: [
      Mark(c),
      { type: "Column", flex: 1, gap: 0, children: [
        Raw(c.name, { style: "h5", bold: true, maxLines: 1 }),
        Txt([`@${c.slug} · ${membersLine(c)[0]}${c.private ? " · " + T.privateTag[0] : ""}`,
          `@${c.slug} · ${membersLine(c)[1]}${c.private ? " · " + T.privateTag[1] : ""}`], { style: "caption", color: "muted", maxLines: 1 }),
        ...(c.description ? [Raw(c.description, { style: "caption", maxLines: 2 })] : []),
      ] },
      ...(join ? [join] : []),
    ] },
  ] };
}

function createSheet() {
  return { type: "BottomSheet", key: "createCommunity", title: T.newCommunity[0], titleEn: T.newCommunity[1], children: [
    { type: "Form", key: "communityForm", gap: 12, onSubmit: "createCommunity", children: [
      { type: "TextField", key: "communityName", required: true, minLength: 3, maxLength: 40, labelText: T.communityName[0], labelTextEn: T.communityName[1] },
      { type: "TextField", key: "communitySlug", required: true, minLength: 3, maxLength: 20, pattern: "^@?[a-zA-Z0-9_.]{3,20}$",
        errorText: "3 a 20 letras, números, _ o .", errorTextEn: "3 to 20 letters, digits, _ or .",
        labelText: T.communitySlug[0], labelTextEn: T.communitySlug[1] },
      { type: "TextField", key: "communityDescription", multiline: true, maxLines: 3, maxLength: 200,
        labelText: T.communityDescription[0], labelTextEn: T.communityDescription[1] },
      { type: "Switch", key: "communityPrivate", value: false, labelText: T.privateCommunity[0], labelTextEn: T.privateCommunity[1],
        hint: T.privateHint[0], hintEn: T.privateHint[1] },
      { type: "ElevatedButton", key: "createCommunityBtn", icon: "add", labelText: T.create[0], labelTextEn: T.create[1], submit: true, fill: true },
    ] },
  ] };
}

export function communitiesTab(s, ctx) {
  const lists = s.communities;
  const results = s.communityResults;
  const items = [
    { type: "Row", key: "cTop", gap: 12, crossAxisAlignment: "center", children: [
      { type: "TextField", key: "communitySearch", kind: "search", flex: 1, maxLength: 40, labelText: T.searchCommunities[0], labelTextEn: T.searchCommunities[1],
        onSubmitted: "searchCommunities", trailingIcon: "search", trailingLabel: "Buscar", trailingLabelEn: "Search", onTrailingTap: "searchCommunities" },
      Button(T.create, { ui: [{ open: "createCommunity" }] }, { key: "newCommunity", icon: "add" }),
    ] },
  ];
  if (results !== undefined) {
    items.push(Txt(T.results, { key: "cResultsTitle", style: "h5", bold: true }), ...results.map(communityRow));
    if (!results.length) items.push(Txt(T.noCommunitiesFound, { key: "cNone", color: "muted" }));
  } else if (lists === undefined) {
    items.push({ type: "CircularProgressIndicator", key: "cLoading" });
  } else {
    if (lists.mine.length) items.push(Txt(T.yourCommunities, { key: "cMineTitle", style: "h5", bold: true }), ...lists.mine.map(communityRow));
    items.push(Txt(T.discover, { key: "cDiscoverTitle", style: "h5", bold: true }), ...lists.discover.map(communityRow));
    if (!lists.discover.length && !lists.mine.length) {
      items.push({ type: "emptyState", key: "cEmpty", icon: "add", title: T.noCommunities[0], titleEn: T.noCommunities[1],
        text: T.noCommunitiesText[0], textEn: T.noCommunitiesText[1] });
    }
  }
  return { type: "Column", flex: 1, children: [
    { type: "ListView", key: "communityList", flex: 1, gap: 8, padding: pagePadding, items },
    createSheet(),
  ] };
}

/** A community's feed as a feed list source: its own keys, its "more" event, its header on top. */
export function communitySource(s, ctx) {
  const c = s.community;
  const join = joinButton(c, "cHeadJoin", true);
  const header = { type: "Card", key: "cHead", padding: 16, gap: 12, elevation: 1, children: [
    { type: "Row", gap: 16, crossAxisAlignment: "center", children: [
      Mark(c, isTv(ctx) ? 40 : 32),
      { type: "Column", flex: 1, gap: 4, children: [
        Raw(c.name, { style: "h3", maxLines: 2 }),
        Txt([`@${c.slug} · ${membersLine(c)[0]} · ${count(c.posts)} ${c.posts === 1 ? "publicación" : "publicaciones"}`,
          `@${c.slug} · ${membersLine(c)[1]} · ${count(c.posts)} ${c.posts === 1 ? "post" : "posts"}`], { style: "caption", color: "muted" }),
      ] },
    ] },
    ...(c.description ? [Raw(c.description)] : []),
    ...(join ? [{ type: "Row", children: [join] }] : c.owner ? [Txt(T.youOwn, { style: "caption", color: "muted" })] : []),
    // The owner of a private one: who is waiting to get in.
    ...(c.owner && c.private && c.pending ? [{ type: "Row", children: [
      Button(T.requests(c.pending), { event: "openRequests", timeoutMs: 20000 }, { key: "cRequests", icon: "person_add" })] }] : []),
  ] };
  const locked = c.private && !c.joined;
  return { items: s.cfeed, next: s.cnext, newer: [], loadingMore: s.cloadingMore, key: "cfeed", more: "moreCommunity",
    canPost: !!c.joined, header,
    empty: locked
      ? { type: "emptyState", icon: "lock", title: T.privateLocked[0], titleEn: T.privateLocked[1], text: T.privateLockedText[0], textEn: T.privateLockedText[1] }
      : { type: "emptyState", icon: "edit", title: T.emptyCommunity[0], titleEn: T.emptyCommunity[1],
        text: c.joined ? T.emptyCommunityMember[0] : T.emptyCommunityVisitor[0], textEn: c.joined ? T.emptyCommunityMember[1] : T.emptyCommunityVisitor[1] } };
}

/** The owner's list of people waiting to get into a private community: accept or decline each. */
function requestsSheet(s) {
  const rows = (s.crequests || []).map((p) => ({ type: "Row", key: "rq" + p.id, gap: 8, crossAxisAlignment: "center", children: [
    { type: "ListTile", flex: 1, title: p.name, titleEn: p.name, subtitle: p.handle ? "@" + p.handle : undefined, leading: Avatar(p),
      onTap: { event: "openUser", arg: String(p.id) } },
    { type: "Button", variant: "secondary", key: "rqNo" + p.id, labelText: T.reject[0], labelTextEn: T.reject[1], onPressed: { event: "rejectRequest", arg: String(p.id) } },
    Button(T.approve, { event: "approveRequest", arg: String(p.id) }, { key: "rqOk" + p.id }),
  ] }));
  return { type: "BottomSheet", key: "communityRequests", title: T.joinRequests[0], titleEn: T.joinRequests[1],
    children: [{ type: "Column", gap: 8, children: rows }] };
}

export function communityView(s, ctx) {
  const c = s.community;
  return { type: "Scaffold",
    appBar: { type: "AppBar", title: c ? c.name : T.communities[0], titleEn: c ? c.name : T.communities[1], leading: IconBtn("arrow_back", T.back, "back") },
    body: c ? { type: "Column", flex: 1, children: [feedTab(s, ctx, communitySource(s, ctx)), requestsSheet(s)] }
      : { type: "Column", padding: pagePadding, children: [{ type: "CircularProgressIndicator" }] } };
}
