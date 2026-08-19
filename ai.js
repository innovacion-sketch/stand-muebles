// ============================================================================
//  Análisis de fotos con IA (visión) — proveedor conectable.
//  Por ahora: Google Gemini (free tier). Se activa solo si hay GEMINI_API_KEY.
//  Corre en segundo plano (cola), para no retrasar el envío de las sucursales.
// ============================================================================
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { DATA_DIR, AI_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL, AI_DELAY_MS, SECCIONES } = config;
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

function isEnabled() { return AI_PROVIDER === 'gemini' && !!GEMINI_API_KEY; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function mimeDe(f) {
  const e = path.extname(f).toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function promptDe(sec, check) {
  return `Eres un inspector de mantenimiento de stands de la marca Sidhe (plantillas personalizadas y escaneo de pisada).
Analiza la(s) foto(s) de la sección "${sec.label}".
Qué revisar: ${check}
Responde SOLO con un objeto JSON válido (en español, sin texto adicional, sin markdown) con esta forma exacta:
{"estado":"ok|atencion|falla","hallazgos":["..."],"faltantes":["..."],"resumen":"...","confianza":0.0}
Reglas:
- "estado": "ok" si todo se ve bien; "atencion" si hay algo menor, dudoso o mala calidad de foto; "falla" si hay daño claro o no funciona.
- "hallazgos": lista breve de problemas o daños visibles (vacía si no hay).
- "faltantes": elementos que deberían estar y no aparecen (vacía si no aplica).
- "resumen": una frase corta del estado general.
- "confianza": número de 0 a 1 según qué tan seguro estás dada la calidad/claridad de la foto.`;
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

// Llama a Gemini con las fotos de una sección y devuelve el veredicto.
async function geminiSeccion(fotos, sec) {
  const check = CHECKLIST[sec.key] || `Elemento del stand: ${sec.label}. Revisa su estado general, daños o cosas faltantes.`;
  const parts = [{ text: promptDe(sec, check) }];
  for (const f of fotos.slice(0, 8)) { // máximo 8 fotos por llamada
    const p = path.join(UPLOAD_DIR, f);
    if (!fs.existsSync(p)) continue;
    parts.push({ inline_data: { mime_type: mimeDe(f), data: fs.readFileSync(p).toString('base64') } });
  }
  if (parts.length === 1) return null; // sin imágenes válidas

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 240)}`);
  }
  const json = await res.json();
  const text = (json.candidates && json.candidates[0] && json.candidates[0].content
    && json.candidates[0].content.parts || []).map((x) => x.text || '').join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { parsed = extraeJson(text); }
  return normaliza(parsed);
}

// Analiza todas las secciones con fotos de un reporte y guarda resultados.
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

  for (const sec of seccionesConFotos) {
    const d = rep.secciones[sec.key];
    let veredicto;
    try {
      veredicto = await geminiSeccion(d.fotos, sec);
    } catch (e) {
      console.error(`[IA] Error en ${rep.sucursal}/${sec.key}:`, e.message);
      veredicto = { estado: 'error', error: e.message, analizadoEn: new Date().toISOString() };
    }
    if (veredicto) {
      // recargar en fresco para no pisar envíos concurrentes
      data = dbStore.load();
      rep = data.reportes.find((r) => r.id === reportId);
      if (!rep) return;
      rep.secciones[sec.key].ia = veredicto;
      await dbStore.save(data);
    }
    await sleep(AI_DELAY_MS); // respeta el límite del free tier
  }

  data = dbStore.load();
  rep = data.reportes.find((r) => r.id === reportId);
  if (rep) {
    const conError = Object.values(rep.secciones).some((s) => s.ia && s.ia.estado === 'error');
    rep.iaEstado = conError ? 'error' : 'listo';
    rep.iaResumen = resumen(rep);
    await dbStore.save(data);
    console.log(`[IA] Reporte ${rep.sucursal} listo. Alertas: ${rep.iaResumen.alertas}`);
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

// Al arrancar, re-encola reportes que quedaron pendientes.
function startupPending() {
  if (!isEnabled()) { console.log('[IA] Deshabilitada (sin GEMINI_API_KEY).'); return; }
  console.log(`[IA] Activa con modelo ${GEMINI_MODEL}.`);
  const data = dbStore.load();
  for (const r of data.reportes) {
    if (r.iaEstado === 'pendiente') enqueue(r.id);
  }
}

module.exports = { isEnabled, enqueue, analizarReporte, startupPending, CHECKLIST };
