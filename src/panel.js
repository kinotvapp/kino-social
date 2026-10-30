// The player-panel tab (apiVersion 14, screen-kit): a comment box, a community picker, "Me gusta" and "Enviar", for
// whatever is playing right now. Panel state lives in `context.state` — Kino's own per-title save, round-tripped
// through panelAction's own `state` field — never the main plugin's `state` from events.js/screen(), which this tab
// never touches: `{ me?, handleCheck?, communities?, text?, communityId? }`.

import { ApiError, call, callFresh, savedSession } from "./api.js";
import { postBody } from "./attach.js";
import { moderationToast } from "./moderation.js";
import { T, label } from "./i18n.js";
import { welcomeView } from "./ui/views.js";
import { Txt } from "./ui/kit.js";

const toast = ([es, en]) => ({ toast: es, toastEn: en });

/** Pre-apiVersion-14 Kino (or screens off): no screen-kit, so a simple classic-panel message, nothing more. */
const CLASSIC_PANEL = { title: "Kino Social", elements: [{ type: "status", text: T.updateKino[0], textEn: T.updateKino[1] }] };

const screenResult = (root) => ({ format: "screen", title: "Kino Social", root });

const noIdentityRoot = () => ({ type: "Column", padding: 16, children: [Txt(T.noIdentity), Txt(T.noIdentityText, { color: "muted" })] });

/** Kino's wire vocabulary ("movie"/"episode"/"live") translated to what postBody/attach.js expects ("movie"/"series"); null for live (not a goal here, per spec section 3). */
function titleKind(context) {
  if (context.kind === "episode") return "series";
  if (context.kind === "movie") return "movie";
  return null;
}

/** "Título — T4·E3": the season/episode fragment inlined (watchedLine's phrasing is for a saved post, not compose). */
function plainTitleText(context) {
  const name = String(context.title || "").trim();
  if (titleKind(context) === "series" && Number.isInteger(context.season) && Number.isInteger(context.episode)) {
    const [es, en] = T.episodeFragment(name, context.season, context.episode);
    return context.lang === "en" ? en : es;
  }
  return name;
}

/** `{ kind, tmdbId, title, year }` for `postBody`'s `attach`, only when `context.ids.tmdb` is a usable id and the kind translates to one `postBody` understands (not "live"). */
function attachFromContext(context) {
  const kind = titleKind(context);
  if (!kind) return null;
  const id = context && context.ids && context.ids.tmdb;
  if (!Number.isInteger(id) || id <= 0) return null;
  // Kino sends `year` as a string (`subject?.year?.toString()`); the backend's post-attach only accepts an integer.
  const year = Number.parseInt(context.year, 10);
  return { kind, tmdbId: id, title: context.title, year: Number.isFinite(year) ? year : undefined };
}

/** The "feed" sentinel (the dropdown's own default option) means "no community": `postBody` wants `null` for that. */
const FEED = "feed";
const communityIdForBody = (state) => (state.communityId && state.communityId !== FEED ? state.communityId : null);

/** "Feed general" first, then the communities the person has joined (only those: she can only post there). */
function communityOptions(communities) {
  const mine = (communities && communities.mine) || [];
  return [
    { value: FEED, label: T.feedOption[0], labelEn: T.feedOption[1] },
    ...mine.map((c) => ({ value: String(c.id), label: c.name })),
  ];
}

/**
 * `me`/`communities` to carry in a `panelAction` response's `state` patch: whatever `state` already cached, else
 * fetched once. `panel(context)` cannot write `state` itself (`player-panel.md#screen-mode`'s own result shape has
 * no `state` field), and this tab sets no `refreshMs`, so `panel()` only redraws after a `panelAction` response —
 * meaning this is the only place the cache can ever get seeded, and once it has, every later action just forwards it.
 */
async function carryCache(state) {
  const out = {};
  if (state.me) out.me = state.me;
  else {
    try {
      out.me = await call("/me");
    } catch (_) {
      // leave it uncached; the next panel() draw or action tries again
    }
  }
  if (state.communities) out.communities = state.communities;
  else {
    try {
      out.communities = await call("/communities");
    } catch (_) {
      out.communities = { mine: [] };
    }
  }
  return out;
}

function composeRoot(state, communities) {
  return { type: "Column", padding: 16, gap: 12, children: [
    { type: "TextField", key: "text", multiline: true, maxLength: 500, value: "",
      hintText: T.commentHint[0], hintTextEn: T.commentHint[1] },
    { type: "DropdownButton", key: "communityId", labelText: T.communities[0], labelTextEn: T.communities[1],
      value: state.communityId ?? FEED, onChanged: "pickCommunity", options: communityOptions(communities) },
    { type: "Row", gap: 8, children: [
      { type: "ElevatedButton", key: "like", onPressed: "like", ...label(...T.likeButton) },
      { type: "ElevatedButton", key: "send", onPressed: "send", variant: "primary", ...label(...T.send) },
    ] },
  ] };
}

export async function panel(context) {
  if (!(context.features || []).includes("screen")) return CLASSIC_PANEL;
  if (!savedSession()) return screenResult(noIdentityRoot());

  const state = context.state || {};
  let me = state.me;
  if (!me) {
    try {
      me = await call("/me");
    } catch (_) {
      return screenResult(noIdentityRoot());
    }
  }
  if (!me.handle) {
    return screenResult(welcomeView({ me, handleCheck: state.handleCheck }, { device: context.device, size: context.size, lang: context.lang }));
  }

  let communities = state.communities;
  if (!communities) {
    try {
      communities = await call("/communities");
    } catch (_) {
      communities = { mine: [] };
    }
  }

  return screenResult(composeRoot(state, communities));
}

/** `send`/`like`: the title attached when there's a TMDB id, else its name woven into plain text; no title either way. */
async function postFromContext(event, context) {
  const state = context.state || {};
  const cache = await carryCache(state);
  const attach = attachFromContext(context);
  const isSeries = titleKind(context) === "series";
  const forceEmpty = event.name === "like";
  const typed = String((event.values && event.values.text) || "").trim();
  let text;
  let season = null;
  let episode = null;
  if (attach) {
    text = forceEmpty ? "" : typed;
    if (isSeries) {
      season = context.season;
      episode = context.episode;
      // A season-0 special loses its T.E tag today: attach.js's postBody guard (shipped, not touched by this fix
      // round) requires season > 0, though the backend itself accepts season >= 0. Known, deliberately-unfixed gap.
    }
  } else {
    const fragment = plainTitleText(context);
    text = forceEmpty || !typed ? fragment : `${typed} — ${fragment}`;
  }
  const json = postBody({ text, attach, season, episode, communityId: communityIdForBody(state) });
  const post = await callFresh("/posts", { method: "POST", json });
  const [es, en] = moderationToast(post) || T.published;
  const base = { me: cache.me, communities: cache.communities };
  return {
    state: forceEmpty ? base : { ...base, inputs: { text: "" } },
    toast: es, toastEn: en,
  };
}

export async function panelAction(event, context) {
  const state = (context && context.state) || {};
  try {
    switch (event.name) {
      case "send":
      case "like":
        return await postFromContext(event, context);
      case "checkHandle": {
        const h = String(event.value || "").trim().replace(/^@/, "").toLowerCase();
        if (h.length < 3) return { state: { handleCheck: null } };
        return { state: { handleCheck: await call("/handles/" + encodeURIComponent(h)) } };
      }
      case "pickHandle": {
        const values = event.values || {};
        const me = await callFresh("/me", { method: "PATCH", json: { handle: values.handleText, name: values.nameText } });
        const [es, en] = T.pickedHandle(me.handle);
        return { state: { me, handleCheck: null }, toast: es, toastEn: en };
      }
      case "pickCommunity": {
        const cache = await carryCache(state);
        return { state: { me: cache.me, communities: cache.communities, communityId: event.value } };
      }
      default:
        return null;
    }
  } catch (e) {
    const code = e instanceof ApiError ? e.code : "offline";
    if (code === "rate_limited") return toast(T.tooFast);
    if (code === "not_member") return toast(T.notMember);
    if (code === "muted") return toast(T.panelMutedToast);
    if (code === "handle_taken") return toast(T.handleTaken);
    if (code === "bad_handle") return toast(T.badHandle);
    // no_identity/device_taken/too_many_devices/unofficial: events.js (the main plugin's own handle flow) answers
    // these with a `{ state: { problem: code } }` for a dedicated screen this panel tab doesn't have; with no screen
    // to show it on, falling through to the generic offline toast is the reasonable call here.
    return toast(T.offline);
  }
}
