// Kino coins through Kino's `coins` capability (apiVersion 16): the person's balance, one coin per tap for someone else's
// post, and a daily balance notice from the job. Kino talks to the coins service; this plugin never sees its address. An older
// Kino has no `kino.coins`: every piece here then hides itself.

import { T } from "./i18n.js";

const TOTALS_KEY = "coinTotals";
const MAX_TOTALS = 200;
const NOTICE_DAY_KEY = "coinNoticeDay";
const NOTICE_HOUR = 20;

/** Whether this Kino has coins at all. */
export const coinsReady = () => typeof kino !== "undefined" && typeof kino.coins === "object" && kino.coins !== null;

/** `{ balance, earnedToday, capToday }`, or null when the service is down, the device unvalidated, or Kino too old. */
export async function loadCoins() {
  if (!coinsReady()) return null;
  try {
    const b = await kino.coins.balance();
    return { balance: Number(b.balance) || 0, earnedToday: Number(b.earnedToday) || 0, capToday: Number(b.capToday) || 0 };
  } catch (_) {
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
  if (!coinsReady() || typeof kino.notifications !== "object") return false;
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
