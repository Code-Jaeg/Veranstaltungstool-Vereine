'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const QRCode = require('qrcode');
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
  copied: 'Veranstaltung kopiert – alle Dienste sind übernommen. Bitte Zeiten und Plätze prüfen.',
  saved: 'Gespeichert.',
  shift_added: 'Dienst hinzugefügt.',
  shift_deleted: 'Dienst gelöscht.',
  signup_removed: 'Eintrag entfernt und Person benachrichtigt.',
  signup_added: 'Helfer eingetragen.',
  called: 'Rundmail „Ersatz gesucht“ ist unterwegs.',
  organizer_added: 'Mitorganisator eingeladen – der persönliche Link ist per Mail unterwegs.',
  organizer_removed: 'Zugang des Mitorganisators entfernt.',
  message_sent: 'Nachricht veröffentlicht.',
  message_mailed: 'Nachricht veröffentlicht und per Mail verschickt.',
  message_deleted: 'Nachricht gelöscht.',
  posted: 'Danke für deine Nachricht!',
  signed_up: 'Danke! Deine Bestätigung mit Kalendereintrag und PDF ist unterwegs.',
  cancelled: 'Abgesagt. Die Veranstaltungsleitung wurde informiert.',
  left_waitlist: 'Du stehst nicht mehr auf der Warteliste.',
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
/** Formularfelder, die einmal oder mehrfach vorkommen, als Liste von Zahlen. */
const ids = (v) => [].concat(v ?? []).map(Number).filter(Number.isInteger);

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
  const kind = body.kind === 'item' ? 'item' : 'shift';
  const s = {
    kind,
    title: u.clean(body.title, 120),
    description: u.clean(body.description, 1000),
    requirement: u.clean(body.requirement, 200),
    starts_at: u.clean(body.starts_at, 16),
    ends_at: u.clean(body.ends_at, 16),
    capacity: Math.min(500, Math.max(1, parseInt(body.capacity, 10) || 1)),
    min_capacity: Math.min(500, Math.max(0, parseInt(body.min_capacity, 10) || 0)),
  };
  if (s.min_capacity >= s.capacity) s.min_capacity = 0;
  const errors = [];
  if (!s.title) errors.push(kind === 'item' ? 'Bitte angeben, was mitgebracht werden soll.' : 'Bitte eine Bezeichnung für den Dienst angeben.');
  if (kind === 'item') {
    // Mitbringposten haben nur eine Abgabezeit; das Ende dient Kalender und Erinnerung.
    if (!u.isLocalDateTime(s.starts_at)) errors.push('Bitte angeben, bis wann es mitgebracht werden soll.');
    else s.ends_at = u.toLocal(new Date(u.toDate(s.starts_at).getTime() + 30 * 60_000));
  } else if (!u.isLocalDateTime(s.starts_at) || !u.isLocalDateTime(s.ends_at)) {
    errors.push('Bitte Beginn und Ende angeben.');
  } else if (s.ends_at <= s.starts_at) {
    errors.push('Das Ende muss nach dem Beginn liegen.');
  }
  return { s, errors };
}

function readPerson(body) {
  const g = {
    name: u.clean(body.name, 100),
    email: u.clean(body.email, 200).toLowerCase(),
    phone: u.clean(body.phone, 50),
  };
  const errors = [];
  if (g.name.length < 2) errors.push('Bitte deinen Namen angeben.');
  if (!u.isEmail(g.email)) errors.push('Bitte eine gültige E-Mail-Adresse angeben.');
  return { g, errors };
}

/**
 * Auswahl aus dem Anmeldeformular: Dienste (shift), Warteliste (wait) und Mitbringposten (qty_<id>).
 * Liefert [{ shiftId, quantity, waitlist, note }].
 */
function readSelection(body, event) {
  const sel = new Map();
  for (const id of ids(body.shift)) sel.set(id, { shiftId: id, quantity: 1, waitlist: false });
  for (const id of ids(body.wait)) sel.set(id, { shiftId: id, quantity: 1, waitlist: true });
  for (const [key, value] of Object.entries(body)) {
    const m = /^qty_(\d+)$/.exec(key);
    const qty = parseInt(value, 10) || 0;
    if (m && qty > 0) sel.set(Number(m[1]), { shiftId: Number(m[1]), quantity: Math.min(qty, 100), waitlist: false });
  }
  for (const s of sel.values()) s.note = u.clean(body[`note_${s.shiftId}`] ?? body.note, 300);
  return [...sel.values()].filter((s) => {
    const shift = repo.shiftById.get(s.shiftId);
    return shift && shift.event_id === event.id;
  });
}

/** Trägt eine Person für die Auswahl ein. Fehler einzelner Dienste brechen die anderen nicht ab. */
function signUp(event, helper, selection, actor = helper.name) {
  const entries = [];
  const errors = [];
  for (const sel of selection) {
    const shift = repo.shiftById.get(sel.shiftId);
    if (u.toDate(shift.ends_at) < new Date()) { errors.push(`„${shift.title}“ liegt bereits in der Vergangenheit.`); continue; }
    try {
      const signup = repo.createSignup(shift.id, helper, { token: u.token(18), note: sel.note }, { quantity: sel.quantity, waitlist: sel.waitlist });
      const position = signup.status === 'waiting' ? repo.waitPosition(signup) : null;
      entries.push({ shift, signup, position });
      const what = shift.kind === 'item' ? `${signup.quantity}× ${shift.title} zugesagt` : `für „${shift.title}“ eingetragen`;
      repo.log(event.id, actor, `${helper.name} ${signup.status === 'waiting' ? `auf Warteliste „${shift.title}“` : what}`);
    } catch (err) {
      if (!err.userFacing) throw err;
      errors.push(err.message);
    }
  }
  return { entries, errors };
}

/** Freie Plätze nachbesetzen und Nachrücker benachrichtigen. */
async function fillFromWaitlist(event, shift) {
  const promoted = repo.promoteWaiting(shift.id);
  for (const p of promoted) {
    repo.log(event.id, 'System', `${p.name} von der Warteliste für „${shift.title}“ nachgerückt`);
    await notify.promoted(event, repo.shiftById.get(shift.id), p);
  }
  return promoted;
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
  repo.log(event.id, event.admin_name, 'Veranstaltung angelegt');
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
    errors: [], values: {}, selected: new Set(), ...extra,
  });
}

app.get('/e/:pt', loadPublic, (req, res) => renderEvent(res, req.event, { selected: new Set(ids(req.query.auswahl)) }));

app.post('/e/:pt/anmelden', loadPublic, wrap(async (req, res) => {
  const event = req.event;
  if (req.body.website) return res.redirect(303, `/e/${event.public_token}`); // Honeypot
  const { g, errors } = readPerson(req.body);
  const selection = readSelection(req.body, event);
  if (!selection.length) errors.push('Bitte mindestens einen Dienst oder Mitbringposten auswählen.');
  if (!req.body.privacy) errors.push('Bitte stimme der Verarbeitung deiner Kontaktdaten zu.');
  const rerender = (errs) => renderEvent(res.status(400), event, { errors: errs, values: req.body, selected: new Set(selection.map((s) => s.shiftId)) });
  if (errors.length) return rerender(errors);
  const helper = repo.upsertHelper(event.id, g, u.token(18));
  const result = signUp(event, helper, selection);
  if (!result.entries.length) return rerender(result.errors);
  await notify.helperSignedUp(event, helper, result.entries);
  const warn = result.errors.length ? `&hinweis=${encodeURIComponent(result.errors.join(' '))}` : '';
  res.redirect(303, `/h/${helper.token}?msg=signed_up${warn}`);
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

// ---------- Persönliche Seite der Helfer ----------

// Links aus älteren Mails (eine Anmeldung je Link) führen auf die persönliche Seite.
app.get('/s/:token', (req, res) => {
  const signup = repo.signupByToken.get(req.params.token);
  const helper = signup && repo.helperById.get(signup.helper_id);
  if (!helper) return notFound(res);
  res.redirect(301, `/h/${helper.token}`);
});

function loadHelper(req, res, next) {
  const helper = repo.helperByToken.get(req.params.token);
  if (!helper) return notFound(res);
  req.helper = helper;
  req.event = repo.eventById.get(helper.event_id);
  next();
}

function renderHelper(res, req, extra = {}) {
  const { event, helper } = req;
  const entries = notify.helperEntries(helper);
  const mine = new Set(entries.filter((e) => e.signup.status !== 'cancelled').map((e) => e.shift.id));
  const now = new Date();
  const open = repo.shiftsWithSignups(event.id).filter((s) => !mine.has(s.id) && u.toDate(s.ends_at) > now);
  res.render('helper', {
    event, helper, entries, open,
    selected: new Set(ids(req.query.auswahl)),
    hint: u.clean(req.query.hinweis, 500),
    calendarUrl: notify.calendarUrl(helper),
    webcalUrl: notify.calendarUrl(helper).replace(/^https?:/, 'webcal:'),
    errors: [], ...extra,
  });
}

app.get('/h/:token', loadHelper, (req, res) => renderHelper(res, req));

app.post('/h/:token/anmelden', loadHelper, wrap(async (req, res) => {
  const { event, helper } = req;
  const selection = readSelection(req.body, event);
  if (!selection.length) return renderHelper(res.status(400), req, { errors: ['Bitte mindestens einen Dienst auswählen.'] });
  const result = signUp(event, helper, selection);
  if (!result.entries.length) return renderHelper(res.status(400), req, { errors: result.errors });
  await notify.helperSignedUp(event, helper, result.entries);
  const warn = result.errors.length ? `&hinweis=${encodeURIComponent(result.errors.join(' '))}` : '';
  res.redirect(303, `/h/${helper.token}?msg=signed_up${warn}`);
}));

app.post('/h/:token/signups/:gid/cancel', loadHelper, wrap(async (req, res) => {
  const { event, helper } = req;
  const signup = repo.signupById.get(Number(req.params.gid));
  if (!signup || signup.helper_id !== helper.id) return notFound(res);
  const shift = repo.shiftById.get(signup.shift_id);
  if (signup.status === 'cancelled') return res.redirect(303, `/h/${helper.token}`);
  repo.cancelSignup(signup.id, u.clean(req.body.reason, 500));
  const updated = { ...repo.signupById.get(signup.id), previous_status: signup.status };
  repo.log(event.id, helper.name, signup.status === 'waiting' ? `Warteliste „${shift.title}“ verlassen` : `„${shift.title}“ abgesagt${updated.cancel_reason ? ` (${updated.cancel_reason})` : ''}`);
  const promoted = signup.status === 'active' ? repo.promoteWaiting(shift.id) : [];
  await notify.signupCancelled(event, shift, updated, helper, { promoted });
  for (const p of promoted) {
    repo.log(event.id, 'System', `${p.name} von der Warteliste für „${shift.title}“ nachgerückt`);
    await notify.promoted(event, repo.shiftById.get(shift.id), p);
  }
  res.redirect(303, `/h/${helper.token}?msg=${signup.status === 'waiting' ? 'left_waitlist' : 'cancelled'}`);
}));

// Abo-Kalender: Kalender-Apps laden ihn regelmäßig neu, Absagen verschwinden automatisch.
app.get('/h/:token/kalender.ics', loadHelper, (req, res) => {
  const { event, helper } = req;
  const items = notify.helperEntries(helper).map(({ shift, signup }) => ics.signupItem(event, shift, signup, helper));
  res.type('text/calendar; charset=utf-8').set('Cache-Control', 'no-cache')
    .send(ics.buildCalendar(items, { name: `${event.title} – meine Dienste`, refreshHours: 6 }));
});

app.get('/h/:token/dienstbestaetigung.pdf', loadHelper, wrap(async (req, res) => {
  const { event, helper } = req;
  const entries = notify.helperEntries(helper).filter((e) => e.signup.status !== 'cancelled');
  res.type('application/pdf').attachment('dienstbestaetigung.pdf')
    .send(await pdf.helperConfirmation(event, helper, entries, notify.helperUrl(helper)));
}));

// ---------- Verwaltung (Leitung und Mitorganisatoren) ----------

function loadAdmin(req, res, next) {
  let event = repo.eventByAdmin.get(req.params.at);
  let organizer = null;
  if (!event) {
    organizer = repo.organizerByToken.get(req.params.at);
    event = organizer && repo.eventById.get(organizer.event_id);
  }
  if (!event) return notFound(res);
  req.event = event;
  req.organizer = organizer;
  req.isOwner = !organizer;
  req.actor = organizer ? organizer.name : event.admin_name;
  req.base = `/admin/${req.params.at}`;
  next();
}

function ownerOnly(req, res, next) {
  if (req.isOwner) return next();
  res.status(403).render('error', { title: 'Nicht erlaubt', message: 'Das darf nur die Veranstaltungsleitung.' });
}

async function renderAdmin(res, req, extra = {}) {
  const { event } = req;
  const shifts = repo.shiftsWithSignups(event.id);
  const publicUrl = notify.eventUrl(event);
  const duty = shifts.filter((s) => s.kind === 'shift');
  res.render('admin', {
    event, shifts,
    base: req.base,
    isOwner: req.isOwner,
    actor: req.actor,
    organizers: repo.organizersByEvent.all(event.id),
    activity: repo.activityByEvent.all(event.id),
    helpers: repo.helpersByEvent.all(event.id),
    messages: repo.messagesByEvent.all(event.id),
    publicUrl,
    adminUrl: `${config.baseUrl}${req.base}`,
    qr: await QRCode.toDataURL(publicUrl, { margin: 1, width: 360 }),
    stats: {
      needed: duty.reduce((n, s) => n + s.capacity, 0),
      filled: duty.reduce((n, s) => n + s.filled, 0),
      critical: shifts.filter((s) => s.critical).length,
      waiting: shifts.reduce((n, s) => n + s.waiting.length, 0),
      cancelled: shifts.reduce((n, s) => n + s.cancelled.length, 0),
    },
    errors: [], values: {}, ...extra,
  });
}

app.get('/admin/:at', loadAdmin, wrap((req, res) => renderAdmin(res, req)));

app.post('/admin/:at/event', loadAdmin, wrap(async (req, res) => {
  const { e, errors } = readEvent(req.body);
  if (!req.isOwner) Object.assign(e, { admin_name: req.event.admin_name, admin_email: req.event.admin_email, admin_phone: req.event.admin_phone });
  if (errors.length) return renderAdmin(res.status(400), req, { errors });
  repo.updateEvent(req.event.id, e);
  repo.log(req.event.id, req.actor, 'Veranstaltungsdaten geändert');
  res.redirect(303, `${req.base}?msg=saved`);
}));

app.post('/admin/:at/copy', loadAdmin, wrap(async (req, res) => {
  const source = req.event;
  const date = u.clean(req.body.event_date, 10);
  const title = u.clean(req.body.title, 120) || source.title;
  if (!u.isLocalDate(date)) return renderAdmin(res.status(400), req, { errors: ['Bitte ein Datum für die Kopie angeben.'] });
  const days = u.daysBetween(source.event_date, date);
  const owner = req.organizer
    ? { admin_name: req.organizer.name, admin_email: req.organizer.email, admin_phone: '' }
    : { admin_name: source.admin_name, admin_email: source.admin_email, admin_phone: source.admin_phone };
  const event = repo.copyEvent(source, {
    ...source, ...owner, title, event_date: date, public_token: u.token(9), admin_token: u.token(24),
  }, (local) => u.addDays(local, days));
  repo.log(event.id, req.actor, `Aus „${source.title}“ (${u.fmtDate(source.event_date)}) kopiert`);
  repo.log(source.id, req.actor, `Kopiert nach „${title}“ (${u.fmtDate(date)})`);
  await notify.eventCreated(event, { copiedFrom: source.title });
  res.redirect(303, `/admin/${event.admin_token}?msg=copied`);
}));

app.post('/admin/:at/shifts', loadAdmin, wrap(async (req, res) => {
  const { s, errors } = readShift(req.body);
  if (errors.length) return renderAdmin(res.status(400), req, { errors, values: req.body });
  // Optional: mehrere aufeinanderfolgende Schichten gleicher Länge anlegen.
  const repeat = s.kind === 'item' ? 1 : Math.min(24, Math.max(1, parseInt(req.body.repeat, 10) || 1));
  const duration = u.toDate(s.ends_at) - u.toDate(s.starts_at);
  let start = u.toDate(s.starts_at);
  for (let i = 0; i < repeat; i++) {
    const end = new Date(start.getTime() + duration);
    repo.createShift(req.event.id, { ...s, starts_at: u.toLocal(start), ends_at: u.toLocal(end) });
    start = end;
  }
  repo.log(req.event.id, req.actor, `${s.kind === 'item' ? 'Mitbringposten' : 'Dienst'} „${s.title}“ angelegt${repeat > 1 ? ` (${repeat} Schichten)` : ''}`);
  res.redirect(303, `${req.base}?msg=shift_added#${s.kind === 'item' ? 'mitbringen' : 'dienste'}`);
}));

function adminShift(req, res) {
  const shift = repo.shiftById.get(Number(req.params.sid));
  if (!shift || shift.event_id !== req.event.id) { notFound(res); return null; }
  return shift;
}

app.post('/admin/:at/shifts/:sid', loadAdmin, wrap(async (req, res) => {
  const shift = adminShift(req, res); if (!shift) return;
  const { s, errors } = readShift({ ...req.body, kind: shift.kind });
  if (errors.length) return renderAdmin(res.status(400), req, { errors });
  repo.updateShift(shift.id, s);
  repo.log(req.event.id, req.actor, `„${s.title}“ geändert`);
  await fillFromWaitlist(req.event, shift); // mehr Plätze → Warteliste rückt nach
  res.redirect(303, `${req.base}?msg=saved#shift-${shift.id}`);
}));

app.post('/admin/:at/shifts/:sid/delete', loadAdmin, (req, res) => {
  const shift = adminShift(req, res); if (!shift) return;
  repo.q('DELETE FROM shifts WHERE id = ?').run(shift.id);
  repo.log(req.event.id, req.actor, `„${shift.title}“ gelöscht`);
  res.redirect(303, `${req.base}?msg=shift_deleted#dienste`);
});

app.post('/admin/:at/shifts/:sid/signups', loadAdmin, wrap(async (req, res) => {
  const shift = adminShift(req, res); if (!shift) return;
  const { g, errors } = readPerson(req.body);
  if (errors.length) return renderAdmin(res.status(400), req, { errors });
  const helper = repo.upsertHelper(req.event.id, g, u.token(18));
  const quantity = shift.kind === 'item' ? Math.max(1, parseInt(req.body.quantity, 10) || 1) : 1;
  const result = signUp(req.event, helper, [{ shiftId: shift.id, quantity, waitlist: Boolean(req.body.waitlist), note: u.clean(req.body.note, 300) }], req.actor);
  if (!result.entries.length) return renderAdmin(res.status(400), req, { errors: result.errors });
  if (req.body.notify) await notify.helperSignedUp(req.event, helper, result.entries);
  res.redirect(303, `${req.base}?msg=signup_added#shift-${shift.id}`);
}));

app.post('/admin/:at/signups/:gid/delete', loadAdmin, wrap(async (req, res) => {
  const signup = repo.signupById.get(Number(req.params.gid));
  const shift = signup && repo.shiftById.get(signup.shift_id);
  if (!shift || shift.event_id !== req.event.id) return notFound(res);
  repo.q('DELETE FROM signups WHERE id = ?').run(signup.id);
  repo.log(req.event.id, req.actor, `${signup.name} aus „${shift.title}“ entfernt`);
  if (signup.status !== 'cancelled') await notify.adminRemovedSignup(req.event, shift, signup);
  if (signup.status === 'active') await fillFromWaitlist(req.event, shift);
  res.redirect(303, `${req.base}?msg=signup_removed#shift-${shift.id}`);
}));

// „Ersatz suchen“: alle Helfer der Veranstaltung, die bei diesem Dienst noch nicht dabei sind.
app.post('/admin/:at/shifts/:sid/call', loadAdmin, wrap(async (req, res) => {
  const shift = adminShift(req, res); if (!shift) return;
  const s = repo.shiftWithSignups(shift.id);
  if (s.free < 1) return renderAdmin(res.status(400), req, { errors: [`„${s.title}“ ist bereits voll besetzt.`] });
  if (s.last_call_at && Date.now() - Date.parse(`${s.last_call_at.replace(' ', 'T')}Z`) < 60 * 60_000) {
    return renderAdmin(res.status(429), req, { errors: ['Für diesen Dienst wurde in der letzten Stunde schon eine Rundmail verschickt.'] });
  }
  const involved = new Set(s.signups.map((g) => g.helper_id));
  const recipients = repo.helpersByEvent.all(req.event.id).filter((h) => !involved.has(h.id));
  if (!recipients.length) return renderAdmin(res.status(400), req, { errors: ['Es gibt noch keine weiteren Helfer, die angeschrieben werden könnten. Teile den Link oder das Plakat.'] });
  repo.q("UPDATE shifts SET last_call_at = datetime('now') WHERE id = ?").run(s.id);
  repo.log(req.event.id, req.actor, `„Ersatz gesucht“ für „${s.title}“ an ${recipients.length} Helfer`);
  notify.callForHelp(req.event, s, recipients, req.actor); // läuft im Hintergrund weiter
  res.redirect(303, `${req.base}?msg=called#shift-${s.id}`);
}));

app.post('/admin/:at/organizers', loadAdmin, ownerOnly, wrap(async (req, res) => {
  const name = u.clean(req.body.name, 100);
  const email = u.clean(req.body.email, 200).toLowerCase();
  if (name.length < 2 || !u.isEmail(email)) return renderAdmin(res.status(400), req, { errors: ['Bitte Name und gültige E-Mail-Adresse des Mitorganisators angeben.'] });
  const organizer = repo.addOrganizer(req.event.id, { name, email, token: u.token(24) });
  repo.log(req.event.id, req.actor, `${name} als Mitorganisator eingeladen`);
  await notify.organizerAdded(req.event, organizer, req.actor);
  res.redirect(303, `${req.base}?msg=organizer_added#orga`);
}));

app.post('/admin/:at/organizers/:oid/delete', loadAdmin, ownerOnly, (req, res) => {
  const o = repo.q('SELECT * FROM organizers WHERE id = ? AND event_id = ?').get(Number(req.params.oid), req.event.id);
  if (!o) return notFound(res);
  repo.q('DELETE FROM organizers WHERE id = ?').run(o.id);
  repo.log(req.event.id, req.actor, `Zugang von ${o.name} entfernt`);
  res.redirect(303, `${req.base}?msg=organizer_removed#orga`);
});

app.post('/admin/:at/messages', loadAdmin, wrap(async (req, res) => {
  const event = req.event;
  const subject = u.clean(req.body.subject, 120) || 'Neuigkeiten';
  const body = u.clean(req.body.body, 4000);
  if (!body) return renderAdmin(res.status(400), req, { errors: ['Bitte eine Nachricht eingeben.'] });
  repo.addMessage(event.id, req.actor, `${subject}\n\n${body}`, true);
  let mailed = false;
  if (req.body.mail) {
    const withDuty = new Set(repo.shiftsWithSignups(event.id).flatMap((s) => s.active.map((g) => g.helper_id)));
    const recipients = repo.helpersByEvent.all(event.id).filter((h) => withDuty.has(h.id));
    notify.broadcast(event, recipients, subject, body, req.actor); // läuft im Hintergrund weiter
    mailed = true;
  }
  repo.log(event.id, req.actor, `Nachricht „${subject}“ veröffentlicht${mailed ? ' und per Mail verschickt' : ''}`);
  res.redirect(303, `${req.base}?msg=${mailed ? 'message_mailed' : 'message_sent'}#pinnwand`);
}));

app.post('/admin/:at/messages/:mid/delete', loadAdmin, (req, res) => {
  repo.q('DELETE FROM messages WHERE id = ? AND event_id = ?').run(Number(req.params.mid), req.event.id);
  res.redirect(303, `${req.base}?msg=message_deleted#pinnwand`);
});

app.get('/admin/:at/dienstplan.pdf', loadAdmin, wrap(async (req, res) => {
  const withContacts = req.query.contacts !== '0';
  res.type('application/pdf').attachment(withContacts ? 'dienstplan.pdf' : 'dienstplan-aushang.pdf')
    .send(await pdf.rosterPdf(req.event, repo.shiftsWithSignups(req.event.id), { withContacts, publicUrl: notify.eventUrl(req.event) }));
}));

app.get('/admin/:at/plakat.pdf', loadAdmin, wrap(async (req, res) => {
  const open = repo.shiftsWithSignups(req.event.id).filter((s) => s.kind === 'shift').reduce((n, s) => n + s.free, 0);
  res.type('application/pdf').attachment('plakat-helfer-gesucht.pdf')
    .send(await pdf.posterPdf(req.event, notify.eventUrl(req.event), { open }));
}));

app.get('/admin/:at/qr.png', loadAdmin, wrap(async (req, res) => {
  res.type('image/png').attachment('qr-anmeldung.png').send(await pdf.qrPng(notify.eventUrl(req.event)));
}));

app.get('/admin/:at/helfer.csv', loadAdmin, (req, res) => {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const STATUS = { active: 'eingetragen', waiting: 'Warteliste', cancelled: 'abgesagt' };
  const lines = [['Art', 'Dienst', 'Beginn', 'Ende', 'Menge', 'Name', 'E-Mail', 'Telefon', 'Bemerkung', 'Status', 'Absagegrund'].map(cell).join(';')];
  for (const s of repo.shiftsWithSignups(req.event.id)) {
    for (const g of s.signups) {
      lines.push([s.kind === 'item' ? 'Mitbringen' : 'Dienst', s.title, s.starts_at.replace('T', ' '), s.kind === 'item' ? '' : s.ends_at.replace('T', ' '),
        g.quantity, g.name, g.email, g.phone, g.note, STATUS[g.status], g.cancel_reason].map(cell).join(';'));
    }
  }
  res.type('text/csv; charset=utf-8').attachment('helfer.csv').send(`﻿${lines.join('\r\n')}\r\n`);
});

app.get('/admin/:at/dienstplan.ics', loadAdmin, (req, res) => {
  const items = repo.shiftsWithSignups(req.event.id).map((s) => ({
    uid: `shift-${s.id}-${req.event.public_token}`,
    start: s.starts_at, end: s.ends_at,
    title: `${s.kind === 'item' ? 'Mitbringen: ' : ''}${s.title} (${s.filled}/${s.capacity})`,
    description: s.active.map((g) => (s.kind === 'item' ? `${g.quantity}× ${g.name}` : g.name)).join('\n'),
    location: req.event.location,
  }));
  res.type('text/calendar; charset=utf-8').attachment('dienstplan.ics')
    .send(ics.buildCalendar(items, { name: req.event.title }));
});

app.post('/admin/:at/delete', loadAdmin, ownerOnly, (req, res) => {
  if (req.body.confirm !== req.event.title) {
    return renderAdmin(res.status(400), req, { errors: ['Zum Löschen bitte den Titel der Veranstaltung exakt eingeben.'] });
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
