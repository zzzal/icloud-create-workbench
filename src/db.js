import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  apple_id TEXT NOT NULL DEFAULT '',
  dsid TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL,
  user_partition TEXT NOT NULL DEFAULT '',
  maildomain_host TEXT NOT NULL DEFAULT '',
  cookie_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  label_prefix TEXT NOT NULL DEFAULT '',
  cooldown_until TEXT,
  imap_password_encrypted TEXT NOT NULL DEFAULT '',
  imap_host TEXT NOT NULL DEFAULT 'imap.mail.me.com',
  imap_last_uid INTEGER NOT NULL DEFAULT 0,
  imap_uid_validity INTEGER NOT NULL DEFAULT 0,
  imap_synced_at TEXT,
  imap_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  email TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'unused',
  platforms TEXT NOT NULL DEFAULT '',
  claimed_at TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  target_total INTEGER NOT NULL,
  batch_size INTEGER NOT NULL,
  label_prefix TEXT NOT NULL,
  status TEXT NOT NULL,
  next_run_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  campaign_id INTEGER REFERENCES campaigns(id),
  requested INTEGER NOT NULL,
  generated INTEGER NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  uid INTEGER NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  sender TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  UNIQUE(account_id, uid)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_addresses_account_state ON addresses(account_id, state);
CREATE INDEX IF NOT EXISTS idx_campaigns_due ON campaigns(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(account_id, recipient);
`;

const ACCOUNT_COLUMNS = [
  ["imap_password_encrypted", "TEXT NOT NULL DEFAULT ''"],
  ["imap_host", "TEXT NOT NULL DEFAULT 'imap.mail.me.com'"],
  ["imap_last_uid", "INTEGER NOT NULL DEFAULT 0"],
  ["imap_uid_validity", "INTEGER NOT NULL DEFAULT 0"],
  ["imap_synced_at", "TEXT"],
  ["imap_error", "TEXT NOT NULL DEFAULT ''"]
];

function existingColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function migrate(db) {
  const columns = existingColumns(db, "accounts");
  for (const [name, definition] of ACCOUNT_COLUMNS) {
    if (!columns.has(name)) db.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${definition}`);
  }
  if (!existingColumns(db, "messages").has("body_html")) {
    db.exec("ALTER TABLE messages ADD COLUMN body_html TEXT NOT NULL DEFAULT ''");
  }
  const addressColumns = existingColumns(db, "addresses");
  if (!addressColumns.has("claimed_at")) {
    db.exec("ALTER TABLE addresses ADD COLUMN claimed_at TEXT NOT NULL DEFAULT ''");
  }
  if (!addressColumns.has("platforms")) {
    db.exec("ALTER TABLE addresses ADD COLUMN platforms TEXT NOT NULL DEFAULT ''");
  }
  db.exec("UPDATE addresses SET state = 'unused' WHERE state = 'trash'");
  db.exec("UPDATE addresses SET state = 'used' WHERE state NOT IN ('unused', 'used', '')");
  if (!existingColumns(db, "batches").has("details")) {
    db.exec("ALTER TABLE batches ADD COLUMN details TEXT NOT NULL DEFAULT ''");
  }
  backfillBatchDetails(db);
}

function backfillBatchDetails(db) {
  const pending = db.prepare("SELECT id FROM batches WHERE details = '' LIMIT 1").get();
  if (!pending) return;
  const accounts = db.prepare("SELECT DISTINCT account_id FROM batches WHERE details = ''").all();
  const addressQuery = db.prepare(`SELECT email, label, created_at FROM addresses
    WHERE account_id = ? AND source = 'generated'
    ORDER BY created_at ASC, id ASC`);
  const batchQuery = db.prepare(`SELECT id, generated, error, created_at FROM batches
    WHERE account_id = ? AND details = ''
    ORDER BY created_at ASC, id ASC`);
  const update = db.prepare("UPDATE batches SET details = ? WHERE id = ? AND details = ''");
  db.exec("BEGIN");
  try {
    for (const account of accounts) {
      const addresses = addressQuery.all(account.account_id);
      let cursor = 0;
      for (const batch of batchQuery.all(account.account_id)) {
        const items = [];
        const need = Number(batch.generated) || 0;
        while (items.length < need && cursor < addresses.length) {
          const address = addresses[cursor];
          if (address.created_at > batch.created_at) break;
          items.push({ email: address.email, label: address.label });
          cursor += 1;
        }
        const failures = String(batch.error || "").split("；").filter(Boolean).map(error => ({ label: "", error }));
        update.run(JSON.stringify({ items, failures }), batch.id);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function nowIso() {
  return new Date().toISOString();
}
