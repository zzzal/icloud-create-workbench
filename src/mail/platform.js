const KNOWN_PLATFORMS = [
  [/microsoft|outlook|hotmail|live\.com|office365|office\.com|accountprotection|微软/, "微软"],
  [/google|gmail|youtube|googlemail|谷歌/, "谷歌"],
  [/github/, "GitHub"],
  [/discord/, "Discord"],
  [/amazon|amazonaws|亚马逊/, "亚马逊"],
  [/facebook|instagram|\bfb\.com\b|meta\.com/, "Meta"],
  [/twitter|(?:^|[^a-z0-9])x\.com(?:[^a-z0-9]|$)/, "X"],
  [/openai|chatgpt/, "OpenAI"],
  [/anthropic|\bclaude\b/, "Claude"],
  [/telegram|电报/, "Telegram"],
  [/steampowered|steamcommunity|\bsteam\b/, "Steam"],
  [/tencent|qq\.com|weixin|wechat|腾讯|微信/, "腾讯"],
  [/alibaba|taobao|aliyun|alipay|\b1688\b|阿里|淘宝|支付宝/, "阿里巴巴"],
  [/netease|163\.com|126\.com|yeah\.net|网易/, "网易"],
  [/baidu|百度/, "百度"],
  [/bytedance|douyin|tiktok|抖音|字节/, "抖音"],
  [/bilibili|b23\.tv|哔哩哔哩|哔哩/, "哔哩哔哩"],
  [/paypal/, "PayPal"],
  [/netflix/, "Netflix"],
  [/spotify/, "Spotify"],
  [/linkedin|领英/, "LinkedIn"],
  [/adobe/, "Adobe"],
  [/zoom\.us/, "Zoom"],
  [/\bslack\b/, "Slack"],
  [/notion/, "Notion"],
  [/dropbox/, "Dropbox"],
  [/reddit/, "Reddit"],
  [/cursor\.com|cursor\.sh/, "Cursor"]
];

const IGNORED_LABELS = new Set([
  "com", "net", "org", "io", "co", "cn", "me", "app", "dev", "so", "ai", "uk", "jp", "de", "fr", "test",
  "mail", "email", "emails", "accounts", "account", "noreply", "no-reply", "notify", "notification",
  "notifications", "security", "login", "info", "team", "hello", "support", "icloud"
]);

function readable(sender, subject, body) {
  const cleanedBody = String(body || "").slice(0, 800).replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, " ");
  return `${sender || ""}\n${subject || ""}\n${cleanedBody}`.toLowerCase();
}

function brandFromSender(sender) {
  const match = String(sender || "").match(/([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})/i);
  if (!match) return "";
  const parts = match[2].toLowerCase().split(".");
  while (parts.length > 1 && IGNORED_LABELS.has(parts.at(-1))) parts.pop();
  const brand = parts.at(-1) || "";
  if (IGNORED_LABELS.has(brand) || !/^[a-z0-9][a-z0-9-]{1,20}$/.test(brand)) return "";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

export function parsePlatforms(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter(tag => typeof tag === "string" && tag && tag !== "unused" && tag !== "used") : [];
  } catch {
    return [];
  }
}

/** 从验证码邮件的发件人、主题和正文判断平台。认不出时留空。 */
export function platformTag(sender, subject, body) {
  const senderText = String(sender || "").toLowerCase();
  if (/apple|appleid|icloud/.test(senderText) && !/hide my email|隐藏邮件/.test(senderText)) return "苹果";
  const text = readable(sender, subject, body);
  for (const [pattern, name] of KNOWN_PLATFORMS) {
    if (pattern.test(text)) return name;
  }
  return brandFromSender(sender);
}
