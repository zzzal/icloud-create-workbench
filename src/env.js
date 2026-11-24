import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const examplePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env.example");

function protect(file) {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows 不使用 Unix 权限位。
  }
}

function generatedEnv() {
  const example = fs.readFileSync(examplePath, "utf8");
  const password = crypto.randomBytes(12).toString("base64url");
  const sessionSecret = crypto.randomBytes(48).toString("base64");
  const dataKey = crypto.randomBytes(32).toString("base64");
  const text = example
    .replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password}`)
    .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${sessionSecret}`)
    .replace(/^DATA_ENCRYPTION_KEY=.*$/m, `DATA_ENCRYPTION_KEY=${dataKey}`);
  return { text, password, username: "admin" };
}

/** 在指定目录准备 .env。已有文件不覆盖。只有旧的 .env.icloud 时复制一次。 */
export function ensureEnv(cwd = process.cwd()) {
  const file = path.resolve(cwd, ".env");
  if (fs.existsSync(file)) return { created: false, copied: false, file };
  const legacy = path.resolve(cwd, ".env.icloud");
  if (fs.existsSync(legacy) && fs.statSync(legacy).isFile()) {
    fs.copyFileSync(legacy, file);
    protect(file);
    return { created: false, copied: true, file };
  }
  const generated = generatedEnv();
  fs.writeFileSync(file, generated.text, { mode: 0o600 });
  protect(file);
  return { created: true, copied: false, file, username: generated.username, password: generated.password };
}

export function reportEnv(result) {
  if (result.created) {
    console.log("已生成 .env");
    console.log(`管理员用户名：${result.username}`);
    console.log(`管理员密码：${result.password}`);
    return;
  }
  if (result.copied) {
    console.log("已将 .env.icloud 复制为 .env，未改动原文件。");
    return;
  }
  console.log(".env 已存在，未覆盖。");
}
