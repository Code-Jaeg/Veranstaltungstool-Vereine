'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

test('Bestehende Datenbank der ersten Version wird ohne Datenverlust migriert', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-migration-'));
  const old = new DatabaseSync(path.join(dir, 'vereinsdienste.sqlite'));
  old.exec(fs.readFileSync(path.join(__dirname, 'fixtures', 'schema-v0.sql'), 'utf8'));
  old.exec(`
    INSERT INTO events (id, public_token, admin_token, title, event_date, admin_name, admin_email)
      VALUES (1, 'pub', 'adm', 'Altes Fest', '2026-11-21', 'Andreas', 'a@example.org');
    INSERT INTO shifts (id, event_id, title, starts_at, ends_at, capacity) VALUES
      (1, 1, 'Aufbau', '2026-11-21T08:00', '2026-11-21T10:00', 2),
      (2, 1, 'Abbau',  '2026-11-21T18:00', '2026-11-21T20:00', 2);
    INSERT INTO signups (shift_id, token, name, email, status) VALUES
      (1, 't1', 'Maria Muster', 'maria@example.org', 'active'),
      (2, 't2', 'Maria Muster', 'MARIA@example.org', 'active'),
      (2, 't3', 'Max Muster',   'max@example.org',   'cancelled');
  `);
  old.close();

  // Neues Programm in einem eigenen Prozess starten, damit db.js frisch migriert.
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', `
    const db = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'db.js'))});
    console.log(JSON.stringify({
      version: db.prepare('PRAGMA user_version').get().user_version,
      helpers: db.prepare('SELECT name, email FROM helpers ORDER BY email').all(),
      orphans: db.prepare('SELECT COUNT(*) AS n FROM signups WHERE helper_id IS NULL').get().n,
      signups: db.prepare('SELECT COUNT(*) AS n FROM signups').get().n,
      quantity: db.prepare('SELECT MIN(quantity) AS q FROM signups').get().q,
      kinds: db.prepare('SELECT DISTINCT kind FROM shifts').all().map((r) => r.kind),
    }));
  `], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
  const r = JSON.parse(out.trim().split('\n').pop());

  assert.strictEqual(r.version, 1);
  assert.strictEqual(r.signups, 3, 'keine Anmeldung verloren');
  assert.strictEqual(r.orphans, 0, 'jede Anmeldung hat ein Helfer-Konto');
  assert.strictEqual(r.helpers.length, 2, 'Maria (zwei Schreibweisen) wird zu einem Konto zusammengeführt');
  assert.strictEqual(r.quantity, 1);
  assert.deepStrictEqual(r.kinds, ['shift']);

  // Zweiter Start: Migration läuft nicht erneut.
  execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'db.js'))})`], { env: { ...process.env, DATA_DIR: dir }, stdio: 'ignore' });
  fs.rmSync(dir, { recursive: true, force: true });
});
