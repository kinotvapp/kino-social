// Kino Social (experiment): a feed to share what you watch, with likes, comments, profiles and people to follow.
// The source of the shipped plugin.js (`npm run build`).

import { postNotices } from "./notices.js";
import { communityView } from "./ui/communities.js";
import { mainView, postView, problemView, userView, welcomeView } from "./ui/views.js";

export { screenEvent } from "./events.js";
export { track } from "./track.js";

/** A pure view of the state Kino keeps; the reserved `open` event loads it. */
export async function screen({ state, route, device, size, lang }) {
  const s = state || {};
  const ctx = { device, size, lang };
  if (s.problem) return { type: "Column", padding: 24, children: [problemView(s.problem)] };
  if (!s.me) return { type: "Column", padding: 48, crossAxisAlignment: "center", children: [{ type: "CircularProgressIndicator" }] };
  if (s.view === "welcome" || !s.me.handle) return welcomeView(s, ctx);
  const name = route && route.name;
  if (name === "post" || s.view === "post") return postView(s, ctx);
  if (name === "user" || s.view === "user") return userView(s, ctx);
  if (name === "community" || s.view === "community") return communityView(s, ctx);
  return mainView(s, ctx);
}

/** The scheduled job: new comments, likes and followers become notices in Kino's bell. */
export async function job() {
  await postNotices();
}
