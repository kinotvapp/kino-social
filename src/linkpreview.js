// A link's preview, read on the person's own device (owner, 2026-10-29: the client does it, the server only checks and
// keeps it): the page's head (Open Graph, then Twitter cards, then the plain tags), or YouTube's oEmbed. Only the head is
// downloaded (`stopAt`), so it costs little. Never throws: a link without a preview is still a link.

const URL_RE = /https?:\/\/[^\s<>"']+/i;
const TRAILING = /[.,;:!?)\]}»"']+$/;
const YOUTUBE = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)$/i;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The first link of [text], as the server reads it too, or null. */
export function firstUrl(text) {
  const m = URL_RE.exec(String(text || ""));
  if (!m) return null;
  const url = m[0].replace(TRAILING, "");
  return url.length <= 2048 ? url : null;
}

function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

const clean = (v, max) => {
  const s = decode(String(v || "")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
};

/** [ref] against the page [base], kept only when it ends up an https address. */
function absoluteHttps(ref, base) {
  const r = decode(String(ref || "").trim());
  if (!r) return undefined;
  let out;
  if (/^https:\/\//i.test(r)) out = r;
  else if (r.startsWith("//")) out = "https:" + r;
  else if (/^[a-z][a-z0-9+.-]*:/i.test(r)) return undefined;
  else {
    const m = /^(https:\/\/[^/?#]+)([^?#]*)/i.exec(base);
    if (!m) return undefined;
    out = r.startsWith("/") ? m[1] + r : m[1] + m[2].replace(/[^/]*$/, "") + r;
  }
  return /^https:\/\/[^/\s]+\.[^/\s]+/i.test(out) && !/\s/.test(out) && out.length <= 1000 ? out : undefined;
}

/** What a page's head says: title, description, site and picture. */
function fromHead(html, pageUrl) {
  const head = String(html || "").slice(0, 65536).split(/<\/head\s*>/i)[0];
  const metas = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content !== undefined && metas[key] === undefined) metas[key] = attrs.content;
  }
  const first = (...keys) => keys.map((k) => metas[k]).find((v) => v !== undefined && String(v).trim() !== "");
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  let image;
  for (const k of ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]) {
    image = metas[k] ? absoluteHttps(metas[k], pageUrl) : undefined;
    if (image) break;
  }
  return {
    title: clean(first("og:title", "twitter:title") ?? (titleTag && titleTag[1]), 120),
    desc: clean(first("og:description", "twitter:description", "description"), 200),
    site: clean(first("og:site_name", "application-name"), 60),
    image,
  };
}

async function youtube(url) {
  const r = await kino.fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(url), { timeoutMs: 8000 });
  if (!r.ok) return {};
  const d = r.json() || {};
  const thumb = typeof d.thumbnail_url === "string" && d.thumbnail_url.startsWith("https://") ? d.thumbnail_url : undefined;
  return { title: clean(d.title, 120), desc: clean(d.author_name, 200), site: "YouTube", image: thumb };
}

/** `{ url, title?, desc?, site?, image? }` for the first link of [text], `{ url }` when the page said nothing, or null. */
export async function linkPreview(text) {
  const url = firstUrl(text);
  if (!url) return null;
  let found = {};
  try {
    const host = (/^https?:\/\/([^/?#:]+)/i.exec(url) || [])[1] || "";
    if (YOUTUBE.test(host)) found = await youtube(url);
    else if (/^https:\/\//i.test(url)) {
      const r = await kino.fetch(url, { timeoutMs: 8000, stopAt: "</head>", maxBytes: 262144 });
      if (r.ok && /html/i.test(r.headers["content-type"] || "html")) found = fromHead(r.text(), r.url || url);
    }
  } catch (_) {
    found = {};
  }
  if (!found.title) return { url };
  const out = { url, title: found.title };
  if (found.desc) out.desc = found.desc;
  out.site = found.site || (/^https?:\/\/(?:www\.)?([^/?#:]+)/i.exec(url) || [])[1];
  if (found.image) out.image = found.image;
  return out;
}
