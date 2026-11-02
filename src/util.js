'use strict';
const crypto = require('node:crypto');

const token = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');

// Alle Zeitangaben werden als Ortszeit (TZ=Europe/Berlin) im Format YYYY-MM-DDTHH:MM gespeichert.
const toDate = (local) => new Date(local.length === 10 ? `${local}T00:00` : local);

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const pad = (n) => String(n).padStart(2, '0');

function fmtDate(local) {
  const d = toDate(local);
  return `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
function fmtShortDate(local) {
  const d = toDate(local);
  return `${WEEKDAYS[d.getDay()].slice(0, 2)}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}
function fmtTime(local) {
  const d = toDate(local);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtRange(start, end) {
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  return sameDay
    ? `${fmtDate(start)}, ${fmtTime(start)}–${fmtTime(end)} Uhr`
    : `${fmtDate(start)}, ${fmtTime(start)} Uhr – ${fmtDate(end)}, ${fmtTime(end)} Uhr`;
}

// Öffentliche Anzeige: nur Vorname + Initial des Nachnamens (Datenschutz).
function publicName(name) {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length < 2) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/** Ortszeit-String formatieren (YYYY-MM-DDTHH:MM). */
const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Ganze Tage zum Datumsteil addieren; die Uhrzeit bleibt unverändert (auch über die Zeitumstellung hinweg). */
function addDays(local, days) {
  const d = new Date(`${local.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10) + local.slice(10);
}

/** Abstand zweier Kalendertage (YYYY-MM-DD) in Tagen. */
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
const isLocalDateTime = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(s || ''));
const isLocalDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const clean = (s, max = 500) => String(s ?? '').trim().slice(0, max);

module.exports = {
  token, toDate, toLocal, addDays, daysBetween, fmtDate, fmtShortDate, fmtTime, fmtRange, publicName,
  isEmail, isLocalDateTime, isLocalDate, clean,
};
