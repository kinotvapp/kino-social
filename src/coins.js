// Kino coins through Kino's `coins` capability (apiVersion 16): the person's balance, one coin per tap for someone else's
// post, and a daily balance notice from the job. Kino talks to the coins service; this plugin never sees its address. An older
// Kino has no `kino.coins`: every piece here then hides itself. Neither when the person switched Kinos off in Kino's Ajustes:
// `kino.coins` then rejects with `disabled`, remembered here (COINS_OFF_KEY) so no button, balance, notice or toast shows; any
// later balance that answers clears it (the switch turned back on).

import { T } from "./i18n.js";

const TOTALS_KEY = "coinTotals";
const MAX_TOTALS = 200;
const NOTICE_DAY_KEY = "coinNoticeDay";
const NOTICE_HOUR = 20;
const COINS_OFF_KEY = "coinsOff";
/** Kino's answer when the person switched Kinos off in its Ajustes. */
export const COINS_DISABLED = "disabled";

/** Whether this Kino has `kino.coins` at all (an older one has none). */
const coinsPresent = () => typeof kino !== "undefined" && typeof kino.coins === "object" && kino.coins !== null;

/** Whether the last answer said Kinos are switched off in Kino's Ajustes. */
const knownOff = () => {
  try {
    return kino.storage.get(COINS_OFF_KEY) === "1";
  } catch (_) {
    return false;
  }
};

/** Remembers whether Kinos are switched off (an answer of `disabled`) or on (any balance). */
function rememberOff(off) {
  try {
    if (off) kino.storage.set(COINS_OFF_KEY, "1");
    else if (knownOff()) kino.storage.remove(COINS_OFF_KEY);
  } catch (_) {
    // Only a hint: the next answer says it again.
  }
}

/** Whether a rejection of `kino.coins` means "switched off in Kino's settings" (remembered when it does). */
export function coinsSwitchedOff(e) {
  const off = !!e && e.code === COINS_DISABLED;
  if (off) rememberOff(true);
  return off;
}

/** Whether this Kino has coins and the person has them on: otherwise nothing of coins shows. */
export const coinsReady = () => coinsPresent() && !knownOff();

/**
 * `{ balance, earnedToday, capToday }`, or null when the service is down, the device unvalidated, Kino too old or Kinos
 * switched off. Asked even while known off: an answer means the person turned them back on.
 */
export async function loadCoins() {
  if (!coinsPresent()) return null;
  try {
    const b = await kino.coins.balance();
    rememberOff(false);
    return { balance: Number(b.balance) || 0, earnedToday: Number(b.earnedToday) || 0, capToday: Number(b.capToday) || 0 };
  } catch (e) {
    coinsSwitchedOff(e);
    return null;
  }
}

/** The coin totals of posts this device learned (from its own gifts), by post id. */
export function knownTotals() {
  try {
    const raw = kino.storage.get(TOTALS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map && typeof map === "object" ? map : {};
  } catch (_) {
    return {};
  }
}

/** Remembers a post's total; the newest MAX_TOTALS stay. */
export function rememberTotal(postId, total) {
  const map = knownTotals();
  delete map[postId];
  map[postId] = total;
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TOTALS))) delete map[k];
  try {
    kino.storage.set(TOTALS_KEY, JSON.stringify(map));
  } catch (_) {
    // Only a nicety: the total shows again after the next gift.
  }
  return map;
}

/** The toast text for a refused gift. */
export function coinRefusal(e) {
  const code = e && e.code;
  if (code === "no_balance") return T.coinNoBalance;
  if (code === "self_gift") return T.coinSelf;
  if (code === "rate_limited") return T.tooFast;
  return T.coinUnavailable;
}

const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * The daily notice: from 20:00 local, once a day, one notice in the bell when the person has coins or earned some today.
 * Off with the "dailyBalance" setting. Answers whether it posted. A day with nothing to say is asked again on the next run.
 */
export async function balanceNotice(now = Date.now()) {
  if (!coinsPresent() || typeof kino.notifications !== "object") return false;
  if (kino.config && kino.config.get("dailyBalance") === false) return false;
  if (new Date(now).getHours() < NOTICE_HOUR) return false;
  const day = localDay(now);
  if (kino.storage.get(NOTICE_DAY_KEY) === day) return false;
  const b = await loadCoins();
  if (!b || (b.balance <= 0 && b.earnedToday <= 0)) return false;
  const [title, titleEn] = T.coinNoticeTitle(b.balance);
  const [text, textEn] = b.earnedToday > 0 ? T.coinNoticeEarned(b.earnedToday) : T.coinNoticeSpend;
  try {
    await kino.notifications.post({ id: "coins-" + day, title, titleEn, text, textEn, go: { screen: { route: "me" } } });
  } catch (_) {
    return false;
  }
  kino.storage.set(NOTICE_DAY_KEY, day);
  return true;
}
