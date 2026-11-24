const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const LABEL_PATTERN = /验证码|校验码|动态码|verification code|one[- ]time (?:code|password)|security code|login code|\botp\b/i;
const STOPWORDS = new Set(["code", "your", "this", "with", "from", "here", "that", "have", "please", "login", "mail"]);

function addressList(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map(item => String(typeof item === "string" ? item : item?.address || "").trim().toLowerCase()).filter(Boolean);
}

export function extractEmails(text) {
  return [...new Set(String(text || "").match(EMAIL_PATTERN) || [])].map(email => email.toLowerCase());
}

/** 优先命中已知 iCloud 邮箱。收件人是主邮箱时，再从主题和正文里找别名。 */
export function matchRecipient(known, message = {}) {
  const aliases = new Set((known || []).map(email => String(email).trim().toLowerCase()).filter(Boolean));
  const header = [...addressList(message.to), ...addressList(message.cc)];
  const knownHeader = header.find(email => aliases.has(email));
  if (knownHeader) return knownHeader;
  const knownText = extractEmails(`${message.subject || ""}\n${message.body || ""}`).find(email => aliases.has(email));
  if (knownText) return knownText;
  return header[0] || "";
}

function digitScore(token) {
  if (/^(?:19|20)\d{2}$/.test(token)) return 1;
  if (token.length === 6) return 6;
  if (token.length === 5 || token.length === 7 || token.length === 8) return 4;
  return 3;
}

function pickFromWindow(window) {
  let best = "";
  let bestScore = 0;
  for (const match of window.matchAll(/\d{4,8}/g)) {
    const score = digitScore(match[0]);
    if (score > bestScore) {
      best = match[0];
      bestScore = score;
    }
  }
  if (best && bestScore > 1) return best;
  const token = window.match(/(?:^|[^A-Za-z0-9])([A-Za-z0-9]{4,8})(?![A-Za-z0-9@])/);
  if (!token) return best;
  if (STOPWORDS.has(token[1].toLowerCase())) return best;
  if (!/\d/.test(token[1]) && best) return best;
  return token[1];
}

export function extractCode(subject, body) {
  const text = `${subject || ""}\n${body || ""}`.replaceAll("\r\n", "\n");
  const label = LABEL_PATTERN.exec(text);
  if (label) {
    const window = text.slice(label.index + label[0].length, label.index + label[0].length + 48);
    const picked = pickFromWindow(window);
    if (picked) return picked;
  }
  const line = text.match(/(?:^|\n)\s*(\d{4,8})\s*(?:\n|$)/);
  return line ? line[1] : "";
}
