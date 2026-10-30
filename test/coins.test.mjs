import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { balanceNotice } from "../src/coins.js";
import { screenEvent } from "../src/events.js";
import { screen } from "../src/plugin.js";
import { postCard } from "../src/ui/cards.js";

const ANA = { id: 1, name: "Ana", handle: "ana", coinsAccount: "a".repeat(64) };
const ME = { id: 2, name: "Beto", handle: "beto", coinsAccount: "b".repeat(64) };
const post = (extra = {}) => ({ type: "post", id: 7, user: ANA, text: "hola", likes: 0, comments: 0, createdAt: 1, ...extra });

/** Every node of a tree whose key is [key]. */
function find(node, key) {
  if (!node || typeof node !== "object") return [];
  const here = node.key === key ? [node] : [];
  return here.concat(...Object.values(node).map((v) => (Array.isArray(v) ? v.flatMap((c) => find(c, key)) : find(v, key))));
}

let store;
let gifts;
let posted;
beforeEach(() => {
  store = new Map([["session", "s"]]);
  gifts = [];
  posted = [];
  globalThis.kino = {
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    config: { get: () => undefined },
    notifications: { post: async (n) => { posted.push(n); } },
    coins: {
      balance: async () => ({ balance: 5, earnedToday: 3, capToday: 20 }),
      give: async (g) => { gifts.push(g); return { balance: 4, postTotal: 9 }; },
    },
  };
});

const kinoError = (code) => Object.assign(new Error(code), { code });

test("the coin button shows only with kino.coins, a coinsAccount and someone else's post", () => {
  const phone = { device: "phone", coins: true };
  assert.equal(find(postCard(post(), phone, ME), "coin-7").length, 1);
  assert.equal(find(postCard(post(), { device: "phone", coins: false }, ME), "coin-7").length, 0);
  assert.equal(find(postCard(post({ user: { ...ANA, coinsAccount: undefined } }), phone, ME), "coin-7").length, 0);
  assert.equal(find(postCard(post({ user: ME }), phone, ME), "coin-7").length, 0);
});

test("the screen tells the cards whether this Kino has coins", async () => {
  const state = { me: ME, view: "main", tab: "feed", feed: [post()] };
  assert.equal(find(await screen({ state, route: { name: "main" }, device: "phone" }), "coin-7").length, 1);
  delete globalThis.kino.coins;
  assert.equal(find(await screen({ state, route: { name: "main" }, device: "phone" }), "coin-7").length, 0);
});

test("the button shows the post's total once known; the TV only shows the total", () => {
  const phone = { device: "phone", coins: true, coinTotals: { 7: 12 } };
  assert.equal(find(postCard(post(), phone, ME), "coin-7")[0].labelText, "12");
  const tv = postCard(post(), { device: "tv", coins: true, coinTotals: { 7: 12 } }, ME);
  assert.equal(find(tv, "coin-7").length, 0);
  assert.equal(find(tv, "coinTotal-7").length, 1);
  assert.equal(find(postCard(post(), { device: "tv", coins: true }, ME), "coinTotal-7").length, 0);
});

test("a coin tap gives once to the author's coinsAccount and updates the balance and the total", async () => {
  const s = { me: ME, feed: [post()], coins: { balance: 5, earnedToday: 3, capToday: 20 } };
  const out = await screenEvent({ name: "coin", arg: "7", state: s });
  assert.deepEqual(gifts, [{ to: ANA.coinsAccount, postId: "7" }]);
  assert.equal(out.state.coins.balance, 4);
  assert.equal(out.state.coinTotals["7"], 9);
  assert.equal(JSON.parse(store.get("coinTotals"))["7"], 9);
});

test("no coin event without kino.coins, for your own post, or for a post it cannot find", async () => {
  await screenEvent({ name: "coin", arg: "7", state: { me: ME, feed: [post({ user: ME })] } });
  await screenEvent({ name: "coin", arg: "8", state: { me: ME, feed: [post()] } });
  delete globalThis.kino.coins;
  assert.equal(await screenEvent({ name: "coin", arg: "7", state: { me: ME, feed: [post()] } }), null);
  assert.deepEqual(gifts, []);
});

test("refusals become the right toast", async () => {
  const cases = { no_balance: "Aún no tienes kinos: ganas uno cada 10 minutos que ves",
    self_gift: "No puedes regalarte kinos", not_available: "Los kinos no están disponibles ahora",
    unknown_account: "Los kinos no están disponibles ahora", rate_limited: "Vas muy rápido: espera un momento" };
  for (const [code, es] of Object.entries(cases)) {
    kino.coins.give = async () => { throw kinoError(code); };
    const out = await screenEvent({ name: "coin", arg: "7", state: { me: ME, feed: [post()] } });
    assert.equal(out.toast, es, code);
    assert.ok(out.toastEn, code);
  }
});

test("opening your profile loads the balance; an unavailable service hides it", async () => {
  const loaded = await screenEvent({ name: "loadCoins", state: { me: ME } });
  assert.deepEqual(loaded.state.coins, { balance: 5, earnedToday: 3, capToday: 20 });
  kino.coins.balance = async () => { throw kinoError("not_available"); };
  assert.equal((await screenEvent({ name: "loadCoins", state: { me: ME } })).state.coins, null);
});

const at = (h, day = 30) => new Date(2026, 9, day, h, 5).getTime();

test("the daily notice waits for 20:00, posts once a day, and only with coins", async () => {
  assert.equal(await balanceNotice(at(19)), false);
  assert.equal(await balanceNotice(at(20)), true);
  assert.equal(await balanceNotice(at(21)), false);
  assert.equal(posted.length, 1);
  assert.match(posted[0].title, /5 kinos/);
  assert.match(posted[0].titleEn, /5 Kinos/);
  assert.equal(await balanceNotice(at(20, 31)), true);
  assert.equal(posted.length, 2);
  assert.notEqual(posted[0].id, posted[1].id);
});

test("no notice with nothing to say, when the switch is off, or without kino.coins", async () => {
  kino.coins.balance = async () => ({ balance: 0, earnedToday: 0, capToday: 20 });
  assert.equal(await balanceNotice(at(20)), false);
  kino.coins.balance = async () => ({ balance: 0, earnedToday: 2, capToday: 20 });
  assert.equal(await balanceNotice(at(20, 31)), true);
  kino.config.get = (k) => (k === "dailyBalance" ? false : undefined);
  assert.equal(await balanceNotice(at(20, 1)), false);
  kino.config.get = () => undefined;
  delete globalThis.kino.coins;
  assert.equal(await balanceNotice(at(20, 2)), false);
  assert.equal(posted.length, 1);
});

test("your profile shows the balance and today's progress, and nothing when unavailable", async () => {
  const state = { me: ME, view: "main", profile: { user: ME, posts: [] }, myActivity: [], coins: { balance: 5, earnedToday: 3, capToday: 20 } };
  const shown = find(await screen({ state, route: { name: "me" }, device: "phone" }), "coinsCard");
  assert.equal(shown.length, 1);
  assert.match(JSON.stringify(shown[0]), /5 kinos/);
  assert.match(JSON.stringify(shown[0]), /Hoy ganaste 3 de 20/);
  assert.equal(find(await screen({ state: { ...state, coins: null }, route: { name: "me" }, device: "phone" }), "coinsCard").length, 0);
  delete globalThis.kino.coins;
  assert.equal(find(await screen({ state, route: { name: "me" }, device: "phone" }), "coinsCard").length, 0);
});
