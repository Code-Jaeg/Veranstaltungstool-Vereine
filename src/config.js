'use strict';
const path = require('node:path');

const env = process.env;

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
  // Optional: n8n-Webhook, der bei Anmeldung/Absage benachrichtigt wird.
  webhookUrl: env.N8N_WEBHOOK_URL || '',
  imprintUrl: env.IMPRINT_URL || '',
  privacyUrl: env.PRIVACY_URL || '',
};
