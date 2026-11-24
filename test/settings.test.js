import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { createApp } from "../src/http.js";
import { createCampaignService } from "../src/services/campaigns.js";
import { createSettingsService } from "../src/services/settings.js";

function baseConfig(databasePath) {
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

test("生成设置写入数据库并立即生效", async () => {
  const databasePath = path.join(os.tmpdir(), `hme-settings-${crypto.randomBytes(4).toString("hex")}.db`);
  const config = baseConfig(databasePath);
  const db = openDatabase(databasePath);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO accounts (
    identity_key, apple_id, region, cookie_encrypted, status, label_prefix, created_at, updated_at
  ) VALUES ('global:1', 'ada@icloud.com', 'global', '', 'active', 'ada', ?, ?)`).run(now, now);
  const settings = createSettingsService({ db, config });
  const seen = [];
  const campaigns = createCampaignService({
    db,
    config,
    accounts: {
      getAccount: () => ({ id: 1, status: "active", apple_id: "ada@icloud.com", label_prefix: "ada", cooldown_until: null }),
      countAddresses: () => 0,
      async generate(_id, count) {
        seen.push(count);
        return { generated: [], errors: [], cooldownUntil: null };
      }
    }
  });
  const server = await new Promise(resolve => {
    const listening = createApp({ config, accounts: { summary() { return {}; }, listAccounts() { return []; } }, campaigns, settings }).listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(settings.get().batchLimit, 5);
    await assert.rejects(() => Promise.resolve().then(() => settings.save({ batchLimit: 9, cooldownMinutes: 60, targetDefault: 700, retryMinutes: 5 })), /每批数量必须是 1-5/);
    const campaign = campaigns.createCampaign({ accountId: 1, targetTotal: 10, batchSize: 5, labelPrefix: "ada" });
    assert.equal(campaign.batchSize, 5);

    const login = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "local-password" })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = { "Content-Type": "application/json", Cookie: cookie };
    const anonymous = await fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(anonymous.status, 401);

    const saved = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ batchLimit: 2, cooldownMinutes: 30, targetDefault: 12, accountLimit: 80, retryMinutes: 4 })
    });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.deepEqual({
      batchLimit: body.batchLimit,
      cooldownMinutes: body.cooldownMinutes,
      targetDefault: body.targetDefault,
      accountLimit: body.accountLimit,
      retryMinutes: body.retryMinutes
    }, { batchLimit: 2, cooldownMinutes: 30, targetDefault: 12, accountLimit: 80, retryMinutes: 4 });
    assert.equal(JSON.stringify(body).includes("local-password"), false);
    assert.equal(config.batchLimit, 2);

    db.prepare("UPDATE campaigns SET next_run_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", campaign.id);
    await campaigns.tick();
    assert.deepEqual(seen, [2]);

    const reloaded = baseConfig(databasePath);
    createSettingsService({ db, config: reloaded });
    assert.equal(reloaded.batchLimit, 2);
    assert.equal(reloaded.cooldownMinutes, 30);
    assert.equal(reloaded.targetDefault, 12);
    assert.equal(reloaded.accountLimit, 80);
    assert.equal(reloaded.retryMinutes, 4);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(databasePath, { force: true });
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});
