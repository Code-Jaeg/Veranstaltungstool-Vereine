'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

test('Mails gehen mit Anhängen und Geheimnis an den n8n-Webhook', async () => {
  let received;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received = { headers: req.headers, body: JSON.parse(body) }; res.end('ok'); });
  }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  process.env.MAIL_WEBHOOK_URL = `http://127.0.0.1:${srv.address().port}/mail`;
  process.env.WEBHOOK_SECRET = 'geheim';
  const mail = require('../src/mail');
  await mail.send({
    to: 'a@example.org', subject: 'Test', content: { title: 'Hallo' },
    attachments: [{ filename: 'dienst.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' }],
  });
  srv.close();
  assert.strictEqual(received.headers['x-vereinsdienste-secret'], 'geheim');
  assert.strictEqual(received.body.to, 'a@example.org');
  assert.match(received.body.html, /Hallo/);
  assert.strictEqual(Buffer.from(received.body.attachments[0].content, 'base64').toString(), 'BEGIN:VCALENDAR');
});
