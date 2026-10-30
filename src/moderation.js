// Moderation as the server tells it (owner, 2026-10-29): a post or comment that had offensive words (masked here or on
// the server) is a warning; the third within 12 h mutes the person for 12 h. Pure: the dialogs and the line under the
// locked composer, built from what the server answered.

import { T } from "./i18n.js";

export const LIMIT = 3;

/** The end of the mute when [until] is still ahead of [now], else 0. */
export function mutedUntil(until, now = Date.now()) {
  const n = Number(until);
  return Number.isInteger(n) && n > now ? n : 0;
}

/** «No puedes publicar ni comentar hasta las 18:42»: Kino writes the clock in the device's 12/24 h. */
export function muteLine(until, props = {}) {
  const [es, en] = T.mutedUntilLine;
  return { type: "Text", text: es, textEn: en, time: Number(until), timeFormat: "clock", style: "caption", color: "error", ...props };
}

const okButton = () => ({ label: T.ok[0], labelEn: T.ok[1], variant: "primary" });

/** The dialog of a mute: «Usaste palabras ofensivas tres veces. No podrás publicar ni comentar hasta las 18:42». */
export function muteDialog(until) {
  const [es, en] = T.mutedUntilDialog;
  return {
    body: [
      { type: "Text", text: T.mutedStarted[0], textEn: T.mutedStarted[1] },
      { type: "Text", text: es, textEn: en, time: Number(until), timeFormat: "clock" },
    ],
    buttons: [okButton()],
  };
}

/**
 * What a saved post or comment's answer asks to show: null when it earned no warning; the mute dialog when its warning
 * started the mute; else «Llevas N de 3 avisos».
 */
export function moderationDialog(response) {
  const m = response && response.moderation;
  if (!m || typeof m !== "object") return null;
  if (Number.isInteger(m.mutedUntil) && m.mutedUntil > 0) return muteDialog(m.mutedUntil);
  const limit = Number.isInteger(m.limit) && m.limit > 0 ? m.limit : LIMIT;
  const n = Number.isInteger(m.strikes) && m.strikes > 0 ? Math.min(m.strikes, limit) : 1;
  const [es, en] = T.strikeWarning(n, limit);
  return { body: es, bodyEn: en, buttons: [okButton()] };
}

/** The state an answer with [response] leaves: the mute's end when it started one. */
export function moderationState(response, now = Date.now()) {
  const m = response && response.moderation;
  const until = m && mutedUntil(m.mutedUntil, now);
  return until ? { mutedUntil: until } : {};
}
