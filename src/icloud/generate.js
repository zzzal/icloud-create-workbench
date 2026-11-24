/** 从 Apple 响应里取出可读错误。 */
export function errorMessage(data, fallback) {
  const error = data?.error;
  if (error && typeof error === "object") return String(error.errorMessage || fallback);
  if (typeof data?.reason === "string" && data.reason) return data.reason;
  if (typeof error === "string" && error) return error;
  return fallback;
}

/**
 * 同一批里两次申请之间的停顿。多数落在 3 秒附近，短不会少于 1.2 秒，长不超过 8 秒。
 * random 连续取两个 0 到 1 的数，用来做成偏态分布，而不是每次都等同一个时长。
 */
export function humanPauseMs(random = Math.random) {
  const u1 = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, random()));
  const u2 = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, random()));
  const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const seconds = Math.min(8, Math.max(1.2, 3.2 + gaussian * 1.1));
  return Math.round(seconds * 1000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 按标签顺序生成再保留。前一个失败时停止，避免在限流后继续打接口。
 * client.generateEmail / reserveEmail 由调用方注入，测试不走网络。
 */
export async function generateSequential(client, labels, note, options = {}) {
  const pause = options.pause ?? (async () => sleep(humanPauseMs()));
  const generated = [];
  const errors = [];
  for (let index = 0; index < labels.length; index += 1) {
    if (options.shouldContinue?.() === false) break;
    if (index > 0) {
      await pause();
      if (options.shouldContinue?.() === false) break;
    }
    const label = labels[index];
    const created = await client.generateEmail();
    if (!created?.success) {
      errors.push({ label, error: errorMessage(created, "生成失败") });
      for (const skipped of labels.slice(index + 1)) {
        errors.push({ label: skipped, error: "前序操作失败，未继续执行" });
      }
      break;
    }
    const email = created.result?.hme;
    const reserved = await client.reserveEmail(email, label, note);
    if (!reserved?.success) {
      errors.push({ label, error: errorMessage(reserved, "保留失败") });
      for (const skipped of labels.slice(index + 1)) {
        errors.push({ label: skipped, error: "前序操作失败，未继续执行" });
      }
      break;
    }
    generated.push({ email, label, createdAt: new Date().toISOString() });
    options.onProgress?.(generated.length);
  }
  return { generated, errors };
}
