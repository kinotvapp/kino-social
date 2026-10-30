import assert from "node:assert/strict";
import { test } from "node:test";

import { mainView } from "../src/ui/views.js";

const ME = { id: 1, name: "Kino Lord" };
const find = (node, pred, out = []) => {
  if (node && typeof node === "object") {
    if (pred(node)) out.push(node);
    for (const v of Object.values(node)) find(v, pred, out);
  }
  return out;
};

test("the app bar holds the tabs where the greeting was: no «Hola», no second row", () => {
  for (const device of ["phone", "tv"]) {
    const bar = mainView({ me: ME, tab: "feed", feed: [] }, { device }).appBar;
    const tabs = find(bar.title, (n) => n.type === "TabBar")[0];
    assert.deepEqual(tabs.tabs.map((t) => t.value), ["feed", "communities", "people"]);
    assert.equal(bar.bottom, undefined);
    assert.ok(!JSON.stringify(bar).includes("Hola") && !JSON.stringify(bar).includes("Hi,"));
  }
});

test("TV: «Nueva publicación» is the red (primary) button in the app bar beside reload, only in the feed, not in the body", () => {
  const tv = { device: "tv" };
  const feed = mainView({ me: ME, tab: "feed", feed: [] }, tv);
  assert.deepEqual(feed.appBar.actions.map((a) => a.key), ["refresh", "openProfile"]);
  const write = find(feed.appBar.title, (n) => n.key === "tvCompose")[0];
  assert.equal(write.type, "ElevatedButton", "Kino's primary button: the red one");
  assert.notEqual(write.variant, "secondary");
  assert.equal(write.icon, "edit");
  assert.equal(write.labelText, "Nueva publicación");
  assert.deepEqual(write.onPressed, { ui: [{ open: "composer" }] });
  assert.equal(feed.appBar.title.children.at(-1), write, "the last thing before the reload button");
  assert.equal(find(feed.body, (n) => n.key === "tvCompose").length, 0);
  assert.ok(find(feed.body, (n) => n.key === "composer").length > 0, "the sheet it opens stays in the feed");
  for (const tab of ["communities", "people"]) {
    const other = mainView({ me: ME, tab }, tv);
    assert.deepEqual(other.appBar.actions.map((a) => a.key), ["refresh", "openProfile"], tab);
    assert.equal(find(other.appBar, (n) => n.key === "tvCompose").length, 0, tab);
  }
});

test("TV: a muted person sees the button off until the mute ends; a phone keeps its prompt, not the bar button", () => {
  const until = Date.now() + 3600000;
  const muted = mainView({ me: ME, tab: "feed", feed: [], mutedUntil: until }, { device: "tv" });
  const off = find(muted.appBar.title, (n) => n.key === "tvCompose")[0];
  assert.ok(Number.isInteger(off.enabledAt) && off.enabledAt > Date.now());
  const phone = mainView({ me: ME, tab: "feed", feed: [] }, { device: "phone" });
  assert.deepEqual(phone.appBar.actions.map((a) => a.key), ["refresh", "openProfile"]);
});

test("TV: the bar gives back some of Kino's 24 dp padding above and below (sides kept); a phone keeps Kino's own", () => {
  const tv = mainView({ me: ME, tab: "feed", feed: [] }, { device: "tv" }).appBar;
  assert.deepEqual(tv.padding, { x: 24, y: 12 });
  const phone = mainView({ me: ME, tab: "feed", feed: [] }, { device: "phone" }).appBar;
  assert.equal(phone.padding, undefined);
});

test("TV profile: the bars of the pages with a back arrow share the home bar's padding; Edit profile sits beside the avatar, not under the numbers", async () => {
  const { meView, userView, postView } = await import("../src/ui/views.js");
  const tv = { device: "tv" };
  const own = { me: ME, profile: { user: { id: 1, name: "Kino", handle: "lordmacu" }, postCount: 3, followers: 4, followingCount: 1, posts: [], activity: [] }, myActivity: [] };
  const view = meView(own, tv);
  assert.deepEqual(view.appBar.padding, { x: 24, y: 12 });
  const head = find(view.body, (n) => n.key === "head-1")[0];
  const [identity, ...rest] = head.children;
  assert.ok(find(identity, (n) => n.key === "editProfileBtn").length === 1, "in the avatar row");
  assert.equal(identity.children.at(-1).key, "editProfileBtn", "to the right of the name and the @user");
  assert.ok(!rest.some((r) => find(r, (n) => n.key === "editProfileBtn").length), "not again below");
  assert.deepEqual(userView({ me: ME, user: { user: { id: 2, name: "Ana" }, postCount: 0, followers: 0, followingCount: 0, posts: [], activity: [] } }, tv).appBar.padding, { x: 24, y: 12 });
  assert.deepEqual(postView({ me: ME }, tv).appBar.padding, { x: 24, y: 12 });
  const phone = meView(own, { device: "phone" });
  assert.equal(phone.appBar.padding, undefined);
  const phoneHead = find(phone.body, (n) => n.key === "head-1")[0];
  assert.equal(find(phoneHead.children[0], (n) => n.key === "editProfileBtn").length, 0, "a phone keeps it under the numbers");
  assert.equal(find(phoneHead, (n) => n.key === "editProfileBtn").length, 1);
});
