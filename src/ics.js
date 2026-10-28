'use strict';
const config = require('./config');
const { toDate } = require('./util');

const host = new URL(config.baseUrl).hostname;

const esc = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const utc = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// RFC 5545: Zeilen nach 75 Oktetten falten.
function fold(line) {
  const out = [];
  let buf = Buffer.from(line, 'utf8');
  let first = true;
  while (buf.length > (first ? 75 : 74)) {
    let cut = first ? 75 : 74;
    while ((buf[cut] & 0xc0) === 0x80) cut--; // nicht mitten in einem UTF-8-Zeichen trennen
    out.push((first ? '' : ' ') + buf.subarray(0, cut).toString('utf8'));
    buf = buf.subarray(cut);
    first = false;
  }
  out.push((first ? '' : ' ') + buf.toString('utf8'));
  return out.join('\r\n');
}

/**
 * items: [{ uid, start, end, title, description, location, url, cancelled }]
 */
function buildCalendar(items, { method = 'PUBLISH', name } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${esc(config.appName)}//DE`,
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
  ];
  if (name) lines.push(`X-WR-CALNAME:${esc(name)}`);
  const stamp = utc(new Date());
  for (const it of items) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${it.uid}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utc(toDate(it.start))}`,
      `DTEND:${utc(toDate(it.end))}`,
      `SUMMARY:${esc(it.title)}`,
    );
    if (it.description) lines.push(`DESCRIPTION:${esc(it.description)}`);
    if (it.location) lines.push(`LOCATION:${esc(it.location)}`);
    if (it.url) lines.push(`URL:${it.url}`);
    if (it.cancelled) {
      lines.push('STATUS:CANCELLED', 'SEQUENCE:1');
    } else {
      lines.push(
        'STATUS:CONFIRMED', 'SEQUENCE:0',
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(it.title)}`, 'TRIGGER:-PT2H', 'END:VALARM',
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(it.title)}`, 'TRIGGER:-P1D', 'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

function signupItem(event, shift, signup, { cancelled = false } = {}) {
  const manageUrl = `${config.baseUrl}/s/${signup.token}`;
  return {
    uid: `signup-${signup.token}`,
    start: shift.starts_at,
    end: shift.ends_at,
    title: `${shift.title} – ${event.title}`,
    description: [
      `Dein Dienst: ${shift.title}`,
      shift.description,
      `Ansprechpartner: ${event.admin_name}${event.admin_phone ? `, ${event.admin_phone}` : ''}`,
      `Anmeldung verwalten / absagen: ${manageUrl}`,
    ].filter(Boolean).join('\n'),
    location: event.location,
    url: manageUrl,
    cancelled,
  };
}

module.exports = { buildCalendar, signupItem };
