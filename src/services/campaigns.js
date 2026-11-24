import { nowIso } from "../db.js";
import {
  assertBatchCount,
  assertTargetTotal,
  defaultLabelPrefix,
  httpError,
  nextAllowedTime,
  normalizeLabelPrefix
} from "./rules.js";

const campaignSummary = `SELECT campaigns.*, accounts.apple_id,
  (SELECT COUNT(*) FROM addresses WHERE addresses.account_id = campaigns.account_id) AS inventory_count
  FROM campaigns JOIN accounts ON accounts.id = campaigns.account_id`;
const blockingCampaigns = `SELECT 1 FROM campaigns AS existing
  WHERE existing.account_id = ? AND existing.status IN ('running', 'paused')`;
const campaignConflict = "该账号已有运行或暂停的生成任务，请先停止现有任务";

function accountLimitOf(config) {
  const value = Number(config.accountLimit);
  return Number.isInteger(value) && value >= 1 ? value : 700;
}

function publicCampaign(row, batch = null) {
  return {
    id: row.id,
    accountId: row.account_id,
    appleId: row.apple_id,
    targetTotal: row.target_total,
    batchSize: row.batch_size,
    labelPrefix: row.label_prefix,
    status: row.status,
    nextRunAt: row.next_run_at,
    lastError: row.last_error,
    createdCount: row.created_count,
    inventoryCount: row.inventory_count,
    batch,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createCampaignService({ db, config, accounts }) {
  let ticking = false;

  function requireAccount(accountId) {
    const account = accounts.getAccount(accountId);
    if (!account) throw httpError(404, "CK 账号不存在");
    if (account.status === "expired") throw httpError(409, "CK 已过期，请先更新 CK", { accountExpired: true });
    return account;
  }

  function createCampaign(input) {
    const account = requireAccount(Number(input.accountId));
    const targetTotal = Number(input.targetTotal || config.targetDefault);
    const batchSize = Number(input.batchSize || config.batchLimit);
    const labelPrefix = normalizeLabelPrefix(input.labelPrefix || account.label_prefix || defaultLabelPrefix(account.apple_id));
    assertTargetTotal(targetTotal);
    assertBatchCount(batchSize, config.batchLimit);
    const limit = accountLimitOf(config);
    const currentTotal = accounts.countAddresses(account.id);
    const remaining = Math.max(0, limit - currentTotal);
    if (remaining === 0) {
      throw httpError(400, `该账号已有 ${currentTotal} 个邮箱，已达到每个账号最多 ${limit} 个，不能再生成。`, {
        remaining: 0,
        accountLimit: limit,
        currentTotal
      });
    }
    if (targetTotal > remaining) {
      throw httpError(400, `超出每个账号最多 ${limit} 个邮箱。当前已有 ${currentTotal} 个，还能生成 ${remaining} 个。`, {
        remaining,
        accountLimit: limit,
        currentTotal
      });
    }
    const now = nowIso();
    const inserted = db.prepare(`INSERT INTO campaigns (
      account_id, target_total, batch_size, label_prefix, status, next_run_at, created_count, created_at, updated_at
    ) SELECT ?, ?, ?, ?, 'running', ?, 0, ?, ?
      WHERE NOT EXISTS (${blockingCampaigns})`).run(
      account.id,
      targetTotal,
      batchSize,
      labelPrefix,
      nextAllowedTime(account.cooldown_until),
      now,
      now,
      account.id
    );
    if (!inserted.changes) throw httpError(409, campaignConflict);
    return getCampaign(Number(inserted.lastInsertRowid));
  }

  function getCampaign(id) {
    const row = db.prepare(`${campaignSummary} WHERE campaigns.id = ? AND campaigns.status != 'deleted'`).get(id);
    return row ? publicCampaign(row) : null;
  }

  function listCampaigns() {
    return db.prepare(`${campaignSummary} WHERE campaigns.status != 'deleted' ORDER BY campaigns.id DESC LIMIT 100`).all().map(row =>
      publicCampaign(row, accounts.getCampaignBatch(row.account_id, row.id))
    );
  }

  function suspendCampaign(id, status, includePaused = false) {
    return db.prepare(`UPDATE campaigns SET status = ?, next_run_at = NULL, updated_at = ?
      WHERE id = ? AND (status = 'running' OR (status = 'paused' AND ?))`)
      .run(status, nowIso(), id, Number(includePaused)).changes;
  }

  function stopCampaign(id) {
    if (!suspendCampaign(id, "stopped", true)) throw httpError(404, "运行或暂停中的生成任务不存在");
    return { ok: true };
  }

  function pauseCampaign(id) {
    if (suspendCampaign(id, "paused")) return { ok: true };
    const task = db.prepare("SELECT status FROM campaigns WHERE id = ? AND status != 'deleted'").get(id);
    if (!task) throw httpError(404, "生成任务不存在");
    if (task.status !== "paused") throw httpError(409, "该生成任务当前不能暂停");
    return { ok: true };
  }

  function resumeCampaign(id) {
    const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ? AND status != 'deleted'").get(id);
    if (!campaign) throw httpError(404, "生产目标不存在");
    const account = requireAccount(campaign.account_id);
    if (!["paused", "stopped"].includes(campaign.status)) throw httpError(409, "该生产目标当前不能继续");
    const updated = db.prepare(`UPDATE campaigns SET status = 'running', next_run_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('paused', 'stopped')
        AND NOT EXISTS (${blockingCampaigns} AND existing.id != ?)`).run(
      nextAllowedTime(account.cooldown_until),
      nowIso(),
      id,
      account.id,
      id
    );
    if (!updated.changes) throw httpError(409, campaignConflict);
    return { ok: true };
  }

  function deleteCampaign(id) {
    // Keep the referenced task ID for existing and in-flight batch history.
    const updated = db.prepare("UPDATE campaigns SET status = 'deleted', next_run_at = NULL, updated_at = ? WHERE id = ? AND status != 'deleted'").run(nowIso(), id);
    if (!updated.changes) throw httpError(404, "生产目标不存在");
    return { ok: true };
  }

  function recordRun(id, generatedCount, nextRunAt, lastError) {
    db.prepare(`UPDATE campaigns
      SET created_count = created_count + ?, next_run_at = CASE WHEN status = 'running' THEN ? ELSE NULL END,
        last_error = ?, updated_at = ?
      WHERE id = ? AND status != 'deleted'`).run(generatedCount, nextRunAt, lastError || "", nowIso(), id);
  }

  function completeCampaign(id) {
    db.prepare("UPDATE campaigns SET status = 'completed', next_run_at = NULL, updated_at = ? WHERE id = ? AND status != 'deleted'").run(nowIso(), id);
  }

  async function runCampaign(row) {
    if (row.created_count >= row.target_total) {
      completeCampaign(row.id);
      return;
    }
    const limit = accountLimitOf(config);
    const slots = Math.max(0, limit - accounts.countAddresses(row.account_id));
    if (slots === 0) {
      recordRun(row.id, 0, null, `已达到每个账号最多 ${limit} 个邮箱`);
      suspendCampaign(row.id, "stopped");
      return;
    }
    const requestedCount = Math.min(row.batch_size, config.batchLimit, row.target_total - row.created_count, slots);
    try {
      const result = await accounts.generate(row.account_id, requestedCount, row.label_prefix, row.id);
      const createdNow = row.created_count + result.generated.length;
      const slotsLeft = Math.max(0, limit - accounts.countAddresses(row.account_id));
      const complete = createdNow >= row.target_total;
      const capped = !complete && slotsLeft === 0;
      const finished = complete || capped;
      const nextRunAt = finished
        ? null
        : result.generated.length
          ? result.cooldownUntil
          : new Date(Date.now() + config.retryMinutes * 60_000).toISOString();
      const errors = (result.errors || []).map(item => item.error);
      if (capped) errors.push(`已达到每个账号最多 ${limit} 个邮箱`);
      recordRun(row.id, result.generated.length, nextRunAt, errors.join("；"));
      if (complete) completeCampaign(row.id);
      else if (capped) suspendCampaign(row.id, "stopped");
    } catch (error) {
      if (error.status === 404) {
        suspendCampaign(row.id, "stopped");
        return;
      }
      if (error.accountExpired || error.status === 410) {
        recordRun(row.id, 0, null, error.message);
        suspendCampaign(row.id, "stopped");
        return;
      }
      const nextRunAt = error.cooldownUntil || new Date(Date.now() + config.retryMinutes * 60_000).toISOString();
      recordRun(row.id, 0, nextRunAt, error.message);
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const due = db.prepare(`SELECT id FROM campaigns
        WHERE status = 'running' AND next_run_at <= ?
        ORDER BY next_run_at ASC`).all(nowIso());
      const readDue = db.prepare("SELECT * FROM campaigns WHERE id = ? AND status = 'running' AND next_run_at <= ?");
      for (const { id } of due) {
        const campaign = readDue.get(id, nowIso());
        if (campaign) await runCampaign(campaign);
      }
    } finally {
      ticking = false;
    }
  }

  function start() {
    const timer = setInterval(() => {
      tick().catch(error => console.error(`生产任务调度失败：${error.message}`));
    }, 5000);
    timer.unref();
    tick().catch(error => console.error(`生产任务调度失败：${error.message}`));
    return () => clearInterval(timer);
  }

  return { createCampaign, listCampaigns, pauseCampaign, stopCampaign, resumeCampaign, deleteCampaign, tick, start };
}
