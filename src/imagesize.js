// A thumbnail's type and size read from its own header (PNG IHDR, JPEG SOFn), the same reading as the server's
// app/cards.py image_size: QuickJS has no image decoder, and none is needed to know the width.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** Strict base64 (padded, standard alphabet, no spaces) to bytes, or null when it is not. */
export function decodeBase64(s) {
  if (typeof s !== "string" || !s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = B64_INDEX[s.charCodeAt(i)];
    const b = B64_INDEX[s.charCodeAt(i + 1)];
    const c = s[i + 2] === "=" ? 0 : B64_INDEX[s.charCodeAt(i + 2)];
    const d = s[i + 3] === "=" ? 0 : B64_INDEX[s.charCodeAt(i + 3)];
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]; // length 13, "IHDR"

/** `{ mime, width, height }` of a PNG or JPEG read from its header; null for anything else or a cut header. */
export function imageSize(bytes) {
  if (!bytes || typeof bytes.length !== "number") return null;
  const b = bytes;
  const n = b.length;
  if (n >= 8 && PNG_SIG.every((v, i) => b[i] === v)) {
    if (n < 24 || !IHDR.every((v, i) => b[8 + i] === v)) return null;
    const width = u32(b, 16);
    const height = u32(b, 20);
    return width && height ? { mime: "image/png", width, height } : null;
  }
  if (n >= 2 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= n) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i += 1; continue; } // fill byte
      if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // no length
      if (marker === 0xd9 || marker === 0xda) return null; // end, or a scan before any frame header
      const length = u16(b, i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (i + 9 > n) return null;
        const height = u16(b, i + 5);
        const width = u16(b, i + 7);
        return width && height ? { mime: "image/jpeg", width, height } : null;
      }
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}
