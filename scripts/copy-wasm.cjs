const fs = require('node:fs');
const path = require('node:path');

const source = require.resolve('sql.js/dist/sql-wasm.wasm');
const destination = path.join(__dirname, '..', 'dist-electron', 'sql-wasm.wasm');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
