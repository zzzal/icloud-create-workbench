import { decryptSecret, encryptSecret } from "../crypto.js";
import { nowIso } from "../db.js";
import { httpError } from "../services/rules.js";
import { extractCode, matchRecipient } from "./code.js";
import { fetchImapMessages } from "./imap.js";
import { parsePlatforms, platformTag } from "./platform.js";
import { renderMailHtml } from "./render.js";

const DEFAULT_HOST = "imap.mail.me.com";
const MAX_BODY_HTML = 200_000;
const MESSAGE_MATCH = `instr(lower(messages.subject || char(10) || messages.sender || char(10) ||
  messages.body || char(10) || messages.code), ?) > 0`;

function normalizeQuery(query) {
  return String(query || "").trim().toLowerCase();
}

function recipientKey(accountId, recipient) {
  return `${accountId}\n${String(recipient || "").toLowerCase()}`;
}

function safeError(error) {
  return String(error?.message || "收取失败")
    .replace(/pass(?:word)?\s*[=:]\s*\S+/gi, "password=[已隐藏]")
    .slice(0, 300);
}

function publicImap(row) {
  return {
    id: row.id,
    appleId: row.apple_id,
    displayName: row.display_name,
    imapReady: Boolean(row.imap_password_encrypted),
    imapHost: row.imap_host || DEFAULT_HOST,
    imapError: row.imap_error || "",
    imapSyncedAt: row.imap_synced_at || null
  };
}

export function createInboxService({ db, config, fetchMessages = fetchImapMessages }) {
  const inflight = new Map();
  let ticking = false;

  function requireAccount(id) {
    const account = db.prepare("SELECT * FROM accounts WHERE id = ? AND status != 'deleted'").get(id);
    if (!account) throw httpError(404, "账号不存在");
    return account;
  }

  function savePassword(id, input = {}) {
    const account = requireAccount(id);
    const password = String(input.appPassword || "").trim();
    const host = String(input.host || account.imap_host || DEFAULT_HOST).trim().toLowerCase();
    if (!/^[a-z0-9.-]{1,253}$/.test(host) || !host.includes(".")) throw httpError(400, "收件服务器地址无效");
    if (!password && !account.imap_password_encrypted) throw httpError(400, "请填写 App 专用密码");
    if (password && (password.length < 8 || password.length > 128)) throw httpError(400, "App 专用密码长度不正确");
    const hostChanged = host !== (account.imap_host || DEFAULT_HOST);
    const fields = ["imap_host = ?", "imap_error = ''", "updated_at = ?"];
    const values = [host, nowIso()];
    if (password) {
      fields.push("imap_password_encrypted = ?");
      values.push(encryptSecret(password, config.encryptionKey));
    }
    if (hostChanged) {
      fields.push("imap_last_uid = 0", "imap_uid_validity = 0");
    }
    values.push(id);
    db.prepare(`UPDATE accounts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return publicImap(requireAccount(id));
  }

  function clearPassword(id) {
    requireAccount(id);
    db.prepare("UPDATE accounts SET imap_password_encrypted = '', imap_error = '', updated_at = ? WHERE id = ?").run(nowIso(), id);
    return { ok: true };
  }

  function claimRandom() {
    const pick = db.prepare(`SELECT addresses.id, addresses.email, addresses.label, addresses.account_id, accounts.apple_id
      FROM addresses JOIN accounts ON accounts.id = addresses.account_id
      WHERE addresses.state = 'unused' AND addresses.claimed_at = '' AND accounts.status != 'deleted'
      ORDER BY RANDOM() LIMIT 1`);
    const mark = db.prepare("UPDATE addresses SET claimed_at = ?, updated_at = ? WHERE id = ? AND state = 'unused' AND claimed_at = ''");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const row = pick.get();
      if (!row) throw httpError(404, "没有未使用的邮箱");
      const now = nowIso();
      if (!mark.run(now, now, row.id).changes) continue;
      return {
        id: row.id,
        email: row.email,
        label: row.label,
        accountId: row.account_id,
        appleId: row.apple_id
      };
    }
    throw httpError(409, "邮箱刚被取走，请再试一次");
  }

  function tagAddress(accountId, email, sender, subject, body) {
    const tag = platformTag(sender, subject, body);
    if (!tag || !email) return "";
    const row = db.prepare("SELECT id, platforms FROM addresses WHERE account_id = ? AND lower(email) = lower(?)").get(accountId, email);
    if (!row) return tag;
    const tags = parsePlatforms(row.platforms).filter(item => item !== tag);
    tags.unshift(tag);
    db.prepare("UPDATE addresses SET platforms = ?, state = 'used', updated_at = ? WHERE id = ?")
      .run(JSON.stringify(tags), nowIso(), row.id);
    return tag;
  }

  function backfillPlatformTags() {
    const grouped = new Map();
    const rows = db.prepare(`SELECT account_id, recipient, sender, subject, body
      FROM messages WHERE code != '' ORDER BY received_at DESC, id DESC`).all();
    for (const row of rows) {
      const tag = platformTag(row.sender, row.subject, row.body);
      if (!tag || !row.recipient) continue;
      const key = recipientKey(row.account_id, row.recipient);
      const tags = grouped.get(key) || { accountId: row.account_id, email: row.recipient, tags: [] };
      if (!tags.tags.includes(tag)) tags.tags.push(tag);
      grouped.set(key, tags);
    }
    const update = db.prepare(`UPDATE addresses SET platforms = ?, state = 'used', updated_at = ?
      WHERE account_id = ? AND lower(email) = lower(?)`);
    const now = nowIso();
    for (const item of grouped.values()) update.run(JSON.stringify(item.tags), now, item.accountId, item.email);
  }

  function list(query = "") {
    const needle = normalizeQuery(query);
    const accounts = db.prepare(`SELECT id, apple_id, display_name, imap_password_encrypted, imap_host, imap_error, imap_synced_at
      FROM accounts WHERE status != 'deleted' ORDER BY id DESC`).all().map(publicImap);
    const ready = new Map(accounts.map(account => [account.id, account.imapReady]));
    const addresses = db.prepare(`SELECT addresses.email, addresses.label, addresses.state, addresses.account_id, accounts.apple_id
      FROM addresses JOIN accounts ON accounts.id = addresses.account_id
      WHERE accounts.status != 'deleted'
      ORDER BY addresses.email`).all();
    const messages = db.prepare(`SELECT id, account_id, recipient, sender, subject, body, code, received_at
      FROM messages ORDER BY received_at DESC, id DESC`).all();
    const latest = new Map();
    const verifications = new Map();
    const counts = new Map();
    const platformTags = new Map();
    for (const message of messages) {
      const key = recipientKey(message.account_id, message.recipient);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!latest.has(key)) latest.set(key, message);
      if (message.code && !verifications.has(key)) {
        verifications.set(key, { code: message.code, sender: message.sender, subject: message.subject, receivedAt: message.received_at });
      }
      if (!message.code) continue;
      const tag = platformTag(message.sender, message.subject, message.body);
      if (!tag) continue;
      const tags = platformTags.get(key) || [];
      if (!tags.includes(tag)) tags.push(tag);
      platformTags.set(key, tags);
    }
    const seen = new Set();
    const mailboxes = [];
    for (const address of addresses) {
      const key = recipientKey(address.account_id, address.email);
      seen.add(key);
      const last = latest.get(key);
      mailboxes.push(mailboxFrom(address.email, address, last, verifications.get(key), counts.get(key) || 0, true, ready, platformTags.get(key) || []));
    }
    for (const [key, last] of latest) {
      if (seen.has(key)) continue;
      const account = accounts.find(item => item.id === last.account_id);
      if (!account) continue;
      mailboxes.push(mailboxFrom(last.recipient || account.appleId, {
        label: "未匹配",
        state: "unknown",
        account_id: last.account_id,
        apple_id: account.appleId
      }, last, verifications.get(key), counts.get(key) || 0, false, ready, platformTags.get(key) || []));
    }
    mailboxes.sort((left, right) => {
      if (left.latestAt && right.latestAt && left.latestAt !== right.latestAt) return right.latestAt.localeCompare(left.latestAt);
      if (left.latestAt) return -1;
      if (right.latestAt) return 1;
      return left.email.localeCompare(right.email);
    });
    if (!needle) return { accounts, mailboxes };
    const hits = db.prepare(`SELECT messages.account_id, lower(messages.recipient) AS recipient, COUNT(*) AS total
      FROM messages JOIN accounts ON accounts.id = messages.account_id
      WHERE accounts.status != 'deleted' AND ${MESSAGE_MATCH}
      GROUP BY messages.account_id, lower(messages.recipient)`).all(needle);
    const matches = new Map(hits.map(row => [recipientKey(row.account_id, row.recipient), row.total]));
    const filtered = mailboxes.filter(item => {
      item.searchMatches = matches.get(recipientKey(item.accountId, item.email)) || 0;
      return item.searchMatches > 0 || [item.email, item.label, item.appleId]
        .some(value => value.toLowerCase().includes(needle));
    });
    return { accounts, mailboxes: filtered };
  }

  function messagesFor(email, accountId, { q, page, pageSize } = {}) {
    const value = String(email || "").trim().toLowerCase();
    if (!value.includes("@")) throw httpError(400, "请选择一个邮箱");
    const id = accountId === undefined ? null : Number(accountId);
    if (id !== null && (!Number.isSafeInteger(id) || id < 1)) throw httpError(400, "账号无效");
    const params = id === null ? [value] : [value, id];
    const accountFilter = id === null ? "" : "AND messages.account_id = ?";
    const needle = normalizeQuery(q);
    const matchFilter = needle ? `AND ${MESSAGE_MATCH}` : "";
    if (needle) params.push(needle);
    const from = `FROM messages JOIN accounts ON accounts.id = messages.account_id
      WHERE accounts.status != 'deleted' AND lower(messages.recipient) = ? ${accountFilter} ${matchFilter}`;
    const total = db.prepare(`SELECT COUNT(*) AS total ${from}`).get(...params).total;
    const size = Math.min(Math.max(1, Math.trunc(Number(pageSize)) || 40), 100);
    const currentPage = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), Math.max(1, Math.ceil(total / size)));
    const rows = db.prepare(`SELECT messages.id, messages.recipient, messages.sender, messages.subject, messages.body,
      messages.body_html != '' AS has_html, messages.code, messages.received_at, accounts.apple_id
      ${from}
      ORDER BY messages.received_at DESC, messages.id DESC
      LIMIT ? OFFSET ?`).all(...params, size, (currentPage - 1) * size);
    return {
      email: rows[0]?.recipient || String(email || "").trim(),
      total,
      page: currentPage,
      pageSize: size,
      messages: rows.map(row => ({
        id: row.id,
        recipient: row.recipient,
        sender: row.sender,
        subject: row.subject,
        body: row.body,
        hasHtml: Boolean(row.has_html),
        code: row.code,
        receivedAt: row.received_at,
        appleId: row.apple_id
      }))
    };
  }

  function messageHtml(id) {
    if (!Number.isSafeInteger(id) || id < 1) throw httpError(400, "邮件编号无效");
    const row = db.prepare(`SELECT messages.body_html
      FROM messages JOIN accounts ON accounts.id = messages.account_id
      WHERE messages.id = ? AND accounts.status != 'deleted'`).get(id);
    if (!row) throw httpError(404, "邮件不存在");
    return { html: renderMailHtml(row.body_html) };
  }

  async function syncAccount(account) {
    if (!account.imap_password_encrypted) return { id: account.id, synced: 0, skipped: true };
    const existing = inflight.get(account.id);
    if (existing) return existing;
    const job = pullAccount(account).finally(() => inflight.delete(account.id));
    inflight.set(account.id, job);
    return job;
  }

  async function pullAccount(account) {
    try {
      const password = decryptSecret(account.imap_password_encrypted, config.encryptionKey);
      const since = account.imap_last_uid > 0 ? null : new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const fetched = await fetchMessages({
        appleId: account.apple_id,
        appPassword: password,
        host: account.imap_host || DEFAULT_HOST,
        sinceUid: account.imap_last_uid || 0,
        since,
        uidValidity: account.imap_uid_validity || 0,
        limit: 40
      });
      const batch = Array.isArray(fetched) ? fetched : (fetched?.messages || []);
      const uidValidity = Array.isArray(fetched) ? account.imap_uid_validity || 0 : Number(fetched?.uidValidity || 0);
      const known = db.prepare("SELECT email FROM addresses WHERE account_id = ?").all(account.id).map(row => row.email);
      const insert = db.prepare(`INSERT OR IGNORE INTO messages
        (account_id, uid, recipient, sender, subject, body, body_html, code, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      let saved = 0;
      let maxUid = account.imap_last_uid || 0;
      db.exec("BEGIN");
      try {
        for (const message of batch) {
          const uid = Number(message.uid);
          if (!Number.isInteger(uid) || uid < 1) continue;
          const recipient = matchRecipient(known, message) || account.apple_id;
          const code = extractCode(message.subject, message.body);
          const result = insert.run(
            account.id,
            uid,
            recipient,
            String(message.sender || "").slice(0, 300),
            String(message.subject || "").slice(0, 300),
            String(message.body || "").slice(0, 4000),
            typeof message.bodyHtml === "string" ? message.bodyHtml.slice(0, MAX_BODY_HTML) : "",
            code,
            message.receivedAt || nowIso()
          );
          if (result.changes) {
            saved += 1;
            if (code) tagAddress(account.id, recipient, message.sender, message.subject, message.body);
          }
          if (uid > maxUid) maxUid = uid;
        }
        db.prepare(`UPDATE accounts
          SET imap_last_uid = ?, imap_uid_validity = ?, imap_synced_at = ?, imap_error = '', updated_at = ?
          WHERE id = ?`).run(maxUid, uidValidity, nowIso(), nowIso(), account.id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { id: account.id, synced: saved };
    } catch (error) {
      const message = safeError(error);
      db.prepare("UPDATE accounts SET imap_error = ?, imap_synced_at = ?, updated_at = ? WHERE id = ?")
        .run(message, nowIso(), nowIso(), account.id);
      return { id: account.id, synced: 0, error: message };
    }
  }

  async function syncAll(accountId) {
    if (accountId) {
      const account = requireAccount(Number(accountId));
      return [await syncAccount(account)];
    }
    const accounts = db.prepare("SELECT * FROM accounts WHERE status != 'deleted' AND imap_password_encrypted != ''").all();
    const results = [];
    for (const account of accounts) results.push(await syncAccount(account));
    return results;
  }

  function start() {
    const run = () => {
      if (ticking) return;
      ticking = true;
      syncAll().catch(error => console.error(`收件同步失败：${safeError(error)}`)).finally(() => {
        ticking = false;
      });
    };
    run();
    const timer = setInterval(run, 15_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  backfillPlatformTags();
  return { savePassword, clearPassword, claimRandom, list, messagesFor, messageHtml, syncAccount, syncAll, start };
}

function mailboxFrom(email, address, last, verification, messageCount, matched, ready, tags = []) {
  return {
    email,
    label: address.label || "",
    state: address.state || "",
    tags,
    accountId: address.account_id,
    appleId: address.apple_id,
    imapReady: Boolean(ready.get(address.account_id)),
    latestCode: verification?.code || "",
    latestVerification: verification || null,
    latestSubject: last?.subject || "",
    latestSender: last?.sender || "",
    latestAt: last?.received_at || null,
    messageCount,
    matched
  };
}
