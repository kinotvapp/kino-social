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
