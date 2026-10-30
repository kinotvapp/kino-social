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

/** "Título — T4·E3": the season/episode fragment inlined (watchedLine's phrasing is for a saved post, not compose). */
function plainTitleText(context) {
  const name = String(context.title || "").trim();
  if (context.kind === "series" && Number.isInteger(context.season) && Number.isInteger(context.episode)) {
    return `${name} — T${context.season}·E${context.episode}`;
  }
  return name;
}

/** `{ kind, tmdbId, title, year }` for `postBody`'s `attach`, only when `context.ids.tmdb` is a usable id. */
function attachFromContext(context) {
  const id = context && context.ids && context.ids.tmdb;
  if (!Number.isInteger(id) || id <= 0) return null;
  return { kind: context.kind, tmdbId: id, title: context.title, year: context.year };
}

/** "Feed general" first, then the communities the person has joined (only those: she can only post there). */
function communityOptions(communities) {
  const mine = (communities && communities.mine) || [];
  return [
    { value: "feed", label: "Feed general", labelEn: "General feed" },
    ...mine.map((c) => ({ value: String(c.id), label: c.name })),
  ];
}

function composeRoot(state, communities) {
  return { type: "Column", padding: 16, gap: 12, children: [
    { type: "TextField", key: "text", multiline: true, maxLength: 500, value: state.text || "",
      hintText: T.commentHint[0], hintTextEn: T.commentHint[1], onChanged: "setText" },
    { type: "DropdownButton", key: "communityId", labelText: T.communities[0], labelTextEn: T.communities[1],
      value: state.communityId ?? "feed", onChanged: "pickCommunity", options: communityOptions(communities) },
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
  const attach = attachFromContext(context);
  const isSeries = context.kind === "series";
  const forceEmpty = event.name === "like";
  const typed = String(state.text || "").trim();
  let text;
  let season = null;
  let episode = null;
  if (attach) {
    text = forceEmpty ? "" : typed;
    if (isSeries) {
      season = context.season;
      episode = context.episode;
    }
  } else {
    const fragment = plainTitleText(context);
    text = forceEmpty || !typed ? fragment : `${typed} — ${fragment}`;
  }
  const json = postBody({ text, attach, season, episode, communityId: state.communityId });
  const post = await callFresh("/posts", { method: "POST", json });
  const [es, en] = moderationToast(post) || T.published;
  return { state: { ...state, text: "" }, toast: es, toastEn: en };
}

export async function panelAction({ event, context }) {
  const state = (context && context.state) || {};
  try {
    switch (event.name) {
      case "send":
      case "like":
        return await postFromContext(event, context);
      case "setText":
        return { state: { ...state, text: event.value } };
      case "checkHandle": {
        const h = String(event.value || "").trim().replace(/^@/, "").toLowerCase();
        if (h.length < 3) return { state: { ...state, handleCheck: null } };
        return { state: { ...state, handleCheck: await call("/handles/" + encodeURIComponent(h)) } };
      }
      case "pickHandle": {
        const values = event.values || {};
        const me = await callFresh("/me", { method: "PATCH", json: { handle: values.handleText, name: values.nameText } });
        return { state: { ...state, me, handleCheck: null }, toast: `¡Listo! Ya eres @${me.handle}`, toastEn: `Done! You're @${me.handle}` };
      }
      case "pickCommunity":
        return { state: { ...state, communityId: event.value } };
      default:
        return null;
    }
  } catch (e) {
    const code = e instanceof ApiError ? e.code : "offline";
    if (code === "rate_limited") return toast(T.tooFast);
    if (code === "not_member") return toast(T.notMember);
    if (code === "muted") return toast(T.panelMutedToast);
    return toast(T.offline);
  }
}
