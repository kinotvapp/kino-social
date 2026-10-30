// Kino's bell: the job asks the server what is new for this person (comments on their posts, new followers) and posts one
// notice per server notification. A notice's id is the server's, so a comment group that grows replaces its own notice.

import { call } from "./api.js";

const SINCE_KEY = "noticesSince";

function noticeOf(n) {
  const who = n.actor && n.actor.name ? n.actor.name : "Alguien";
  if (n.kind === "follow") {
    return {
      id: "f" + n.id, title: `${who} te sigue`, titleEn: `${who} follows you`,
      text: "Mira su perfil", textEn: "See their profile",
      go: { screen: { route: "user", args: { id: String(n.actor.id) } } },
    };
  }
  const others = Math.max(0, (n.count || 1) - 1);
  const excerpt = (n.postText || "").slice(0, 120);
  if (n.kind === "community_request" || n.kind === "community_approved") {
    const place = (n.community && n.community.name) || "la comunidad";
    const placeEn = (n.community && n.community.name) || "the community";
    const go = { screen: { route: "community", args: { id: String(n.community && n.community.id) } } };
    if (n.kind === "community_approved") {
      return { id: "ca" + n.id, title: `Ya eres parte de ${place}`, titleEn: `You're in ${placeEn}`,
        text: "Tu solicitud fue aceptada", textEn: "Your request was accepted", go };
    }
    return {
      id: "cr" + n.id,
      title: others ? `${who} y ${others} más quieren unirse a ${place}` : `${who} quiere unirse a ${place}`,
      titleEn: others ? `${who} and ${others} more want to join ${placeEn}` : `${who} wants to join ${placeEn}`,
      text: "Revisa las solicitudes", textEn: "Review the requests", go,
    };
  }
  if (n.kind === "community_post" || n.kind === "community_join") {
    const place = (n.community && n.community.name) || "tu comunidad";
    const placeEn = (n.community && n.community.name) || "your community";
    if (n.kind === "community_post") {
      return {
        id: "cp" + n.id,
        title: n.count > 1 ? `${n.count} publicaciones nuevas en ${place}` : `${who} publicó en ${place}`,
        titleEn: n.count > 1 ? `${n.count} new posts in ${placeEn}` : `${who} posted in ${placeEn}`,
        text: excerpt || undefined, textEn: excerpt || undefined,
        go: { screen: { route: "post", args: { id: String(n.postId) } } },
      };
    }
    return {
      id: "cj" + n.id,
      title: others ? `${who} y ${others} más se unieron a ${place}` : `${who} se unió a ${place}`,
      titleEn: others ? `${who} and ${others} more joined ${placeEn}` : `${who} joined ${placeEn}`,
      go: { screen: { route: "community", args: { id: String(n.community && n.community.id) } } },
    };
  }
  if (n.kind === "post") {
    const many = n.count > 1;
    return {
      id: "p" + n.id,
      title: many ? `${who} publicó ${n.count} cosas nuevas` : `${who} publicó algo nuevo`,
      titleEn: many ? `${who} posted ${n.count} new things` : `${who} posted something new`,
      text: excerpt || undefined, textEn: excerpt || undefined,
      go: { screen: { route: "post", args: { id: String(n.postId) } } },
    };
  }
  if (n.kind === "like") {
    return {
      id: "l" + n.id,
      title: others ? `A ${who} y ${others} más les gustó tu publicación` : `A ${who} le gustó tu publicación`,
      titleEn: others ? `${who} and ${others} more liked your post` : `${who} liked your post`,
      text: excerpt || undefined, textEn: excerpt || undefined,
      go: { screen: { route: "post", args: { id: String(n.postId) } } },
    };
  }
  const es = others ? `${who} y ${others} más comentaron tu publicación` : `${who} comentó tu publicación`;
  const en = others ? `${who} and ${others} more commented on your post` : `${who} commented on your post`;
  return {
    id: "c" + n.id, title: es, titleEn: en, text: excerpt || undefined, textEn: excerpt || undefined,
    go: { screen: { route: "post", args: { id: String(n.postId) } } },
  };
}

/** The job's work. Without a session (never opened, or logged out) there is nothing to ask. */
export async function postNotices() {
  if (typeof kino.notifications !== "object") return 0;
  const since = Number(kino.storage.get(SINCE_KEY) || 0);
  let body;
  try {
    body = await call("/notifications?since=" + since);
  } catch (_) {
    return 0;
  }
  // Oldest first, so the newest ends on top; the cursor moves only past what the bell took, so a refused one (the bell's
  // hourly cap) comes back on the next run.
  const fresh = (body.items || []).filter((n) => !n.read).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let cursor = since;
  let posted = 0;
  for (const n of fresh) {
    try {
      await kino.notifications.post(noticeOf(n));
    } catch (_) {
      break;
    }
    cursor = Math.max(cursor, n.createdAt || 0);
    posted++;
  }
  kino.storage.set(SINCE_KEY, String(cursor));
  return posted;
}
