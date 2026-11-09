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
import { canPublish, cleanQuery, pickAttachment, postBody, recentTitles, searchTitles, withPoster } from "./attach.js";
import { coinRefusal, coinsReady, coinsSwitchedOff, knownTotals, loadCoins, rememberTotal } from "./coins.js";
import { fullCardGo, goPluginReady, slimCard, utf8Length } from "./card.js";
import { draftById, draftCard, draftExcerpt, readDrafts, removeDraft, reviewState } from "./wall.js";
import { SETTING as DIRECT_SETTING, allowedPublishers, isAllowed, takeDirectWarning, withAllowed } from "./direct.js";

/** The drafts other plugins proposed, as the feed's banner lists them (a few short fields each; never a card's image). */
const draftsState = () => readDrafts().map((d) => ({ id: d.id, from: d.from || "", text: draftExcerpt(d).slice(0, 140), titled: !!d.title, carded: !!d.card }));

const MAX_FEED = 80;
// A community's feed and the posts that wait behind «N nuevas» hold less than the feed; with every list full of share
// cards, `fitState` keeps the whole screen state under STATE_LINE, far from Kino's 64 KB (test/cards.test.mjs pins it).
const MAX_CFEED = 30;
const MAX_NEWER = 10;
const FEED_PAGE = 20;
const toast = ([es, en]) => ({ toast: es, toastEn: en });

function failure(e) {
  const code = e instanceof ApiError ? e.code : "offline";
  if (code === "rate_limited") return toast(T.tooFast);
  if (code === "handle_taken") return toast(T.handleTaken);
  if (code === "bad_handle") return toast(T.badHandle);
  if (code === "slug_taken") return toast(T.slugTaken);
  if (["bad_name", "bad_slug", "bad_description"].includes(code)) return toast(T.badCommunity);
  if (code === "not_member") return toast(T.notMember);
  // A share card the server refuses (an 18+-looking title, a field out of rule): the composer keeps it and the words.
  if (code === "bad_card") return toast(T.badCard);
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

/** Your profile, with your coins (null hides them: no coins in this Kino, or the service is unavailable). */
async function loadProfile(me) {
  // myPlugins carries every attached repo, hidden ones included (`?all=1`) -- the own profile is the one place that
  // needs them, to render the "Ocultos" list (CREATOR-PROFILE-SPEC.md §6).
  const [p, mine, plugins, coins] = await Promise.all([call("/users/" + me.id), call("/me/activity"), call("/me/plugins?all=1").catch(() => ({ plugins: [] })), loadCoins()]);
  return { profile: p, myActivity: mine.items, myPlugins: plugins.plugins, coins, coinTotals: knownTotals() };
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
    // Asked once per open: it learns whether the person switched Kinos off (or back on) in Kino's Ajustes.
    const coins = await loadCoins();
    const base = { me, problem: null, mutedUntil: mutedUntil(me.mutedUntil), ...(coinsReady() ? { coins, coinTotals: knownTotals() } : {}) };
    if (!me.handle) return { state: { ...base, view: "welcome" } };
    await syncActivity().catch(() => 0);
    const notes = await call("/notifications").catch(() => ({ unread: 0 }));
    await markSeen(notes); // also when a notice opened a post or a profile
    // A notice opens the screen at { name, params: {}, args } (go.screen's args); a push inside the screen sets params.
    const id = (route.args && route.args.id) || (route.params && route.params.id);
    if (route.name === "post" && id) return { state: { ...base, view: "post", thread: await loadThread(id) } };
    if (route.name === "user" && id) return { state: { ...base, view: "user", user: await call("/users/" + id) } };
    // The daily coins notice opens your profile, where the balance is.
    if (route.name === "me") return { state: { ...base, view: "me", ...(await loadProfile(me)) } };
    if (route.name === "community" && id) return { state: { ...base, view: "community", ...(await loadCommunity(id)) } };
    const main = { ...base, view: "main", ...(await loadFeed(state)), unread: notes.unread || 0, drafts: draftsState() };
    // A draft's notice opens the feed with that draft in the composer, ready for the person's own Publicar.
    const draft = route.name === "draft" && id ? draftById(id) : null;
    if (draft) {
      const review = await reviewState(draft);
      return { state: { ...main, ...review.state }, ui: review.ui };
    }
    return { state: main };
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

/** The post [postId] wherever the state holds it (feed, community, open post, profiles). */
function findPost(state, postId) {
  const lists = [state.feed, state.cfeed, state.thread && [state.thread.post], state.profile && state.profile.posts, state.user && state.user.posts];
  for (const list of lists) {
    const hit = (list || []).find((p) => p && p.type === "post" && sameId(p.id, postId));
    if (hit) return hit;
  }
  return null;
}

/** One tap, one coin: Kino gives it through the coins service; the answer is the balance left and the post's total. */
async function giveCoin(state, postId) {
  if (!coinsReady()) return null;
  const post = findPost(state, postId);
  const to = post && post.user && post.user.coinsAccount;
  if (!to) return null;
  if (state.me && sameId(post.user.id, state.me.id)) return toast(T.coinSelf);
  try {
    const r = await kino.coins.give({ to, postId: String(postId) });
    const coins = { ...(state.coins || { earnedToday: 0, capToday: 0 }), balance: Number(r.balance) || 0 };
    const out = { coins };
    if (Number.isFinite(Number(r.postTotal))) out.coinTotals = rememberTotal(String(postId), Number(r.postTotal));
    return { state: out, ...toast(T.coinGiven) };
  } catch (e) {
    // Switched off in Kino's Ajustes: no word about it, the coins just leave the screen.
    if (coinsSwitchedOff(e)) return { state: { coins: null } };
    return toast(coinRefusal(e));
  }
}

/**
 * The press of a share card whose button is an event: a plugin with no plain repo (installed from a file or a URL) or an
 * older Kino, which would drop a go.plugin without a word, get a toast naming the plugin; a card whose route the state
 * did not keep is read again from the server and opened from this answer to the person's press.
 */
async function cardTap(state, postId) {
  const post = findPost(state, postId);
  const c = post && slimCard(post.card);
  if (!c) return null;
  if (!c.g && !c.m) return toast(T.cannotOpen(c.n));
  if (!goPluginReady()) return toast(T.updateKinoToOpen(c.n));
  let fresh;
  try {
    fresh = await callFresh("/posts/" + encodeURIComponent(String(postId)), { fullCards: true });
  } catch (e) {
    // Deleted meanwhile: it says so; anything else is the usual answer (offline, rate limited...).
    return e instanceof ApiError && e.status === 404 ? toast(T.cardPostGone) : failure(e);
  }
  const go = fullCardGo(fresh.card);
  return go ? { go: { plugin: go } } : toast(T.cannotOpen(c.n));
}

/**
 * Whether the event comes from the main feed: its route says so (the state's `view` may be stale after a system Back).
 * The feed is every root that draws `view` (plugin.js `screen`): "main", and the route a notice opened the screen at
 * ("draft"), which Kino keeps at the bottom of the stack for the whole session; only the pushed pages are not.
 */
const PAGE_VIEWS = ["me", "post", "user", "community"];
const onMain = (route) => !!route && !PAGE_VIEWS.includes(route.name);

/**
 * The pages the person left: on the main feed (route `main`, nothing pushed over it) a community's feed, a person's posts
 * and your profile are no longer on screen nor under it, so they leave the state (the next opening loads them again), and
 * a page `view` left from a deep link or an opening goes back to "main". Kino's system Back pops a page without an event,
 * so this runs on whatever event comes next on the feed (its own `tick` at the latest); only the route decides.
 */
const PAGE_KEYS = ["cfeed", "cnext", "community", "crequests", "user", "profile", "myActivity", "myPlugins"];
function leftPages(s, route) {
  if (!onMain(route)) return null;
  const out = Object.fromEntries(PAGE_KEYS.filter((k) => s[k] !== undefined && s[k] !== null).map((k) => [k, null]));
  if (PAGE_VIEWS.includes(s.view)) out.view = "main";
  return Object.keys(out).length ? out : null;
}

// The whole state is kept under this line (Kino refuses a patch past 64 KB and the feed would stop updating). Only a
// state crowded with share cards ever reaches it; what is shed first is what is not on screen.
const STATE_LINE = 44 * 1024;
const stateBytes = (s) => utf8Length(JSON.stringify(s));
const mergeState = (s, patch) => {
  const next = { ...s };
  for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k]; else next[k] = v;
  return next;
};

/** The main feed cut to its first [n] items, its cursor moved to the oldest kept one. */
function feedTo(feed, n) {
  const kept = feed.slice(0, n);
  const times = kept.map((i) => i.createdAt).filter(Number.isFinite);
  return { feed: kept, ...(times.length ? { next: Math.min(...times) } : {}) };
}

/**
 * The answer's patch, shedding what is off screen while the state it leaves would pass STATE_LINE: the posts waiting behind
 * «N nuevas» (the next `tick` brings them back), then the end of the main feed when a page covers it (down to 40, then
 * 20 posts; «Cargar más» reloads them), then the end of a community's feed when a page covers it (down to 10).
 */
function fitState(s, out, route) {
  if (!out || !out.state) return out;
  const patch = { ...out.state };
  let merged = mergeState(s, patch);
  if (stateBytes(merged) <= STATE_LINE) return out;
  const top = route && route.name;
  const covered = !onMain(route); // a page is over the feed
  const steps = [
    () => (merged.newer || []).length && { newer: [] },
    () => covered && (merged.feed || []).length > 40 && feedTo(merged.feed, 40),
    () => covered && (merged.feed || []).length > FEED_PAGE && feedTo(merged.feed, FEED_PAGE),
    () => covered && top !== "community" && (merged.cfeed || []).length > 10 && (({ feed, next }) => ({ cfeed: feed, cnext: next }))(feedTo(merged.cfeed, 10)),
  ];
  for (const step of steps) {
    const cut = step();
    if (!cut) continue;
    Object.assign(patch, cut);
    merged = mergeState(merged, cut);
    if (stateBytes(merged) <= STATE_LINE) break;
  }
  return { ...out, state: patch };
}

/**
 * A direct post's moderation warning (direct.js keeps it: nobody was looking when it went out) shown with the next answer
 * that can carry a dialog: the opening or the next press on the feed, never a `tick` (its dialog would be dropped), never
 * over another dialog or a problem page. The mute it started comes in through `moderationState`.
 */
function withDirectWarning(event, out) {
  if (event.name === "tick" || (event.name !== "open" && !onMain(event.route))) return out;
  if (out && (out.dialog || (out.state && out.state.problem))) return out;
  const m = takeDirectWarning();
  if (!m) return out;
  const answer = { moderation: m };
  const warned = moderationDialog(answer);
  if (!warned) return out;
  return { ...(out || {}), state: { ...((out && out.state) || {}), ...moderationState(answer) }, dialog: warned };
}

export async function screenEvent(event) {
  const s = event.state || {};
  let out = withDirectWarning(event, await handleEvent(event));
  const stale = leftPages(s, event.route);
  if (stale) out = { ...(out || {}), state: { ...stale, ...((out && out.state) || {}) } };
  return fitState(s, out, event.route);
}

/**
 * The plugin to ask about after the person published draft [d]: `{ repo, name }` when the draft asked to go direct
 * (`direct` is never set for an 18+ caller) from a plugin with an address that is not allowed yet; else null.
 */
function directAsk(d) {
  const c = d && d.direct === true && d.caller;
  if (!c || !c.repo || isAllowed(c.repo)) return null;
  return { repo: c.repo, name: c.name || d.from || c.repo };
}

/** «¿Permitir que <plugin> publique directo en tu muro?» with Permitir / Solo esta vez. */
const askDirectDialog = ({ repo, name }) => ({
  title: T.allowDirect(name)[0], titleEn: T.allowDirect(name)[1], body: T.allowDirectBody[0], bodyEn: T.allowDirectBody[1],
  buttons: [
    { label: T.allowDirectYes[0], labelEn: T.allowDirectYes[1], event: "allowDirect", arg: repo, variant: "primary" },
    { label: T.allowDirectOnce[0], labelEn: T.allowDirectOnce[1], variant: "text" },
  ],
});

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

// Every handler is awaited inside the try below (`return await`), so a rejection lands in `failure`, never out of here.
async function handleEvent({ name, arg, value, state, route, device }) {
  const s = state || {};
  const inputs = s.inputs || {};
  try {
    switch (name) {
      case "open":
        return await open(s, route || { name: "main" });
      case "openProfile":
        // Your profile is a page of its own over the tabs (back arrow and the system back), never a tab: a TabBar can
        // only mark one of its own tabs, so a hidden one left «Feed» marked and a tap on it did nothing.
        return { route: { push: "me", params: {} }, state: { ...(await loadProfile(s.me)) } };
      case "tab": {
        const tab = value;
        if (tab === "people") {
          const people = await call("/people");
          return { state: { tab, people: people.items, results: undefined } };
        }
        if (tab === "communities") return { state: { tab, communities: await call("/communities"), communityResults: undefined } };
        return { state: { tab } };
      }
      case "refresh": {
        const out = { ...(await loadFeed(s)), selected: s.selected };
        if (route && route.name === "me") Object.assign(out, await loadProfile(s.me));
        if (s.tab === "people") out.people = (await call("/people")).items;
        if (s.tab === "communities") out.communities = await call("/communities");
        await syncActivity().catch(() => 0);
        const notes = await call("/notifications").catch(() => ({ unread: s.unread || 0 }));
        return { state: { ...out, unread: notes.unread || 0, drafts: draftsState() }, ...toast(["Al día", "Up to date"]) };
      }
      case "tick": {
        // Nobody's press: a conditional GET of the first page; new posts wait behind «N nuevas» instead of moving the feed.
        // A mute that ran out unlocks the composer and the comment field without a press.
        if (s.mutedUntil && !mutedUntil(s.mutedUntil)) return { state: { mutedUntil: 0 } };
        // On the feed by its route (a system Back leaves `view` stale), or by `view` when Kino gave no route.
        if (!(route ? onMain(route) && s.view !== "welcome" : s.view === "main") || !s.feed) return null;
        // A draft another plugin proposed while the screen was open shows up in the feed's banner.
        const drafts = draftsState();
        if (drafts.length !== (s.drafts || []).length) return { state: { drafts } };
        const page = await call("/feed?limit=20", { etag: s.feedTag }).catch(() => ({ notModified: true }));
        if (page.notModified) return null;
        const known = new Set([...(s.feed || []), ...(s.newer || [])].map((i) => i.type + ":" + i.id));
        const newer = mergeById([...(s.newer || []), ...page.items.filter((i) => i.type !== "suggestions" && !known.has(i.type + ":" + i.id))]).slice(0, MAX_NEWER);
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
        return { state: { cfeed: mergeById([...(s.cfeed || []), ...page.items]).slice(-MAX_CFEED), cnext: page.next, cloadingMore: false } };
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
      // «Quitar tarjeta»: the post goes without the card, and is no longer that draft's review: the card draft stays in
      // the banner until the person publishes it or discards it.
      case "clearCard":
        return { state: { attachCard: null, draftId: null }, focus: "openAttach" };
      // A draft another plugin proposed: into the composer (the person still presses Publicar), or away.
      case "reviewDraft": {
        const d = draftById(arg);
        if (!d) return { state: { drafts: draftsState() }, ...toast(T.draftGone) };
        const review = await reviewState(d);
        return { state: { ...review.state, tab: "feed" }, ui: review.ui };
      }
      case "discardDraft":
        removeDraft(arg);
        return { state: { drafts: draftsState(), ...(s.draftId === String(arg) ? { draftId: null } : {}) }, ...toast(T.draftDiscarded) };
      case "publish": {
        const values = (arguments[0] && arguments[0].values) || inputs;
        const raw = tidyLines(values.postText ?? inputs.postText);
        // A share card is read whole from its stored draft (the state holds only its short fields, never its image).
        let card = null;
        if (s.attachCard) {
          const d = draftById(s.attachCard.draftId);
          if (!d || !d.card) return toast(T.draftGone);
          card = draftCard(d);
        }
        const attach = s.attach && !card ? await withPoster(s.attach) : null;
        if (!canPublish(raw, attach, card)) return toast(T.needTextOrTitle);
        const text = raw ? await clean(raw) : "";
        // The device reads the link (the server never fetches): a TMDB or IMDb title from Kino's TMDB, else the page's head.
        // A title the person attached, or a card, wins over any link, which then stays plain text: nothing to read.
        const linkTitle = text && !attach && !card ? await titleHint(text) : null;
        const link = linkTitle || !text || attach || card ? null : await linkPreview(text);
        // Written inside a community's page, it goes to that community and its feed; else to the general one. The route
        // decides: after a system Back the state may still name the last community (and `view` with it).
        const inCommunity = !!s.community && !!route && route.name === "community";
        const json = postBody({ text, linkTitle, link, attach, card, communityId: inCommunity ? s.community.id : null });
        const post = await callFresh("/posts", { method: "POST", json });
        const placed = inCommunity
          ? { cfeed: mergeById([post, ...(s.cfeed || [])]).slice(0, MAX_CFEED), community: { ...s.community, posts: (s.community.posts || 0) + 1 } }
          : { feed: mergeById([post, ...(s.feed || [])]).slice(0, MAX_FEED), tab: "feed" };
        const warned = moderationDialog(post);
        // A draft that asked to go direct: its plugin may be allowed now (a moderation dialog wins; the ask waits for the next one).
        const ask = warned || !s.draftId ? null : directAsk(draftById(s.draftId));
        // A reviewed draft is done once it is out.
        if (s.draftId) removeDraft(s.draftId);
        return { state: { ...placed, ...moderationState(post), attach: null, attachCard: null, draftId: null, maybeSent: false, drafts: draftsState(), ...closedPicker(), inputs: { postText: "", titleSearch: "" },
          ...(ask ? { askDirect: ask } : {}) },
          ui: [{ close: "composer" }], ...(warned ? { dialog: warned } : ask ? { dialog: askDirectDialog(ask) } : toast(T.published)) };
      }
      // Permitir: the plugin joins the person's synced list of plugins that publish directly.
      case "allowDirect": {
        const ask = s.askDirect;
        if (!ask || !ask.repo || String(arg || "").toLowerCase() !== String(ask.repo).toLowerCase()) return { state: { askDirect: null } };
        return { config: { [DIRECT_SETTING]: withAllowed(allowedPublishers(), ask.repo, ask.name) }, state: { askDirect: null }, ...toast(T.allowed(ask.name)) };
      }
      case "like":
      case "unlike": {
        const r = await callFresh(`/posts/${arg}/like`, { method: name === "like" ? "POST" : "DELETE" });
        return { state: patchPost(s, arg, () => ({ likes: r.likes, liked: r.liked })) };
      }
      case "coin":
        return await giveCoin(s, arg);
      // A share card's button when it could not carry the go.plugin itself.
      case "cardTap":
        return await cardTap(s, arg);
      case "loadCoins":
        return { state: { coins: await loadCoins() } };
      case "openPost": {
        const thread = await loadThread(arg);
        if (device === "tv") return { state: { thread, selected: String(arg) }, focus: "commentText" };
        // On a phone the post opens as a page: a chat-like list that stays at its newest comment, the box at the bottom.
        return { route: { push: "post", params: { id: String(arg) } }, state: { thread } };
      }
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
        // Deleted from its own page: back to where it was opened from.
        const onItsPage = wasOpen && route && route.name === "post";
        return { state: { ...out, ...(onItsPage ? { view: "main" } : {}) }, ...(onItsPage ? { route: { pop: true } } : {}), ...toast(T.deleted) };
      }
      case "openUser": {
        if (s.me && sameId(arg, s.me.id)) return { route: { push: "me", params: {} }, state: { ...(await loadProfile(s.me)) } };
        const [user, plugins] = await Promise.all([call("/users/" + arg), call("/users/" + arg + "/plugins")]);
        return { route: { push: "user", params: { id: String(arg) } }, state: { user: { ...user, plugins: plugins.plugins } } };
      }
      case "hidePlugin":
      case "unhidePlugin": {
        await callFresh(`/me/plugins/${arg}/${name === "hidePlugin" ? "hide" : "unhide"}`, { method: "POST" });
        const hidden = name === "hidePlugin";
        const myPlugins = (s.myPlugins || []).map((pl) => (pl.repo === arg ? { ...pl, hidden } : pl));
        return { state: { myPlugins } };
      }
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
