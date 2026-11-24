import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decryptSecret } from "../src/crypto.js";
import { openDatabase } from "../src/db.js";
import { createApp } from "../src/http.js";
import { generateSequential } from "../src/icloud/generate.js";
import { createAccountService } from "../src/services/accounts.js";
import { createCampaignService } from "../src/services/campaigns.js";

function fakeClient() {
  return {
    async validateSession(cookie) {
      if (!String(cookie).includes("good")) {
        const error = new Error("Failed to validate cookie: rejected");
        error.code = "REJECTED";
        throw error;
      }
      return {
        cookie,
        region: "global",
        appleId: "ada@icloud.com",
        dsid: "42",
        displayName: "Ada",
        featureAvailable: true,
        userPartition: "68",
        maildomainHost: "p68-maildomainws.icloud.com"
      };
    },
    async generateAddresses(_cookie, _region, host, labels) {
      return {
        maildomainHost: host,
        errors: [],
        generated: labels.map(label => ({
          email: `${label}@icloud.com`,
          label,
          createdAt: new Date().toISOString()
        }))
      };
    },
    async listAddresses() {
      return {
        maildomainHost: "p68-maildomainws.icloud.com",
        addresses: [{
          email: "synced@icloud.com",
          label: "synced",
          active: true,
          createdAt: new Date().toISOString()
        }]
      };
    }
  };
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  return server;
}

test("导入和更新 cURL 都要校验隐藏地址列表，迟到的失败保留新凭据", async () => {
  const db = openDatabase(":memory:");
  const config = { encryptionKey: crypto.randomBytes(32) };
  const client = fakeClient();
  const list = client.listAddresses;
  const validate = client.validateSession;
  const oldRequestStarted = Promise.withResolvers();
  const releaseOldRequest = Promise.withResolvers();
  let holdOldRequest = false;
  let oldSync;
  client.validateSession = async (cookie, region, host) => {
    const result = await validate(cookie, region, host);
    return cookie.includes("good-other") ? { ...result, appleId: "other@example.test", dsid: "43" } : result;
  };
  client.listAddresses = async (cookie, region, host) => {
    if (cookie.includes("good-unavailable")) throw new Error("Invalid global session");
    if (holdOldRequest && cookie.includes("good-old")) {
      oldRequestStarted.resolve();
      await releaseOldRequest.promise;
      throw new Error("Invalid global session");
    }
    return list(cookie, region, host);
  };
  const curl = token => `curl 'https://p68-maildomainws.icloud.com/v2/hme/list' -b 'X-APPLE-WEBAUTH-USER=${token}'`;
  const accounts = createAccountService({ db, config, client });
  try {
    await assert.rejects(accounts.importAccount(curl("good-unavailable")), /隐藏邮件地址列表校验失败/);
    assert.deepEqual(accounts.listAccounts(), []);

    const account = await accounts.importAccount(curl("good-old"));
    await accounts.syncAddresses(account.id);
    const snapshot = accounts.getAccount(account.id).cookie_encrypted;
    await assert.rejects(accounts.updateCookie(account.id, curl("good-unavailable"), "auto"), /隐藏邮件地址列表校验失败/);
    await assert.rejects(accounts.updateCookie(account.id, curl("good-other"), "auto"), { status: 409 });
    assert.equal(accounts.getAccount(account.id).cookie_encrypted, snapshot);

    holdOldRequest = true;
    oldSync = assert.rejects(accounts.syncAddresses(account.id), { status: 409 });
    await Promise.race([oldRequestStarted.promise, oldSync]);
    const updated = await accounts.updateCookie(account.id, curl("good-new"), "auto");
    releaseOldRequest.resolve();
    await oldSync;
    assert.equal(updated.id, account.id);
    assert.equal(updated.addressCount, 1);
    assert.equal(accounts.getAccount(account.id).status, "active");
    assert.notEqual(accounts.getAccount(account.id).cookie_encrypted, snapshot);
  } finally {
    releaseOldRequest.resolve();
    try {
      await oldSync;
    } finally {
      db.close();
    }
  }
});

test("生成任务在批次结束前报告已保留地址数", async () => {
  const db = openDatabase(":memory:");
  const config = { encryptionKey: crypto.randomBytes(32), batchLimit: 5, cooldownMinutes: 60, retryMinutes: 5 };
  const firstReserved = Promise.withResolvers();
  const finishBatch = Promise.withResolvers();
  const client = fakeClient();
  client.generateAddresses = async (_cookie, _region, maildomainHost, labels, options) => {
    let count = 0;
    const result = await generateSequential({
      async generateEmail() {
        count += 1;
        return { success: true, result: { hme: `generated-${count}@icloud.com` } };
      },
      async reserveEmail() { return { success: true }; }
    }, labels, "", {
      ...options,
      async pause() {
        firstReserved.resolve();
        await finishBatch.promise;
      }
    });
    return { ...result, maildomainHost };
  };
  const accounts = createAccountService({ db, config, client });
  const campaigns = createCampaignService({ db, config, accounts });
  let running;
  try {
    const account = await accounts.importAccount("X-APPLE-WEBAUTH-USER=good", "global");
    await accounts.syncAddresses(account.id);
    campaigns.createCampaign({ accountId: account.id, targetTotal: 2, batchSize: 2, labelPrefix: "ada" });
    running = campaigns.tick();
    await Promise.race([firstReserved.promise, running]);

    const [inFlight] = campaigns.listCampaigns();
    assert.equal(inFlight.inventoryCount, 1);
    assert.deepEqual(inFlight.batch, { completed: 1, total: 2 });
    finishBatch.resolve();
    await running;

    const [finished] = campaigns.listCampaigns();
    assert.equal(finished.status, "completed");
    assert.equal(finished.inventoryCount, 3);
    assert.equal(finished.createdCount, 2);
    assert.equal(finished.batch, null);
  } finally {
    finishBatch.resolve();
    try {
      await running;
    } finally {
      db.close();
    }
  }
});

test("生成数量按本次任务计算，超出账号上限时拒绝并分页返回库存", async () => {
  const db = openDatabase(":memory:");
  const config = { encryptionKey: crypto.randomBytes(32), batchLimit: 5, cooldownMinutes: 60, retryMinutes: 5, accountLimit: 4 };
  try {
    const accounts = createAccountService({ db, config, client: fakeClient() });
    const campaigns = createCampaignService({ db, config, accounts });
    const account = await accounts.importAccount("X-APPLE-WEBAUTH-USER=good", "global");
    const now = new Date().toISOString();
    for (let index = 0; index < 3; index += 1) {
      db.prepare(`INSERT INTO addresses (account_id, email, label, state, source, created_at, updated_at)
        VALUES (?, ?, ?, 'unused', 'generated', ?, ?)`).run(account.id, `page-${index}@icloud.com`, `page-${index}`, now, now);
    }
    const page = accounts.listAddresses({ page: 2, pageSize: 2 });
    assert.equal(page.total, 3);
    assert.equal(page.page, 2);
    assert.equal(page.rows.length, 1);
    assert.equal(page.rows[0].email, "page-0@icloud.com");

    assert.throws(() => campaigns.createCampaign({ accountId: account.id, targetTotal: 2, batchSize: 1 }), error => {
      assert.equal(error.status, 400);
      assert.equal(error.remaining, 1);
      assert.equal(error.currentTotal, 3);
      assert.match(error.message, /还能生成 1 个/);
      return true;
    });
    const task = campaigns.createCampaign({ accountId: account.id, targetTotal: 1, batchSize: 1 });
    await campaigns.tick();
    const [done] = campaigns.listCampaigns();
    assert.equal(done.id, task.id);
    assert.equal(done.status, "completed");
    assert.equal(done.createdCount, 1);
    assert.equal(done.inventoryCount, 4);
    assert.throws(() => campaigns.createCampaign({ accountId: account.id, targetTotal: 1, batchSize: 1 }), /不能再生成/);
  } finally {
    db.close();
  }
});

test("任务进行中达到账号上限时停止，不把已有库存算进本次数量", async () => {
  const db = openDatabase(":memory:");
  const config = { encryptionKey: crypto.randomBytes(32), batchLimit: 5, cooldownMinutes: 60, retryMinutes: 5, accountLimit: 5 };
  try {
    const accounts = createAccountService({ db, config, client: fakeClient() });
    const campaigns = createCampaignService({ db, config, accounts });
    const account = await accounts.importAccount("X-APPLE-WEBAUTH-USER=good", "global");
    const task = campaigns.createCampaign({ accountId: account.id, targetTotal: 4, batchSize: 2 });
    config.accountLimit = 2;
    await campaigns.tick();
    const [stopped] = campaigns.listCampaigns();
    assert.equal(stopped.id, task.id);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.createdCount, 2);
    assert.equal(stopped.inventoryCount, 2);
    assert.match(stopped.lastError, /最多 2 个邮箱/);
    assert.equal(accounts.countAddresses(account.id), 2);
  } finally {
    db.close();
  }
});

test("暂停保留正在处理的地址，继续后遵守冷却并完成原任务", async () => {
  const db = openDatabase(":memory:");
  const config = { encryptionKey: crypto.randomBytes(32), batchLimit: 5, cooldownMinutes: 60, retryMinutes: 5 };
  const reserving = Promise.withResolvers();
  const release = Promise.withResolvers();
  const client = fakeClient();
  let attempts = 0;
  client.generateAddresses = async (_cookie, _region, maildomainHost, labels, options) => {
    const result = await generateSequential({
      async generateEmail() {
        attempts += 1;
        return { success: true, result: { hme: `paused-flow-${attempts}@icloud.com` } };
      },
      async reserveEmail() {
        if (attempts === 1) {
          reserving.resolve();
          await release.promise;
        }
        return { success: true };
      }
    }, labels, "", { ...options, async pause() {} });
    return { ...result, maildomainHost };
  };
  const accounts = createAccountService({ db, config, client });
  const campaigns = createCampaignService({ db, config, accounts });
  let running;
  try {
    const account = await accounts.importAccount("X-APPLE-WEBAUTH-USER=good", "global");
    const task = campaigns.createCampaign({ accountId: account.id, targetTotal: 3, batchSize: 2 });
    running = campaigns.tick();
    await Promise.race([reserving.promise, running]);
    assert.deepEqual(campaigns.pauseCampaign(task.id), { ok: true });
    assert.deepEqual(campaigns.pauseCampaign(task.id), { ok: true });
    release.resolve();
    await running;

    const [paused] = campaigns.listCampaigns();
    assert.equal(paused.status, "paused");
    assert.equal(paused.nextRunAt, null);
    assert.equal(paused.createdCount, 1);
    assert.equal(accounts.listBatches()[0].generated, 1);
    await campaigns.tick();
    assert.equal(attempts, 1);
    assert.throws(() => campaigns.createCampaign({ accountId: account.id, targetTotal: 3 }), { status: 409 });

    campaigns.resumeCampaign(task.id);
    assert.equal(campaigns.listCampaigns()[0].nextRunAt, accounts.getAccount(account.id).cooldown_until);
    await campaigns.tick();
    assert.equal(attempts, 1);
    db.prepare("UPDATE accounts SET cooldown_until = NULL WHERE id = ?").run(account.id);
    db.prepare("UPDATE campaigns SET next_run_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
    await campaigns.tick();
    assert.equal(attempts, 3);
    const [finished] = campaigns.listCampaigns();
    assert.equal(finished.status, "completed");
    assert.equal(finished.createdCount, 3);
  } finally {
    release.resolve();
    try {
      await running;
    } finally {
      db.close();
    }
  }
});

test("已停止任务允许同账号新建，继续旧任务时检查运行或暂停的任务", async () => {
  const db = openDatabase(":memory:");
  const config = { encryptionKey: crypto.randomBytes(32), batchLimit: 5, cooldownMinutes: 60, retryMinutes: 5 };
  try {
    const accounts = createAccountService({ db, config, client: fakeClient() });
    const campaigns = createCampaignService({ db, config, accounts });
    const account = await accounts.importAccount("X-APPLE-WEBAUTH-USER=good", "global");
    const input = { accountId: account.id, targetTotal: 3, batchSize: 1 };
    const previous = campaigns.createCampaign(input);
    campaigns.stopCampaign(previous.id);

    const current = campaigns.createCampaign(input);
    assert.notEqual(current.id, previous.id);
    assert.throws(() => campaigns.createCampaign(input), { status: 409 });
    assert.throws(() => campaigns.resumeCampaign(previous.id), { status: 409 });
    campaigns.pauseCampaign(current.id);
    assert.throws(() => campaigns.createCampaign(input), { status: 409 });
    assert.throws(() => campaigns.resumeCampaign(previous.id), { status: 409 });

    campaigns.stopCampaign(current.id);
    campaigns.resumeCampaign(previous.id);
    assert.deepEqual(campaigns.listCampaigns().map(task => [task.id, task.status]), [
      [current.id, "stopped"],
      [previous.id, "running"]
    ]);
  } finally {
    db.close();
  }
});

test("删除保留既有和正在写入的批次记录，旧任务不会影响新任务", async () => {
  const db = openDatabase(":memory:");
  const config = { encryptionKey: crypto.randomBytes(32), batchLimit: 5, cooldownMinutes: 60, retryMinutes: 5 };
  const client = fakeClient();
  const accounts = createAccountService({ db, config, client });
  const campaigns = createCampaignService({ db, config, accounts });
  const reserving = Promise.withResolvers();
  const release = Promise.withResolvers();
  let running;
  try {
    const account = await accounts.importAccount("X-APPLE-WEBAUTH-USER=good", "global");
    const finished = campaigns.createCampaign({ accountId: account.id, targetTotal: 1, batchSize: 1 });
    await campaigns.tick();
    assert.equal(accounts.listBatches()[0].campaignId, finished.id);
    assert.deepEqual(campaigns.deleteCampaign(finished.id), { ok: true });
    assert.deepEqual(campaigns.listCampaigns(), []);
    assert.equal(accounts.countAddresses(account.id), 1);

    db.prepare("UPDATE accounts SET cooldown_until = NULL WHERE id = ?").run(account.id);
    const active = campaigns.createCampaign({ accountId: account.id, targetTotal: 3, batchSize: 2 });
    let attempts = 0;
    client.generateAddresses = async (_cookie, _region, maildomainHost, labels, options) => {
      const result = await generateSequential({
        async generateEmail() {
          attempts += 1;
          return { success: true, result: { hme: `deleted-flow-${attempts}@icloud.com` } };
        },
        async reserveEmail() {
          reserving.resolve();
          await release.promise;
          return { success: true };
        }
      }, labels, "", { ...options, async pause() {} });
      return { ...result, maildomainHost };
    };
    running = campaigns.tick();
    await Promise.race([reserving.promise, running]);
    campaigns.deleteCampaign(active.id);
    assert.throws(() => campaigns.resumeCampaign(active.id), { status: 404 });
    const replacement = campaigns.createCampaign({ accountId: account.id, targetTotal: 3, batchSize: 1 });
    release.resolve();
    await running;

    assert.equal(attempts, 1);
    const [current] = campaigns.listCampaigns();
    assert.equal(current.id, replacement.id);
    assert.notEqual(current.id, active.id);
    assert.equal(current.createdCount, 0);
    assert.equal(current.inventoryCount, 2);
    assert.deepEqual(accounts.listBatches().map(batch => batch.campaignId), [active.id, finished.id]);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    release.resolve();
    try {
      await running;
    } finally {
      db.close();
    }
  }
});

test("导入、生成、冷却和生产目标", async () => {
  const databasePath = path.join(os.tmpdir(), `hme-${crypto.randomBytes(4).toString("hex")}.db`);
  const config = {
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
  const db = openDatabase(databasePath);
  const accounts = createAccountService({ db, config, client: fakeClient() });
  const campaigns = createCampaignService({ db, config, accounts });
  const server = await listen(createApp({ config, accounts, campaigns }));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const anonymous = await fetch(`${base}/api/accounts`);
    assert.equal(anonymous.status, 401);

    const login = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "local-password" })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = { "Content-Type": "application/json", Cookie: cookie };
    const settings = await fetch(`${base}/api/settings`, { headers });
    assert.equal(settings.status, 200);
    assert.equal((await settings.json()).batchLimit, 5);

    const rejected = await fetch(`${base}/api/accounts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ cookie: "X-APPLE-WEBAUTH-USER=bad", region: "global" })
    });
    assert.equal(rejected.status, 400);

    const imported = await fetch(`${base}/api/accounts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ cookie: "X-APPLE-WEBAUTH-USER=good", region: "global" })
    });
    assert.equal(imported.status, 201);
    const { account } = await imported.json();
    assert.equal(account.appleId, "ada@icloud.com");
    assert.equal(account.userPartition, "68");

    const synced = await fetch(`${base}/api/accounts/${account.id}/sync`, { method: "POST", headers, body: "{}" });
    assert.equal(synced.status, 200);
    assert.equal((await synced.json()).synced, 1);
    const overview = await fetch(`${base}/api/overview`, { headers });
    assert.equal(overview.status, 200);
    const summary = await overview.json();
    assert.equal(summary.accountCount, 1);
    assert.equal(summary.validCount, 1);
    assert.equal(summary.mailboxCount, 1);
    assert.equal(summary.messageCount, 0);
    assert.equal(summary.credentials[0].valid, true);

    const generated = await fetch(`${base}/api/accounts/${account.id}/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ count: 2, labelPrefix: "ada" })
    });
    assert.equal(generated.status, 200);
    const batch = await generated.json();
    assert.equal(batch.generated.length, 2);
    assert.match(batch.generated[0].email, /ada-0001@icloud.com/);

    const cooled = await fetch(`${base}/api/accounts/${account.id}/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ count: 1, labelPrefix: "ada" })
    });
    assert.equal(cooled.status, 409);

    const campaign = await fetch(`${base}/api/campaigns`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId: account.id, targetTotal: 4, batchSize: 1, labelPrefix: "ada" })
    });
    assert.equal(campaign.status, 201);
    const createdCampaign = (await campaign.json()).campaign;
    db.prepare("UPDATE campaigns SET next_run_at = ? WHERE id = ?").run(new Date().toISOString(), createdCampaign.id);
    await campaigns.tick();
    const listed = await fetch(`${base}/api/campaigns`, { headers });
    const saved = (await listed.json()).campaigns[0];
    assert.equal(saved.status, "running");
    assert.equal(saved.createdCount, 0);
    assert.match(saved.lastError, /冷却/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(databasePath, { force: true });
    fs.rmSync(`${databasePath}-wal`, { force: true });
    fs.rmSync(`${databasePath}-shm`, { force: true });
  }
});

test("轮换后的 Cookie 加密入库，接口结果里没有 Cookie", async () => {
  const db = openDatabase(":memory:");
  const config = { encryptionKey: crypto.randomBytes(32) };
  const client = fakeClient();
  client.listAddresses = async () => ({
    maildomainHost: "p68-maildomainws.icloud.com",
    addresses: [],
    cookie: "X-APPLE-WEBAUTH-USER=good; X-APPLE-WEBAUTH-TOKEN=rotated"
  });
  const accounts = createAccountService({ db, config, client });
  try {
    const account = await accounts.importAccount("X-APPLE-WEBAUTH-USER=good");
    const stored = decryptSecret(accounts.getAccount(account.id).cookie_encrypted, config.encryptionKey);
    assert.match(stored, /X-APPLE-WEBAUTH-TOKEN=rotated/);
    assert.equal(JSON.stringify(account).includes("rotated"), false);

    client.listAddresses = async () => {
      const error = new Error("Invalid global session");
      error.cookie = "X-APPLE-WEBAUTH-USER=good; X-APPLE-WEBAUTH-TOKEN=after-sync";
      throw error;
    };
    await assert.rejects(accounts.syncAddresses(account.id), { status: 410 });
    const expired = accounts.getAccount(account.id);
    assert.equal(expired.status, "expired");
    assert.match(decryptSecret(expired.cookie_encrypted, config.encryptionKey), /X-APPLE-WEBAUTH-TOKEN=after-sync/);
    assert.equal(String(expired.cookie_encrypted).includes("after-sync"), false);
  } finally {
    db.close();
  }
});

test("生成明细按批次保存，任务明细合并各批，列表接口不返回邮箱", async () => {
  const db = openDatabase(":memory:");
  const config = { encryptionKey: crypto.randomBytes(32), batchLimit: 5, cooldownMinutes: 60, retryMinutes: 5 };
  const client = fakeClient();
  try {
    const accounts = createAccountService({ db, config, client });
    const campaigns = createCampaignService({ db, config, accounts });
    const account = await accounts.importAccount("X-APPLE-WEBAUTH-USER=good", "global");
    const result = await accounts.generate(account.id, 2, "ada");
    const listed = accounts.listBatches();
    assert.equal(listed.length, 1);
    assert.equal(Object.hasOwn(listed[0], "items"), false);
    assert.equal(JSON.stringify(listed).includes("ada-0001"), false);
    const detail = accounts.generationDetails("batch", listed[0].id);
    assert.equal(detail.items.length, 2);
    assert.deepEqual(detail.items.map(item => item.email), result.generated.map(item => item.email));
    assert.equal(detail.items[0].state, "unused");
    assert.equal(detail.items[0].createdAt, result.generated[0].createdAt);
    assert.equal(Object.hasOwn(detail.items[0], "label"), false);
    db.prepare("UPDATE addresses SET state = 'used' WHERE email = ?").run(result.generated[0].email);
    assert.equal(accounts.generationDetails("batch", listed[0].id).items[0].state, "used");

    db.prepare("UPDATE accounts SET cooldown_until = NULL WHERE id = ?").run(account.id);
    const task = campaigns.createCampaign({ accountId: account.id, targetTotal: 1, batchSize: 1, labelPrefix: "ada" });
    await campaigns.tick();
    const campaignDetail = accounts.generationDetails("campaign", task.id);
    assert.equal(campaignDetail.kind, "campaign");
    assert.equal(campaignDetail.items.length, 1);
    assert.equal(campaignDetail.generated, 1);
    assert.equal(campaignDetail.targetTotal, 1);
    assert.match(campaignDetail.items[0].email, /ada-0003@icloud.com/);

    db.prepare("UPDATE accounts SET cooldown_until = NULL WHERE id = ?").run(account.id);
    client.generateAddresses = async (_cookie, _region, host) => ({
      maildomainHost: host,
      generated: [],
      errors: [{ label: "ada-0004", error: "本批失败" }]
    });
    await accounts.generate(account.id, 1, "ada");
    const failed = accounts.listBatches()[0];
    assert.equal(failed.generated, 0);
    const failedDetail = accounts.generationDetails("batch", failed.id);
    assert.deepEqual(failedDetail.items, []);
    assert.deepEqual(failedDetail.failures, [{ label: "ada-0004", error: "本批失败" }]);
    assert.equal(JSON.stringify(accounts.listBatches()).includes("ada-0004"), false);

    assert.throws(() => accounts.generationDetails("batch", 999), { status: 404 });
    assert.throws(() => accounts.generationDetails("other", task.id), { status: 400 });
  } finally {
    db.close();
  }
});

test("空的批次明细按生成顺序补回邮箱，测试地址不计入", () => {
  const databasePath = path.join(os.tmpdir(), `hme-details-${crypto.randomBytes(4).toString("hex")}.db`);
  const config = { encryptionKey: crypto.randomBytes(32) };
  const db = openDatabase(databasePath);
  const now = "2026-01-02T00:00:00.000Z";
  try {
    db.prepare(`INSERT INTO accounts (identity_key, apple_id, region, cookie_encrypted, created_at, updated_at)
      VALUES ('backfill', 'ada@icloud.com', 'global', 'x', ?, ?)`).run(now, now);
    const insertAddress = db.prepare(`INSERT INTO addresses (account_id, email, label, source, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?)`);
    insertAddress.run("local@icloud.com", "local", "local-test", "2026-01-01T00:00:00.000Z", now);
    insertAddress.run("one@icloud.com", "ada-0001", "generated", "2026-01-01T00:00:01.000Z", now);
    insertAddress.run("two@icloud.com", "ada-0002", "generated", "2026-01-01T00:00:02.000Z", now);
    insertAddress.run("three@icloud.com", "ada-0003", "generated", "2026-01-01T00:00:04.000Z", now);
    db.prepare(`INSERT INTO batches (account_id, requested, generated, error, details, created_at)
      VALUES (1, 2, 2, '', '', '2026-01-01T00:00:03.000Z')`).run();
    db.prepare(`INSERT INTO batches (account_id, requested, generated, error, details, created_at)
      VALUES (1, 1, 0, '本批失败', '', '2026-01-01T00:00:03.500Z')`).run();
    db.prepare(`INSERT INTO batches (account_id, requested, generated, error, details, created_at)
      VALUES (1, 1, 1, '', '', '2026-01-01T00:00:05.000Z')`).run();
  } finally {
    db.close();
  }

  const reopened = openDatabase(databasePath);
  try {
    const accounts = createAccountService({ db: reopened, config, client: fakeClient() });
    assert.deepEqual(accounts.generationDetails("batch", 1).items.map(item => item.email), ["one@icloud.com", "two@icloud.com"]);
    const empty = accounts.generationDetails("batch", 2);
    assert.deepEqual(empty.items, []);
    assert.deepEqual(empty.failures, [{ label: "", error: "本批失败" }]);
    assert.deepEqual(accounts.generationDetails("batch", 3).items.map(item => item.createdAt), ["2026-01-01T00:00:04.000Z"]);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS total FROM batches WHERE details = ''").get().total, 0);
  } finally {
    reopened.close();
    fs.rmSync(databasePath, { force: true });
    fs.rmSync(`${databasePath}-wal`, { force: true });
    fs.rmSync(`${databasePath}-shm`, { force: true });
  }
});
