'use strict';
const path = require('node:path');

const fs = require('node:fs');

// Geheimnisse können auch als Datei übergeben werden (z. B. CREATE_PASSWORD_FILE=/secrets/create_password),
// damit sie nicht im Klartext in der Compose-Datei stehen.
const SECRET_KEYS = ['CREATE_PASSWORD', 'WEBHOOK_SECRET', 'SMTP_USER', 'SMTP_PASS', 'MAIL_WEBHOOK_URL', 'N8N_WEBHOOK_URL'];
const env = { ...process.env };
for (const name of SECRET_KEYS) {
  const file = process.env[`${name}_FILE`];
  if (!file) continue;
  try {
    env[name] = fs.readFileSync(file, 'utf8').trim();
  } catch (err) {
    console.error(`[config] ${name}_FILE: Datei nicht lesbar (${err.code})`);
  }
}

module.exports = {
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  dataDir: env.DATA_DIR || path.join(__dirname, '..', 'data'),
  appName: env.APP_NAME || 'Vereinsdienste',
  // Wenn gesetzt, braucht man dieses Passwort, um neue Veranstaltungen anzulegen.
  createPassword: env.CREATE_PASSWORD || '',
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Vereinsdienste <no-reply@localhost>',
  },
  // Kommagetrennte Liste: Stunden vor Schichtbeginn, zu denen erinnert wird.
  reminderHours: (env.REMINDER_HOURS || '48')
    .split(',').map((h) => Number(h.trim())).filter((h) => h > 0).sort((a, b) => b - a),
  // Tage vor der Veranstaltung, an denen die Leitung einen Kurzbericht zur Besetzung bekommt (0 = aus).
  reportDaysBefore: Number(env.REPORT_DAYS_BEFORE ?? 3),
  // Tage nach der Veranstaltung, nach denen personenbezogene Daten gelöscht werden (0 = nie).
  retentionDays: Number(env.DATA_RETENTION_DAYS ?? 30),
  // Alternativ zu SMTP: Mails an einen n8n-Webhook übergeben, der sie versendet.
  mailWebhookUrl: env.MAIL_WEBHOOK_URL || '',
  // Optional: n8n-Webhook, der bei Anmeldung/Absage benachrichtigt wird.
  webhookUrl: env.N8N_WEBHOOK_URL || '',
  // Gemeinsames Geheimnis, das als Header X-Vereinsdienste-Secret an die Webhooks geht.
  webhookSecret: env.WEBHOOK_SECRET || '',
  // Angaben für Impressum und Datenschutzerklärung.
  operator: {
    name: env.OPERATOR_NAME || '',
    address: env.OPERATOR_ADDRESS || '',
    email: env.OPERATOR_EMAIL || '',
    representative: env.OPERATOR_REPRESENTATIVE || '',
    register: env.OPERATOR_REGISTER || '',
    // Vollständige Datenschutzerklärung des Betreibers (z. B. Vereinswebsite)
    privacyUrl: env.OPERATOR_PRIVACY_URL || '',
    // Zusätzlicher Datenschutzhinweis des Betreibers (Freitext)
    privacyNote: env.OPERATOR_PRIVACY_NOTE || '',
  },
  imprintUrl: env.IMPRINT_URL || '',
  privacyUrl: env.PRIVACY_URL || '',
};
