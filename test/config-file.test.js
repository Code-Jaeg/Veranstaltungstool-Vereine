'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Geheimnisse werden aus *_FILE gelesen', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-')), 'pw');
  fs.writeFileSync(file, 'aus-datei\n');
  process.env.CREATE_PASSWORD_FILE = file;
  process.env.WEBHOOK_SECRET_FILE = file;
  const config = require('../src/config');
  assert.strictEqual(config.createPassword, 'aus-datei');
  assert.strictEqual(config.webhookSecret, 'aus-datei');
});
