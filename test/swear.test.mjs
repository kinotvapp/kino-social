import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { clean, fold, maskWith } from "../src/swear.js";

let asks;
let reply;
beforeEach(() => {
  asks = 0;
  reply = { ok: true, text: '{"words":[]}', model: "kit" };
  const store = new Map();
  globalThis.kino = {
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    ai: { ask: async () => { asks++; return reply; } },
  };
});

test("a word of the local list is masked without asking the AI", async () => {
  assert.equal(await clean("Qué MIERDA de final!"), "Qué xxxx de final!");
  assert.equal(asks, 0);
});

test("nothing local: the AI is asked once and what it finds is learned", async () => {
  reply = { ok: true, text: '{"words":["Zopenco","inventada"]}', model: "kit" };
  assert.equal(await clean("Eres un zopenco"), "Eres un xxxx");
  assert.equal(asks, 1);
  assert.equal(await clean("otro ZOPENCO más"), "otro xxxx más");
  assert.equal(asks, 1); // learned: no second ask
});

test("the AI's reply is untrusted: words not in the text are ignored, junk keeps the text", async () => {
  reply = { ok: true, text: '{"words":["hola mundo","nada"]}', model: "kit" };
  assert.equal(await clean("hola mundo"), "hola mundo");
  reply = { ok: true, text: "not json", model: "kit" };
  assert.equal(await clean("texto limpio"), "texto limpio");
  reply = { ok: false, error: "rate_limited", message: "" };
  assert.equal(await clean("texto limpio"), "texto limpio");
});

test("fold keeps ñ and drops accents", () => {
  assert.equal(fold("Pendéjo"), "pendejo");
  assert.equal(fold("Coño"), "coño");
  assert.deepEqual(maskWith("un cono de helado", ["coño"]), { text: "un cono de helado", hit: false });
});
