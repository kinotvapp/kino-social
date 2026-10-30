// screenEvent: every press, change and timer of the screen. The server is the truth; the screen state holds at most a
// few pages of the feed and the open post's comments.

import { ApiError, call, callFresh, login, savedSession } from "./api.js";
import { syncActivity } from "./activity.js";
import { T } from "./i18n.js";
import { clean } from "./swear.js";
import { moderationDialog, moderationState, muteDialog, mutedUntil } from "./moderation.js";
import { linkPreview } from "./linkpreview.js";
import { titleHint } from "./titlelink.js";
import { tidyLines } from "./lines.js";
import { canPublish, cleanQuery, pickAttachment, postBody, recentTitles, searchTitles } from "./attach.js";

const MAX_FEED = 80;
const toast = ([es, en]) => ({ toast: es, toastEn: en });

function failure(e) {
  const code = e instanceof ApiError ? e.code : "offline";
  if (code === "rate_limited") return toast(T.tooFast);
  if (code === "handle_taken") return toast(["Ese @usuario ya existe: prueba otro", "That @username is taken: try another"]);
  if (code === "bad_handle") return toast(["Ese @usuario no se puede usar", "That @username can't be used"]);
  if (code === "slug_taken") return toast(T.slugTaken);
  if (["bad_name", "bad_slug", "bad_description"].includes(code)) return toast(T.badCommunity);
  if (code === "not_member") return toast(T.notMember);
  // Muted: the dialog says until when; what the person wrote stays in its field (inputs untouched).
  if (code === "muted") return { state: { mutedUntil: mutedUntil(e.mutedUntil) }, dialog: muteDialog(e.mutedUntil) };
  if (["no_identity", "unofficial", "device_taken", "too_many_devices"].includes(code)) return { state: { problem: code } };
  return toast(T.offline);
}

/** The composer's picker, folded away (its lists dropped: they only live while it is open). */
const closedPicker = () => ({ picking: false, pickQuery: "", pickResults: null, pickRecent: null, pickError: null });

const sameId = (a, b) => String(a) === String(b);
const mergeById = (items) => {
  const seen = new Set();
  return items.filter((i) => {
    const k = i.type + ":" + i.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

async function loadFeed(state) {
  const page = await call("/feed?limit=20");
  return { feed: page.items, next: page.next, feedTag: page.etag, newer: [] };
}

async function loadProfile(me) {
  const [p, mine] = await Promise.all([call("/users/" + me.id), call("/me/activity")]);
  return { profile: p, myActivity: mine.items };
}

async function loadCommunity(id) {
  const community = await call("/communities/" + id);
  // A private community's feed is for its members: a visitor sees what it is and asks to join.
  if (community.private && !community.joined) return { community, cfeed: [], cnext: null };
  const page = await call(`/communities/${id}/feed?limit=20`);
  return { community, cfeed: page.items, cnext: page.next };
}

async function loadThread(postId) {
  const [post, comments] = await Promise.all([call("/posts/" + postId), call(`/posts/${postId}/comments`)]);
  return { postId: String(postId), post, items: comments.items };
}

/**
 * Opening Social is seeing what was new: the server marks it read, so its count starts again and a post's comment notice
 * groups from zero ("Ana y 2 más", not a count that grows for months). Best effort.
 */
async function markSeen(notes) {
  const newest = (notes.items || []).reduce((m, n) => Math.max(m, n.createdAt || 0), 0);
  if (!notes.unread || !newest) return;
  await callFresh("/notifications/read", { method: "POST", json: { upTo: newest } }).catch(() => 0);
}

/** The first call: a session (logging in if needed), the person, then what the route needs. */
async function open(state, route) {
  try {
    if (!savedSession()) await login();
    let me;
    try {
      me = await call("/me");
    } catch (e) {
      if (e.code !== "no_session") throw e;
      await login();
      me = await call("/me");
    }
    const base = { me, problem: null, mutedUntil: mutedUntil(me.mutedUntil) };
    if (!me.handle) return { state: { ...base, view: "welcome" } };
    await syncActivity().catch(() => 0);
    const notes = await call("/notifications").catch(() => ({ unread: 0 }));
    await markSeen(notes); // also when a notice opened a post or a profile
    // A notice opens the screen at { name, params: {}, args } (go.screen's args); a push inside the screen sets params.
    const id = (route.args && route.args.id) || (route.params && route.params.id);
    if (route.name === "post" && id) return { state: { ...base, view: "post", thread: await loadThread(id) } };
    if (route.name === "user" && id) return { state: { ...base, view: "user", user: await call("/users/" + id) } };
    if (route.name === "community" && id) return { state: { ...base, view: "community", ...(await loadCommunity(id)) } };
    return { state: { ...base, view: "main", ...(await loadFeed(state)), unread: notes.unread || 0 } };
  } catch (e) {
    return { state: { problem: e instanceof ApiError ? e.code : "offline" } };
  }
}

function patchPost(state, postId, change) {
  const fix = (p) => (p && p.type === "post" && sameId(p.id, postId) ? { ...p, ...change(p) } : p);
  const out = { feed: (state.feed || []).map(fix) };
  if (state.thread && sameId(state.thread.postId, postId)) out.thread = { ...state.thread, post: fix(state.thread.post) };
  if (state.profile) out.profile = { ...state.profile, posts: (state.profile.posts || []).map(fix) };
  if (state.user) out.user = { ...state.user, posts: (state.user.posts || []).map(fix) };
  if (state.cfeed) out.cfeed = state.cfeed.map(fix);
  return out;
}

/** A community changed (joined, left): every copy of it in the state follows. */
function patchCommunity(state, c) {
  const fix = (x) => (sameId(x.id, c.id) ? c : x);
  const out = {};
  if (state.community && sameId(state.community.id, c.id)) out.community = c;
  if (state.communities) {
    const mine = state.communities.mine.filter((x) => !sameId(x.id, c.id));
    const discover = state.communities.discover.filter((x) => !sameId(x.id, c.id));
    out.communities = c.joined ? { mine: [...mine, c], discover } : { mine, discover: [c, ...discover] };
  }
  if (state.communityResults) out.communityResults = state.communityResults.map(fix);
  return out;
}

function patchFollow(state, userId, following) {
  const fix = (p) => (sameId(p.id, userId) ? { ...p, following } : p);
  const out = {};
  if (state.people) out.people = state.people.map(fix);
  if (state.results) out.results = state.results.map(fix);
  if (state.user && sameId(state.user.user.id, userId)) {
    out.user = { ...state.user, following, followers: Math.max(0, (state.user.followers || 0) + (following ? 1 : -1)) };
  }
  if (state.feed) out.feed = state.feed.map((i) => (i.type === "suggestions" ? { ...i, people: i.people.filter((p) => !sameId(p.id, userId)) } : i))
    .filter((i) => i.type !== "suggestions" || i.people.length);
  return out;
}

export async function screenEvent({ name, arg, value, state, route, device }) {
  const s = state || {};
  const inputs = s.inputs || {};
  try {
    switch (name) {
      case "open":
        return open(s, route || { name: "main" });
      case "openProfile":
      case "tab": {
        const tab = name === "openProfile" ? "profile" : value;
        if (tab === "profile") return { state: { tab, ...(await loadProfile(s.me)) } };
        if (tab === "people") {
          const people = await call("/people");
          return { state: { tab, people: people.items, results: undefined } };
        }
        if (tab === "communities") return { state: { tab, communities: await call("/communities"), communityResults: undefined } };
        return { state: { tab } };
      }
      case "refresh": {
        const out = { ...(await loadFeed(s)), selected: s.selected };
        if (s.tab === "profile") Object.assign(out, await loadProfile(s.me));
        if (s.tab === "people") out.people = (await call("/people")).items;
        if (s.tab === "communities") out.communities = await call("/communities");
        await syncActivity().catch(() => 0);
        const notes = await call("/notifications").catch(() => ({ unread: s.unread || 0 }));
        return { state: { ...out, unread: notes.unread || 0 }, ...toast(["Al día", "Up to date"]) };
      }
      case "tick": {
        // Nobody's press: a conditional GET of the first page; new posts wait behind «N nuevas» instead of moving the feed.
        // A mute that ran out unlocks the composer and the comment field without a press.
        if (s.mutedUntil && !mutedUntil(s.mutedUntil)) return { state: { mutedUntil: 0 } };
        if (s.view !== "main" || !s.feed) return null;
        const page = await call("/feed?limit=20", { etag: s.feedTag }).catch(() => ({ notModified: true }));
        if (page.notModified) return null;
        const known = new Set([...(s.feed || []), ...(s.newer || [])].map((i) => i.type + ":" + i.id));
        const newer = mergeById([...(s.newer || []), ...page.items.filter((i) => i.type !== "suggestions" && !known.has(i.type + ":" + i.id))]);
        // Counts (likes, comments) of what is on screen follow quietly.
        const fresh = new Map(page.items.map((i) => [i.type + ":" + i.id, i]));
        const feed = s.feed.map((i) => fresh.get(i.type + ":" + i.id) || i);
        return { state: { feed, newer, feedTag: page.etag } };
      }
      case "showNewer":
        return { state: { feed: mergeById([...(s.newer || []), ...(s.feed || [])]).slice(0, MAX_FEED), newer: [] }, focus: "feed" };
      case "more": {
        if (!s.next) return null;
        const page = await call(`/feed?limit=20&before=${s.next}`);
        const feed = mergeById([...(s.feed || []), ...page.items.filter((i) => i.type !== "suggestions")]);
        return { state: { feed: feed.slice(-MAX_FEED), next: page.next, loadingMore: false } };
      }
      case "moreCommunity": {
        if (!s.cnext || !s.community) return null;
        const page = await call(`/communities/${s.community.id}/feed?limit=20&before=${s.cnext}`);
        return { state: { cfeed: mergeById([...(s.cfeed || []), ...page.items]).slice(-MAX_FEED), cnext: page.next, cloadingMore: false } };
      }
      case "openCommunity":
        return { route: { push: "community", params: { id: String(arg) } }, state: { view: "community", ...(await loadCommunity(arg)) } };
      case "joinCommunity":
      case "leaveCommunity": {
        const c = await callFresh(`/communities/${arg}/join`, { method: name === "joinCommunity" ? "POST" : "DELETE" });
        const asked = name === "joinCommunity" && c.requested;
        return { state: patchCommunity(s, c), ...(asked ? toast(T.requestSent) : {}) };
      }
      case "openRequests": {
        if (!s.community) return null;
        const r = await call(`/communities/${s.community.id}/requests`);
        return { state: { crequests: r.items }, ui: [{ open: "communityRequests" }] };
      }
      case "approveRequest":
      case "rejectRequest": {
        if (!s.community) return null;
        const c = await callFresh(`/communities/${s.community.id}/requests/${arg}`, { method: "POST", json: { approve: name === "approveRequest" } });
        const crequests = (s.crequests || []).filter((p) => !sameId(p.id, arg));
        return { state: { ...patchCommunity(s, c), crequests }, ...(crequests.length ? {} : { ui: [{ close: "communityRequests" }] }) };
      }
      case "searchCommunities": {
        const q = String(inputs.communitySearch || "").trim();
        if (q.length < 2) return { state: { communityResults: undefined } };
        return { state: { communityResults: (await call("/communities?q=" + encodeURIComponent(q))).items } };
      }
      case "createCommunity": {
        const values = (arguments[0] && arguments[0].values) || inputs;
        const c = await callFresh("/communities", { method: "POST", json: {
          name: String(values.communityName || "").trim(), slug: String(values.communitySlug || "").trim(),
          description: await clean(String(values.communityDescription || "").trim()), private: values.communityPrivate === true } });
        return { route: { push: "community", params: { id: String(c.id) } },
          state: { view: "community", community: c, cfeed: [], cnext: null,
            inputs: { communityName: "", communitySlug: "", communityDescription: "", communityPrivate: false },
            ...(s.communities ? { communities: { ...s.communities, mine: [...s.communities.mine, c] } } : {}) },
          ui: [{ close: "createCommunity" }], ...toast(T.communityCreated) };
      }
      case "openAttach":
        return { state: { picking: true, pickQuery: "", pickResults: null, pickError: null, pickRecent: await recentTitles(),
          inputs: { titleSearch: "" } }, focus: "titleSearch" };
      case "searchTitles": {
        const q = cleanQuery(value !== undefined ? value : inputs.titleSearch);
        if (!q) return { state: { pickQuery: "", pickResults: null, pickError: null } };
        if (typeof kino.tmdb !== "function") return { state: { pickQuery: q, pickError: "noTmdb" } };
        try {
          return { state: { pickQuery: q, pickResults: await searchTitles(q), pickError: null } };
        } catch (_) {
          return { state: { pickQuery: q, pickResults: null, pickError: "failed" } };
        }
      }
      case "attachTitle": {
        const attach = pickAttachment(arg, s.pickResults, s.pickRecent);
        if (!attach) return null;
        return { state: { attach, ...closedPicker() }, focus: "postText" };
      }
      case "cancelAttach":
        return { state: closedPicker(), focus: "openAttach" };
      case "clearAttach":
        return { state: { attach: null }, focus: "openAttach" };
      case "publish": {
        const values = (arguments[0] && arguments[0].values) || inputs;
        const raw = tidyLines(values.postText ?? inputs.postText);
        const attach = s.attach || null;
        if (!canPublish(raw, attach)) return toast(T.needTextOrTitle);
        const text = raw ? await clean(raw) : "";
        // The device reads the link (the server never fetches): a TMDB or IMDb title from Kino's TMDB, else the page's head.
        // A title the person attached wins over any link, which then stays plain text: nothing to read.
        const linkTitle = text && !attach ? await titleHint(text) : null;
        const link = linkTitle || !text || attach ? null : await linkPreview(text);
        // Written inside a community's page, it goes to that community and its feed; else to the general one.
        const inCommunity = s.community && ((route && route.name === "community") || s.view === "community");
        const json = postBody({ text, linkTitle, link, attach, communityId: inCommunity ? s.community.id : null });
        const post = await callFresh("/posts", { method: "POST", json });
        const placed = inCommunity
          ? { cfeed: mergeById([post, ...(s.cfeed || [])]).slice(0, MAX_FEED), community: { ...s.community, posts: (s.community.posts || 0) + 1 } }
          : { feed: mergeById([post, ...(s.feed || [])]).slice(0, MAX_FEED), tab: "feed" };
        const warned = moderationDialog(post);
        return { state: { ...placed, ...moderationState(post), attach: null, ...closedPicker(), inputs: { postText: "", titleSearch: "" } },
          ui: [{ close: "composer" }], ...(warned ? { dialog: warned } : toast(T.published)) };
      }
      case "like":
      case "unlike": {
        const r = await callFresh(`/posts/${arg}/like`, { method: name === "like" ? "POST" : "DELETE" });
        return { state: patchPost(s, arg, () => ({ likes: r.likes, liked: r.liked })) };
      }
      case "openPost": {
        const thread = await loadThread(arg);
        if (device === "tv") return { state: { thread, selected: String(arg) }, focus: "commentText" };
        return { state: { thread }, ui: [{ open: "thread" }] };
      }
      case "threadClosed":
        return null;
      case "sendComment": {
        const raw = tidyLines(inputs.commentText);
        if (!raw || !s.thread) return null;
        const text = await clean(raw);
        const c = await callFresh(`/posts/${s.thread.postId}/comments`, { method: "POST", json: { text } });
        const thread = { ...s.thread, items: [...(s.thread.items || []), c].slice(-50) };
        const warned = moderationDialog(c);
        return { state: { ...patchPost({ ...s, thread }, s.thread.postId, (p) => ({ comments: (p.comments || 0) + 1 })), thread: { ...thread, post: { ...thread.post, comments: (thread.post.comments || 0) + 1 } }, ...moderationState(c), inputs: { commentText: "" } },
          ...(warned ? { dialog: warned } : {}) };
      }
      case "postMenu":
        return { dialog: { title: T.deletePost[0], titleEn: T.deletePost[1], body: T.deleteText[0], bodyEn: T.deleteText[1],
          buttons: [{ label: T.delete[0], labelEn: T.delete[1], event: "deletePost", arg: String(arg), variant: "primary" }, { label: T.cancel[0], labelEn: T.cancel[1], variant: "text" }] } };
      case "deletePost": {
        await callFresh("/posts/" + arg, { method: "DELETE" });
        const keep = (i) => !(i.type === "post" && sameId(i.id, arg));
        const out = { feed: (s.feed || []).filter(keep) };
        if (s.cfeed) out.cfeed = s.cfeed.filter(keep);
        if (s.profile) out.profile = { ...s.profile, posts: (s.profile.posts || []).filter(keep) };
        if (s.user) out.user = { ...s.user, posts: (s.user.posts || []).filter(keep) };
        const wasOpen = s.thread && sameId(s.thread.postId, arg);
        if (wasOpen) out.thread = null;
        return { state: out, ...(wasOpen ? { ui: [{ close: "thread" }] } : {}), ...toast(T.deleted) };
      }
      case "openUser":
        if (s.me && sameId(arg, s.me.id)) return { state: { tab: "profile", ...(await loadProfile(s.me)) }, ui: [{ close: "thread" }] };
        return { route: { push: "user", params: { id: String(arg) } }, state: { user: await call("/users/" + arg) }, ui: [{ close: "thread" }] };
      case "back": {
        // Back from a post, a person or a community lands on the main tabs (loading the feed when a notice opened us deep).
        const out = { view: "main" };
        if (s.feed === undefined) Object.assign(out, await loadFeed(s));
        return { route: { pop: true }, state: out };
      }
      case "follow":
      case "unfollow":
        await callFresh("/follow/" + arg, { method: name === "follow" ? "POST" : "DELETE" });
        return { state: patchFollow(s, arg, name === "follow") };
      case "search": {
        const q = String(inputs.searchText || "").trim();
        if (q.length < 2) return { state: { results: undefined } };
        const r = await call("/people?q=" + encodeURIComponent(q));
        return { state: { results: r.items } };
      }
      case "checkHandle": {
        const h = String(value || "").trim().replace(/^@/, "").toLowerCase();
        if (h.length < 3) return { state: { handleCheck: null } };
        return { state: { handleCheck: await call("/handles/" + encodeURIComponent(h)) } };
      }
      case "pickHandle": {
        const values = (arguments[0] && arguments[0].values) || inputs;
        const me = await callFresh("/me", { method: "PATCH", json: { handle: values.handleText, name: values.nameText } });
        const next = await open({ ...s, me }, { name: "main" });
        return { ...next, ...toast(["¡Listo! Ya eres @" + me.handle, "Done! You're @" + me.handle]) };
      }
      case "saveProfile": {
        const values = (arguments[0] && arguments[0].values) || inputs;
        const me = await callFresh("/me", { method: "PATCH", json: { name: values.nameText, handle: values.handleText, bio: values.bioText || "" } });
        return { state: { me, ...(await loadProfile(me)) }, ui: [{ close: "editProfile" }], ...toast(T.saved) };
      }
      case "toggleShare": {
        const me = await callFresh("/me", { method: "PATCH", json: { shareActivity: value === true } });
        return { state: { me } };
      }
      case "toggleActivity": {
        await callFresh("/me/activity/" + arg, { method: "PATCH", json: { hidden: value !== true } });
        return { state: { myActivity: (s.myActivity || []).map((a) => (sameId(a.id, arg) ? { ...a, hidden: value !== true } : a)) } };
      }
      case "logoutAll":
        await callFresh("/me/logout-all", { method: "POST" });
        kino.storage.remove("session");
        return { close: true, ...toast(["Cerraste sesión en todos tus aparatos", "You logged out on all your devices"]) };
      default:
        return null;
    }
  } catch (e) {
    return failure(e);
  }
}
