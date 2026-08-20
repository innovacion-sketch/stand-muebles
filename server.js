const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const config = require('./config');
const { REGIONES, SUCURSALES, SECCIONES, DATA_DIR, ADMIN_PASSWORD, SESSION_SECRET, PORT } = config;

// Región a la que pertenece cada sucursal (para el panel).
const REGION_DE = {};
for (const r of REGIONES) for (const s of r.sucursales) REGION_DE[s] = r.nombre;

// ¿El reporte tiene alguna incidencia? (una sección marcada "no funcional")
function tieneIncidencia(reporte) {
  return Object.values(reporte.secciones || {}).some((s) => s && s.estado === 'issue');
}
const dbStore = require('./db');
const { weekKey, weekRange, recentWeeks, normalizaNombre } = require('./utils');
const { buildPDF } = require('./pdf');
const ai = require('./ai');

// Sharp es opcional: si no carga, se guardan las imágenes originales.
let sharp = null;
try { sharp = require('sharp'); } catch (e) { console.warn('sharp no disponible, se guardan imágenes sin optimizar.'); }

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 horas
}));

// -------- Subida de archivos (en memoria para poder optimizar con sharp) --------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 200 }, // 25MB por foto
});

async function guardarImagen(file) {
  const id = crypto.randomBytes(8).toString('hex');
  const outName = `${id}.jpg`;
  const outPath = path.join(UPLOAD_DIR, outName);
  if (sharp) {
    try {
      await sharp(file.buffer, { failOn: 'none' }) // tolerante con fotos imperfectas
        .rotate() // respeta orientación EXIF del celular
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 72 })
        .toFile(outPath);
      return outName;
    } catch (e) {
      console.warn('Fallo sharp, guardo original:', e.message);
    }
  }
  const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
  const fallbackName = `${id}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fallbackName), file.buffer);
  return fallbackName;
}

// ============================ RUTAS PÚBLICAS ============================

// Config para el formulario
app.get('/api/config', (req, res) => {
  // Qué imágenes de referencia existen (public/referencias/<clave>.<ext>).
  const referencias = {};
  try {
    for (const f of fs.readdirSync(path.join(__dirname, 'public', 'referencias'))) {
      const m = /^(.+)\.(jpe?g|png|webp)$/i.exec(f);
      if (m) referencias[m[1]] = f;
    }
  } catch (e) { /* sin carpeta o vacía */ }

  res.json({
    sucursales: SUCURSALES,
    regiones: REGIONES,
    referencias,
    secciones: SECCIONES.map((s) => ({
      key: s.key, grupo: s.grupo || '', label: s.label, estado: !!s.estado, estadoLabel: s.estadoLabel || '¿En buen estado?',
      fotos: !!s.fotos, minFotos: s.minFotos || 0, opcional: !!s.opcional, hint: s.hint || '',
    })),
  });
});

// Pendientes de la semana pasada para una sucursal (para la sección de avances).
app.get('/api/pendientes-semana-pasada', (req, res) => {
  const norm = normalizaNombre((req.query.sucursal || '').toString());
  if (!norm) return res.status(400).json({ error: 'falta_sucursal' });
  const semanaPasada = weekKey(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const data = dbStore.load();
  const previos = data.reportes
    .filter((r) => normalizaNombre(r.sucursal) === norm && r.semana === semanaPasada)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const r = previos[0];
  if (!r) return res.json({ semana: semanaPasada, hayReporte: false, pendientes: [], sugerencias: '' });

  const pendientes = [];
  for (const sec of SECCIONES) {
    const d = r.secciones[sec.key];
    if (d && sec.estado && d.estado === 'issue') {
      pendientes.push({ seccion: sec.label, comentario: d.comentarios || '' });
    }
  }
  const desp = r.secciones && r.secciones.desperfectos;
  if (desp && ((desp.fotos && desp.fotos.length) || desp.comentarios)) {
    pendientes.push({ seccion: 'Desperfectos / Daños', comentario: desp.comentarios || '' });
  }
  res.json({ semana: semanaPasada, hayReporte: true, pendientes, sugerencias: r.sugerencias || '' });
});

// Enviar reporte
app.post('/api/reportes', upload.any(), async (req, res) => {
  try {
    const sucursal = (req.body.sucursal || '').trim();
    if (!SUCURSALES.includes(sucursal)) {
      return res.status(400).json({ error: 'Selecciona una sucursal válida.' });
    }
    const responsable = (req.body.responsable || '').trim();
    const sugerencias = (req.body.sugerencias || '').trim();

    // Agrupar archivos por sección (fieldname = "foto_<key>")
    const filesBySection = {};
    for (const f of req.files || []) {
      const m = /^foto_(.+)$/.exec(f.fieldname);
      if (!m) continue;
      (filesBySection[m[1]] = filesBySection[m[1]] || []).push(f);
    }

    const secciones = {};
    for (const sec of SECCIONES) {
      const files = filesBySection[sec.key] || [];
      const nombres = [];
      for (const file of files) nombres.push(await guardarImagen(file));
      secciones[sec.key] = {
        estado: req.body[`estado_${sec.key}`] || null, // 'ok' | 'issue' | null
        comentarios: (req.body[`comentarios_${sec.key}`] || '').trim(),
        fotos: nombres,
      };
    }

    const now = new Date();
    const reporte = {
      id: crypto.randomBytes(10).toString('hex'),
      sucursal,
      responsable,
      semana: weekKey(now),
      createdAt: now.toISOString(),
      secciones,
      sugerencias,
      avances: {
        estado: (req.body.avances_estado || '').trim(),        // 'si' | 'parcial' | 'no' | ''
        comentarios: (req.body.avances_comentarios || '').trim(),
      },
      iaEstado: ai.isEnabled() ? 'pendiente' : 'off',
    };

    const data = dbStore.load();
    data.reportes.push(reporte);
    await dbStore.save(data);

    // Análisis con IA en segundo plano (no bloquea la respuesta).
    ai.enqueue(reporte.id);

    res.json({ ok: true, id: reporte.id, semana: reporte.semana });
  } catch (e) {
    console.error('Error al guardar reporte:', e);
    res.status(500).json({ error: 'No se pudo guardar el reporte. Intenta de nuevo.' });
  }
});

// ============================ AUTENTICACIÓN ADMIN ============================
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ error: 'No autorizado' });
}

app.post('/api/admin/login', (req, res) => {
  const pass = (req.body && req.body.password) || '';
  if (pass && pass === ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Contraseña incorrecta' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/me', (req, res) => {
  res.json({ admin: !!(req.session && req.session.admin) });
});

// ============================ RUTAS ADMIN ============================

// Estado por semana: qué sucursales reportaron y cuáles no.
app.get('/api/admin/estado', requireAdmin, (req, res) => {
  const semana = req.query.semana || weekKey(new Date());
  const data = dbStore.load();
  const reportesSemana = data.reportes.filter((r) => r.semana === semana);
  const porSucursal = {};
  for (const r of reportesSemana) {
    // guardar el más reciente por sucursal
    if (!porSucursal[r.sucursal] || r.createdAt > porSucursal[r.sucursal].createdAt) {
      porSucursal[r.sucursal] = r;
    }
  }
  const filas = SUCURSALES.map((suc) => {
    const r = porSucursal[suc];
    const alertaIA = r ? Object.values(r.secciones || {}).some((s) => s.ia && (s.ia.estado === 'atencion' || s.ia.estado === 'falla')) : false;
    return {
      sucursal: suc,
      region: REGION_DE[suc] || '',
      reporto: !!r,
      incidencia: r ? tieneIncidencia(r) : false,
      iaEstado: r ? (r.iaEstado || 'off') : null, // pendiente | listo | error | off
      alertaIA,
      id: r ? r.id : null,
      createdAt: r ? r.createdAt : null,
      responsable: r ? r.responsable : null,
    };
  });
  // Agrupar por región, respetando el orden de config.
  const grupos = REGIONES.map((reg) => ({
    nombre: reg.nombre,
    filas: filas.filter((f) => f.region === reg.nombre),
  }));

  // Resumen de alertas de IA de la semana (para el panel).
  const resumenIA = [];
  for (const suc of SUCURSALES) {
    const r = porSucursal[suc];
    if (!r) continue;
    const items = [];
    for (const s of SECCIONES) {
      const d = r.secciones[s.key];
      if (d && d.ia && (d.ia.estado === 'atencion' || d.ia.estado === 'falla')) {
        items.push({
          seccion: s.label,
          estado: d.ia.estado,
          hallazgos: d.ia.hallazgos || [],
          faltantes: d.ia.faltantes || [],
        });
      }
    }
    if (items.length) resumenIA.push({ sucursal: suc, region: REGION_DE[suc] || '', id: r.id, items });
  }
  res.json({
    semana,
    rango: weekRange(semana),
    semanas: recentWeeks(12).map((k) => ({ key: k, rango: weekRange(k) })),
    total: SUCURSALES.length,
    completadas: filas.filter((f) => f.reporto).length,
    incidencias: filas.filter((f) => f.incidencia).length,
    alertasIA: filas.filter((f) => f.alertaIA).length,
    iaEnabled: ai.isEnabled(),
    iaPendientes: filas.filter((f) => f.iaEstado === 'pendiente').length,
    resumenIA,
    filas,
    grupos,
  });
});

// Lista completa de reportes (para explorar todos)
app.get('/api/admin/reportes', requireAdmin, (req, res) => {
  const data = dbStore.load();
  const lista = data.reportes
    .map((r) => ({
      id: r.id, sucursal: r.sucursal, semana: r.semana, createdAt: r.createdAt,
      responsable: r.responsable,
      totalFotos: Object.values(r.secciones || {}).reduce((a, s) => a + (s.fotos ? s.fotos.length : 0), 0),
    }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ reportes: lista });
});

// Detalle de un reporte (con nombres de fotos)
app.get('/api/admin/reportes/:id', requireAdmin, (req, res) => {
  const data = dbStore.load();
  const r = data.reportes.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  res.json({
    reporte: r,
    secciones: SECCIONES,
    rango: weekRange(r.semana),
  });
});

// Servir una foto (solo admin)
app.get('/api/admin/foto/:nombre', requireAdmin, (req, res) => {
  const nombre = path.basename(req.params.nombre); // evita path traversal
  const filePath = path.join(UPLOAD_DIR, nombre);
  if (!fs.existsSync(filePath)) return res.status(404).send('No encontrado');
  res.sendFile(filePath);
});

// Descargar PDF de un reporte (solo admin)
app.get('/api/admin/reportes/:id/pdf', requireAdmin, (req, res) => {
  const data = dbStore.load();
  const r = data.reportes.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).send('No encontrado');
  const nombreArchivo = `Reporte_${r.sucursal.replace(/[^a-z0-9]+/gi, '_')}_${r.semana}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  buildPDF(r, res);
});

// Reanalizar un reporte con IA (solo admin)
app.post('/api/admin/reportes/:id/reanalizar', requireAdmin, async (req, res) => {
  if (!ai.isEnabled()) return res.status(400).json({ error: 'IA no configurada (falta GEMINI_API_KEY)' });
  const data = dbStore.load();
  const r = data.reportes.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  r.iaEstado = 'pendiente';
  await dbStore.save(data);
  ai.enqueue(r.id);
  res.json({ ok: true });
});

// ============================ INTEGRACIÓN (asistencias) ============================
// Consulta si una sucursal ya completó su reporte de la semana.
// La usa el sistema de asistencias para permitir/bloquear la salida a comer.
// Protegida con la cabecera X-Integration-Key (define INTEGRATION_KEY).
app.get('/api/estado-sucursal', (req, res) => {
  if (!config.INTEGRATION_KEY) {
    return res.status(503).json({ error: 'integracion_no_configurada' });
  }
  if (req.get('X-Integration-Key') !== config.INTEGRATION_KEY) {
    return res.status(401).json({ error: 'no_autorizado' });
  }
  const nombre = (req.query.sucursal || '').toString();
  const norm = normalizaNombre(nombre);
  if (!norm) return res.status(400).json({ error: 'falta_sucursal' });

  const existe = SUCURSALES.some((s) => normalizaNombre(s) === norm);
  const semana = (req.query.semana || weekKey(new Date())).toString();
  const data = dbStore.load();
  const completo = data.reportes.some((r) => normalizaNombre(r.sucursal) === norm && r.semana === semana);

  res.json({ sucursal: nombre, existe, semana, completo });
});

// ============================ ESTÁTICOS ============================
app.use(express.static(path.join(__dirname, 'public')));

// Manejador de errores: SIEMPRE responde JSON (evita que multer u otros
// errores devuelvan una página HTML que rompe al cliente).
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err && err.message);
  if (res.headersSent) return next(err);
  let mensaje = 'No se pudo procesar la solicitud. Intenta de nuevo.';
  if (err && err.code === 'LIMIT_FILE_SIZE') mensaje = 'Una foto pesa demasiado. Intenta de nuevo (se comprimen solas al subir).';
  else if (err && err.code === 'LIMIT_FILE_COUNT') mensaje = 'Demasiadas fotos en un solo envío.';
  res.status((err && err.status) || 400).json({ error: 'error_procesar', message: mensaje });
});

app.listen(PORT, () => {
  console.log(`Stand Muebles corriendo en http://localhost:${PORT}`);
  console.log(`Datos en: ${DATA_DIR}`);
  if (ADMIN_PASSWORD === 'cambia-esta-clave') {
    console.warn('⚠  Estás usando la contraseña de administrador por defecto. Define ADMIN_PASSWORD.');
  }
  ai.startupPending();
});
