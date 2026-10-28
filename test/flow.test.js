'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vereinsdienste-'));
process.env.DATA_DIR = dataDir;
process.env.BASE_URL = 'http://localhost';
process.env.REMINDER_HOURS = '48,24';

const app = require('../src/server');
const jobs = require('../src/jobs');
const repo = require('../src/repo');

let server; let base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const post = (url, data) => fetch(base + url, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data),
});
const outbox = () => {
  const dir = path.join(dataDir, 'outbox');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8')) : [];
};
const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

test('kompletter Ablauf: anlegen, eintragen, erinnern, absagen', async () => {
  const day = new Date(Date.now() + 30 * 3600 * 1000);
  let res = await post('/events', {
    title: 'Hoffest', organization: 'Förderverein Klosterhof', event_date: local(day).slice(0, 10),
    location: 'Klosterhof 1', admin_name: 'Alex Orga', admin_email: 'orga@example.org', privacy: '1',
  });
  assert.strictEqual(res.status, 303);
  const adminPath = res.headers.get('location').split('?')[0];
  const event = repo.q('SELECT * FROM events').get();
  assert.match(outbox()[0], /Veranstaltung angelegt/);

  const start = new Date(Date.now() + 30 * 3600 * 1000);
  const end = new Date(start.getTime() + 2 * 3600 * 1000);
  res = await post(`${adminPath}/shifts`, { title: 'Kuchenstand', starts_at: local(start), ends_at: local(end), capacity: '1', repeat: '2' });
  assert.strictEqual(res.status, 303);
  const shifts = repo.shiftsByEvent.all(event.id);
  assert.strictEqual(shifts.length, 2);
  assert.strictEqual(shifts[1].starts_at, shifts[0].ends_at);

  const page = await (await fetch(`${base}/e/${event.public_token}`)).text();
  assert.match(page, /Kuchenstand/);

  res = await post(`/e/${event.public_token}/shifts/${shifts[0].id}/signup`, { name: 'Maria Muster', email: 'maria@example.org', privacy: '1' });
  assert.strictEqual(res.status, 303);
  const manage = res.headers.get('location').split('?')[0];
  const confirmation = outbox().at(-1);
  assert.match(confirmation, /dienst\.ics/);
  assert.match(confirmation, /dienstbestaetigung\.pdf/);

  // Voll besetzt
  res = await post(`/e/${event.public_token}/shifts/${shifts[0].id}/signup`, { name: 'Max Muster', email: 'max@example.org', privacy: '1' });
  assert.strictEqual(res.status, 400);
  assert.match(await res.text(), /voll besetzt/);

  // Öffentliche Seite zeigt nur Vorname + Initial
  const page2 = await (await fetch(`${base}/e/${event.public_token}`)).text();
  assert.match(page2, /Maria M\./);
  assert.doesNotMatch(page2, /maria@example\.org/);

  assert.strictEqual((await fetch(`${base}${manage}/dienst.ics`)).headers.get('content-type').startsWith('text/calendar'), true);
  assert.strictEqual((await fetch(`${base}${manage}/dienstbestaetigung.pdf`)).status, 200);
  assert.strictEqual((await fetch(`${base}${adminPath}/dienstplan.pdf`)).status, 200);

  // Erinnerung: Anmeldung künstlich älter machen, dann Job ausführen
  repo.q("UPDATE signups SET created_at = datetime('now', '-3 days')").run();
  assert.strictEqual(await jobs.sendReminders(), 1);
  assert.match(outbox().at(-1), /Erinnerung/);
  assert.strictEqual(await jobs.sendReminders(), 0, 'keine doppelte Erinnerung');

  // Absage -> Mail an Veranstaltungsleitung
  res = await post(`${manage}/cancel`, { reason: 'krank' });
  assert.strictEqual(res.status, 303);
  const mails = outbox().join('\n');
  assert.match(mails, /To: orga@example\.org[\s\S]*Ausfall/);
  assert.match(mails, /method=CANCEL/);
  assert.strictEqual(repo.activeCount.get(shifts[0].id).n, 0);
});

test('ungültige Links liefern 404', async () => {
  assert.strictEqual((await fetch(`${base}/admin/falsch`)).status, 404);
  assert.strictEqual((await fetch(`${base}/s/falsch`)).status, 404);
});
