import crypto from "node:crypto";

const COOKIE = "session";
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

function sign(body, secret) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

export function createSessionToken(username, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ u: username, exp: now + EIGHT_HOURS })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function readSessionToken(token, secret, now = Date.now()) {
  if (!token || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  const expected = sign(body, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.u || !payload?.exp || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCookie(header, name = COOKIE) {
  const parts = String(header || "").split(";");
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return "";
}

export function sessionCookie(token, { secure }) {
  const flags = ["HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${EIGHT_HOURS / 1000}`];
  if (secure) flags.push("Secure");
  return `${COOKIE}=${encodeURIComponent(token)}; ${flags.join("; ")}`;
}

export function clearSessionCookie({ secure }) {
  const flags = ["HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
  if (secure) flags.push("Secure");
  return `${COOKIE}=; ${flags.join("; ")}`;
}
