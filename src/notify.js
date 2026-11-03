'use strict';
const config = require('./config');
const mail = require('./mail');
const ics = require('./ics');
const pdf = require('./pdf');
const repo = require('./repo');
const { fmtRange, fmtDate, fmtTime } = require('./util');

const helperUrl = ics.helperUrl;
const calendarUrl = (helper) => `${helperUrl(helper)}/kalender.ics`;
const eventUrl = (event) => `${config.baseUrl}/e/${event.public_token}`;
const shiftUrl = (event, shift) => `${eventUrl(event)}?auswahl=${shift.id}#shift-${shift.id}`;
const adminUrl = (event, token = event.admin_token) => `${config.baseUrl}/admin/${token}`;

/** Leitung und alle Mitorganisatoren. */
function adminRecipients(event) {
  const list = [{ name: event.admin_name, email: event.admin_email, token: event.admin_token }];
  for (const o of repo.organizersByEvent.all(event.id)) list.push({ name: o.name, email: o.email, token: o.token });
  return list;
}

/** Alle aktuellen Einträge einer Person mit Dienst und Wartelistenplatz. */
function helperEntries(helper) {
  return repo.signupsByHelper.all(helper.id).map((signup) => ({
    signup,
    shift: repo.shiftById.get(signup.shift_id),
    position: signup.status === 'waiting' ? repo.waitPosition(signup) : null,
  }));
}

const entryLabel = (shift, signup) => (shift.kind === 'item' ? `${signup.quantity}× ${shift.title}` : shift.title);
const entryTime = (shift) => (shift.kind === 'item'
  ? `mitbringen bis ${fmtDate(shift.starts_at)}, ${fmtTime(shift.starts_at)} Uhr`
  : fmtRange(shift.starts_at, shift.ends_at));
const entryRow = ({ shift, signup, position }) => [
  entryLabel(shift, signup),
  [entryTime(shift), signup.status === 'waiting' ? `Warteliste, Platz ${position}` : ''].filter(Boolean).join('\n'),
];

async function attachments(event, helper, entries, { cancelled = false } = {}) {
  const method = cancelled ? 'CANCEL' : 'PUBLISH';
  const calendar = ics.buildCalendar(entries.map(({ shift, signup }) => ics.signupItem(event, shift, signup, helper, { cancelled })), { method });
  const list = [{ filename: 'dienste.ics', content: calendar, contentType: `text/calendar; charset=utf-8; method=${method}` }];
  if (!cancelled) {
    const current = helperEntries(helper).filter((e) => e.signup.status !== 'cancelled');
    list.push({ filename: 'dienstbestaetigung.pdf', content: await pdf.helperConfirmation(event, helper, current, helperUrl(helper)) });
  }
  return list;
}

const contactRow = (event) => ['Ansprechpartner', [event.admin_name, event.admin_phone].filter(Boolean).join(', ')];

async function webhook(type, payload) {
  if (!config.webhookUrl) return;
  try {
    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vereinsdienste-secret': config.webhookSecret },
      body: JSON.stringify({ type, at: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error('[webhook] fehlgeschlagen:', err.message);
  }
}

const hookData = (event, shift, signup) => ({
  event: { title: event.title, date: event.event_date, url: eventUrl(event), adminUrl: adminUrl(event) },
  shift: shift && { title: shift.title, kind: shift.kind, starts_at: shift.starts_at, ends_at: shift.ends_at, capacity: shift.capacity },
  signup: signup && { name: signup.name, email: signup.email, phone: signup.phone, reason: signup.cancel_reason, quantity: signup.quantity },
});

// ---------- Leitung ----------

async function eventCreated(event, { copiedFrom } = {}) {
  await mail.sendSafe({
    to: event.admin_email,
    subject: `Deine Veranstaltung „${event.title}“ ist angelegt`,
    content: {
      title: 'Veranstaltung angelegt 🎉',
      paragraphs: [
        `Hallo ${event.admin_name},`,
        copiedFrom
          ? `die Veranstaltung wurde aus „${copiedFrom}“ kopiert – alle Dienste sind schon da. Prüfe Zeiten und Plätze und teile dann den Link für Helferinnen und Helfer.`
          : 'deine Veranstaltung ist bereit. Lege jetzt die Dienste an und teile anschließend den Link für Helferinnen und Helfer.',
        'Wichtig: Der Verwaltungslink ist dein persönlicher Zugang – bitte nicht weitergeben. Weitere Organisatoren kannst du in der Verwaltung mit eigenem Zugang einladen.',
      ],
      rows: [
        ['Veranstaltung', event.title],
        ['Datum', fmtDate(event.event_date)],
        ['Link für Helfer', eventUrl(event)],
        ['Verwaltung', adminUrl(event)],
      ],
      button: { label: 'Veranstaltung verwalten', url: adminUrl(event) },
    },
  });
}

async function organizerAdded(event, organizer, invitedBy) {
  await mail.sendSafe({
    to: organizer.email,
    replyTo: event.admin_email,
    subject: `Einladung zur Organisation: ${event.title}`,
    content: {
      title: 'Du organisierst mit',
      paragraphs: [
        `Hallo ${organizer.name},`,
        `${invitedBy} hat dich eingeladen, die Helferplanung für „${event.title}“ mitzuorganisieren. Über deinen persönlichen Link kannst du Dienste anlegen, Helfer eintragen und Nachrichten schreiben. Absagen bekommst du ab jetzt ebenfalls per Mail.`,
        'Bitte gib den Link nicht weiter – er ist dein persönlicher Zugang.',
      ],
      rows: [['Veranstaltung', event.title], ['Datum', fmtDate(event.event_date)]],
      button: { label: 'Zur Verwaltung', url: adminUrl(event, organizer.token) },
    },
  });
}

/** Kurzbericht einige Tage vor der Veranstaltung. */
async function preEventReport(event, shifts) {
  const critical = shifts.filter((s) => s.critical);
  const cancelled = shifts.flatMap((s) => s.cancelled.map((g) => `${g.name} – ${s.title}${g.cancel_reason ? ` (${g.cancel_reason})` : ''}`));
  const waiting = shifts.reduce((n, s) => n + s.waiting.length, 0);
  const rows = shifts.map((s) => [
    `${s.critical ? '⚠️ ' : '✅ '}${s.title}`,
    `${s.kind === 'item' ? `bis ${fmtTime(s.starts_at)}` : `${fmtTime(s.starts_at)}–${fmtTime(s.ends_at)}`} · ${s.filled}/${s.capacity}${s.min_capacity > 0 && s.min_capacity < s.capacity ? ` (mind. ${s.min_capacity})` : ''}`,
  ]);
  for (const r of adminRecipients(event)) {
    await mail.sendSafe({
      to: r.email,
      subject: `${critical.length ? `⚠️ ${critical.length} Dienste unterbesetzt` : '✅ Alles besetzt'}: ${event.title} am ${fmtDate(event.event_date)}`,
      content: {
        title: 'Kurzbericht zur Besetzung',
        paragraphs: [
          `Hallo ${r.name},`,
          critical.length
            ? `in ${config.reportDaysBefore} Tagen ist es so weit. Bei ${critical.length} ${critical.length === 1 ? 'Dienst fehlen' : 'Diensten fehlen'} noch Leute – in der Verwaltung kannst du mit „Ersatz suchen“ gezielt alle Helfer anschreiben.`
            : `in ${config.reportDaysBefore} Tagen ist es so weit – alle Dienste sind mindestens ausreichend besetzt. Danke fürs Organisieren!`,
          cancelled.length ? `Bisherige Absagen:\n${cancelled.join('\n')}` : '',
          waiting ? `${waiting} ${waiting === 1 ? 'Person steht' : 'Personen stehen'} auf Wartelisten.` : '',
        ].filter(Boolean),
        rows,
        button: { label: 'Dienstplan öffnen', url: adminUrl(event, r.token) },
      },
    });
  }
}

// ---------- Helfer ----------

async function helperSignedUp(event, helper, entries) {
  const active = entries.filter((e) => e.signup.status === 'active');
  await mail.sendSafe({
    to: helper.email,
    replyTo: event.admin_email,
    subject: `Bestätigung: ${event.title}`,
    content: {
      title: 'Danke fürs Mithelfen!',
      paragraphs: [
        `Hallo ${helper.name},`,
        active.length
          ? 'du bist eingetragen. Im Anhang findest du die Kalendereinträge (.ics) und deine Dienstbestätigung als PDF. Den Kalender kannst du auch abonnieren – dann aktualisiert er sich bei Änderungen von selbst.'
          : 'du stehst auf der Warteliste. Sobald ein Platz frei wird, rückst du automatisch nach und bekommst eine Mail.',
      ],
      rows: [['Veranstaltung', event.title], ...entries.map(entryRow), ['Ort', event.location || '–'], contactRow(event)],
      button: { label: 'Meine Dienste ansehen oder absagen', url: helperUrl(helper) },
    },
    attachments: await attachments(event, helper, entries),
  });
  for (const e of entries) await webhook('signup.created', hookData(event, e.shift, e.signup));
}

async function reminder(event, shift, signup, helper, hours) {
  const isItem = shift.kind === 'item';
  await mail.sendSafe({
    to: helper.email,
    replyTo: event.admin_email,
    subject: `Erinnerung: ${isItem ? `${signup.quantity}× ${shift.title} mitbringen` : shift.title} am ${fmtDate(shift.starts_at)}`,
    content: {
      title: isItem ? 'Denkst du ans Mitbringen?' : 'Erinnerung an deinen Dienst',
      paragraphs: [
        `Hallo ${helper.name},`,
        `in etwa ${hours >= 24 ? `${Math.round(hours / 24)} Tag(en)` : `${hours} Stunden`} ist es so weit. Wir freuen uns auf dich!`,
        'Falls du nicht kannst, sage bitte möglichst früh ab, damit wir Ersatz finden.',
      ],
      rows: [['Veranstaltung', event.title], entryRow({ shift, signup }), ['Ort', event.location || '–'], contactRow(event)],
      button: { label: 'Ich kann leider nicht', url: helperUrl(helper), color: '#ff3b30' },
    },
    attachments: await attachments(event, helper, [{ shift, signup }]),
  });
}

async function signupCancelled(event, shift, signup, helper, { promoted = [] } = {}) {
  const wasWaiting = signup.previous_status === 'waiting';
  const free = shift.capacity - repo.filled.get(shift.id).n;
  await mail.sendSafe({
    to: helper.email,
    subject: `Abgesagt: ${shift.title} – ${event.title}`,
    content: {
      title: wasWaiting ? 'Von der Warteliste genommen' : 'Deine Absage ist angekommen',
      paragraphs: [`Hallo ${helper.name},`, 'schade, dass es nicht klappt – danke für die Rückmeldung! Der Kalendereintrag im Anhang entfernt den Termin aus deinem Kalender.'],
      rows: [['Veranstaltung', event.title], entryRow({ shift, signup })],
    },
    attachments: await attachments(event, helper, [{ shift, signup }], { cancelled: true }),
  });
  if (wasWaiting) return; // Wer nur auf der Warteliste stand, fehlt niemandem.
  const replacement = promoted.length ? `${promoted.map((p) => p.name).join(', ')} ist von der Warteliste nachgerückt.` : '';
  for (const r of adminRecipients(event)) {
    await mail.sendSafe({
      to: r.email,
      replyTo: helper.email,
      subject: `⚠️ Ausfall: ${helper.name} – ${shift.title} (${fmtDate(shift.starts_at)})`,
      content: {
        title: shift.kind === 'item' ? 'Eine Zusage zum Mitbringen fällt weg' : 'Ein Helfer ist ausgefallen',
        paragraphs: [
          `${helper.name} hat „${entryLabel(shift, signup)}“ abgesagt.`,
          replacement,
          free > 0 ? `Für diesen Dienst ${free === 1 ? 'ist jetzt 1 Platz' : `sind jetzt ${free} Plätze`} frei. Mit „Ersatz suchen“ in der Verwaltung kannst du alle Helfer gezielt anschreiben.` : '',
        ].filter(Boolean),
        rows: [
          ['Dienst', shift.title], ['Zeit', entryTime(shift)],
          ['Helfer', helper.name], ['E-Mail', helper.email], ['Telefon', helper.phone || '–'],
          ['Begründung', signup.cancel_reason || '–'],
        ],
        button: { label: 'Dienstplan öffnen', url: `${adminUrl(event, r.token)}#shift-${shift.id}` },
      },
    });
  }
  await webhook('signup.cancelled', hookData(event, shift, signup));
}

/** Von der Warteliste nachgerückt. */
async function promoted(event, shift, signup) {
  const helper = repo.helperById.get(signup.helper_id);
  await mail.sendSafe({
    to: helper.email,
    replyTo: event.admin_email,
    subject: `Du bist nachgerückt: ${shift.title} – ${event.title}`,
    content: {
      title: 'Ein Platz ist frei geworden – du bist dabei!',
      paragraphs: [
        `Hallo ${helper.name},`,
        `für „${shift.title}“ ist ein Platz frei geworden, und du bist von der Warteliste nachgerückt. Im Anhang findest du den aktualisierten Kalendereintrag und deine Dienstbestätigung.`,
        'Falls es bei dir inzwischen nicht mehr passt, sage bitte kurz ab.',
      ],
      rows: [['Veranstaltung', event.title], entryRow({ shift, signup }), ['Ort', event.location || '–'], contactRow(event)],
      button: { label: 'Meine Dienste ansehen', url: helperUrl(helper) },
    },
    attachments: await attachments(event, helper, [{ shift, signup }]),
  });
  await webhook('signup.promoted', hookData(event, shift, signup));
}

async function adminRemovedSignup(event, shift, signup) {
  const helper = repo.helperById.get(signup.helper_id);
  if (!helper) return;
  await mail.sendSafe({
    to: helper.email,
    replyTo: event.admin_email,
    subject: `Änderung: ${shift.title} – ${event.title}`,
    content: {
      title: 'Dein Dienst wurde geändert',
      paragraphs: [`Hallo ${helper.name},`, `die Veranstaltungsleitung hat dich aus „${shift.title}“ ausgetragen. Bei Fragen antworte einfach auf diese Mail.`],
      rows: [['Veranstaltung', event.title], entryRow({ shift, signup })],
    },
    attachments: await attachments(event, helper, [{ shift, signup }], { cancelled: true }),
  });
}

/** „Ersatz gesucht“: alle Helfer der Veranstaltung, die bei diesem Dienst noch nicht dabei sind. */
async function callForHelp(event, shift, recipients, sender) {
  const isItem = shift.kind === 'item';
  for (const h of recipients) {
    await mail.sendSafe({
      to: h.email,
      replyTo: event.admin_email,
      subject: `${isItem ? 'Wer kann mitbringen' : 'Wer kann einspringen'}: ${shift.title} – ${event.title}`,
      content: {
        title: isItem ? 'Wir brauchen noch etwas' : 'Wir brauchen noch Unterstützung',
        paragraphs: [
          `Hallo ${h.name},`,
          isItem
            ? `für „${shift.title}“ fehlen noch ${shift.free}. Kannst du etwas mitbringen? Ein Klick genügt, deine Daten sind schon ausgefüllt.`
            : `für „${shift.title}“ ${shift.free === 1 ? 'fehlt noch 1 Person' : `fehlen noch ${shift.free} Personen`}. Hast du Zeit? Ein Klick genügt, deine Daten sind schon ausgefüllt.`,
          shift.requirement ? `Gesucht: ${shift.requirement}` : '',
          `Viele Grüße\n${sender}`,
        ].filter(Boolean),
        rows: [['Veranstaltung', event.title], [shift.title, entryTime(shift)]],
        button: { label: isItem ? 'Ich bringe etwas mit' : 'Ich springe ein', url: `${helperUrl(h)}?auswahl=${shift.id}#shift-${shift.id}` },
      },
    });
  }
}

async function broadcast(event, recipients, subject, body, sender) {
  for (const r of recipients) {
    await mail.sendSafe({
      to: r.email,
      replyTo: event.admin_email,
      subject: `${event.title}: ${subject}`,
      content: {
        title: subject,
        paragraphs: [`Hallo ${r.name},`, body, `Viele Grüße\n${sender}`],
        button: { label: 'Zur Veranstaltung', url: r.token ? helperUrl(r) : eventUrl(event) },
      },
    });
  }
}

module.exports = {
  eventCreated, organizerAdded, preEventReport,
  helperSignedUp, reminder, signupCancelled, promoted, adminRemovedSignup, callForHelp, broadcast,
  helperEntries, adminRecipients, eventUrl, shiftUrl, adminUrl, helperUrl, calendarUrl,
};
