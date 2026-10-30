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
    assert.equal(bar.title.type, "TabBar");
    assert.deepEqual(bar.title.tabs.map((t) => t.value), ["feed", "communities", "people"]);
    assert.equal(bar.bottom, undefined);
    assert.ok(!JSON.stringify(bar).includes("Hola") && !JSON.stringify(bar).includes("Hi,"));
  }
});

test("TV: «Nueva publicación» is an app-bar button next to reload, only in the feed, and no longer in the body", () => {
  const tv = { device: "tv" };
  const feed = mainView({ me: ME, tab: "feed", feed: [] }, tv);
  assert.deepEqual(feed.appBar.actions.map((a) => a.key), ["tvCompose", "refresh", "openProfile"]);
  assert.equal(feed.appBar.actions[0].icon, "edit");
  assert.equal(feed.appBar.actions[0].labelText, "Nueva publicación");
  assert.deepEqual(feed.appBar.actions[0].onPressed, { ui: [{ open: "composer" }] });
  assert.equal(find(feed.body, (n) => n.key === "tvCompose").length, 0);
  assert.ok(find(feed.body, (n) => n.key === "composer").length > 0, "the sheet it opens stays in the feed");
  for (const tab of ["communities", "people"]) {
    const other = mainView({ me: ME, tab }, tv);
    assert.deepEqual(other.appBar.actions.map((a) => a.key), ["refresh", "openProfile"], tab);
  }
});

test("TV: a muted person sees the button off until the mute ends; a phone keeps its prompt, not the bar button", () => {
  const until = Date.now() + 3600000;
  const muted = mainView({ me: ME, tab: "feed", feed: [], mutedUntil: until }, { device: "tv" });
  assert.ok(Number.isInteger(muted.appBar.actions[0].enabledAt) && muted.appBar.actions[0].enabledAt > Date.now());
  const phone = mainView({ me: ME, tab: "feed", feed: [] }, { device: "phone" });
  assert.deepEqual(phone.appBar.actions.map((a) => a.key), ["refresh", "openProfile"]);
});
