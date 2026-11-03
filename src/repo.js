'use strict';
const db = require('./db');

const q = (sql) => db.prepare(sql);

const stmts = {
  eventByPublic: q('SELECT * FROM events WHERE public_token = ?'),
  eventByAdmin: q('SELECT * FROM events WHERE admin_token = ?'),
  eventById: q('SELECT * FROM events WHERE id = ?'),
  shiftsByEvent: q("SELECT * FROM shifts WHERE event_id = ? ORDER BY kind = 'item', starts_at, title"),
  shiftById: q('SELECT * FROM shifts WHERE id = ?'),
  signupsByEvent: q(`SELECT g.* FROM signups g JOIN shifts s ON s.id = g.shift_id
                     WHERE s.event_id = ? ORDER BY g.created_at, g.id`),
  signupByToken: q('SELECT * FROM signups WHERE token = ?'),
  signupById: q('SELECT * FROM signups WHERE id = ?'),
  filled: q("SELECT COALESCE(SUM(quantity), 0) AS n FROM signups WHERE shift_id = ? AND status = 'active'"),
  messagesByEvent: q('SELECT * FROM messages WHERE event_id = ? ORDER BY created_at DESC, id DESC LIMIT 200'),
  helperByToken: q('SELECT * FROM helpers WHERE token = ?'),
  helperById: q('SELECT * FROM helpers WHERE id = ?'),
  helpersByEvent: q('SELECT * FROM helpers WHERE event_id = ? ORDER BY name'),
  signupsByHelper: q(`SELECT g.*, s.title AS shift_title FROM signups g JOIN shifts s ON s.id = g.shift_id
                      WHERE g.helper_id = ? ORDER BY s.kind = 'item', s.starts_at`),
  organizerByToken: q('SELECT * FROM organizers WHERE token = ?'),
  organizersByEvent: q('SELECT * FROM organizers WHERE event_id = ? ORDER BY created_at'),
  activityByEvent: q('SELECT * FROM activity WHERE event_id = ? ORDER BY id DESC LIMIT 40'),
};

/** Bedarf eines Dienstes: Mindestbesetzung, falls gesetzt, sonst alle Plätze. */
const needOf = (s) => (s.min_capacity > 0 ? Math.min(s.min_capacity, s.capacity) : s.capacity);

function decorate(s, signups) {
  s.signups = signups.filter((g) => g.shift_id === s.id);
  s.active = s.signups.filter((g) => g.status === 'active');
  s.waiting = s.signups.filter((g) => g.status === 'waiting');
  s.cancelled = s.signups.filter((g) => g.status === 'cancelled');
  s.filled = s.active.reduce((n, g) => n + g.quantity, 0);
  s.free = Math.max(0, s.capacity - s.filled);
  s.need = needOf(s);
  s.critical = s.filled < s.need;
  return s;
}

function shiftsWithSignups(eventId) {
  const signups = stmts.signupsByEvent.all(eventId);
  return stmts.shiftsByEvent.all(eventId).map((s) => decorate(s, signups));
}

function shiftWithSignups(shiftId) {
  const s = stmts.shiftById.get(shiftId);
  return s && decorate(s, q('SELECT * FROM signups WHERE shift_id = ? ORDER BY created_at, id').all(shiftId));
}

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function userError(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
}

// ---------- Veranstaltungen ----------

const EVENT_FIELDS = ['title', 'organization', 'description', 'location', 'event_date', 'admin_name', 'admin_email', 'admin_phone'];

function createEvent(e) {
  const r = q(`INSERT INTO events (public_token, admin_token, ${EVENT_FIELDS.join(', ')}) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(e.public_token, e.admin_token, ...EVENT_FIELDS.map((f) => e[f] ?? null));
  return stmts.eventById.get(r.lastInsertRowid);
}

function updateEvent(id, e) {
  q(`UPDATE events SET ${EVENT_FIELDS.map((f) => `${f}=?`).join(', ')}, report_sent_at = NULL WHERE id=?`)
    .run(...EVENT_FIELDS.map((f) => e[f] ?? null), id);
}

/** Veranstaltung samt Diensten auf ein neues Datum kopieren (ohne Anmeldungen und Nachrichten). */
function copyEvent(source, e, shiftDate) {
  return transaction(() => {
    const event = createEvent(e);
    for (const s of stmts.shiftsByEvent.all(source.id)) {
      createShift(event.id, { ...s, starts_at: shiftDate(s.starts_at), ends_at: shiftDate(s.ends_at) });
    }
    return event;
  });
}

// ---------- Dienste ----------

const SHIFT_FIELDS = ['kind', 'title', 'description', 'requirement', 'starts_at', 'ends_at', 'capacity', 'min_capacity'];

function createShift(eventId, s) {
  q(`INSERT INTO shifts (event_id, ${SHIFT_FIELDS.join(', ')}) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(eventId, ...SHIFT_FIELDS.map((f) => s[f] ?? null));
}

function updateShift(id, s) {
  q(`UPDATE shifts SET ${SHIFT_FIELDS.map((f) => `${f}=?`).join(', ')} WHERE id=?`)
    .run(...SHIFT_FIELDS.map((f) => s[f] ?? null), id);
}

// ---------- Helfer und Anmeldungen ----------

/** Helfer-Konto je Veranstaltung und E-Mail-Adresse; Name/Telefon werden aktualisiert. */
function upsertHelper(eventId, g, token) {
  const existing = q('SELECT * FROM helpers WHERE event_id = ? AND email = ?').get(eventId, g.email);
  if (existing) {
    q('UPDATE helpers SET name = ?, phone = COALESCE(NULLIF(?, \'\'), phone) WHERE id = ?').run(g.name, g.phone || '', existing.id);
    return stmts.helperById.get(existing.id);
  }
  const r = q('INSERT INTO helpers (event_id, token, name, email, phone) VALUES (?,?,?,?,?)')
    .run(eventId, token, g.name, g.email, g.phone);
  return stmts.helperById.get(r.lastInsertRowid);
}

/**
 * Atomar eintragen. Ist kein Platz mehr frei, landet die Person auf der Warteliste,
 * sofern `waitlist` erlaubt ist. Liefert die Anmeldung (status active oder waiting).
 */
function createSignup(shiftId, helper, g, { quantity = 1, waitlist = false } = {}) {
  return transaction(() => {
    const shift = stmts.shiftById.get(shiftId);
    if (!shift) throw userError('Dienst nicht gefunden.');
    const dup = q("SELECT 1 FROM signups WHERE shift_id = ? AND helper_id = ? AND status IN ('active','waiting')").get(shiftId, helper.id);
    if (dup) throw userError(`Für „${shift.title}“ bist du bereits eingetragen.`);
    const qty = shift.kind === 'item' ? Math.max(1, quantity) : 1;
    const free = shift.capacity - stmts.filled.get(shiftId).n;
    let status = 'active';
    if (free < qty) {
      if (!waitlist || shift.kind === 'item') {
        throw userError(free > 0
          ? `Für „${shift.title}“ werden nur noch ${free} benötigt.`
          : `„${shift.title}“ ist leider schon voll besetzt.`);
      }
      status = 'waiting';
    }
    const r = q('INSERT INTO signups (shift_id, helper_id, token, name, email, phone, note, quantity, status) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(shiftId, helper.id, g.token, helper.name, helper.email, helper.phone, g.note, qty, status);
    return stmts.signupById.get(r.lastInsertRowid);
  });
}

function cancelSignup(id, reason) {
  q("UPDATE signups SET status='cancelled', cancel_reason=?, cancelled_at=datetime('now') WHERE id=? AND status IN ('active','waiting')")
    .run(reason, id);
}

/** Wartende rücken der Reihe nach auf freie Plätze nach. Liefert die nachgerückten Anmeldungen. */
function promoteWaiting(shiftId) {
  return transaction(() => {
    const shift = stmts.shiftById.get(shiftId);
    const promoted = [];
    if (!shift || shift.kind === 'item') return promoted;
    let free = shift.capacity - stmts.filled.get(shiftId).n;
    const waiting = q("SELECT * FROM signups WHERE shift_id = ? AND status = 'waiting' ORDER BY created_at, id").all(shiftId);
    for (const g of waiting) {
      if (free < 1) break;
      q("UPDATE signups SET status = 'active', reminders_sent = '' WHERE id = ?").run(g.id);
      promoted.push(stmts.signupById.get(g.id));
      free -= 1;
    }
    return promoted;
  });
}

/** Position auf der Warteliste (1 = als Nächstes dran). */
function waitPosition(signup) {
  return q("SELECT COUNT(*) AS n FROM signups WHERE shift_id = ? AND status = 'waiting' AND (created_at < ? OR (created_at = ? AND id <= ?))")
    .get(signup.shift_id, signup.created_at, signup.created_at, signup.id).n;
}

// ---------- Organisatoren, Nachrichten, Verlauf ----------

function addOrganizer(eventId, o) {
  const r = q('INSERT INTO organizers (event_id, token, name, email) VALUES (?,?,?,?)').run(eventId, o.token, o.name, o.email);
  return q('SELECT * FROM organizers WHERE id = ?').get(r.lastInsertRowid);
}

function addMessage(eventId, author, body, isAdmin) {
  q('INSERT INTO messages (event_id, author, body, is_admin) VALUES (?,?,?,?)').run(eventId, author, body, isAdmin ? 1 : 0);
}

function log(eventId, actor, text) {
  q('INSERT INTO activity (event_id, actor, text) VALUES (?,?,?)').run(eventId, actor, text);
}

module.exports = {
  db, q, ...stmts, needOf, shiftsWithSignups, shiftWithSignups,
  createEvent, updateEvent, copyEvent, createShift, updateShift,
  upsertHelper, createSignup, cancelSignup, promoteWaiting, waitPosition,
  addOrganizer, addMessage, log,
};
