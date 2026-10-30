import assert from "node:assert/strict";
import { test } from "node:test";

import { postCard } from "../src/ui/cards.js";

test("a text-less, title-attached post reads as a like, not a blank bubble", () => {
  const post = { id: 1, user: { id: 2, name: "Cristian" }, text: "", likes: 0, comments: 0, createdAt: 1,
    link: { url: "https://www.themoviedb.org/tv/66732", tmdb: { kind: "series", id: 66732 }, title: "Stranger Things", season: 1, episode: 7 } };
  const card = postCard(post, { device: "phone" }, null);
  assert.ok(JSON.stringify(card).includes("le gustó"));
});
