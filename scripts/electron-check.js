const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../lib/database');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-manager-electron-check-'));
const ctx = createDatabase(dir);
console.log('ELECTRON_SQLITE_OK', ctx.dbPath);
ctx.close();
