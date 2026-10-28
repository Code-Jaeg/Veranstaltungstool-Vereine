'use strict';
const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');
const config = require('./config');

let transport;
if (config.smtp.host) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
} else {
  // Ohne SMTP-Konfiguration werden Mails als .eml-Dateien in data/outbox abgelegt (Test/Entwicklung).
  transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Einfaches, mailclient-taugliches HTML im iOS-Look. */
function layout({ title, paragraphs = [], rows = [], button }) {
  const p = paragraphs.map((t) => `<p style="margin:0 0 12px">${escapeHtml(t).replace(/\n/g, '<br>')}</p>`).join('');
  const r = rows.length
    ? `<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:12px;margin:8px 0 16px">${rows
      .map(([k, v]) => `<tr><td style="padding:10px 14px;color:#6e6e73;border-bottom:1px solid #e5e5ea;width:35%">${escapeHtml(k)}</td><td style="padding:10px 14px;border-bottom:1px solid #e5e5ea">${escapeHtml(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`
    : '';
  const b = button
    ? `<p style="margin:20px 0"><a href="${escapeHtml(button.url)}" style="background:${button.color || '#007aff'};color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e;font-size:15px;line-height:1.45">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<h1 style="font-size:24px;margin:0 0 16px">${escapeHtml(title)}</h1>${p}${r}${b}
<p style="color:#8e8e93;font-size:12px;margin-top:24px">${escapeHtml(config.appName)} · ${escapeHtml(config.baseUrl)}</p>
</div></body></html>`;
}

function textVersion({ title, paragraphs = [], rows = [], button }) {
  return [title, '', ...paragraphs, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', button ? `${button.label}: ${button.url}` : '']
    .join('\n');
}

async function send({ to, subject, content, attachments = [], replyTo }) {
  const info = await transport.sendMail({
    from: config.smtp.from,
    to,
    replyTo,
    subject,
    html: layout(content),
    text: textVersion(content),
    attachments,
  });
  if (!config.smtp.host) {
    const dir = path.join(config.dataDir, 'outbox');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${String(to).replace(/[^a-z0-9@.]/gi, '_')}.eml`);
    fs.writeFileSync(file, info.message);
    console.log(`[mail] (kein SMTP) ${subject} -> ${to} gespeichert in ${file}`);
  }
  return info;
}

/** Fehler beim Mailversand sollen die Webanwendung nicht blockieren. */
function sendSafe(opts) {
  return send(opts).catch((err) => console.error(`[mail] Versand an ${opts.to} fehlgeschlagen:`, err.message));
}

module.exports = { send, sendSafe };
