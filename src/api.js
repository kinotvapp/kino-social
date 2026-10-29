// The Kino Social server: one host, JSON, a bearer session kept in kino.storage.

export const BASE = "https://social.comparadorinternet.co";
const SESSION_KEY = "session";
const SESSION_TTL_MS = 29 * 24 * 3600 * 1000;

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export const savedSession = () => kino.storage.get(SESSION_KEY);

async function post(path, json) {
  let r;
  try {
    r = await kino.fetch(BASE + path, { method: "POST", body: { json }, timeoutMs: 15000 });
  } catch (_) {
    throw new ApiError("offline", 0);
  }
  if (r.status === 429) throw new ApiError("rate_limited", 429);
  if (r.status === 401 || r.status === 403) {
    let code = "no_identity";
    try { code = r.json().error || code; } catch (_) { /* keep the default */ }
    const known = { unofficial_plugin: "unofficial", device_key_mismatch: "device_taken", too_many_devices: "too_many_devices" };
    throw new ApiError(known[code] || "no_identity", r.status);
  }
  if (!r.ok) throw new ApiError("offline", r.status);
  return r.json();
}

/**
 * A new session (only inside a call the person started): the server's one-use challenge, signed by this install's own
 * key through kino.identity, with Kino's signed Telegram token. Kino also attests which plugin code asked.
 */
export async function login() {
  if (typeof kino.identity !== "object") throw new ApiError("no_identity", 0);
  const { challenge } = await post("/session/challenge", {});
  let who;
  try {
    who = await kino.identity.telegram({ challenge });
  } catch (_) {
    throw new ApiError("no_identity", 0);
  }
  const body = await post("/session", {
    token: who.token, challenge, deviceKey: who.deviceKey, signature: who.signature,
    author: who.author || "", codeHash: who.codeHash || "",
  });
  kino.storage.set(SESSION_KEY, body.session, { ttlMs: SESSION_TTL_MS });
  return body.user;
}

/**
 * One call with the saved session. `etag` sends If-None-Match: a 304 answers `{ notModified: true }`.
 * A 401 drops the session (the caller logs in again where it may).
 */
export async function call(path, { method = "GET", json, etag } = {}) {
  const session = savedSession();
  if (!session) throw new ApiError("no_session", 401);
  const headers = { authorization: "Bearer " + session };
  if (etag) headers["if-none-match"] = etag;
  let r;
  try {
    r = await kino.fetch(BASE + path, { method, headers, body: json === undefined ? undefined : { json }, timeoutMs: 15000 });
  } catch (_) {
    throw new ApiError("offline", 0);
  }
  if (r.status === 304) return { notModified: true, etag };
  if (r.status === 401) {
    kino.storage.remove(SESSION_KEY);
    throw new ApiError("no_session", 401);
  }
  let body = {};
  try { body = r.json() || {}; } catch (_) { /* an empty body */ }
  if (r.status === 429) throw new ApiError("rate_limited", 429);
  if (r.status === 409) throw new ApiError(body.error || "conflict", 409);
  if (r.status === 400) throw new ApiError(body.error || "bad_request", 400);
  if (!r.ok) throw new ApiError("offline", r.status);
  return { ...body, etag: r.headers.etag };
}

/** `call`, logging in again once when the session is gone (person-started calls only). */
export async function callFresh(path, options) {
  try {
    return await call(path, options);
  } catch (e) {
    if (e.code !== "no_session") throw e;
    await login();
    return call(path, options);
  }
}
