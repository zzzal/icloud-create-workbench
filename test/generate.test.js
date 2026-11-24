import assert from "node:assert/strict";
import test from "node:test";
import { generateSequential, humanPauseMs } from "../src/icloud/generate.js";
import { defaultLabelPrefix, normalizeLabelPrefix } from "../src/services/rules.js";

test("前一次保留失败后不再继续", async () => {
  const labels = ["a-0001", "a-0002", "a-0003"];
  const result = await generateSequential({
    async generateEmail() {
      return { success: true, result: { hme: "one@icloud.com" } };
    },
    async reserveEmail() {
      return { success: false, error: { errorMessage: "上限" } };
    }
  }, labels, "note");
  assert.equal(result.generated.length, 0);
  assert.equal(result.errors[0].error, "上限");
  assert.equal(result.errors[1].error, "前序操作失败，未继续执行");
  assert.equal(result.errors.length, 3);
});

test("同一批的两次申请之间才停顿", async () => {
  let pauses = 0;
  const result = await generateSequential({
    async generateEmail() {
      return { success: true, result: { hme: `box-${pauses}@icloud.com` } };
    },
    async reserveEmail(_email, label) {
      return { success: true, result: { hme: label } };
    }
  }, ["a-0001", "a-0002", "a-0003"], "note", {
    async pause() {
      pauses += 1;
    }
  });
  assert.equal(result.generated.length, 3);
  assert.equal(pauses, 2);
});

test("仿真停顿落在 1.2 到 8 秒", () => {
  const samples = Array.from({ length: 200 }, () => humanPauseMs(Math.random));
  assert.ok(samples.every(ms => ms >= 1200 && ms <= 8000));
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[100];
  assert.ok(median > 2000 && median < 5000, `中位数 ${median}`);
});

test("标签前缀规则", () => {
  assert.equal(defaultLabelPrefix("Ada.Lovelace+mail@icloud.com"), "Ada_Lovelace_mail");
  assert.equal(normalizeLabelPrefix("team_1"), "team_1");
  assert.throws(() => normalizeLabelPrefix("有空格"), /标签前缀/);
});
