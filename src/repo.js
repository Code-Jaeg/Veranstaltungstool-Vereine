'use strict';
const db = require('./db');

const q = (sql) => db.prepare(sql);

const stmts = {
  eventByPublic: q('SELECT * FROM events WHERE public_token = ?'),
  eventByAdmin: q('SELECT * FROM events WHERE admin_token = ?'),
  eventById: q('SELECT * FROM events WHERE id = ?'),
  shiftsByEvent: q('SELECT * FROM shifts WHERE event_id = ? ORDER BY starts_at, title'),
  shiftById: q('SELECT * FROM shifts WHERE id = ?'),
  signupsByEvent: q(`SELECT g.* FROM signups g JOIN shifts s ON s.id = g.shift_id
                     WHERE s.event_id = ? ORDER BY g.created_at`),
  signupByToken: q('SELECT * FROM signups WHERE token = ?'),
  activeCount: q("SELECT COUNT(*) AS n FROM signups WHERE shift_id = ? AND status = 'active'"),
  messagesByEvent: q('SELECT * FROM messages WHERE event_id = ? ORDER BY created_at DESC, id DESC LIMIT 200'),
};

function shiftsWithSignups(eventId) {
  const shifts = stmts.shiftsByEvent.all(eventId);
  const signups = stmts.signupsByEvent.all(eventId);
  for (const s of shifts) {
    s.signups = signups.filter((g) => g.shift_id === s.id);
    s.active = s.signups.filter((g) => g.status === 'active');
    s.free = Math.max(0, s.capacity - s.active.length);
  }
  return shifts;
}

function createEvent(e) {
  const r = q(`INSERT INTO events (public_token, admin_token, title, organization, description, location,
               event_date, admin_name, admin_email, admin_phone)
               VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(e.public_token, e.admin_token, e.title, e.organization, e.description, e.location,
      e.event_date, e.admin_name, e.admin_email, e.admin_phone);
  return stmts.eventById.get(r.lastInsertRowid);
}

function updateEvent(id, e) {
  q(`UPDATE events SET title=?, organization=?, description=?, location=?, event_date=?,
     admin_name=?, admin_email=?, admin_phone=? WHERE id=?`)
    .run(e.title, e.organization, e.description, e.location, e.event_date,
      e.admin_name, e.admin_email, e.admin_phone, id);
}

function createShift(eventId, s) {
  q('INSERT INTO shifts (event_id, title, description, starts_at, ends_at, capacity) VALUES (?,?,?,?,?,?)')
    .run(eventId, s.title, s.description, s.starts_at, s.ends_at, s.capacity);
}

function updateShift(id, s) {
  q('UPDATE shifts SET title=?, description=?, starts_at=?, ends_at=?, capacity=? WHERE id=?')
    .run(s.title, s.description, s.starts_at, s.ends_at, s.capacity, id);
}

/** Atomar prüfen, ob noch ein Platz frei ist, und eintragen. */
function createSignup(shiftId, g) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const shift = stmts.shiftById.get(shiftId);
    if (!shift) throw new Error('Dienst nicht gefunden.');
    if (stmts.activeCount.get(shiftId).n >= shift.capacity) {
      const err = new Error('Dieser Dienst ist leider schon voll besetzt.');
      err.userFacing = true;
      throw err;
    }
    const dup = q("SELECT 1 FROM signups WHERE shift_id = ? AND lower(email) = lower(?) AND status = 'active'").get(shiftId, g.email);
    if (dup) {
      const err = new Error('Du bist für diesen Dienst bereits eingetragen.');
      err.userFacing = true;
      throw err;
    }
    q('INSERT INTO signups (shift_id, token, name, email, phone, note) VALUES (?,?,?,?,?,?)')
      .run(shiftId, g.token, g.name, g.email, g.phone, g.note);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return stmts.signupByToken.get(g.token);
}

function cancelSignup(id, reason) {
  q("UPDATE signups SET status='cancelled', cancel_reason=?, cancelled_at=datetime('now') WHERE id=? AND status='active'")
    .run(reason, id);
}

function addMessage(eventId, author, body, isAdmin) {
  q('INSERT INTO messages (event_id, author, body, is_admin) VALUES (?,?,?,?)').run(eventId, author, body, isAdmin ? 1 : 0);
}

module.exports = {
  db, q, ...stmts, shiftsWithSignups, createEvent, updateEvent, createShift, updateShift,
  createSignup, cancelSignup, addMessage,
};
