// «Publicar ya»: a plugin the person allowed may publish a proposal straight to their wall (the door's `publish: true`).
//
// The allowed plugins are the manifest's `list` setting `directPublishers` (`{ repo, name }` entries, synced like every
// setting): the person adds one with Permitir, the first time they publish a draft that asked to go direct, and removes
// it on their profile or in Ajustes ▸ Plugins ▸ Kino Social. Addresses compare as `owner/name[/path]` with any `@ref` cut,
// ignoring case.
//
// A direct post goes through the composer's path: the same POST /posts, so the server's profanity mask, moderation, rate
// limits and mute all apply. Inside a provider call there is no person's press, so it uses the saved session only (no
// login: kino.identity needs a press) and the local swear list only (no kino.ai). Any failure answers null and the caller
// keeps the proposal as a draft: the sender never sees an error for it.

import { ApiError, call } from "./api.js";
import { canPublish, postBody } from "./attach.js";
import { plainRepo } from "./card.js";
import { tidyLines } from "./lines.js";
import { cleanLocal } from "./swear.js";
import { draftCard, reviewText, titleAttachment } from "./wall.js";

export const SETTING = "directPublishers";
export const MAX_ALLOWED = 20;
// Kino gives a provider call 10 s: the POST gives up in time for the draft to be kept and answered.
const BUDGET_MS = 8500;
const MIN_POST_MS = 1500;

/**
 * An address as compared: `owner/name[/path]` without `@ref`, with `owner/name` in lower case (GitHub ignores its case) and
 * the sub-path as written (a folder's name is case-sensitive: `plugins/A` is not `plugins/a`); the raw text when it is not
 * an address.
 */
function keyOf(repo) {
  const plain = plainRepo(repo) || String(repo || "").trim();
  const parts = plain.split("/");
  return [...parts.slice(0, 2).map((p) => p.toLowerCase()), ...parts.slice(2)].join("/");
}

/** The plugins the person allowed, as stored (`[]` on a Kino without `kino.config`, or when none). */
export function allowedPublishers() {
  let list;
  try {
    if (typeof kino.config !== "object" || !kino.config || typeof kino.config.get !== "function") return [];
    list = kino.config.get(SETTING);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e === "object" && typeof e.repo === "string" && e.repo.trim())
    .map((e) => ({ repo: e.repo.trim(), ...(typeof e.name === "string" && e.name.trim() ? { name: e.name.trim() } : {}) }));
}

/** Whether the plugin at [repo] (a caller's address) may publish directly. Never for a plugin without an address. */
export function isAllowed(repo) {
  if (!plainRepo(repo)) return false;
  const key = keyOf(repo);
  return allowedPublishers().some((e) => keyOf(e.repo) === key);
}

/** [list] with [repo] allowed as [name]: one entry per address (`keyOf`), the newest last, at most 20 (the newest). */
export function withAllowed(list, repo, name) {
  const key = keyOf(repo);
  const rest = (Array.isArray(list) ? list : []).filter((e) => e && keyOf(e.repo) !== key);
  const entry = { repo: String(repo), ...(name ? { name: String(name) } : {}) };
  return [...rest, entry].slice(-MAX_ALLOWED);
}

/** The POST /posts body for proposal [d], or null when nothing would be left to post. */
async function directBody(d) {
  if (d.kind === "card" && d.card) {
    return postBody({ text: cleanLocal(tidyLines(d.text || "")), card: draftCard(d) });
  }
  // A share as its review would fill the composer: its TMDB title attached, its link as plain text (no page preview).
  // One TMDB call, no poster hunt: the provider call has 10 s.
  const attach = await titleAttachment(d.title, { poster: false });
  const text = cleanLocal(tidyLines(reviewText(d)));
  if (!canPublish(text, attach)) return null;
  return postBody({ text, attach });
}

// A direct post that earned a moderation warning (or started a mute): nobody is looking, so the warning waits here, tiny,
// until the screen next opens (events.js `withDirectWarning`).
const WARNING_KEY = "directWarning";
const int = (v) => (Number.isInteger(v) ? v : undefined);

function keepWarning(m) {
  if (!m || typeof m !== "object") return;
  const w = { strikes: int(m.strikes), limit: int(m.limit), mutedUntil: int(m.mutedUntil) };
  try { kino.storage.set(WARNING_KEY, JSON.stringify(w)); } catch (_) { /* full storage: the server still counted it */ }
}

/** The moderation answer a direct post left (`{ strikes?, limit?, mutedUntil? }`), taken once; else null. */
export function takeDirectWarning() {
  let raw;
  try { raw = kino.storage.get(WARNING_KEY); } catch (_) { return null; }
  if (!raw) return null;
  try { kino.storage.remove(WARNING_KEY); } catch (_) { /* shown again next time at worst */ }
  try {
    const w = JSON.parse(raw);
    return w && typeof w === "object" ? w : null;
  } catch (_) {
    return null;
  }
}

/** A failure after the POST left the device with no answer (a throw, a timeout, a 5xx): it may have been saved. */
const unanswered = (e) => e instanceof ApiError && e.code === "offline" && (!e.status || e.status >= 500);

/**
 * Publishes proposal [d] on the person's wall now: the new post's id, or null on any failure (no session, muted, rate
 * limited, offline, a card the server refuses, no time left). [started] is when the provider call began. [report] gets
 * `maybeSent: true` when the POST went out but no answer said whether it was saved (its draft then says so). [onPost]
 * runs right before the POST leaves (the caller marks its draft then: Kino may end the call during the POST).
 */
export async function publishDirect(d, started = Date.now(), report = {}, onPost = () => {}) {
  let posting = false;
  try {
    const json = await directBody(d);
    if (!json) return null;
    const left = BUDGET_MS - (Date.now() - started);
    if (left < MIN_POST_MS) return null;
    posting = true;
    onPost();
    // No poster lookups after it (`posters: false`): the post is out, the time is Kino's.
    const post = await call("/posts", { method: "POST", json, timeoutMs: left, posters: false });
    posting = false;
    if (post && post.moderation) keepWarning(post.moderation);
    const id = Number(post && post.id);
    if (Number.isInteger(id)) return id;
    report.maybeSent = true; // a 200 without an id: something was saved
    return null;
  } catch (e) {
    if (posting && unanswered(e)) report.maybeSent = true;
    return null;
  }
}
