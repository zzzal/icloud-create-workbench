import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { matchLocale, resolveLocale, translate } from "../public/i18n.js";

test("系统语言映射到简体、繁体或英语", () => {
  assert.equal(matchLocale("zh-Hant"), "zh-TW");
  assert.equal(matchLocale("zh-TW"), "zh-TW");
  assert.equal(matchLocale("zh-HK"), "zh-TW");
  assert.equal(matchLocale("zh-MO"), "zh-TW");
  assert.equal(matchLocale("zh-Hant-HK"), "zh-TW");
  assert.equal(matchLocale("zh-CN"), "zh-CN");
  assert.equal(matchLocale("zh"), "zh-CN");
  assert.equal(matchLocale("en-US"), "en");
  assert.equal(matchLocale("ja"), "");
  assert.equal(resolveLocale("", ["en-US", "zh-CN"]), "en");
  assert.equal(resolveLocale("zh-TW", ["en"]), "zh-TW");
  assert.equal(resolveLocale("nope", ["fr", "de"]), "zh-CN");
});

test("界面文案按语言替换，简体保留原文", () => {
  assert.equal(translate("en", "登录工作台"), "Sign in");
  assert.equal(translate("zh-TW", "登录工作台"), "登入工作台");
  assert.equal(translate("zh-CN", "登录工作台"), "登录工作台");
  assert.equal(translate("zh-CN", "已获取 {email}。", { email: "a@b.c" }), "已获取 a@b.c。");
  assert.equal(translate("en", "已获取 {email}。", { email: "a@b.c" }), "Picked a@b.c.");
  assert.equal(translate("en", "没有未使用的邮箱"), "No unused addresses");
  assert.equal(translate("en", "还没有iCloud邮箱"), "No iCloud Mail addresses yet");
  assert.equal(translate("zh-TW", "还没有iCloud邮箱"), "還沒有iCloud郵箱");
  assert.equal(translate("zh-CN", "iCloud 邮箱"), "iCloud 邮箱");
  assert.equal(translate("en", "iCloud 邮箱工作台"), "iCloud Mail");
  assert.equal(
    translate("en", "每批数量必须是 1-5 之间的整数"),
    "Batch size must be an integer from 1 to 5"
  );
  assert.equal(
    translate("zh-TW", "每批数量必须是 1-5 之间的整数"),
    "每批數量必須是 1-5 之間的整數"
  );
  assert.equal(
    translate("en", "连接 iCloud 失败：timed out"),
    "Could not connect to iCloud: timed out"
  );
});

function dictionaryKeys(name, source) {
  const start = source.indexOf(`const ${name} = {`);
  const end = source.indexOf("\n};", start);
  const keys = new Set();
  const pattern = /(?:^|\n)  "((?:\\.|[^"\\])*)":/g;
  for (const match of source.slice(start, end).matchAll(pattern)) keys.add(JSON.parse(`"${match[1]}"`));
  return keys;
}

test("页面里的固定文案都有英文和繁体", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const i18n = fs.readFileSync(new URL("../public/i18n.js", import.meta.url), "utf8");
  const keys = new Set();
  const pattern = /\bt\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (const match of app.matchAll(pattern)) keys.add(JSON.parse(`"${match[2]}"`));
  const en = dictionaryKeys("en", i18n);
  const zhTW = dictionaryKeys("zhTW", i18n);
  const missing = [...keys].filter(key => !en.has(key) || !zhTW.has(key));
  assert.deepEqual(missing, []);
  const onlyEn = [...en].filter(key => !zhTW.has(key));
  const onlyTw = [...zhTW].filter(key => !en.has(key));
  assert.deepEqual(onlyEn, []);
  assert.deepEqual(onlyTw, []);
});
