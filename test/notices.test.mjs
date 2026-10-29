import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { postNotices } from "../src/notices.js";

let posted;
let items;
beforeEach(() => {
  posted = [];
  const store = new Map([["session", "s"]]);
  globalThis.kino = {
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
    notifications: { post: (n) => posted.push(n) },
    fetch: async () => ({ status: 200, ok: true, headers: {}, json: () => ({ items, unread: items.length }) }),
  };
});

const actor = { id: 7, name: "Ben", handle: "ben" };

test("each kind gets its own words and opens what it is about", async () => {
  items = [
    { id: 3, kind: "like", actor, postId: 11, count: 2, postText: "hola", createdAt: 3 },
    { id: 2, kind: "comment", actor, postId: 11, count: 1, postText: "hola", createdAt: 2 },
    { id: 1, kind: "follow", actor, createdAt: 1 },
  ];
  assert.equal(await postNotices(), 3);
  const byId = Object.fromEntries(posted.map((n) => [n.id, n]));
  assert.equal(byId.l3.title, "A Ben y 1 más les gustó tu publicación");
  assert.equal(byId.l3.titleEn, "Ben and 1 more liked your post");
  assert.deepEqual(byId.l3.go, { screen: { route: "post", args: { id: "11" } } });
  assert.equal(byId.c2.title, "Ben comentó tu publicación");
  assert.deepEqual(byId.f1.go, { screen: { route: "user", args: { id: "7" } } });
});

test("a notice the bell refuses is not skipped: the next run starts from it", async () => {
  items = [
    { id: 2, kind: "follow", actor, createdAt: 20 },
    { id: 1, kind: "follow", actor: { ...actor, id: 8 }, createdAt: 10 },
  ];
  let calls = 0;
  kino.notifications.post = async (n) => { calls++; if (n.id === "f2") throw Object.assign(new Error("x"), { code: "rate_limited" }); posted.push(n); };
  assert.equal(await postNotices(), 1);
  assert.deepEqual(posted.map((n) => n.id), ["f1"]);
  assert.equal(kino.storage.get("noticesSince"), "10");
});

test("a new post of someone you follow names them and opens the newest post", async () => {
  items = [{ id: 9, kind: "post", actor, postId: 40, count: 3, postText: "Viendo Dune otra vez", createdAt: 5 }];
  await postNotices();
  assert.equal(posted[0].id, "p9");
  assert.equal(posted[0].title, "Ben publicó 3 cosas nuevas");
  assert.equal(posted[0].titleEn, "Ben posted 3 new things");
  assert.equal(posted[0].text, "Viendo Dune otra vez");
  assert.deepEqual(posted[0].go, { screen: { route: "post", args: { id: "40" } } });
});

test("community notices name the community and open it or its newest post", async () => {
  const community = { id: 4, name: "Cine de terror", slug: "terror" };
  items = [
    { id: 21, kind: "community_post", actor, postId: 70, count: 2, postText: "Hereditary", community, createdAt: 2 },
    { id: 20, kind: "community_join", actor, count: 3, community, createdAt: 1 },
  ];
  await postNotices();
  const byId = Object.fromEntries(posted.map((n) => [n.id, n]));
  assert.equal(byId.cp21.title, "2 publicaciones nuevas en Cine de terror");
  assert.equal(byId.cp21.titleEn, "2 new posts in Cine de terror");
  assert.deepEqual(byId.cp21.go, { screen: { route: "post", args: { id: "70" } } });
  assert.equal(byId.cj20.title, "Ben y 2 más se unieron a Cine de terror");
  assert.deepEqual(byId.cj20.go, { screen: { route: "community", args: { id: "4" } } });
});
