// Utilidades de fechas: el reporte es semanal (cada martes).
// Agrupamos por semana ISO (lunes-domingo) para saber qué sucursal ya reportó.

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Jueves de la semana define el año ISO
  const dayNum = (d.getUTCDay() + 6) % 7; // lunes=0 ... domingo=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return { year: d.getUTCFullYear(), week };
}

function weekKey(date) {
  const { year, week } = isoWeek(date);
  return `${year}-S${String(week).padStart(2, '0')}`;
}

// Rango de fechas (lunes a domingo) de una weekKey, para mostrarlo bonito.
function weekRange(key) {
  const [yStr, wStr] = key.split('-S');
  const year = parseInt(yStr, 10);
  const week = parseInt(wStr, 10);
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dayNum = (simple.getUTCDay() + 6) % 7;
  const monday = new Date(simple);
  monday.setUTCDate(simple.getUTCDate() - dayNum);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (dt) => `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
  return `${fmt(monday)} al ${fmt(sunday)}`;
}

// Lista de las últimas N semanas (incluida la actual), más reciente primero.
function recentWeeks(n = 12) {
  const weeks = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i * 7);
    weeks.push(weekKey(d));
  }
  return [...new Set(weeks)];
}

// Normaliza un nombre de sucursal para comparar (sin acentos, minúsculas, espacios colapsados).
function normalizaNombre(s) {
  return String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
    // El sistema de asistencias guarda las sucursales como "Liverpool <nombre>"
    // (son stands dentro de Liverpool). Ignoramos ese prefijo para que casen.
    .replace(/^liverpool\s+/, '');
}

module.exports = { isoWeek, weekKey, weekRange, recentWeeks, normalizaNombre };
