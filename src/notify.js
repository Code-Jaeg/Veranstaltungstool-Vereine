'use strict';
const config = require('./config');
const mail = require('./mail');
const ics = require('./ics');
const pdf = require('./pdf');
const { fmtRange, fmtDate } = require('./util');

const manageUrl = (signup) => `${config.baseUrl}/s/${signup.token}`;
const eventUrl = (event) => `${config.baseUrl}/e/${event.public_token}`;
const adminUrl = (event) => `${config.baseUrl}/admin/${event.admin_token}`;

async function attachmentsFor(event, shift, signup, { cancelled = false } = {}) {
  const calendar = ics.buildCalendar([ics.signupItem(event, shift, signup, { cancelled })], {
    method: cancelled ? 'CANCEL' : 'PUBLISH',
  });
  const list = [{
    filename: 'dienst.ics',
    content: calendar,
    contentType: `text/calendar; charset=utf-8; method=${cancelled ? 'CANCEL' : 'PUBLISH'}`,
  }];
  if (!cancelled) {
    list.push({ filename: 'dienstbestaetigung.pdf', content: await pdf.signupConfirmation(event, shift, signup) });
  }
  return list;
}

const shiftRows = (event, shift) => [
  ['Veranstaltung', event.title],
  ['Dienst', shift.title],
  ['Zeit', fmtRange(shift.starts_at, shift.ends_at)],
  ['Ort', event.location || '–'],
  ['Ansprechpartner', [event.admin_name, event.admin_phone].filter(Boolean).join(', ')],
];

async function webhook(type, payload) {
  if (!config.webhookUrl) return;
  try {
    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, at: new Date().toISOString(), ...payload }),
    });
  } catch (err) {
    console.error('[webhook] fehlgeschlagen:', err.message);
  }
}

const hookData = (event, shift, signup) => ({
  event: { title: event.title, date: event.event_date, url: eventUrl(event), adminUrl: adminUrl(event) },
  shift: shift && { title: shift.title, starts_at: shift.starts_at, ends_at: shift.ends_at, capacity: shift.capacity },
  signup: signup && { name: signup.name, email: signup.email, phone: signup.phone, reason: signup.cancel_reason },
});

async function eventCreated(event) {
  await mail.sendSafe({
    to: event.admin_email,
    subject: `Deine Veranstaltung „${event.title}“ ist angelegt`,
    content: {
      title: 'Veranstaltung angelegt 🎉',
      paragraphs: [
        `Hallo ${event.admin_name},`,
        'deine Veranstaltung ist bereit. Lege jetzt die Dienste an und teile anschließend den Link für Helferinnen und Helfer.',
        'Wichtig: Der Verwaltungslink ist dein persönlicher Zugang – bitte nicht weitergeben.',
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

async function signupCreated(event, shift, signup) {
  await mail.sendSafe({
    to: signup.email,
    replyTo: event.admin_email,
    subject: `Bestätigung: ${shift.title} – ${event.title}`,
    content: {
      title: 'Danke fürs Mithelfen!',
      paragraphs: [
        `Hallo ${signup.name},`,
        'du bist für folgenden Dienst eingetragen. Im Anhang findest du einen Kalendereintrag (.ics) und deine Dienstbestätigung als PDF.',
      ],
      rows: shiftRows(event, shift),
      button: { label: 'Anmeldung ansehen oder absagen', url: manageUrl(signup) },
    },
    attachments: await attachmentsFor(event, shift, signup),
  });
  await webhook('signup.created', hookData(event, shift, signup));
}

async function reminder(event, shift, signup, hours) {
  await mail.sendSafe({
    to: signup.email,
    replyTo: event.admin_email,
    subject: `Erinnerung: ${shift.title} am ${fmtDate(shift.starts_at)}`,
    content: {
      title: 'Erinnerung an deinen Dienst',
      paragraphs: [
        `Hallo ${signup.name},`,
        `in etwa ${hours >= 24 ? `${Math.round(hours / 24)} Tag(en)` : `${hours} Stunden`} beginnt dein Dienst. Wir freuen uns auf dich!`,
        'Falls du nicht kannst, sage bitte möglichst früh ab, damit wir Ersatz finden.',
      ],
      rows: shiftRows(event, shift),
      button: { label: 'Ich kann leider nicht', url: manageUrl(signup), color: '#ff3b30' },
    },
    attachments: await attachmentsFor(event, shift, signup),
  });
}

async function signupCancelled(event, shift, signup, freeAfter) {
  await Promise.all([
    mail.sendSafe({
      to: signup.email,
      subject: `Abgesagt: ${shift.title} – ${event.title}`,
      content: {
        title: 'Deine Absage ist angekommen',
        paragraphs: [`Hallo ${signup.name},`, 'schade, dass es nicht klappt – danke für die Rückmeldung! Der Kalendereintrag im Anhang entfernt den Termin aus deinem Kalender.'],
        rows: shiftRows(event, shift),
      },
      attachments: await attachmentsFor(event, shift, signup, { cancelled: true }),
    }),
    mail.sendSafe({
      to: event.admin_email,
      replyTo: signup.email,
      subject: `⚠️ Ausfall: ${signup.name} – ${shift.title} (${fmtDate(shift.starts_at)})`,
      content: {
        title: 'Ein Helfer ist ausgefallen',
        paragraphs: [
          `${signup.name} hat sich vom Dienst „${shift.title}“ abgemeldet.`,
          freeAfter > 0 ? `Für diesen Dienst ${freeAfter === 1 ? 'ist jetzt 1 Platz' : `sind jetzt ${freeAfter} Plätze`} frei.` : '',
        ].filter(Boolean),
        rows: [
          ...shiftRows(event, shift).slice(0, 3),
          ['Helfer', signup.name],
          ['E-Mail', signup.email],
          ['Telefon', signup.phone || '–'],
          ['Begründung', signup.cancel_reason || '–'],
        ],
        button: { label: 'Dienstplan öffnen', url: adminUrl(event) },
      },
    }),
  ]);
  await webhook('signup.cancelled', hookData(event, shift, signup));
}

async function adminRemovedSignup(event, shift, signup) {
  await mail.sendSafe({
    to: signup.email,
    replyTo: event.admin_email,
    subject: `Änderung: ${shift.title} – ${event.title}`,
    content: {
      title: 'Dein Dienst wurde geändert',
      paragraphs: [`Hallo ${signup.name},`, `die Veranstaltungsleitung hat dich aus dem Dienst „${shift.title}“ ausgetragen. Bei Fragen antworte einfach auf diese Mail.`],
      rows: shiftRows(event, shift),
    },
    attachments: await attachmentsFor(event, shift, signup, { cancelled: true }),
  });
}

async function broadcast(event, recipients, subject, body) {
  for (const r of recipients) {
    await mail.sendSafe({
      to: r.email,
      replyTo: event.admin_email,
      subject: `${event.title}: ${subject}`,
      content: {
        title: subject,
        paragraphs: [`Hallo ${r.name},`, body, `Viele Grüße\n${event.admin_name}`],
        button: { label: 'Zur Veranstaltung', url: r.token ? manageUrl(r) : eventUrl(event) },
      },
    });
  }
}

module.exports = { eventCreated, signupCreated, reminder, signupCancelled, adminRemovedSignup, broadcast, eventUrl, adminUrl, manageUrl };
