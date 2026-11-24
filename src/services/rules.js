export function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

export function isExpiredSessionError(message) {
  return /invalid global session|session.*expired|global session/i.test(String(message || ""));
}

export function normalizeLabelPrefix(value) {
  const labelPrefix = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(labelPrefix)) {
    throw httpError(400, "标签前缀只能包含字母、数字、下划线和短横线，最长 24 位");
  }
  return labelPrefix;
}

export function defaultLabelPrefix(appleId) {
  return String(appleId || "").split("@")[0].replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 24) || "icloud";
}

export function nextAllowedTime(cooldownUntil, now = Date.now()) {
  const cooldown = new Date(cooldownUntil || 0).getTime();
  return new Date(Math.max(now, Number.isFinite(cooldown) ? cooldown : 0)).toISOString();
}

export function assertBatchCount(count, batchLimit) {
  if (!Number.isInteger(count) || count < 1 || count > batchLimit) {
    throw httpError(400, `每批只能生成 1-${batchLimit} 个`);
  }
}

export function assertTargetTotal(targetTotal) {
  if (!Number.isInteger(targetTotal) || targetTotal < 1 || targetTotal > 700) {
    throw httpError(400, "生成数量必须是 1-700 之间的整数");
  }
}
