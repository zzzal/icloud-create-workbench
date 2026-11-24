import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const DEFAULT_HOST = "imap.mail.me.com";
const SOURCE_LIMIT = 200_000;

function plainText(mail) {
  if (mail?.text) return String(mail.text);
  if (!mail?.html) return "";
  return String(mail.html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function addressOf(list) {
  return (list || []).map(item => item?.address).filter(Boolean);
}

function formatSender(envelope, mail) {
  const from = envelope?.from?.[0] || mail?.from?.value?.[0];
  if (!from?.address && !from?.name) return "";
  if (from.name && from.address) return `${from.name} <${from.address}>`;
  return from.address || from.name || "";
}

async function readOne(message) {
  const mail = message.source ? await simpleParser(message.source, { skipTextToHtml: true }) : null;
  const envelope = message.envelope || {};
  const received = message.internalDate || envelope.date || new Date();
  return {
    uid: Number(message.uid),
    to: [...addressOf(envelope.to), ...addressOf(envelope.cc), ...addressOf(mail?.to?.value), ...addressOf(mail?.cc?.value)],
    sender: formatSender(envelope, mail),
    subject: mail?.subject || envelope.subject || "",
    body: plainText(mail).slice(0, 8000),
    bodyHtml: typeof mail?.html === "string" ? mail.html : "",
    receivedAt: new Date(received).toISOString()
  };
}

function emptyFetch(error) {
  return /no matching messages|nothing to fetch/i.test(String(error?.message || ""));
}

export async function fetchImapMessages({
  appleId,
  appPassword,
  host = DEFAULT_HOST,
  sinceUid = 0,
  since = null,
  limit = 40,
  uidValidity = 0
} = {}) {
  const client = new ImapFlow({
    host: host || DEFAULT_HOST,
    port: 993,
    secure: true,
    auth: { user: appleId, pass: appPassword },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000
  });
  // ImapFlow 会把套接字超时抛成 error 事件。没有监听时 Node 会退出。
  client.on("error", () => {});
  let lock;
  try {
    await client.connect();
    lock = await client.getMailboxLock("INBOX");
    const openedValidity = Number(client.mailbox?.uidValidity || 0);
    const validityChanged = uidValidity > 0 && openedValidity > 0 && openedValidity !== uidValidity;
    const effectiveUid = validityChanged ? 0 : sinceUid;
    const query = effectiveUid > 0
      ? { uid: `${effectiveUid + 1}:*` }
      : { since: since || new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) };
    const found = await client.search(query, { uid: true });
    if (found === false) throw new Error("邮箱搜索被服务器拒绝");
    const uids = (found || []).map(Number).filter(uid => uid > effectiveUid).slice(-limit);
    const messages = [];
    if (uids.length) {
      try {
        for await (const message of client.fetch(uids, {
          uid: true,
          envelope: true,
          internalDate: true,
          source: { maxLength: SOURCE_LIMIT }
        }, { uid: true })) {
          messages.push(await readOne(message));
        }
      } catch (error) {
        if (!emptyFetch(error)) throw error;
      }
    }
    messages.sort((left, right) => left.uid - right.uid);
    return { uidValidity: openedValidity, messages };
  } finally {
    try {
      lock?.release();
    } catch {
      // 锁已随连接释放。
    }
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}
