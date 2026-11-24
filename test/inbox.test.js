import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { decryptSecret } from "../src/crypto.js";
import { openDatabase } from "../src/db.js";
import { createApp } from "../src/http.js";
import { extractCode, matchRecipient } from "../src/mail/code.js";
import { platformTag } from "../src/mail/platform.js";
import { createInboxService } from "../src/mail/inbox.js";
import { createAccountService } from "../src/services/accounts.js";
import { createCampaignService } from "../src/services/campaigns.js";

test("从邮件里抽出验证码", () => {
  assert.equal(extractCode("登录", "验证码：839201"), "839201");
  assert.equal(extractCode("Login", "Your verification code is 482910"), "482910");
  assert.equal(extractCode("", "one-time code: AB12CD"), "AB12CD");
  assert.equal(extractCode("通知", "\n839201\n"), "839201");
  assert.equal(extractCode("hello", "订单 1234 已发出"), "");
  assert.equal(extractCode("验证码 2026 年", "请使用 839201 完成登录"), "839201");
  assert.equal(extractCode("Login code 998877", ""), "998877");
});

test("收件人优先匹配已知 iCloud 邮箱", () => {
  const known = ["ada-0001@icloud.com"];
  assert.equal(matchRecipient(known, {
    to: ["ada@icloud.com"],
    subject: "验证码",
    body: "地址 ada-0001@icloud.com 的验证码是 111111"
  }), "ada-0001@icloud.com");
  assert.equal(matchRecipient(known, { to: ["ada-0001@icloud.com"], body: "其他 someone@icloud.com" }), "ada-0001@icloud.com");
  assert.equal(matchRecipient(known, { to: ["other@icloud.com"], subject: "hi", body: "没有别名" }), "other@icloud.com");
});

function configFor(databasePath) {
  return {
    host: "127.0.0.1",
    port: 0,
    adminUsername: "admin",
    adminPassword: "local-password",
    sessionSecret: "session-secret-value",
    cookieSecure: false,
    encryptionKey: crypto.randomBytes(32),
    databasePath,
    batchLimit: 5,
    cooldownMinutes: 60,
    targetDefault: 700,
    retryMinutes: 5,
    clientBuildNumber: "2536Project32",
    clientMasteringNumber: "2536B20"
  };
}

function insertAccount(db) {
  const now = new Date().toISOString();
  const inserted = db.prepare(`INSERT INTO accounts (
    identity_key, apple_id, region, cookie_encrypted, status, created_at, updated_at
  ) VALUES ('global:42', 'ada@icloud.com', 'global', 'stored-cookie', 'active', ?, ?)`).run(now, now);
  const accountId = Number(inserted.lastInsertRowid);
  db.prepare(`INSERT INTO addresses (account_id, email, label, state, source, created_at, updated_at)
    VALUES (?, 'ada-0001@icloud.com', 'ada-0001', 'unused', 'generated', ?, ?)`).run(accountId, now, now);
  return accountId;
}

test("普通邮件之后仍显示最近的验证码，邮件详情按账号筛选", () => {
  const db = openDatabase(":memory:");
  try {
    const accountId = insertAccount(db);
    const email = "ada-0001@icloud.com";
    const insert = db.prepare(`INSERT INTO messages (account_id, uid, recipient, sender, subject, code, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    insert.run(accountId, 1, email, "login@example.test", "验证码", "839201", "2026-11-18T01:00:00Z");
    insert.run(accountId, 2, email, "news@example.test", "普通通知", "", "2026-11-18T02:00:00Z");
    const other = db.prepare(`INSERT INTO accounts (identity_key, apple_id, region, cookie_encrypted, created_at, updated_at)
      VALUES ('global:43', 'another@icloud.com', 'global', '', '', '')`).run().lastInsertRowid;
    insert.run(other, 1, email, "other@example.test", "另一账号的邮件", "192837", "2026-11-18T03:00:00Z");

    const inbox = createInboxService({ db, config: configFor(":memory:") });
    const mailbox = inbox.list("839201").mailboxes[0];
    assert.equal(mailbox.accountId, accountId);
    assert.equal(mailbox.latestSubject, "普通通知");
    assert.equal(mailbox.latestCode, "839201");
    assert.deepEqual(mailbox.latestVerification, {
      code: "839201", sender: "login@example.test", subject: "验证码", receivedAt: "2026-11-18T01:00:00Z"
    });
    const details = inbox.messagesFor(email, accountId).messages;
    assert.deepEqual(details.map(message => message.code), ["", "839201"]);
    assert.ok(details.every(message => message.id > 0));
    assert.equal(inbox.messagesFor(email).messages.length, 3);
  } finally {
    db.close();
  }
});

test("验证码邮件按内容生成平台标签，正文里的 iCloud 地址不会当成苹果", () => {
  assert.equal(platformTag("GitHub <noreply@github.com>", "Your verification code", "code 839201"), "GitHub");
  assert.equal(platformTag("Microsoft account team <account-security-noreply@accountprotection.microsoft.com>", "验证码", "安全代码 102938"), "微软");
  assert.equal(platformTag("腾讯 <noreply@qq.com>", "验证码", "你的验证码是 445566"), "腾讯");
  assert.equal(platformTag("Apple <appleid@id.apple.com>", "验证码", "你的 Apple 账户验证码"), "苹果");
  assert.equal(platformTag(
    "Shop <noreply@shop.example.com>",
    "验证码",
    "发送到 ada-0001@icloud.com 的验证码是 839201，由 iCloud 隐藏邮件转发"
  ), "Example");
  assert.equal(platformTag("", "你好", "没有验证码"), "");
});

test("收到验证码后把邮箱标成对应平台，已有验证码会在启动时补标", async () => {
  const db = openDatabase(":memory:");
  try {
    const accountId = insertAccount(db);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO messages (account_id, uid, recipient, sender, subject, body, code, received_at)
      VALUES (?, 1, 'ada-0001@icloud.com', 'GitHub <noreply@github.com>', 'Verify', 'code 839201', '839201', ?)`).run(accountId, now);
    const inbox = createInboxService({
      db,
      config: configFor(":memory:"),
      async fetchMessages() {
        return [{
          uid: 2,
          to: ["ada-0001@icloud.com"],
          sender: "Discord <noreply@discord.com>",
          subject: "验证码",
          body: "Your Discord verification code is 102938",
          receivedAt: now
        }];
      }
    });
    assert.equal(db.prepare("SELECT state FROM addresses WHERE email = 'ada-0001@icloud.com'").get().state, "used");
    assert.deepEqual(JSON.parse(db.prepare("SELECT platforms FROM addresses WHERE email = 'ada-0001@icloud.com'").get().platforms), ["GitHub"]);
    inbox.savePassword(accountId, { appPassword: "fixture-password" });
    await inbox.syncAll(accountId);
    assert.equal(db.prepare("SELECT state FROM addresses WHERE email = 'ada-0001@icloud.com'").get().state, "used");
    assert.deepEqual(JSON.parse(db.prepare("SELECT platforms FROM addresses WHERE email = 'ada-0001@icloud.com'").get().platforms), ["Discord", "GitHub"]);
    assert.deepEqual(inbox.list().mailboxes.find(item => item.email === "ada-0001@icloud.com").tags, ["Discord", "GitHub"]);
  } finally {
    db.close();
  }
});

test("随机获取只取未使用邮箱，标签仍保持未使用", () => {
  const db = openDatabase(":memory:");
  try {
    const accountId = insertAccount(db);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO addresses (account_id, email, label, state, source, created_at, updated_at)
      VALUES (?, 'ada-0002@icloud.com', 'ada-0002', 'used', 'generated', ?, ?)`).run(accountId, now, now);
    db.prepare(`INSERT INTO addresses (account_id, email, label, state, source, created_at, updated_at)
      VALUES (?, 'ada-0003@icloud.com', 'ada-0003', 'trash', 'generated', ?, ?)`).run(accountId, now, now);
    const removed = db.prepare(`INSERT INTO accounts (
      identity_key, apple_id, region, cookie_encrypted, status, created_at, updated_at
    ) VALUES ('global:99', 'gone@icloud.com', 'global', '', 'deleted', ?, ?)`).run(now, now).lastInsertRowid;
    db.prepare(`INSERT INTO addresses (account_id, email, label, state, source, created_at, updated_at)
      VALUES (?, 'gone@icloud.com', 'gone', 'unused', 'generated', ?, ?)`).run(removed, now, now);

    const inbox = createInboxService({ db, config: configFor(":memory:") });
    const claimed = inbox.claimRandom();
    assert.equal(claimed.email, "ada-0001@icloud.com");
    assert.equal(claimed.accountId, accountId);
    assert.equal(JSON.stringify(claimed).includes("stored-cookie"), false);
    assert.equal(db.prepare("SELECT state FROM addresses WHERE email = ?").get(claimed.email).state, "unused");
    assert.notEqual(db.prepare("SELECT claimed_at FROM addresses WHERE email = ?").get(claimed.email).claimed_at, "");
    assert.equal(db.prepare("SELECT state FROM addresses WHERE email = 'ada-0002@icloud.com'").get().state, "used");
    assert.throws(() => inbox.claimRandom(), { status: 404, message: "没有未使用的邮箱" });
  } finally {
    db.close();
  }
});

test("按主题、正文搜索历史邮件并分页", () => {
  const db = openDatabase(":memory:");
  try {
    const accountId = insertAccount(db);
    const email = "ada-0001@icloud.com";
    const insert = db.prepare(`INSERT INTO messages (account_id, uid, recipient, subject, body, received_at)
      VALUES (?, ?, ?, ?, ?, '2026-11-18T01:00:00Z')`);
    insert.run(accountId, 1, email, "归档账单", "历史费用 DISCOUNT_50%");
    insert.run(accountId, 2, email, "其他账单", "DISCOUNTX500");
    for (let uid = 3; uid <= 45; uid += 1) insert.run(accountId, uid, email, "常规通知", "新的邮件内容");

    const inbox = createInboxService({ db, config: configFor(":memory:") });
    assert.equal(inbox.list("discount_50%").mailboxes[0].searchMatches, 1);
    assert.equal(inbox.list("归档账单").mailboxes[0].email, email);
    assert.equal(inbox.list("ada-0001").mailboxes[0].email, email);
    assert.deepEqual(inbox.list("不存在").mailboxes, []);

    const matched = inbox.messagesFor(email, accountId, { q: "discount_50%", pageSize: 10 });
    assert.equal(matched.total, 1);
    assert.deepEqual(matched.messages.map(message => message.subject), ["归档账单"]);
    const first = inbox.messagesFor(email, accountId, { page: 1, pageSize: 10 });
    const second = inbox.messagesFor(email, accountId, { page: 2, pageSize: 10 });
    const last = inbox.messagesFor(email, accountId, { page: 100, pageSize: 10 });
    assert.equal(first.total, 45);
    assert.equal(first.messages.length, 10);
    assert.equal(second.messages.length, 10);
    assert.ok(first.messages.at(-1).id > second.messages[0].id);
    assert.equal(last.page, 5);
    assert.equal(last.messages.length, 5);
  } finally {
    db.close();
  }
});

test("保留 HTML 邮件格式并过滤远程资源，纯文本仍可检索", async () => {
  const db = openDatabase(":memory:");
  try {
    const accountId = insertAccount(db);
    const email = "ada-0001@icloud.com";
    const inbox = createInboxService({
      db,
      config: configFor(":memory:"),
      async fetchMessages() {
        return [{
          uid: 1, to: [email], body: "验证码：839201",
          bodyHtml: `<html><head><title>内部标题</title></head><body>
            <h2 style="color:#1a54aa; background-image:url(https://example.test/tracker)">验证码</h2>
            <table><tr><td><strong>839201</strong></td></tr></table>
            <img src="data:image/png;base64,AAAA" alt="内嵌图">
            <img src="https://example.test/pixel" alt="标识">
            <a href="https://example.test/">服务邮件</a>
            <script>messageScript()</script>
          </body></html>`
        }, { uid: 2, to: [email], body: "纯文本正文" }];
      }
    });
    inbox.savePassword(accountId, { appPassword: "fixture-password" });
    assert.equal((await inbox.syncAll(accountId))[0].synced, 2);

    const [message] = inbox.messagesFor(email, accountId, { q: "839201" }).messages;
    assert.equal(message.body, "验证码：839201");
    assert.equal(message.code, "839201");
    assert.equal(message.hasHtml, true);
    assert.equal(Object.hasOwn(message, "bodyHtml"), false);
    const { html } = inbox.messageHtml(message.id);
    assert.match(html, /<h2 style="color:#1a54aa">验证码<\/h2>/);
    assert.ok(html.includes("<table><tr><td><strong>839201</strong></td></tr></table>"));
    assert.ok(html.includes('src="data:image/png;base64,AAAA"'));
    assert.ok(html.includes("标识"));
    assert.doesNotMatch(html, /example\.test|<script|messageScript|内部标题/);

    const [plain] = inbox.messagesFor(email, accountId, { q: "纯文本正文" }).messages;
    assert.equal(plain.hasHtml, false);
    assert.equal(inbox.messageHtml(plain.id).html, "");
  } finally {
    db.close();
  }
});

test("旧库会补上收件字段", () => {
  const databasePath = path.join(os.tmpdir(), `hme-old-${crypto.randomBytes(4).toString("hex")}.db`);
  const raw = new DatabaseSync(databasePath);
  raw.exec(`CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    identity_key TEXT NOT NULL UNIQUE,
    apple_id TEXT NOT NULL DEFAULT '',
    dsid TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL,
    user_partition TEXT NOT NULL DEFAULT '',
    maildomain_host TEXT NOT NULL DEFAULT '',
    cookie_encrypted TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    label_prefix TEXT NOT NULL DEFAULT '',
    cooldown_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL
  );
  INSERT INTO messages (account_id, recipient, body) VALUES (1, 'old@icloud.com', '旧邮件正文')`);
  raw.close();
  const db = openDatabase(databasePath);
  const names = new Set(db.prepare("PRAGMA table_info(accounts)").all().map(row => row.name));
  assert.equal(names.has("imap_password_encrypted"), true);
  assert.equal(Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'").get()), true);
  assert.deepEqual({ ...db.prepare("SELECT body, body_html FROM messages").get() }, { body: "旧邮件正文", body_html: "" });
  db.close();
  fs.rmSync(databasePath, { force: true });
});

test("收取验证码会去重，并且接口不返回密码", async () => {
  const databasePath = path.join(os.tmpdir(), `hme-inbox-${crypto.randomBytes(4).toString("hex")}.db`);
  const config = configFor(databasePath);
  const db = openDatabase(databasePath);
  const accountId = insertAccount(db);
  const password = "abcd-efgh-ijkl-mnop";
  let calls = 0;
  const inbox = createInboxService({
    db,
    config,
    async fetchMessages(input) {
      calls += 1;
      assert.equal(input.appleId, "ada@icloud.com");
      assert.equal(input.appPassword, password);
      if (calls === 1) {
        return {
          uidValidity: 7,
          messages: [
            {
              uid: 10,
              to: ["ada@icloud.com"],
              sender: "Login <noreply@example.com>",
              subject: "验证码",
              body: "隐藏邮箱 ada-0001@icloud.com 的验证码是 839201",
              receivedAt: "2026-11-18T01:00:00.000Z"
            },
            {
              uid: 11,
              to: ["someone@icloud.com"],
              sender: "Other <a@b.c>",
              subject: "hi",
              body: "\n482193\n",
              receivedAt: "2026-11-18T02:00:00.000Z"
            }
          ]
        };
      }
      return {
        uidValidity: 7,
        messages: [{
          uid: 10,
          to: ["ada-0001@icloud.com"],
          sender: "Login <noreply@example.com>",
          subject: "验证码",
          body: "验证码是 839201",
          receivedAt: "2026-11-18T01:00:00.000Z"
        }]
      };
    }
  });
  const accounts = createAccountService({ db, config, client: {} });
  const campaigns = createCampaignService({ db, config, accounts });
  const server = await listen(createApp({ config, accounts, campaigns, inbox }));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "local-password" })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = { "Content-Type": "application/json", Cookie: cookie };
    const saved = await fetch(`${base}/api/accounts/${accountId}/imap`, {
      method: "POST",
      headers,
      body: JSON.stringify({ appPassword: password, host: "imap.mail.me.com" })
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.account.imapReady, true);
    assert.equal(JSON.stringify(savedBody).includes(password), false);
    const stored = db.prepare("SELECT imap_password_encrypted FROM accounts WHERE id = ?").get(accountId);
    assert.equal(decryptSecret(stored.imap_password_encrypted, config.encryptionKey), password);

    const synced = await fetch(`${base}/api/inbox/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId })
    });
    assert.equal(synced.status, 200);
    assert.equal((await synced.json()).results[0].synced, 2);
    const board = await (await fetch(`${base}/api/inbox`, { headers })).json();
    assert.equal(JSON.stringify(board).includes(password), false);
    const alias = board.mailboxes.find(item => item.email === "ada-0001@icloud.com");
    assert.equal(alias.latestCode, "839201");
    const unmatched = board.mailboxes.find(item => item.email === "someone@icloud.com");
    assert.equal(unmatched.matched, false);
    assert.equal(unmatched.latestCode, "482193");

    const again = await inbox.syncAll(accountId);
    assert.equal(again[0].synced, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM messages").get().total, 2);
    const detail = await (await fetch(`${base}/api/inbox/messages?email=ada-0001@icloud.com`, { headers })).json();
    assert.equal(detail.messages[0].code, "839201");
    const overview = await (await fetch(`${base}/api/overview`, { headers })).json();
    assert.equal(overview.messageCount, 2);
    assert.equal(overview.credentials[0].messageCount, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(databasePath, { force: true });
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  return new Promise(resolve => server.once("listening", () => resolve(server)));
}
