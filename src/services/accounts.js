import { decryptSecret, encryptSecret } from "../crypto.js";
import { parseCookieContext } from "../icloud/cookie.js";
import { nowIso } from "../db.js";
import { parsePlatforms } from "../mail/platform.js";
import {
  assertBatchCount,
  defaultLabelPrefix,
  httpError,
  isExpiredSessionError,
  normalizeLabelPrefix
} from "./rules.js";

function publicAccount(row, addressCount = 0) {
  if (!row) return null;
  return {
    id: row.id,
    appleId: row.apple_id,
    dsid: row.dsid,
    displayName: row.display_name,
    region: row.region,
    userPartition: row.user_partition,
    maildomainHost: row.maildomain_host,
    status: row.status,
    labelPrefix: row.label_prefix,
    cooldownUntil: row.cooldown_until,
    addressCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createAccountService({ db, config, client }) {
  const running = new Map();

  function countAddresses(accountId) {
    return db.prepare("SELECT COUNT(*) AS total FROM addresses WHERE account_id = ?").get(accountId).total;
  }

  function getCampaignBatch(accountId, campaignId) {
    const batch = running.get(accountId);
    if (batch?.campaignId !== campaignId) return null;
    return { completed: batch.completed, total: batch.total };
  }

  function getAccount(id) {
    return db.prepare("SELECT * FROM accounts WHERE id = ? AND status != 'deleted'").get(id);
  }

  function requireAccount(id) {
    const account = getAccount(id);
    if (!account) throw httpError(404, "账号不存在");
    return account;
  }

  function withCookie(id) {
    const account = requireAccount(id);
    return { account, cookie: decryptSecret(account.cookie_encrypted, config.encryptionKey) };
  }

  function ensureActive(account) {
    if (account.status === "expired") throw httpError(409, "CK 已过期，请先更新 CK", { accountExpired: true });
  }

  async function prepareAccount(cookieInput, region = "auto") {
    if (!String(cookieInput || "").trim()) throw httpError(400, "CK 不能为空");
    const parsed = parseCookieContext(cookieInput, region);
    if (!parsed.cookie) throw httpError(400, "复制的 cURL 没有包含 Cookie，请重新复制 iCloud+ 首页请求");
    if (!/X-APPLE/i.test(parsed.cookie)) throw httpError(400, "CK 中未找到必要的 X-APPLE 字段");
    let checked;
    try {
      checked = await client.validateSession(parsed.cookie, parsed.region, parsed.maildomainHost);
    } catch (error) {
      const wrapped = httpError(400, error.message);
      wrapped.code = error.code;
      throw wrapped;
    }
    if (!checked.featureAvailable) throw httpError(400, "该 Apple ID 未检测到iCloud邮箱功能");
    return {
      identityKey: `${checked.region}:${checked.dsid || checked.appleId}`,
      appleId: checked.appleId,
      dsid: checked.dsid,
      displayName: checked.displayName,
      region: checked.region,
      userPartition: checked.userPartition,
      maildomainHost: checked.maildomainHost,
      labelPrefix: defaultLabelPrefix(checked.appleId),
      cookie: checked.cookie
    };
  }

  async function verifyAddressAccess(prepared) {
    try {
      const result = await client.listAddresses(prepared.cookie, prepared.region, prepared.maildomainHost);
      prepared.maildomainHost = result.maildomainHost;
      if (result.cookie) prepared.cookie = result.cookie;
    } catch (error) {
      if (error.cookie) prepared.cookie = error.cookie;
      throw httpError(400, `隐藏邮件地址列表校验失败（${error.message}）`);
    }
  }

  function persistRefreshedCookie(account, nextCookie) {
    if (!nextCookie) return account.cookie_encrypted;
    const current = decryptSecret(account.cookie_encrypted, config.encryptionKey);
    if (nextCookie === current) return account.cookie_encrypted;
    const encrypted = encryptSecret(nextCookie, config.encryptionKey);
    const updated = db.prepare(`UPDATE accounts
      SET cookie_encrypted = ?, updated_at = ?
      WHERE id = ? AND cookie_encrypted = ? AND status != 'deleted'`).run(
      encrypted,
      nowIso(),
      account.id,
      account.cookie_encrypted
    );
    if (!updated.changes) return null;
    account.cookie_encrypted = encrypted;
    return encrypted;
  }

  function savePrepared(prepared, existingId = null, { expectedCookie = null, keepCookie = false } = {}) {
    const now = nowIso();
    const encrypted = keepCookie ? expectedCookie : encryptSecret(prepared.cookie, config.encryptionKey);
    const id = existingId ?? db.prepare("SELECT id FROM accounts WHERE identity_key = ?").get(prepared.identityKey)?.id;
    if (id) {
      const result = db.prepare(`UPDATE accounts
        SET apple_id = ?, dsid = ?, display_name = ?, region = ?, user_partition = ?,
            maildomain_host = ?, cookie_encrypted = ?, status = 'active', updated_at = ?
        WHERE id = ? AND (? IS NULL OR (cookie_encrypted = ? AND status != 'deleted'))`).run(
        prepared.appleId,
        prepared.dsid,
        prepared.displayName,
        prepared.region,
        prepared.userPartition,
        prepared.maildomainHost,
        encrypted,
        now,
        id,
        expectedCookie,
        expectedCookie
      );
      return result.changes ? id : null;
    }
    const inserted = db.prepare(`INSERT INTO accounts (
      identity_key, apple_id, dsid, display_name, region, user_partition, maildomain_host,
      cookie_encrypted, status, label_prefix, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).run(
      prepared.identityKey,
      prepared.appleId,
      prepared.dsid,
      prepared.displayName,
      prepared.region,
      prepared.userPartition,
      prepared.maildomainHost,
      encrypted,
      prepared.labelPrefix,
      now,
      now
    );
    return Number(inserted.lastInsertRowid);
  }

  async function importAccount(cookieInput, region) {
    const prepared = await prepareAccount(cookieInput, region);
    await verifyAddressAccess(prepared);
    const id = savePrepared(prepared);
    return publicAccount(getAccount(id), countAddresses(id));
  }

  async function updateCookie(id, cookieInput, region) {
    const existing = requireAccount(id);
    const prepared = await prepareAccount(cookieInput, !region || region === "auto" ? existing.region : region);
    if (prepared.identityKey !== existing.identity_key) {
      throw httpError(409, "新 CK 不属于当前 Apple ID，请使用导入功能新增账号");
    }
    await verifyAddressAccess(prepared);
    if (!savePrepared(prepared, id, { expectedCookie: existing.cookie_encrypted })) throw httpError(409, "账号凭据已变更，请重新打开账号后再提交");
    return publicAccount(getAccount(id), countAddresses(id));
  }

  async function checkCookie(id) {
    const { account, cookie } = withCookie(id);
    try {
      const prepared = await prepareAccount(cookie, account.region);
      if (prepared.identityKey !== account.identity_key) throw new Error("CK 返回的 Apple ID 与当前账号不一致");
      if (!savePrepared(prepared, id, { expectedCookie: account.cookie_encrypted, keepCookie: prepared.cookie === cookie })) {
        throw httpError(409, "凭据已更新，请重新检测");
      }
      return { valid: true, account: publicAccount(getAccount(id), countAddresses(id)) };
    } catch (error) {
      if (error.code !== "NETWORK") {
        db.prepare("UPDATE accounts SET status = 'expired', updated_at = ? WHERE id = ? AND cookie_encrypted = ? AND status != 'deleted'")
          .run(nowIso(), id, account.cookie_encrypted);
      }
      return { valid: false, error: error.message, account: publicAccount(getAccount(id), countAddresses(id)) };
    }
  }

  function listAccounts() {
    return db.prepare(`SELECT accounts.*, (
      SELECT COUNT(*) FROM addresses WHERE addresses.account_id = accounts.id
    ) AS address_count
    FROM accounts WHERE status != 'deleted' ORDER BY id DESC`).all().map(row => publicAccount(row, row.address_count));
  }

  function summary() {
    const totals = new Map(db.prepare(`SELECT messages.account_id AS account_id, COUNT(*) AS total
      FROM messages JOIN accounts ON accounts.id = messages.account_id
      WHERE accounts.status != 'deleted'
      GROUP BY messages.account_id`).all().map(row => [row.account_id, row.total]));
    const credentials = listAccounts().map(account => ({
      id: account.id,
      appleId: account.appleId,
      displayName: account.displayName,
      status: account.status,
      valid: account.status === "active",
      mailboxCount: account.addressCount,
      messageCount: totals.get(account.id) || 0,
      updatedAt: account.updatedAt
    }));
    return {
      accountCount: credentials.length,
      validCount: credentials.filter(account => account.valid).length,
      expiredCount: credentials.filter(account => !account.valid).length,
      mailboxCount: credentials.reduce((total, account) => total + account.mailboxCount, 0),
      messageCount: credentials.reduce((total, account) => total + account.messageCount, 0),
      credentials
    };
  }

  function removeAccount(id) {
    const account = requireAccount(id);
    const now = nowIso();
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE accounts SET status = 'deleted', cookie_encrypted = '', updated_at = ? WHERE id = ?").run(now, account.id);
      db.prepare("UPDATE campaigns SET status = 'stopped', next_run_at = NULL, updated_at = ? WHERE account_id = ? AND status = 'running'").run(now, account.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { ok: true };
  }

  function rememberAddresses(accountId, rows, source) {
    const now = nowIso();
    const find = db.prepare("SELECT id, state FROM addresses WHERE email = ?");
    const insert = db.prepare(`INSERT INTO addresses
      (account_id, email, label, state, source, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const update = db.prepare("UPDATE addresses SET account_id = ?, label = ?, updated_at = ? WHERE id = ?");
    db.exec("BEGIN");
    try {
      for (const row of rows) {
        const existing = find.get(row.email);
        if (!existing) {
          insert.run(accountId, row.email, row.label || "", "unused", source, row.note || "", row.createdAt || now, now);
          continue;
        }
        update.run(accountId, row.label || "", now, existing.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function markExpired(account, message) {
    const updated = db.prepare("UPDATE accounts SET status = 'expired', updated_at = ? WHERE id = ? AND cookie_encrypted = ? AND status != 'deleted'")
      .run(nowIso(), account.id, account.cookie_encrypted);
    if (!updated.changes) return httpError(409, "账号凭据已变更，请使用当前凭据重试");
    return httpError(410, message || "CK 已失效，请先更新 CK", { accountExpired: true });
  }

  async function syncAddresses(id) {
    const { account, cookie } = withCookie(id);
    ensureActive(account);
    let result;
    try {
      result = await client.listAddresses(cookie, account.region, account.maildomain_host);
    } catch (error) {
      if (persistRefreshedCookie(account, error.cookie) === null) throw httpError(409, "账号凭据已变更，请使用当前凭据重试");
      if (isExpiredSessionError(error.message)) throw markExpired(account, error.message);
      throw httpError(400, error.message);
    }
    if (persistRefreshedCookie(account, result.cookie) === null) throw httpError(409, "账号凭据已变更，请使用当前凭据重试");
    rememberAddresses(id, result.addresses, "synced");
    db.prepare("UPDATE accounts SET maildomain_host = ?, updated_at = ? WHERE id = ?").run(result.maildomainHost, nowIso(), id);
    return { synced: result.addresses.length };
  }

  function nextLabelIndex(accountId, prefix) {
    const rows = db.prepare("SELECT label FROM addresses WHERE account_id = ? AND label LIKE ?").all(accountId, `${prefix}-%`);
    const matcher = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
    let max = 0;
    for (const row of rows) {
      const matched = matcher.exec(row.label);
      if (matched) max = Math.max(max, Number(matched[1]));
    }
    return max + 1;
  }

  function makeLabels(accountId, prefix, count) {
    const start = nextLabelIndex(accountId, prefix);
    return Array.from({ length: count }, (_, index) => `${prefix}-${String(start + index).padStart(4, "0")}`);
  }

  async function generate(id, requestedCount, requestedPrefix, campaignId = null) {
    const { account, cookie } = withCookie(id);
    ensureActive(account);
    const count = Number(requestedCount || config.batchLimit);
    assertBatchCount(count, config.batchLimit);
    if (running.has(id)) throw httpError(409, "该账号已有生成任务运行中");
    if (account.cooldown_until && new Date(account.cooldown_until).getTime() > Date.now()) {
      throw httpError(409, "该账号仍处于生成冷却期", { cooldownUntil: account.cooldown_until });
    }
    const prefix = normalizeLabelPrefix(requestedPrefix || account.label_prefix || defaultLabelPrefix(account.apple_id));
    const labels = makeLabels(id, prefix, count);
    const runningCampaign = campaignId === null ? null : db.prepare("SELECT 1 FROM campaigns WHERE id = ? AND status = 'running'");
    const batch = { campaignId, completed: 0, total: count };
    running.set(id, batch);
    let result = { generated: [], errors: [], maildomainHost: account.maildomain_host };
    try {
      result = await client.generateAddresses(cookie, account.region, account.maildomain_host, labels, {
        shouldContinue: () => !runningCampaign || Boolean(runningCampaign.get(campaignId)),
        onProgress: completed => { batch.completed = completed; }
      });
    } catch (error) {
      result.errors = [{ label: labels[0], error: error.message }];
      if (persistRefreshedCookie(account, error.cookie) === null) {
        recordBatch(id, campaignId, count, result);
        throw httpError(409, "账号凭据已变更，请使用当前凭据重试");
      }
      if (isExpiredSessionError(error.message)) {
        recordBatch(id, campaignId, count, result);
        throw markExpired(account, error.message);
      }
    } finally {
      running.delete(id);
    }
    const generated = result.generated || [];
    const errors = result.errors || [];
    if (persistRefreshedCookie(account, result.cookie) === null) throw httpError(409, "账号凭据已变更，请使用当前凭据重试");
    rememberAddresses(id, generated.map(item => ({ ...item, active: true, note: "generated" })), "generated");
    const now = nowIso();
    const cooldownUntil = generated.length
      ? new Date(Date.now() + config.cooldownMinutes * 60_000).toISOString()
      : account.cooldown_until;
    db.prepare("UPDATE accounts SET maildomain_host = ?, label_prefix = ?, cooldown_until = ?, updated_at = ? WHERE id = ?").run(
      result.maildomainHost || account.maildomain_host,
      prefix,
      cooldownUntil,
      now,
      id
    );
    recordBatch(id, campaignId, count, result);
    return {
      generated,
      errors,
      cooldownUntil,
      account: publicAccount(getAccount(id), countAddresses(id))
    };
  }

  function storedDetails(result) {
    const items = [];
    for (const item of result.generated || []) {
      const email = String(item?.email || "").trim();
      if (!email) continue;
      items.push({ email, label: String(item.label || ""), createdAt: String(item.createdAt || "") });
    }
    const failures = [];
    for (const item of result.errors || []) {
      const error = String(item?.error || "").trim();
      const label = String(item?.label || "");
      if (!error && !label) continue;
      failures.push({ label, error });
    }
    return JSON.stringify({ items, failures });
  }

  function recordBatch(accountId, campaignId, requested, result) {
    db.prepare(`INSERT INTO batches (account_id, campaign_id, requested, generated, error, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      accountId,
      campaignId,
      requested,
      (result.generated || []).length,
      (result.errors || []).map(item => item.error).join("；"),
      storedDetails(result),
      nowIso()
    );
  }

  function listAddresses({ accountId, state, page = 1, pageSize = 50 }) {
    const where = ["1 = 1"];
    const params = [];
    if (accountId) {
      where.push("addresses.account_id = ?");
      params.push(Number(accountId));
    }
    const tag = String(state || "");
    if (tag) {
      where.push(`EXISTS (
        SELECT 1 FROM json_each(CASE WHEN addresses.platforms = '' THEN '[]' ELSE addresses.platforms END)
        WHERE json_each.value = ?
      )`);
      params.push(tag);
    }
    const filter = where.join(" AND ");
    const total = db.prepare(`SELECT COUNT(*) AS total FROM addresses WHERE ${filter}`).get(...params).total;
    const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
    const rows = db.prepare(`SELECT addresses.*, accounts.apple_id AS apple_id
      FROM addresses JOIN accounts ON accounts.id = addresses.account_id
      WHERE ${filter} ORDER BY addresses.id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
    const tags = db.prepare(`SELECT DISTINCT json_each.value AS tag
      FROM addresses, json_each(CASE WHEN addresses.platforms = '' THEN '[]' ELSE addresses.platforms END)
      WHERE json_each.value != ''
      ORDER BY tag`).all().map(row => row.tag);
    return {
      total,
      page: offset / size + 1,
      pageSize: size,
      tags,
      rows: rows.map(row => ({
        id: row.id,
        accountId: row.account_id,
        appleId: row.apple_id,
        email: row.email,
        label: row.label,
        state: row.state === "used" ? "used" : "unused",
        platforms: parsePlatforms(row.platforms),
        source: row.source,
        createdAt: row.created_at
      }))
    };
  }

  function setAddressState(id, state) {
    if (state !== "unused") throw httpError(400, "只能恢复为未使用");
    const updated = db.prepare("UPDATE addresses SET state = ?, updated_at = ? WHERE id = ?").run(state, nowIso(), id);
    if (!updated.changes) throw httpError(404, "邮箱不存在");
    return { ok: true };
  }

  function listBatches(limit = 20) {
    return db.prepare(`SELECT batches.*, accounts.apple_id AS apple_id
      FROM batches JOIN accounts ON accounts.id = batches.account_id
      ORDER BY batches.id DESC LIMIT ?`).all(Math.min(limit, 100)).map(row => ({
      id: row.id,
      accountId: row.account_id,
      appleId: row.apple_id,
      campaignId: row.campaign_id,
      requested: row.requested,
      generated: row.generated,
      error: row.error,
      createdAt: row.created_at
    }));
  }

  function readDetails(value) {
    let parsed = {};
    try {
      parsed = JSON.parse(value || "");
    } catch {
      parsed = {};
    }
    const items = [];
    for (const item of Array.isArray(parsed?.items) ? parsed.items : []) {
      const email = String(item?.email || "").trim();
      if (!email) continue;
      items.push({ email, label: String(item?.label || ""), createdAt: String(item?.createdAt || "") });
    }
    const failures = [];
    for (const item of Array.isArray(parsed?.failures) ? parsed.failures : []) {
      const error = String(item?.error || "");
      const label = String(item?.label || "");
      if (!error && !label) continue;
      failures.push({ label, error });
    }
    return { items, failures };
  }

  function enrichItems(items) {
    if (!items.length) return [];
    const rows = db.prepare(`SELECT email, state, created_at FROM addresses WHERE email IN (${items.map(() => "?").join(",")})`)
      .all(...items.map(item => item.email));
    const current = new Map(rows.map(row => [row.email, row]));
    return items.map(item => {
      const row = current.get(item.email);
      return {
        email: item.email,
        createdAt: row?.created_at || item.createdAt || "",
        state: row ? (row.state === "used" ? "used" : "unused") : ""
      };
    });
  }

  function generationDetails(kind, id) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) throw httpError(400, "明细不存在");
    if (kind === "batch") {
      const row = db.prepare(`SELECT batches.*, accounts.apple_id AS apple_id
        FROM batches JOIN accounts ON accounts.id = batches.account_id
        WHERE batches.id = ?`).get(numericId);
      if (!row) throw httpError(404, "明细不存在");
      const details = readDetails(row.details);
      return {
        kind: "batch",
        id: row.id,
        appleId: row.apple_id,
        campaignId: row.campaign_id,
        requested: row.requested,
        generated: row.generated,
        error: row.error,
        createdAt: row.created_at,
        items: enrichItems(details.items),
        failures: details.failures
      };
    }
    if (kind === "campaign") {
      const campaign = db.prepare(`SELECT campaigns.*, accounts.apple_id AS apple_id
        FROM campaigns JOIN accounts ON accounts.id = campaigns.account_id
        WHERE campaigns.id = ?`).get(numericId);
      if (!campaign) throw httpError(404, "明细不存在");
      const batches = db.prepare("SELECT details FROM batches WHERE campaign_id = ? ORDER BY id ASC").all(numericId);
      const items = [];
      const failures = [];
      for (const batch of batches) {
        const details = readDetails(batch.details);
        items.push(...details.items);
        failures.push(...details.failures);
      }
      return {
        kind: "campaign",
        id: campaign.id,
        appleId: campaign.apple_id,
        status: campaign.status,
        requested: campaign.target_total,
        generated: campaign.created_count,
        error: campaign.last_error,
        createdAt: campaign.updated_at,
        targetTotal: campaign.target_total,
        items: enrichItems(items),
        failures
      };
    }
    throw httpError(400, "明细不存在");
  }

  return {
    importAccount,
    updateCookie,
    checkCookie,
    listAccounts,
    summary,
    removeAccount,
    syncAddresses,
    generate,
    listAddresses,
    setAddressState,
    listBatches,
    generationDetails,
    countAddresses,
    getCampaignBatch,
    getAccount
  };
}
