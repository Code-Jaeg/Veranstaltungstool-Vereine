'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'vereinsdienste.sqlite'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    public_token  TEXT NOT NULL UNIQUE,
    admin_token   TEXT NOT NULL UNIQUE,
    title         TEXT NOT NULL,
    organization  TEXT,
    description   TEXT,
    location      TEXT,
    event_date    TEXT NOT NULL,          -- YYYY-MM-DD
    admin_name    TEXT NOT NULL,
    admin_email   TEXT NOT NULL,
    admin_phone   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    starts_at   TEXT NOT NULL,            -- YYYY-MM-DDTHH:MM (Ortszeit)
    ends_at     TEXT NOT NULL,
    capacity    INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS signups (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id      INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    token         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    phone         TEXT,
    note          TEXT,
    status        TEXT NOT NULL DEFAULT 'active',   -- active | cancelled
    cancel_reason TEXT,
    cancelled_at  TEXT,
    reminders_sent TEXT NOT NULL DEFAULT '',        -- z.B. ',48,24,'
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    author      TEXT NOT NULL,
    body        TEXT NOT NULL,
    is_admin    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_shifts_event ON shifts(event_id);
  CREATE INDEX IF NOT EXISTS idx_signups_shift ON signups(shift_id);
  CREATE INDEX IF NOT EXISTS idx_messages_event ON messages(event_id);
`);

module.exports = db;
