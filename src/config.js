'use strict';
const path = require('node:path');

const fs = require('node:fs');

// Geheimnisse können auch als Datei übergeben werden (z. B. CREATE_PASSWORD_FILE=/secrets/create_password),
// damit sie nicht im Klartext in der Compose-Datei stehen.
const env = { ...process.env };
for (const key of Object.keys(process.env)) {
  if (!key.endsWith('_FILE')) continue;
  const name = key.slice(0, -5);
  try {
    env[name] = fs.readFileSync(process.env[key], 'utf8').trim();
  } catch (err) {
    console.error(`[config] ${key}: Datei nicht lesbar (${err.code})`);
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
  },
  imprintUrl: env.IMPRINT_URL || '',
  privacyUrl: env.PRIVACY_URL || '',
};
