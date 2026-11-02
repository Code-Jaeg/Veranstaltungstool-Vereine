'use strict';
const config = require('./config');
const repo = require('./repo');
const notify = require('./notify');
const { toDate } = require('./util');

const HOUR = 3600 * 1000;

async function sendReminders(now = new Date()) {
  if (!config.reminderHours.length) return 0;
  const maxH = config.reminderHours[0];
  const rows = repo.q(`
    SELECT g.id AS signup_id, s.id AS shift_id, e.id AS event_id
    FROM signups g JOIN shifts s ON s.id = g.shift_id JOIN events e ON e.id = s.event_id
    WHERE g.status = 'active'`).all();
  let sent = 0;
  for (const row of rows) {
    const shift = repo.shiftById.get(row.shift_id);
    const hoursUntil = (toDate(shift.starts_at) - now) / HOUR;
    if (hoursUntil <= 0 || hoursUntil > maxH) continue;
    const signup = repo.q('SELECT * FROM signups WHERE id = ?').get(row.signup_id);
    const done = signup.reminders_sent.split(',').filter(Boolean).map(Number);
    const due = config.reminderHours.filter((h) => hoursUntil <= h && !done.includes(h));
    if (!due.length) continue;
    // Erst markieren, dann senden – so gibt es auch bei Neustarts keine doppelten Mails.
    repo.q('UPDATE signups SET reminders_sent = ? WHERE id = ?').run(`,${[...done, ...due].join(',')},`, signup.id);
    // Wer sich gerade erst eingetragen hat, hat schon die Bestätigung bekommen.
    const ageHours = (now - new Date(`${signup.created_at.replace(' ', 'T')}Z`)) / HOUR;
    if (ageHours < 6) continue;
    const event = repo.eventById.get(row.event_id);
    const helper = repo.helperById.get(signup.helper_id);
    if (!helper) continue;
    await notify.reminder(event, shift, signup, helper, Math.max(1, Math.round(hoursUntil)));
    sent++;
  }
  if (sent) console.log(`[jobs] ${sent} Erinnerung(en) versendet`);
  return sent;
}

/** Kurzbericht zur Besetzung, einmalig wenige Tage vor der Veranstaltung. */
async function sendPreEventReports(now = new Date()) {
  if (!config.reportDaysBefore) return 0;
  let sent = 0;
  for (const event of repo.q('SELECT * FROM events WHERE report_sent_at IS NULL').all()) {
    const daysUntil = (toDate(event.event_date) - now) / (24 * HOUR);
    if (daysUntil < 0 || daysUntil > config.reportDaysBefore) continue;
    const shifts = repo.shiftsWithSignups(event.id);
    if (!shifts.length) continue;
    repo.q("UPDATE events SET report_sent_at = datetime('now') WHERE id = ?").run(event.id);
    await notify.preEventReport(event, shifts);
    sent++;
  }
  if (sent) console.log(`[jobs] ${sent} Kurzbericht(e) versendet`);
  return sent;
}

function purgeOldEvents(now = new Date()) {
  if (!config.retentionDays) return 0;
  const cutoff = new Date(now.getTime() - config.retentionDays * 24 * HOUR);
  let removed = 0;
  for (const e of repo.q('SELECT id, event_date FROM events').all()) {
    const last = repo.q('SELECT MAX(ends_at) AS m FROM shifts WHERE event_id = ?').get(e.id).m;
    const end = toDate(last && last.slice(0, 10) > e.event_date ? last : `${e.event_date}T23:59`);
    if (end < cutoff) {
      repo.q('DELETE FROM events WHERE id = ?').run(e.id);
      removed++;
    }
  }
  if (removed) console.log(`[jobs] ${removed} abgelaufene Veranstaltung(en) gelöscht (Datenschutz)`);
  return removed;
}

function start() {
  const tick = () => {
    sendReminders().catch((err) => console.error('[jobs] Erinnerungen:', err));
    sendPreEventReports().catch((err) => console.error('[jobs] Kurzberichte:', err));
    try { purgeOldEvents(); } catch (err) { console.error('[jobs] Aufräumen:', err); }
  };
  setTimeout(tick, 5000);
  return setInterval(tick, 10 * 60 * 1000);
}

module.exports = { start, sendReminders, sendPreEventReports, purgeOldEvents };
