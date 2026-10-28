'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const repo = require('./repo');
const notify = require('./notify');
const ics = require('./ics');
const pdf = require('./pdf');
const jobs = require('./jobs');
const u = require('./util');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.locals.config = config;
app.locals.u = u;

const FLASH = {
  created: 'Veranstaltung angelegt. Den Verwaltungslink haben wir dir auch per Mail geschickt.',
  saved: 'Gespeichert.',
  shift_added: 'Dienst hinzugefügt.',
  shift_deleted: 'Dienst gelöscht.',
  signup_removed: 'Helfer ausgetragen und benachrichtigt.',
  signup_added: 'Helfer eingetragen.',
  message_sent: 'Nachricht veröffentlicht.',
  message_mailed: 'Nachricht veröffentlicht und per Mail verschickt.',
  message_deleted: 'Nachricht gelöscht.',
  posted: 'Danke für deine Nachricht!',
  signed_up: 'Du bist eingetragen! Eine Bestätigung mit Kalendereintrag und PDF ist unterwegs.',
  cancelled: 'Du hast dich abgemeldet. Die Veranstaltungsleitung wurde informiert.',
};

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', // Tokens in URLs sollen nicht nach außen gelangen
    'X-Robots-Tag': 'noindex, nofollow',
  });
  res.locals.flash = FLASH[req.query.msg] || '';
  res.locals.path = req.path;
  next();
});

app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '7d' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Schutz vor Cross-Site-Formularen: Origin muss zur eigenen Seite passen.
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const origin = req.get('origin');
  let foreign = false;
  try { foreign = Boolean(origin) && origin !== 'null' && new URL(origin).host !== req.get('host'); } catch { foreign = true; }
  if (foreign) {
    return res.status(403).render('error', { title: 'Nicht erlaubt', message: 'Ungültige Anfrage-Herkunft.' });
  }
  next();
});

// Einfaches Rate-Limit für Formularaktionen.
const hits = new Map();
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const now = Date.now();
  const key = req.ip;
  const list = (hits.get(key) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(key, list);
  if (list.length > 40) return res.status(429).render('error', { title: 'Zu viele Anfragen', message: 'Bitte warte einen Moment und versuche es erneut.' });
  next();
});
setInterval(() => hits.clear(), 10 * 60_000).unref();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const notFound = (res) => res.status(404).render('error', { title: 'Nicht gefunden', message: 'Dieser Link ist ungültig oder die Veranstaltung wurde bereits gelöscht.' });
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function readEvent(body) {
  const e = {
    title: u.clean(body.title, 120),
    organization: u.clean(body.organization, 120),
    description: u.clean(body.description, 4000),
    location: u.clean(body.location, 200),
    event_date: u.clean(body.event_date, 10),
    admin_name: u.clean(body.admin_name, 100),
    admin_email: u.clean(body.admin_email, 200),
    admin_phone: u.clean(body.admin_phone, 50),
  };
  const errors = [];
  if (!e.title) errors.push('Bitte einen Titel angeben.');
  if (!u.isLocalDate(e.event_date)) errors.push('Bitte ein gültiges Datum angeben.');
  if (!e.admin_name) errors.push('Bitte deinen Namen angeben.');
  if (!u.isEmail(e.admin_email)) errors.push('Bitte eine gültige E-Mail-Adresse angeben.');
  return { e, errors };
}

function readShift(body) {
  const s = {
    title: u.clean(body.title, 120),
    description: u.clean(body.description, 1000),
    starts_at: u.clean(body.starts_at, 16),
    ends_at: u.clean(body.ends_at, 16),
    capacity: Math.min(500, Math.max(1, parseInt(body.capacity, 10) || 1)),
  };
  const errors = [];
  if (!s.title) errors.push('Bitte eine Bezeichnung für den Dienst angeben.');
  if (!u.isLocalDateTime(s.starts_at) || !u.isLocalDateTime(s.ends_at)) errors.push('Bitte Beginn und Ende angeben.');
  else if (s.ends_at <= s.starts_at) errors.push('Das Ende muss nach dem Beginn liegen.');
  return { s, errors };
}

function readPerson(body) {
  const g = {
    name: u.clean(body.name, 100),
    email: u.clean(body.email, 200),
    phone: u.clean(body.phone, 50),
    note: u.clean(body.note, 500),
  };
  const errors = [];
  if (g.name.length < 2) errors.push('Bitte deinen Namen angeben.');
  if (!u.isEmail(g.email)) errors.push('Bitte eine gültige E-Mail-Adresse angeben.');
  return { g, errors };
}

// ---------- Startseite / Veranstaltung anlegen ----------

app.get('/', (req, res) => res.render('home', { values: {}, errors: [] }));

app.post('/events', wrap(async (req, res) => {
  const { e, errors } = readEvent(req.body);
  if (config.createPassword && !safeEqual(req.body.create_password || '', config.createPassword)) {
    errors.push('Das Vereinspasswort ist nicht korrekt.');
  }
  if (!req.body.privacy) errors.push('Bitte bestätige den Datenschutzhinweis.');
  if (errors.length) return res.status(400).render('home', { values: req.body, errors });
  const event = repo.createEvent({ ...e, public_token: u.token(9), admin_token: u.token(24) });
  await notify.eventCreated(event);
  res.redirect(303, `/admin/${event.admin_token}?msg=created`);
}));

// ---------- Öffentliche Veranstaltungsseite ----------

function loadPublic(req, res, next) {
  const event = repo.eventByPublic.get(req.params.pt);
  if (!event) return notFound(res);
  req.event = event;
  next();
}

function renderEvent(res, event, extra = {}) {
  res.render('event', {
    event,
    shifts: repo.shiftsWithSignups(event.id),
    messages: repo.messagesByEvent.all(event.id),
    errors: [], values: {}, openShift: null, ...extra,
  });
}

app.get('/e/:pt', loadPublic, (req, res) => renderEvent(res, req.event));

app.post('/e/:pt/shifts/:sid/signup', loadPublic, wrap(async (req, res) => {
  const event = req.event;
  const shift = repo.shiftById.get(Number(req.params.sid));
  if (!shift || shift.event_id !== event.id) return notFound(res);
  if (req.body.website) return res.redirect(303, `/e/${event.public_token}`); // Honeypot
  const { g, errors } = readPerson(req.body);
  if (!req.body.privacy) errors.push('Bitte stimme der Verarbeitung deiner Kontaktdaten zu.');
  if (u.toDate(shift.ends_at) < new Date()) errors.push('Dieser Dienst liegt bereits in der Vergangenheit.');
  let signup;
  if (!errors.length) {
    try {
      signup = repo.createSignup(shift.id, { ...g, token: u.token(18) });
    } catch (err) {
      if (!err.userFacing) throw err;
      errors.push(err.message);
    }
  }
  if (errors.length) return renderEvent(res.status(400), event, { errors, values: req.body, openShift: shift.id });
  await notify.signupCreated(event, shift, signup);
  res.redirect(303, `/s/${signup.token}?msg=signed_up`);
}));

app.post('/e/:pt/messages', loadPublic, (req, res) => {
  const event = req.event;
  if (req.body.website) return res.redirect(303, `/e/${event.public_token}#pinnwand`);
  const author = u.clean(req.body.author, 60);
  const body = u.clean(req.body.body, 2000);
  if (!author || !body) {
    return renderEvent(res.status(400), event, { errors: ['Bitte Name und Nachricht angeben.'], values: req.body });
  }
  repo.addMessage(event.id, author, body, false);
  res.redirect(303, `/e/${event.public_token}?msg=posted#pinnwand`);
});

// ---------- Eigene Anmeldung verwalten ----------

function loadSignup(req, res, next) {
  const signup = repo.signupByToken.get(req.params.token);
  if (!signup) return notFound(res);
  req.signup = signup;
  req.shift = repo.shiftById.get(signup.shift_id);
  req.event = repo.eventById.get(req.shift.event_id);
  next();
}

app.get('/s/:token', loadSignup, (req, res) => {
  res.render('signup', { event: req.event, shift: req.shift, signup: req.signup });
});

app.get('/s/:token/dienst.ics', loadSignup, (req, res) => {
  res.type('text/calendar; charset=utf-8')
    .attachment('dienst.ics')
    .send(ics.buildCalendar([ics.signupItem(req.event, req.shift, req.signup, { cancelled: req.signup.status !== 'active' })]));
});

app.get('/s/:token/dienstbestaetigung.pdf', loadSignup, wrap(async (req, res) => {
  res.type('application/pdf').attachment('dienstbestaetigung.pdf')
    .send(await pdf.signupConfirmation(req.event, req.shift, req.signup));
}));

app.post('/s/:token/cancel', loadSignup, wrap(async (req, res) => {
  const { event, shift, signup } = req;
  if (signup.status === 'active') {
    repo.cancelSignup(signup.id, u.clean(req.body.reason, 500));
    const updated = repo.signupByToken.get(signup.token);
    const free = shift.capacity - repo.activeCount.get(shift.id).n;
    await notify.signupCancelled(event, shift, updated, free);
  }
  res.redirect(303, `/s/${signup.token}?msg=cancelled`);
}));

// ---------- Verwaltung ----------

function loadAdmin(req, res, next) {
  const event = repo.eventByAdmin.get(req.params.at);
  if (!event) return notFound(res);
  req.event = event;
  next();
}

function renderAdmin(res, event, extra = {}) {
  const shifts = repo.shiftsWithSignups(event.id);
  res.render('admin', {
    event, shifts,
    messages: repo.messagesByEvent.all(event.id),
    publicUrl: notify.eventUrl(event),
    adminUrl: notify.adminUrl(event),
    stats: {
      shifts: shifts.length,
      needed: shifts.reduce((n, s) => n + s.capacity, 0),
      filled: shifts.reduce((n, s) => n + s.active.length, 0),
      cancelled: shifts.reduce((n, s) => n + s.signups.filter((g) => g.status === 'cancelled').length, 0),
    },
    errors: [], values: {}, ...extra,
  });
}

app.get('/admin/:at', loadAdmin, (req, res) => renderAdmin(res, req.event));

app.post('/admin/:at/event', loadAdmin, (req, res) => {
  const { e, errors } = readEvent(req.body);
  if (errors.length) return renderAdmin(res.status(400), req.event, { errors });
  repo.updateEvent(req.event.id, e);
  res.redirect(303, `/admin/${req.event.admin_token}?msg=saved`);
});

app.post('/admin/:at/shifts', loadAdmin, (req, res) => {
  const { s, errors } = readShift(req.body);
  if (errors.length) return renderAdmin(res.status(400), req.event, { errors, values: req.body });
  // Optional: mehrere aufeinanderfolgende Schichten gleicher Länge anlegen.
  const repeat = Math.min(24, Math.max(1, parseInt(req.body.repeat, 10) || 1));
  const duration = u.toDate(s.ends_at) - u.toDate(s.starts_at);
  const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  let start = u.toDate(s.starts_at);
  for (let i = 0; i < repeat; i++) {
    const end = new Date(start.getTime() + duration);
    repo.createShift(req.event.id, { ...s, starts_at: local(start), ends_at: local(end) });
    start = end;
  }
  res.redirect(303, `/admin/${req.event.admin_token}?msg=shift_added#dienste`);
});

function adminShift(req, res) {
  const shift = repo.shiftById.get(Number(req.params.sid));
  if (!shift || shift.event_id !== req.event.id) { notFound(res); return null; }
  return shift;
}

app.post('/admin/:at/shifts/:sid', loadAdmin, (req, res) => {
  const shift = adminShift(req, res); if (!shift) return;
  const { s, errors } = readShift(req.body);
  if (errors.length) return renderAdmin(res.status(400), req.event, { errors });
  repo.updateShift(shift.id, s);
  res.redirect(303, `/admin/${req.event.admin_token}?msg=saved#shift-${shift.id}`);
});

app.post('/admin/:at/shifts/:sid/delete', loadAdmin, (req, res) => {
  const shift = adminShift(req, res); if (!shift) return;
  repo.q('DELETE FROM shifts WHERE id = ?').run(shift.id);
  res.redirect(303, `/admin/${req.event.admin_token}?msg=shift_deleted#dienste`);
});

app.post('/admin/:at/shifts/:sid/signups', loadAdmin, wrap(async (req, res) => {
  const shift = adminShift(req, res); if (!shift) return;
  const { g, errors } = readPerson(req.body);
  let signup;
  if (!errors.length) {
    try {
      signup = repo.createSignup(shift.id, { ...g, token: u.token(18) });
    } catch (err) {
      if (!err.userFacing) throw err;
      errors.push(err.message);
    }
  }
  if (errors.length) return renderAdmin(res.status(400), req.event, { errors });
  if (req.body.notify) await notify.signupCreated(req.event, shift, signup);
  res.redirect(303, `/admin/${req.event.admin_token}?msg=signup_added#shift-${shift.id}`);
}));

app.post('/admin/:at/signups/:gid/delete', loadAdmin, wrap(async (req, res) => {
  const signup = repo.q('SELECT * FROM signups WHERE id = ?').get(Number(req.params.gid));
  const shift = signup && repo.shiftById.get(signup.shift_id);
  if (!shift || shift.event_id !== req.event.id) return notFound(res);
  repo.q('DELETE FROM signups WHERE id = ?').run(signup.id);
  if (signup.status === 'active') await notify.adminRemovedSignup(req.event, shift, signup);
  res.redirect(303, `/admin/${req.event.admin_token}?msg=signup_removed#shift-${shift.id}`);
}));

app.post('/admin/:at/messages', loadAdmin, wrap(async (req, res) => {
  const event = req.event;
  const subject = u.clean(req.body.subject, 120) || 'Neuigkeiten';
  const body = u.clean(req.body.body, 4000);
  if (!body) return renderAdmin(res.status(400), event, { errors: ['Bitte eine Nachricht eingeben.'] });
  repo.addMessage(event.id, event.admin_name, `${subject}\n\n${body}`, true);
  let mailed = false;
  if (req.body.mail) {
    const seen = new Set();
    const recipients = repo.shiftsWithSignups(event.id).flatMap((s) => s.active)
      .filter((g) => !seen.has(g.email.toLowerCase()) && seen.add(g.email.toLowerCase()));
    notify.broadcast(event, recipients, subject, body); // läuft im Hintergrund weiter
    mailed = true;
  }
  res.redirect(303, `/admin/${event.admin_token}?msg=${mailed ? 'message_mailed' : 'message_sent'}#pinnwand`);
}));

app.post('/admin/:at/messages/:mid/delete', loadAdmin, (req, res) => {
  repo.q('DELETE FROM messages WHERE id = ? AND event_id = ?').run(Number(req.params.mid), req.event.id);
  res.redirect(303, `/admin/${req.event.admin_token}?msg=message_deleted#pinnwand`);
});

app.get('/admin/:at/dienstplan.pdf', loadAdmin, wrap(async (req, res) => {
  const withContacts = req.query.contacts !== '0';
  res.type('application/pdf').attachment(withContacts ? 'dienstplan.pdf' : 'dienstplan-aushang.pdf')
    .send(await pdf.rosterPdf(req.event, repo.shiftsWithSignups(req.event.id), { withContacts }));
}));

app.get('/admin/:at/helfer.csv', loadAdmin, (req, res) => {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Dienst', 'Beginn', 'Ende', 'Name', 'E-Mail', 'Telefon', 'Bemerkung', 'Status', 'Absagegrund'].map(cell).join(';')];
  for (const s of repo.shiftsWithSignups(req.event.id)) {
    for (const g of s.signups) {
      lines.push([s.title, s.starts_at.replace('T', ' '), s.ends_at.replace('T', ' '), g.name, g.email, g.phone, g.note,
        g.status === 'active' ? 'eingetragen' : 'abgesagt', g.cancel_reason].map(cell).join(';'));
    }
  }
  res.type('text/csv; charset=utf-8').attachment('helfer.csv').send(`﻿${lines.join('\r\n')}\r\n`);
});

app.get('/admin/:at/dienstplan.ics', loadAdmin, (req, res) => {
  const items = repo.shiftsWithSignups(req.event.id).map((s) => ({
    uid: `shift-${s.id}-${req.event.public_token}`,
    start: s.starts_at, end: s.ends_at,
    title: `${s.title} (${s.active.length}/${s.capacity})`,
    description: s.active.map((g) => g.name).join('\n'),
    location: req.event.location,
  }));
  res.type('text/calendar; charset=utf-8').attachment('dienstplan.ics')
    .send(ics.buildCalendar(items, { name: req.event.title }));
});

app.post('/admin/:at/delete', loadAdmin, (req, res) => {
  if (req.body.confirm !== req.event.title) {
    return renderAdmin(res.status(400), req.event, { errors: ['Zum Löschen bitte den Titel der Veranstaltung exakt eingeben.'] });
  }
  repo.q('DELETE FROM events WHERE id = ?').run(req.event.id);
  res.render('error', { title: 'Gelöscht', message: 'Die Veranstaltung und alle Anmeldedaten wurden gelöscht.' });
});

app.get('/impressum', (req, res) => res.render('impressum', { title: 'Impressum' }));
app.get('/datenschutz', (req, res) => res.render('datenschutz', { title: 'Datenschutz' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res) => notFound(res));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Fehler', message: 'Da ist etwas schiefgelaufen. Bitte versuche es erneut.' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`${config.appName} läuft auf Port ${config.port} (${config.baseUrl})`);
    if (!config.smtp.host && !config.mailWebhookUrl) console.log('Hinweis: weder SMTP_HOST noch MAIL_WEBHOOK_URL gesetzt – Mails werden in data/outbox gespeichert.');
  });
  jobs.start();
}

module.exports = app;
