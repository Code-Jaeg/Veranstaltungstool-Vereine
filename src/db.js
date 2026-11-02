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

// Schema-Änderungen nach dem ersten Release. Jede Migration läuft genau einmal (PRAGMA user_version).
const migrations = [
  // 1: Helfer-Konten, Warteliste, Mitbringposten, Mindestbesetzung, Mitorganisatoren, Verlauf
  () => db.exec(`
    CREATE TABLE helpers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      token       TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL COLLATE NOCASE,
      phone       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (event_id, email)
    );
    CREATE TABLE organizers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      token       TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE activity (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      actor       TEXT NOT NULL,
      text        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_helpers_event ON helpers(event_id);
    CREATE INDEX idx_organizers_event ON organizers(event_id);
    CREATE INDEX idx_activity_event ON activity(event_id);

    ALTER TABLE shifts ADD COLUMN kind TEXT NOT NULL DEFAULT 'shift';       -- shift | item (Mitbringposten)
    ALTER TABLE shifts ADD COLUMN min_capacity INTEGER NOT NULL DEFAULT 0;  -- 0 = alle Plätze nötig
    ALTER TABLE shifts ADD COLUMN requirement TEXT;                         -- z. B. „1 Person mit Kassenerfahrung“
    ALTER TABLE shifts ADD COLUMN last_call_at TEXT;                        -- letzte „Ersatz gesucht“-Rundmail
    ALTER TABLE signups ADD COLUMN helper_id INTEGER REFERENCES helpers(id) ON DELETE CASCADE;
    ALTER TABLE signups ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;     -- Menge bei Mitbringposten
    ALTER TABLE events ADD COLUMN report_sent_at TEXT;                      -- Kurzbericht vor der Veranstaltung

    -- Bestehende Anmeldungen bekommen ein Helfer-Konto je Veranstaltung und E-Mail-Adresse.
    INSERT OR IGNORE INTO helpers (event_id, token, name, email, phone)
      SELECT s.event_id, lower(hex(randomblob(16))), g.name, g.email, g.phone
      FROM signups g JOIN shifts s ON s.id = g.shift_id
      ORDER BY g.created_at DESC;
    UPDATE signups SET helper_id = (
      SELECT h.id FROM helpers h JOIN shifts s ON s.event_id = h.event_id
      WHERE s.id = signups.shift_id AND h.email = signups.email COLLATE NOCASE);
  `),
];

const version = db.prepare('PRAGMA user_version').get().user_version;
for (let v = version; v < migrations.length; v++) {
  db.exec('BEGIN');
  try {
    migrations[v]();
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = db;
