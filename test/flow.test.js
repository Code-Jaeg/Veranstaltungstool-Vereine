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
process.env.REPORT_DAYS_BEFORE = '3';

const app = require('../src/server');
const jobs = require('../src/jobs');
const repo = require('../src/repo');
const u = require('../src/util');

let server; let base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const post = (url, data) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) [].concat(v).forEach((x) => body.append(k, x));
  return fetch(base + url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
};
const get = (url) => fetch(base + url, { redirect: 'manual' });
const outboxDir = path.join(dataDir, 'outbox');
const outbox = () => (fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir).sort().map((f) => fs.readFileSync(path.join(outboxDir, f), 'utf8')) : []);
const clearOutbox = () => fs.rmSync(outboxDir, { recursive: true, force: true });
const mailsTo = (addr) => outbox().filter((m) => m.includes(`To: ${addr}`));
/** Betreff einer .eml-Datei lesbar machen (gefaltete Zeilen, RFC-2047-Kodierung). */
const decodeMail = (m) => {
  const raw = (/^Subject: (.*(?:\r?\n[ \t].*)*)/m.exec(m)?.[1] ?? '').replace(/\?=\s+=\?/g, '?==?').replace(/\r?\n[ \t]/g, ' ');
  return raw.replace(/=\?UTF-8\?Q\?(.*?)\?=/gi, (_, s) => {
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=') { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(s[i] === '_' ? 32 : s.charCodeAt(i));
    }
    return Buffer.from(bytes).toString('utf8');
  });
};
const local = (d) => u.toLocal(d);
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000);

let event; let adminPath; let shifts; let item;

test('Veranstaltung mit Diensten, Mindestbesetzung und Mitbringposten anlegen', async () => {
  const day = inHours(30);
  let res = await post('/events', {
    title: 'Hoffest', organization: 'Förderverein', event_date: local(day).slice(0, 10),
    location: 'Klosterhof 2', admin_name: 'Alex Orga', admin_email: 'orga@example.org', privacy: '1',
  });
  assert.strictEqual(res.status, 303);
  adminPath = res.headers.get('location').split('?')[0];
  event = repo.q('SELECT * FROM events').get();

  const start = inHours(30); const end = inHours(32);
  res = await post(`${adminPath}/shifts`, { kind: 'shift', title: 'Kuchenstand', starts_at: local(start), ends_at: local(end), capacity: '1', repeat: '2' });
  assert.strictEqual(res.status, 303);
  res = await post(`${adminPath}/shifts`, { kind: 'shift', title: 'Aufbau', starts_at: local(inHours(28)), ends_at: local(inHours(30)), capacity: '4', min_capacity: '2', requirement: 'kräftige Hände' });
  res = await post(`${adminPath}/shifts`, { kind: 'item', title: 'Kuchen', starts_at: local(inHours(29)), capacity: '5' });
  assert.strictEqual(res.status, 303);
  shifts = repo.shiftsWithSignups(event.id);
  assert.deepStrictEqual(shifts.map((s) => s.title), ['Aufbau', 'Kuchenstand', 'Kuchenstand', 'Kuchen']);
  item = shifts.find((s) => s.kind === 'item');
  assert.strictEqual(item.ends_at > item.starts_at, true, 'Mitbringposten bekommt ein Ende für den Kalender');
  assert.strictEqual(shifts[0].need, 2);
  assert.strictEqual(shifts[0].critical, true);
});

test('Mehrere Dienste und Mitbringposten in einem Schritt', async () => {
  clearOutbox();
  const [aufbau, kuchen1] = shifts;
  const res = await post(`/e/${event.public_token}/anmelden`, {
    name: 'Maria Muster', email: 'Maria@Example.org', privacy: '1',
    shift: [String(aufbau.id), String(kuchen1.id)], [`qty_${item.id}`]: '2', [`note_${item.id}`]: 'Apfelkuchen',
  });
  assert.strictEqual(res.status, 303);
  const helperPath = res.headers.get('location').split('?')[0];
  assert.match(helperPath, /^\/h\//);
  const helper = repo.q('SELECT * FROM helpers').get();
  assert.strictEqual(helper.email, 'maria@example.org');
  assert.strictEqual(repo.signupsByHelper.all(helper.id).length, 3);
  assert.strictEqual(repo.filled.get(item.id).n, 2);

  const mails = mailsTo('maria@example.org');
  assert.strictEqual(mails.length, 1, 'eine einzige Bestätigung für alle Dienste');
  assert.match(mails[0], /dienste\.ics/);
  assert.match(mails[0], /dienstbestaetigung\.pdf/);

  const page = await (await get(helperPath)).text();
  assert.match(page, /Kalender abonnieren/);
  assert.match(page, /2× Kuchen mitbringen/);

  const feed = await (await get(`${helperPath}/kalender.ics`)).text();
  assert.strictEqual((feed.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(feed, /REFRESH-INTERVAL/);
  assert.match(feed, /Mitbringen: 2× Kuchen/);
  assert.strictEqual((await get(`${helperPath}/dienstbestaetigung.pdf`)).status, 200);

  const pub = await (await get(`/e/${event.public_token}`)).text();
  assert.match(pub, /Maria M\./);
  assert.doesNotMatch(pub, /maria@example\.org/);
});

test('Volle Dienste: Warteliste, Nachrücken nach Absage, Meldung an Leitung', async () => {
  clearOutbox();
  const kuchen1 = shifts[1];
  let res = await post(`/e/${event.public_token}/anmelden`, { name: 'Max Muster', email: 'max@example.org', privacy: '1', wait: String(kuchen1.id) });
  assert.strictEqual(res.status, 303);
  const maxSignup = repo.q("SELECT * FROM signups WHERE email = 'max@example.org'").get();
  assert.strictEqual(maxSignup.status, 'waiting');
  assert.match(mailsTo('max@example.org')[0], /Warteliste/);

  // Maria sagt ab → Max rückt nach, Leitung bekommt Ausfall-Meldung mit Hinweis auf Nachrücker
  const maria = repo.q("SELECT * FROM helpers WHERE email = 'maria@example.org'").get();
  const mariaSignup = repo.q('SELECT * FROM signups WHERE helper_id = ? AND shift_id = ?').get(maria.id, kuchen1.id);
  res = await post(`/h/${maria.token}/signups/${mariaSignup.id}/cancel`, { reason: 'krank' });
  assert.strictEqual(res.status, 303);
  assert.strictEqual(repo.signupById.get(maxSignup.id).status, 'active');
  assert.ok(mailsTo('max@example.org').some((m) => decodeMail(m).includes('nachgerückt')));
  const orga = mailsTo('orga@example.org').map(decodeMail).join('\n');
  assert.match(orga, /Ausfall/);
  assert.ok(outbox().join('\n').includes('method=CANCEL'));
});

test('Mitorganisatoren: eigener Zugang, Verlauf, keine Löschrechte', async () => {
  clearOutbox();
  let res = await post(`${adminPath}/organizers`, { name: 'Sandro Co', email: 'sandro@example.org' });
  assert.strictEqual(res.status, 303);
  const org = repo.organizersByEvent.all(event.id)[0];
  assert.ok(mailsTo('sandro@example.org')[0].includes(`/admin/${org.token}`));
  const page = await (await get(`/admin/${org.token}`)).text();
  assert.match(page, /angemeldet als Sandro Co/);
  res = await post(`/admin/${org.token}/delete`, { confirm: event.title });
  assert.strictEqual(res.status, 403);
  res = await post(`/admin/${org.token}/messages`, { subject: 'Info', body: 'Treffpunkt Hof' });
  assert.strictEqual(res.status, 303);
  assert.ok(repo.activityByEvent.all(event.id).some((a) => a.actor === 'Sandro Co'));
});

test('Ersatz suchen schreibt nur Helfer an, die beim Dienst noch nicht dabei sind', async () => {
  clearOutbox();
  const kuchen2 = shifts[2];
  let res = await post(`${adminPath}/shifts/${kuchen2.id}/call`, {});
  assert.strictEqual(res.status, 303);
  await new Promise((r) => setTimeout(r, 300)); // Versand läuft im Hintergrund
  const decoded = outbox().map(decodeMail);
  assert.ok(decoded.some((s) => s.includes('Wer kann einspringen')));
  assert.strictEqual(mailsTo('maria@example.org').length + mailsTo('max@example.org').length, 2);
  res = await post(`${adminPath}/shifts/${kuchen2.id}/call`, {});
  assert.strictEqual(res.status, 429, 'höchstens eine Rundmail pro Stunde und Dienst');
});

test('Kurzbericht, Erinnerungen, Plakat und Dienstplan', async () => {
  clearOutbox();
  assert.strictEqual(await jobs.sendPreEventReports(), 1);
  assert.strictEqual(await jobs.sendPreEventReports(), 0, 'nur einmal');
  assert.ok(mailsTo('orga@example.org').some((m) => decodeMail(m).includes('unterbesetzt')));
  assert.ok(mailsTo('sandro@example.org').length >= 1, 'Mitorganisatoren bekommen den Bericht auch');

  repo.q("UPDATE signups SET created_at = datetime('now', '-3 days')").run();
  assert.ok(await jobs.sendReminders() >= 1);

  for (const p of ['plakat.pdf', 'dienstplan.pdf', 'dienstplan.pdf?contacts=0', 'qr.png', 'helfer.csv']) {
    assert.strictEqual((await get(`${adminPath}/${p}`)).status, 200, p);
  }
  const csv = await (await get(`${adminPath}/helfer.csv`)).text();
  assert.match(csv, /Mitbringen/);
  assert.match(await (await get(adminPath)).text(), /data:image\/png;base64/);
});

test('Veranstaltung kopieren verschiebt alle Dienste ums gleiche Datum', async () => {
  const next = u.addDays(event.event_date, 364);
  const res = await post(`${adminPath}/copy`, { title: 'Hoffest 2', event_date: next });
  assert.strictEqual(res.status, 303);
  const copy = repo.q("SELECT * FROM events WHERE title = 'Hoffest 2'").get();
  const copied = repo.shiftsByEvent.all(copy.id);
  const original = repo.shiftsByEvent.all(event.id);
  assert.strictEqual(copied.length, original.length);
  assert.deepStrictEqual(copied.map((s) => s.starts_at.slice(11)), original.map((s) => s.starts_at.slice(11)), 'Uhrzeiten bleiben gleich');
  assert.strictEqual(copied[0].starts_at.slice(0, 10), u.addDays(original[0].starts_at, 364).slice(0, 10));
  assert.strictEqual(copied.find((s) => s.kind === 'item').capacity, 5);
  assert.strictEqual(repo.q('SELECT COUNT(*) AS n FROM signups g JOIN shifts s ON s.id = g.shift_id WHERE s.event_id = ?').get(copy.id).n, 0);
});

test('Ungültige Links liefern 404', async () => {
  assert.strictEqual((await get('/admin/falsch')).status, 404);
  assert.strictEqual((await get('/h/falsch')).status, 404);
  assert.strictEqual((await get('/s/falsch')).status, 404);
});
