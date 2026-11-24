import path from "node:path";

function required(env, name, missing) {
  const value = String(env[name] || "").trim();
  if (!value) missing.push(name);
  return value;
}

function integer(env, name, fallback, min, max) {
  const raw = env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 之间的整数`);
  }
  return value;
}

/** 读取并校验启动配置。调用方决定是否退出进程。 */
export function loadConfig(env = process.env) {
  const missing = [];
  const adminPassword = required(env, "ADMIN_PASSWORD", missing);
  const sessionSecret = required(env, "SESSION_SECRET", missing);
  const encryptionKeyRaw = required(env, "DATA_ENCRYPTION_KEY", missing);
  if (missing.length) {
    throw new Error(`缺少环境变量：${missing.join(", ")}。配置写在 .env，启动时会自动生成`);
  }
  if (adminPassword.length < 10) {
    throw new Error("ADMIN_PASSWORD 至少 10 位");
  }
  const encryptionKey = Buffer.from(encryptionKeyRaw, "base64");
  if (encryptionKey.length !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY 必须是 32 字节的 base64");
  }

  return {
    host: env.HOST || "127.0.0.1",
    port: integer(env, "PORT", 4173, 1, 65535),
    adminUsername: env.ADMIN_USERNAME || "admin",
    adminPassword,
    sessionSecret,
    cookieSecure: env.COOKIE_SECURE === "true",
    encryptionKey,
    databasePath: path.resolve(process.cwd(), env.DATABASE_PATH || "./data/workbench.db"),
    batchLimit: integer(env, "GENERATION_BATCH_LIMIT", 5, 1, 5),
    cooldownMinutes: integer(env, "GENERATION_COOLDOWN_MINUTES", 60, 1, 24 * 60),
    targetDefault: integer(env, "GENERATION_TARGET_DEFAULT", 100, 1, 700),
    accountLimit: integer(env, "GENERATION_ACCOUNT_LIMIT", 700, 1, 700),
    retryMinutes: integer(env, "GENERATION_RETRY_MINUTES", 5, 1, 24 * 60),
    clientBuildNumber: env.ICLOUD_CLIENT_BUILD || "2642Build23",
    clientMasteringNumber: env.ICLOUD_CLIENT_MASTERING || "2642Build23"
  };
}
