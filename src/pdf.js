'use strict';
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const config = require('./config');
const { fmtRange, fmtDate, fmtTime, publicName } = require('./util');

const BLUE = '#007AFF';
const GREY = '#6E6E73';
const RED = '#FF3B30';

const qrPng = (url) => QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 600 });

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
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(22).text(event.title, { width: 400 });
  doc.font('Helvetica').fillColor(GREY).fontSize(12)
    .text([fmtDate(event.event_date), event.location].filter(Boolean).join(' · '), { width: 400 });
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

function footer(doc) {
  doc.fontSize(8).fillColor(GREY).text(`Erstellt am ${new Date().toLocaleString('de-DE')} · ${config.appName}`, 50, 780, { align: 'center', width: 495, lineBreak: false });
}

const entryLabel = (shift, signup) => (shift.kind === 'item' ? `${signup.quantity}× ${shift.title} mitbringen` : shift.title);
const entryTime = (shift) => (shift.kind === 'item' ? `bis ${fmtDate(shift.starts_at)}, ${fmtTime(shift.starts_at)} Uhr` : fmtRange(shift.starts_at, shift.ends_at));

/**
 * Bestätigung für alle Dienste einer Person.
 * entries: [{ shift, signup, position }] – position nur bei Warteliste.
 */
async function helperConfirmation(event, helper, entries, manageUrl) {
  const qr = await qrPng(manageUrl);
  return toBuffer((doc) => {
    header(doc, event, 'Dienstbestätigung');
    doc.image(qr, 465, 50, { width: 80 });
    row(doc, 'Name', helper.name);
    for (const { shift, signup, position } of entries) {
      const status = signup.status === 'waiting' ? `Warteliste, Platz ${position}` : signup.status === 'cancelled' ? 'abgesagt' : '';
      const value = [entryTime(shift), status, signup.note, shift.description].filter(Boolean).join('\n');
      row(doc, entryLabel(shift, signup), value);
    }
    row(doc, 'Ort', event.location);
    row(doc, 'Ansprechpartner', [event.admin_name, event.admin_phone, event.admin_email].filter(Boolean).join('\n'));
    doc.moveDown(1).fontSize(11).fillColor('#000')
      .text('Vielen Dank, dass du mithilfst! Falls du kurzfristig verhindert bist, sage bitte über den folgenden Link oder den QR-Code ab, damit wir Ersatz organisieren können:', 50);
    doc.moveDown(0.5).fillColor(BLUE).text(manageUrl, { link: manageUrl, underline: true });
  });
}

/** Gesamter Dienstplan für die Leitung (mit Kontaktdaten) oder zum Aushang (ohne, mit QR-Code). */
async function rosterPdf(event, shifts, { withContacts = true, publicUrl } = {}) {
  const qr = !withContacts && publicUrl ? await qrPng(publicUrl) : null;
  return toBuffer((doc) => {
    header(doc, event, withContacts ? 'Dienstplan' : 'Dienstplan – jetzt eintragen!');
    if (qr) {
      doc.image(qr, 455, 45, { width: 90 });
      doc.fontSize(7).fillColor(GREY).text('Scannen und eintragen', 455, 137, { width: 90, align: 'center' });
      doc.x = 50; doc.y = Math.max(doc.y, 150);
    }
    let section = null;
    for (const s of shifts) {
      if (doc.y > 700) doc.addPage();
      if (s.kind !== section) {
        section = s.kind;
        if (section === 'item') doc.moveDown(0.4).font('Helvetica-Bold').fontSize(15).fillColor(BLUE).text('Mitbringliste', 50).moveDown(0.3);
      }
      const isItem = s.kind === 'item';
      const when = isItem ? `bis ${fmtDate(s.starts_at)}, ${fmtTime(s.starts_at)} Uhr` : `${fmtDate(s.starts_at)}, ${fmtTime(s.starts_at)}–${fmtTime(s.ends_at)} Uhr`;
      const need = s.min_capacity > 0 && s.min_capacity < s.capacity ? ` (mind. ${s.min_capacity})` : '';
      doc.font('Helvetica-Bold').fontSize(13).fillColor(s.critical ? RED : '#000')
        .text(`${s.title}`, 50, doc.y, { continued: true })
        .font('Helvetica').fillColor(GREY).fontSize(11)
        .text(`   ${when}  ·  ${s.filled}/${s.capacity}${need} ${isItem ? 'zugesagt' : 'besetzt'}`);
      if (s.requirement) doc.fillColor(GREY).fontSize(10).text(`Gesucht: ${s.requirement}`, 65);
      doc.moveDown(0.3);
      if (!s.active.length) doc.fillColor(RED).fontSize(11).text('– noch niemand eingetragen –', 65);
      for (const p of s.active) {
        // Zum Aushang wie auf der öffentlichen Seite nur „Vorname N.“
        const name = withContacts ? p.name : publicName(p.name);
        const contact = withContacts ? [p.email, p.phone].filter(Boolean).join(' · ') : '';
        const label = isItem ? `${p.quantity}× ${name}${p.note ? ` – ${p.note}` : ''}` : name;
        doc.fillColor('#000').fontSize(11).text(`•  ${label}${contact ? `   (${contact})` : ''}`, 65);
      }
      if (!isItem) for (let i = 0; i < s.free && s.active.length; i++) doc.fillColor(GREY).text('•  ____________________', 65);
      if (withContacts && s.waiting.length) {
        doc.fillColor(GREY).fontSize(10).text(`Warteliste: ${s.waiting.map((w) => w.name).join(', ')}`, 65);
      }
      doc.moveDown(0.8);
    }
    footer(doc);
  });
}

/** Plakat für Schwarzes Brett oder Elternbrief: großer QR-Code zur Anmeldeseite. */
async function posterPdf(event, publicUrl, { open = 0 } = {}) {
  const qr = await qrPng(publicUrl);
  return toBuffer((doc) => {
    if (event.organization) doc.fillColor(GREY).fontSize(16).text(event.organization, { align: 'center' });
    doc.moveDown(0.5).fillColor('#000').font('Helvetica-Bold').fontSize(34).text(event.title, { align: 'center' });
    doc.moveDown(0.3).font('Helvetica').fillColor(GREY).fontSize(16)
      .text([fmtDate(event.event_date), event.location].filter(Boolean).join(' · '), { align: 'center' });
    doc.moveDown(1.2).fillColor(BLUE).font('Helvetica-Bold').fontSize(26).text('Helferinnen und Helfer gesucht!', { align: 'center' });
    if (open > 0) doc.moveDown(0.3).fillColor('#000').font('Helvetica').fontSize(15).text(`Noch ${open} ${open === 1 ? 'Platz' : 'Plätze'} frei.`, { align: 'center' });
    const size = 300;
    doc.image(qr, (595 - size) / 2, doc.y + 25, { width: size });
    doc.y += size + 45;
    doc.fillColor('#000').font('Helvetica').fontSize(14).text('QR-Code mit dem Handy scannen, Dienst aussuchen, eintragen – fertig.', 50, doc.y, { align: 'center', width: 495 });
    doc.moveDown(0.6).fillColor(BLUE).fontSize(12).text(publicUrl, { align: 'center', width: 495, link: publicUrl });
    if (event.admin_name) {
      doc.moveDown(1.2).fillColor(GREY).fontSize(11)
        .text(`Fragen? ${[event.admin_name, event.admin_phone].filter(Boolean).join(' · ')}`, { align: 'center', width: 495 });
    }
    footer(doc);
  });
}

module.exports = { helperConfirmation, rosterPdf, posterPdf, qrPng };
