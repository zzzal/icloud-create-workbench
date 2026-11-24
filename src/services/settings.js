import { httpError } from "./rules.js";

export const SETTING_FIELDS = {
  batchLimit: { min: 1, max: 5, label: "每批数量" },
  cooldownMinutes: { min: 1, max: 24 * 60, label: "成功后冷却" },
  targetDefault: { min: 1, max: 700, label: "默认生成数量" },
  accountLimit: { min: 1, max: 700, label: "每个账号最多邮箱" },
  retryMinutes: { min: 1, max: 24 * 60, label: "失败后重试" }
};

function parseStored(raw, rule) {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < rule.min || value > rule.max) return null;
  return value;
}

export function createSettingsService({ db, config }) {
  const upsert = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

  function apply() {
    const stored = new Map(db.prepare("SELECT key, value FROM settings").all().map(row => [row.key, row.value]));
    for (const [key, rule] of Object.entries(SETTING_FIELDS)) {
      const value = parseStored(stored.get(key), rule);
      if (value !== null) config[key] = value;
    }
  }

  function present() {
    return {
      username: config.adminUsername,
      batchLimit: config.batchLimit,
      cooldownMinutes: config.cooldownMinutes,
      targetDefault: config.targetDefault,
      accountLimit: config.accountLimit ?? 700,
      retryMinutes: config.retryMinutes
    };
  }

  function save(input = {}) {
    const next = {};
    for (const [key, rule] of Object.entries(SETTING_FIELDS)) {
      const value = Number(input[key]);
      if (!Number.isInteger(value) || value < rule.min || value > rule.max) {
        throw httpError(400, `${rule.label}必须是 ${rule.min}-${rule.max} 之间的整数`);
      }
      next[key] = value;
    }
    db.exec("BEGIN");
    try {
      for (const [key, value] of Object.entries(next)) upsert.run(key, String(value));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    Object.assign(config, next);
    return present();
  }

  apply();
  return { get: present, save };
}
