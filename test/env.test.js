import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureEnv } from "../src/env.js";

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hme-env-"));
}

test("没有配置时生成 .env，默认生成数量是 100，再次启动不覆盖", () => {
  const directory = temporaryDirectory();
  try {
    const created = ensureEnv(directory);
    assert.equal(created.created, true);
    const first = fs.readFileSync(created.file, "utf8");
    assert.match(first, /^GENERATION_TARGET_DEFAULT=100$/m);
    assert.match(first, new RegExp(`^ADMIN_PASSWORD=${created.password}$`, "m"));
    assert.equal(fs.statSync(created.file).mode & 0o777, 0o600);

    const again = ensureEnv(directory);
    assert.equal(again.created, false);
    assert.equal(again.copied, false);
    assert.equal(fs.readFileSync(again.file, "utf8"), first);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("只有 .env.icloud 时复制为 .env，不改动原文件", () => {
  const directory = temporaryDirectory();
  try {
    const legacy = path.join(directory, ".env.icloud");
    fs.writeFileSync(legacy, "ADMIN_PASSWORD=keep-this\nGENERATION_TARGET_DEFAULT=100\n");
    const copied = ensureEnv(directory);
    assert.equal(copied.copied, true);
    assert.equal(fs.readFileSync(copied.file, "utf8"), fs.readFileSync(legacy, "utf8"));
    assert.equal(fs.readFileSync(legacy, "utf8").includes("keep-this"), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
