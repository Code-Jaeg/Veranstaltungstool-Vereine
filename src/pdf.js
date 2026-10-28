'use strict';
const PDFDocument = require('pdfkit');
const config = require('./config');
const { fmtRange, fmtDate, fmtTime } = require('./util');

const BLUE = '#007AFF';
const GREY = '#6E6E73';

function toBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Producer: config.appName } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function header(doc, event, subtitle) {
  if (event.organization) doc.fillColor(GREY).fontSize(11).text(event.organization);
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(22).text(event.title);
  doc.font('Helvetica').fillColor(GREY).fontSize(12)
    .text([fmtDate(event.event_date), event.location].filter(Boolean).join(' · '));
  doc.moveDown(0.5).fillColor(BLUE).fontSize(14).text(subtitle);
  doc.moveTo(50, doc.y + 6).lineTo(545, doc.y + 6).strokeColor('#D1D1D6').stroke();
  doc.moveDown(1.2).fillColor('#000');
}

function row(doc, label, value) {
  if (!value) return;
  const y = doc.y;
  doc.font('Helvetica').fontSize(11).fillColor(GREY).text(label, 50, y, { width: 130 });
  doc.fillColor('#000').text(value, 185, y, { width: 360 });
  doc.moveDown(0.6);
}

/** Dienstbestätigung für eine einzelne Anmeldung. */
function signupConfirmation(event, shift, signup) {
  return toBuffer((doc) => {
    header(doc, event, 'Dienstbestätigung');
    row(doc, 'Name', signup.name);
    row(doc, 'Dienst', shift.title);
    row(doc, 'Zeit', fmtRange(shift.starts_at, shift.ends_at));
    row(doc, 'Ort', event.location);
    row(doc, 'Hinweise', shift.description);
    row(doc, 'Ansprechpartner', [event.admin_name, event.admin_phone, event.admin_email].filter(Boolean).join('\n'));
    doc.moveDown(1).fontSize(11).fillColor('#000')
      .text('Vielen Dank, dass du mithilfst! Falls du kurzfristig verhindert bist, sage bitte über den folgenden Link ab, damit wir Ersatz organisieren können:', 50);
    const url = `${config.baseUrl}/s/${signup.token}`;
    doc.moveDown(0.5).fillColor(BLUE).text(url, { link: url, underline: true });
  });
}

/** Gesamter Dienstplan für den Veranstaltungsadmin (mit Kontaktdaten) oder zum Aushang (ohne). */
function rosterPdf(event, shifts, { withContacts = true } = {}) {
  return toBuffer((doc) => {
    header(doc, event, 'Dienstplan');
    for (const s of shifts) {
      if (doc.y > 700) doc.addPage();
      const active = s.signups.filter((x) => x.status === 'active');
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#000')
        .text(`${s.title}`, 50, doc.y, { continued: true })
        .font('Helvetica').fillColor(GREY).fontSize(11)
        .text(`   ${fmtDate(s.starts_at)}, ${fmtTime(s.starts_at)}–${fmtTime(s.ends_at)} Uhr  ·  ${active.length}/${s.capacity} besetzt`);
      doc.moveDown(0.3);
      if (!active.length) doc.fillColor('#FF3B30').fontSize(11).text('– noch niemand eingetragen –', 65);
      for (const p of active) {
        const contact = withContacts ? [p.email, p.phone].filter(Boolean).join(' · ') : '';
        doc.fillColor('#000').fontSize(11).text(`•  ${p.name}${contact ? `   (${contact})` : ''}`, 65);
      }
      const free = s.capacity - active.length;
      for (let i = 0; i < free && active.length; i++) doc.fillColor(GREY).text('•  ____________________', 65);
      doc.moveDown(0.8);
    }
    doc.fontSize(8).fillColor(GREY).text(`Erstellt am ${new Date().toLocaleString('de-DE')} · ${config.appName}`, 50, 780, { align: 'center', width: 495 });
  });
}

module.exports = { signupConfirmation, rosterPdf };
