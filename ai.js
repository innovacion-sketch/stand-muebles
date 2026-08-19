// ============================================================================
//  Análisis de fotos con IA (visión) — proveedor conectable.
//  Por ahora: Google Gemini (free tier). Se activa solo si hay GEMINI_API_KEY.
//  Corre en segundo plano (cola), para no retrasar el envío de las sucursales.
// ============================================================================
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { DATA_DIR, AI_PROVIDER, GEMINI_API_KEYS, GEMINI_MODEL, AI_DELAY_MS, SECCIONES } = config;

// Rotación de claves: se avanza a la siguiente cuando una se agota/falla.
let keyIndex = 0;
const dbStore = require('./db');

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// ---------------------------------------------------------------------------
//  CHECKLIST POR SECCIÓN — Edita aquí qué debe revisar la IA en cada parte.
// ---------------------------------------------------------------------------
const CHECKLIST = {
  impresora:      'Impresora 3D Sidhe. Revisa: piezas rotas o sueltas, filamento atorado, suciedad, tapa/puerta en buen estado, cables ordenados. ¿Se ve operativa?',
  cajones:        'Cajones del mueble. Revisa: jaladeras y rieles completos, que no estén rotos ni vencidos, sin daños visibles.',
  barandal_lado1: 'Barandal del stand. Revisa: dobleces, tornillos flojos, óxido, vidrio o acrílico roto/rayado, firmeza.',
  barandal_lado2: 'Barandal del stand. Revisa: dobleces, tornillos flojos, óxido, vidrio o acrílico roto/rayado, firmeza.',
  puerta:         'Puerta del mueble. Revisa: bisagras, cerradura, que no esté dañada ni desalineada.',
  silla:          'Silla del cliente. Revisa: tapizado sin roturas, base y ruedas completas, que se vea estable y limpia.',
  modem:          'Módem o router. Revisa: que se vea encendido (luces), cables conectados, sin daños.',
  pantallas:      'Pantalla o monitor de exhibición. Revisa: encendida, sin grietas, mostrando contenido.',
  tablets:        'Tablet(s). Revisa: encendida, pantalla sin grietas, funcionando, sin daños.',
  baropodometro:  'Baropodómetro Sidhe (plataforma circular con anillo iluminado y tapete de calibración). Revisa: cristal/anillo sin grietas, tapete presente y limpio, que se vea encendido.',
  escaner:        'Escáner 3D de pie (isun3D: tapete negro con silueta de pies y marcadores). Revisa: tapete completo y limpio, sin roturas, marcadores visibles, equipo conectado y en su lugar.',
  computadora:    'Computadora o monitor del stand. Revisa: encendida, mostrando el sitio de Sidhe, sin daños, cables ordenados.',
  zapatos:        'Zapatos o sandalias en exhibición. Revisa: acomodo ordenado, producto limpio y presente, exhibición completa.',
  extras:         'Otros elementos del stand. Describe su estado general y cualquier daño o falta evidente.',
  desperfectos:   'Fotos de daños o desperfectos reportados. Describe el daño visible y qué tan grave es.',
};

function isEnabled() { return AI_PROVIDER === 'gemini' && GEMINI_API_KEYS.length > 0; }

// ¿El error indica que la clave se agotó o es inválida? (para rotar a la siguiente)
function esErrorDeClave(status, texto) {
  if (status === 429) return true; // límite de peticiones / cuota
  return /RESOURCE_EXHAUSTED|quota|exhausted|rate limit|API key not valid|invalid.?api.?key|permission|expired/i.test(texto || '');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function mimeDe(f) {
  const e = path.extname(f).toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.webp') return 'image/webp';
  return 'image/jpeg';
}

// Instrucción para analizar VARIAS secciones en una sola llamada (ahorra cuota).
function promptLote() {
  return `Eres un inspector de mantenimiento de stands de la marca Sidhe (plantillas personalizadas y escaneo de pisada).
A continuación recibes varias secciones del stand. Cada una viene marcada con "[SECCION <clave>] <nombre>", su lista de "Qué revisar", y luego sus fotos.
Analiza CADA sección y responde SOLO con un objeto JSON válido (en español, sin markdown, sin texto extra) con UNA entrada por cada <clave>, exactamente así:
{"<clave>": {"estado":"ok|atencion|falla","hallazgos":["..."],"faltantes":["..."],"resumen":"...","confianza":0.0}, "<otra_clave>": { ... }}
Reglas por sección:
- "estado": "ok" si se ve bien; "atencion" si hay algo menor, dudoso o mala calidad de foto; "falla" si hay daño claro o no funciona.
- "hallazgos": problemas o daños visibles (vacío si no hay).
- "faltantes": elementos que deberían estar y no aparecen (vacío si no aplica).
- "resumen": una frase corta del estado.
- "confianza": número de 0 a 1 según la claridad de la foto.
Usa EXACTAMENTE las claves indicadas entre corchetes como llaves del JSON. Incluye TODAS las secciones que recibas.`;
}

function extraeJson(txt) {
  const m = txt && txt.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* noop */ } }
  return null;
}

function normaliza(p) {
  const estados = ['ok', 'atencion', 'falla'];
  const out = {
    estado: estados.includes((p && p.estado) || '') ? p.estado : 'atencion',
    hallazgos: Array.isArray(p && p.hallazgos) ? p.hallazgos.filter(Boolean).map(String) : [],
    faltantes: Array.isArray(p && p.faltantes) ? p.faltantes.filter(Boolean).map(String) : [],
    resumen: (p && typeof p.resumen === 'string') ? p.resumen : '',
    confianza: (p && typeof p.confianza === 'number') ? Math.max(0, Math.min(1, p.confianza)) : null,
    analizadoEn: new Date().toISOString(),
    modelo: GEMINI_MODEL,
  };
  return out;
}

// Llama a Gemini con las partes dadas (texto + imágenes) y devuelve el texto de la respuesta.
// Rota entre las claves cuando una se agota/falla (con pausa para no quemarlas de golpe).
async function geminiGenerate(parts) {
  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };
  let ultimoError;
  for (let intento = 0; intento < GEMINI_API_KEYS.length; intento++) {
    const clave = GEMINI_API_KEYS[keyIndex];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${clave}`;
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

    if (res.ok) {
      const json = await res.json();
      return (json.candidates && json.candidates[0] && json.candidates[0].content
        && json.candidates[0].content.parts || []).map((x) => x.text || '').join('');
    }

    const t = await res.text();
    ultimoError = new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`);

    if (GEMINI_API_KEYS.length > 1 && esErrorDeClave(res.status, t)) {
      const anterior = keyIndex + 1;
      keyIndex = (keyIndex + 1) % GEMINI_API_KEYS.length;
      console.warn(`[IA] Clave #${anterior} agotada/no válida (${res.status}). Rotando a la clave #${keyIndex + 1}...`);
      await sleep(700); // pausa entre claves para no agotarlas en ráfaga
      continue;
    }
    throw ultimoError; // error no relacionado con la clave
  }
  throw ultimoError || new Error('Todas las claves de Gemini están agotadas.');
}

// Analiza un grupo de secciones en UNA sola llamada. Devuelve { clave: veredictoCrudo }.
async function geminiLote(rep, secciones) {
  const parts = [{ text: promptLote() }];
  let hayImagenes = false;
  for (const sec of secciones) {
    const check = CHECKLIST[sec.key] || `Elemento del stand: ${sec.label}. Revisa su estado general, daños o cosas faltantes.`;
    parts.push({ text: `\n[SECCION ${sec.key}] ${sec.label}\nQué revisar: ${check}\nFotos:` });
    for (const f of (rep.secciones[sec.key].fotos || []).slice(0, 8)) {
      const p = path.join(UPLOAD_DIR, f);
      if (!fs.existsSync(p)) continue;
      parts.push({ inline_data: { mime_type: mimeDe(f), data: fs.readFileSync(p).toString('base64') } });
      hayImagenes = true;
    }
  }
  if (!hayImagenes) return {};

  const text = await geminiGenerate(parts);
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { parsed = extraeJson(text); }
  return (parsed && typeof parsed === 'object') ? parsed : {};
}

// Máximo de imágenes por llamada (para no exceder el tamaño del request).
const MAX_IMG_LOTE = 20;

// Analiza un reporte completo en pocas llamadas (agrupa secciones por lote).
async function analizarReporte(reportId) {
  if (!isEnabled()) return;
  let data = dbStore.load();
  let rep = data.reportes.find((r) => r.id === reportId);
  if (!rep) return;
  console.log(`[IA] Analizando reporte ${rep.sucursal} (${rep.semana})...`);

  const seccionesConFotos = SECCIONES.filter((s) => {
    const d = rep.secciones[s.key];
    return d && d.fotos && d.fotos.length;
  });

  // Agrupar secciones en lotes hasta MAX_IMG_LOTE imágenes por llamada.
  const lotes = [];
  let grupo = [], imgs = 0;
  for (const s of seccionesConFotos) {
    const n = Math.min(rep.secciones[s.key].fotos.length, 8);
    if (grupo.length && imgs + n > MAX_IMG_LOTE) { lotes.push(grupo); grupo = []; imgs = 0; }
    grupo.push(s); imgs += n;
  }
  if (grupo.length) lotes.push(grupo);

  for (let li = 0; li < lotes.length; li++) {
    const secs = lotes[li];
    let veredictos = {};
    try {
      veredictos = await geminiLote(rep, secs);
    } catch (e) {
      console.error(`[IA] Error analizando ${rep.sucursal} (lote ${li + 1}/${lotes.length}):`, e.message);
      for (const s of secs) veredictos[s.key] = { estado: 'error', error: e.message, analizadoEn: new Date().toISOString() };
    }
    // recargar en fresco para no pisar envíos concurrentes
    data = dbStore.load();
    rep = data.reportes.find((r) => r.id === reportId);
    if (!rep) return;
    for (const s of secs) {
      const raw = veredictos[s.key];
      if (raw && raw.estado === 'error') rep.secciones[s.key].ia = raw;
      else if (raw) rep.secciones[s.key].ia = normaliza(raw);
      // si la IA no devolvió esta sección, se queda sin veredicto (no la marcamos como falsa alerta).
    }
    await dbStore.save(data);
    if (li < lotes.length - 1) await sleep(AI_DELAY_MS);
  }

  data = dbStore.load();
  rep = data.reportes.find((r) => r.id === reportId);
  if (rep) {
    const conError = Object.values(rep.secciones).some((s) => s.ia && s.ia.estado === 'error');
    rep.iaEstado = conError ? 'error' : 'listo';
    rep.iaResumen = resumen(rep);
    await dbStore.save(data);
    console.log(`[IA] Reporte ${rep.sucursal} ${conError ? 'con errores (se reintentará)' : 'listo'}. Alertas: ${rep.iaResumen.alertas}. Llamadas: ${lotes.length}.`);
  }
}

function resumen(rep) {
  let alertas = 0, fallas = 0;
  for (const s of Object.values(rep.secciones)) {
    if (s.ia && (s.ia.estado === 'atencion' || s.ia.estado === 'falla')) alertas++;
    if (s.ia && s.ia.estado === 'falla') fallas++;
  }
  return { alertas, fallas };
}

// --------------------------- Cola en segundo plano --------------------------
const cola = [];
let procesando = false;
function enqueue(reportId) {
  if (!isEnabled()) return;
  if (!cola.includes(reportId)) cola.push(reportId);
  procesar();
}
async function procesar() {
  if (procesando) return;
  procesando = true;
  while (cola.length) {
    const id = cola.shift();
    try { await analizarReporte(id); } catch (e) { console.error('[IA] Fallo en cola:', e.message); }
  }
  procesando = false;
}

// Reintento automático: cada cierto tiempo re-encola los reportes que quedaron
// en error (p. ej. por cuota agotada), para que se completen solos al liberarse.
let retryTimer = null;
function iniciarReintentos() {
  if (!isEnabled() || retryTimer) return;
  const cadaMin = parseInt(process.env.AI_RETRY_MIN || '30', 10);
  if (!(cadaMin > 0)) return;
  retryTimer = setInterval(() => {
    const data = dbStore.load();
    const errs = data.reportes.filter((r) => r.iaEstado === 'error');
    if (errs.length) {
      console.log(`[IA] Reintentando ${errs.length} reporte(s) en error...`);
      for (const r of errs) enqueue(r.id);
    }
  }, cadaMin * 60 * 1000);
  if (retryTimer.unref) retryTimer.unref();
}

// Al arrancar, re-encola reportes pendientes o en error, y activa el reintento.
function startupPending() {
  if (!isEnabled()) { console.log('[IA] Deshabilitada (sin GEMINI_API_KEY).'); return; }
  console.log(`[IA] Activa con modelo ${GEMINI_MODEL}. Claves configuradas: ${GEMINI_API_KEYS.length}${GEMINI_API_KEYS.length > 1 ? ' (rotación activada)' : ''}.`);
  const data = dbStore.load();
  for (const r of data.reportes) {
    if (r.iaEstado === 'pendiente' || r.iaEstado === 'error') enqueue(r.id);
  }
  iniciarReintentos();
}

module.exports = { isEnabled, enqueue, analizarReporte, startupPending, CHECKLIST };
