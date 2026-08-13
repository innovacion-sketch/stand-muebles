// Base de datos sencilla en archivo JSON (sin dependencias nativas).
// Suficiente para el volumen de datos de reportes semanales.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) return { reportes: [] };
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('No se pudo leer db.json, se inicia vacío:', e.message);
    return { reportes: [] };
  }
}

// Cola de escritura simple para evitar corrupción por concurrencia.
let writing = Promise.resolve();
function save(data) {
  writing = writing.then(() => {
    ensureDir();
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_FILE);
  });
  return writing;
}

module.exports = { load, save, DB_FILE };
