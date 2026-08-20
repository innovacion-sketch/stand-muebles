// ============================================================================
//  CONFIGURACIÓN — Edita este archivo para adaptar la app a tu operación.
// ============================================================================

// ---------------------------------------------------------------------------
// 1) SUCURSALES POR REGIÓN
//    Edita los nombres y regiones aquí. La app arma el desplegable y el panel
//    a partir de esta estructura. Puedes agregar/quitar regiones o sucursales.
// ---------------------------------------------------------------------------
const REGIONES = [
  {
    nombre: 'CDMX',
    sucursales: [
      'Atizapán', 'Coapa', 'Delta', 'Insurgentes', 'Lindavista',
      'Mitikah', 'Perisur', 'Polanco', 'Santa Fe', 'Satélite',
    ],
  },
  {
    nombre: 'Colombia',
    sucursales: [
      'Prochampions Bogotá', 'Prochampions Cali', 'Prochampions Medellín',
    ],
  },
  {
    nombre: 'Foránea',
    sucursales: [
      'Altabrisa Villahermosa', 'Altaria Aguascalientes', 'Andares Guadalajara',
      'Angelópolis Puebla', 'Antea Querétaro', 'Crystal Tuxtla',
      'Galerías Cuernavaca', 'Galerías Mérida', 'Galerías Metepec',
      'Galerías Monterrey', 'Galerías Pachuca', 'La Perla Guadalajara',
      'Las Américas Morelia', 'Las Américas Veracruz', 'Las Américas Xalapa',
      'Península Tijuana', 'Plaza Mayor León', 'Plaza Oaxaca', 'San Luis Potosí',
    ],
  },
];

// Lista plana derivada (no editar: se genera de REGIONES).
const SUCURSALES = REGIONES.flatMap((r) => r.sucursales);

// ---------------------------------------------------------------------------
// 2) SECCIONES DEL REPORTE
//    key       -> identificador interno (no repetir)
//    label     -> título que ve el usuario
//    estado    -> muestra selector Funcional / No funcional (o Buen estado / Dañado)
//    estadoLabel -> texto de la pregunta de estado
//    fotos     -> true para permitir subir fotos
//    minFotos  -> fotos mínimas sugeridas (solo informativo)
//    opcional  -> true si la sección puede quedar vacía (ej. pantallas)
// ---------------------------------------------------------------------------
const SECCIONES = [
  // key         grupo          label                                estado / etiqueta                                   fotos    min  opcional  hint
  { key: 'impresora',      grupo: 'Impresora 3D', label: 'Impresora 3D',                       estado: true, estadoLabel: '¿La impresora funciona correctamente?', fotos: true, minFotos: 6, hint: 'Sube 6 fotos: 4 de los lados, 1 de arriba y 1 del interior' },

  { key: 'cajones',        grupo: 'Mobiliario',   label: 'Cajones',                            estado: true, estadoLabel: '¿Los cajones están en buen estado?',      fotos: true, minFotos: 1, hint: 'Sube hasta 6 fotos (los cajones con los que cuentes)' },
  { key: 'barandal_lado1', grupo: 'Mobiliario',   label: 'Barandal — Lado 1',                  estado: true, estadoLabel: '¿El barandal está en buen estado?',        fotos: true, minFotos: 2 },
  { key: 'barandal_lado2', grupo: 'Mobiliario',   label: 'Barandal — Lado 2',                  estado: true, estadoLabel: '¿El barandal está en buen estado?',        fotos: true, minFotos: 2 },
  { key: 'puerta',         grupo: 'Mobiliario',   label: 'Puerta',                             estado: true, estadoLabel: '¿La puerta está en buen estado?',          fotos: true, minFotos: 1 },
  { key: 'silla',          grupo: 'Mobiliario',   label: 'Silla del cliente',                  estado: true, estadoLabel: '¿La silla está en buen estado?',           fotos: true, minFotos: 1 },

  { key: 'modem',          grupo: 'Conectividad', label: 'Módem',                              estado: true, estadoLabel: '¿El módem funciona correctamente?',        fotos: true, minFotos: 1 },

  { key: 'pantallas',      grupo: 'Equipo',       label: 'Pantallas (si aplica)',              estado: true, estadoLabel: '¿Las pantallas funcionan correctamente?',  fotos: true, minFotos: 0, opcional: true },
  { key: 'tablets',        grupo: 'Equipo',       label: 'Tablets (si tienen)',                estado: true, estadoLabel: '¿Las tablets funcionan correctamente?',    fotos: true, minFotos: 0, opcional: true, hint: 'Una foto de cada tablet con la que cuenten' },
  { key: 'baropodometro',  grupo: 'Equipo',       label: 'Baropodómetro',                      estado: true, estadoLabel: '¿El baropodómetro funciona correctamente?', fotos: true, minFotos: 1 },
  { key: 'escaner',        grupo: 'Equipo',       label: 'Escáner 3D',                         estado: true, estadoLabel: '¿El escáner funciona correctamente?',       fotos: true, minFotos: 2, hint: 'Foto del escáner y del tapete de calibración' },
  { key: 'computadora',    grupo: 'Equipo',       label: 'Computadora',                        estado: true, estadoLabel: '¿La computadora funciona correctamente?',  fotos: true, minFotos: 1 },

  { key: 'zapatos',        grupo: 'Exhibición',   label: 'Zapatos o sandalias en exhibición',  estado: false, fotos: true, minFotos: 0, opcional: true, hint: 'Fotos de los zapatos o sandalias expuestas' },
  { key: 'extras',         grupo: 'Otros',        label: 'Otras cosas del stand',              estado: false, fotos: true, minFotos: 0, opcional: true, hint: 'Cualquier otro elemento con el que cuenten, aparte del stand' },

  { key: 'desperfectos',   grupo: 'Incidencias',  label: 'Desperfectos / Daños',               estado: false, fotos: true, minFotos: 0, opcional: true, hint: 'Fotos de cualquier daño o desperfecto' },
];

// Reúne todas las claves de Gemini disponibles:
//  - GEMINI_API_KEY (una, o varias separadas por coma)
//  - GEMINI_API_KEYS (varias separadas por coma)
//  - GEMINI_API_KEY_1, GEMINI_API_KEY_2, ... (una por variable, hasta 30)
function reunirClavesGemini() {
  const claves = [];
  const base = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  claves.push(...base.split(/[,\s]+/));
  for (let i = 1; i <= 30; i++) {
    const v = process.env['GEMINI_API_KEY_' + i];
    if (v) claves.push(...v.split(/[,\s]+/));
  }
  return [...new Set(claves.map((k) => k.trim()).filter(Boolean))];
}
const GEMINI_KEYS = reunirClavesGemini();

module.exports = {
  REGIONES,
  SUCURSALES,
  SECCIONES,

  // Contraseña del panel de administración.
  // Cámbiala aquí o, mejor, define la variable de entorno ADMIN_PASSWORD en EasyPanel.
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'cambia-esta-clave',

  // Secreto para las sesiones (define SESSION_SECRET en EasyPanel para producción).
  SESSION_SECRET: process.env.SESSION_SECRET || 'stand-muebles-secret-cambiame',

  // Carpeta donde se guardan datos y fotos (debe ser un volumen persistente).
  DATA_DIR: process.env.DATA_DIR || require('path').join(__dirname, 'data'),

  // Puerto
  PORT: process.env.PORT || 3000,

  // ---- Análisis con IA (Gemini free tier) ----
  // Se activa automáticamente si defines GEMINI_API_KEY. Sin clave, la app
  // funciona igual pero sin análisis de fotos.
  // Varias cuentas: usa una variable por clave (recomendado en EasyPanel):
  //   GEMINI_API_KEY_1=clave1   GEMINI_API_KEY_2=clave2   ...
  // (También funciona GEMINI_API_KEY con varias separadas por coma.)
  // La app rota a la siguiente automáticamente cuando una se agota o falla.
  AI_PROVIDER: process.env.AI_PROVIDER || (GEMINI_KEYS.length ? 'gemini' : 'none'),
  GEMINI_API_KEYS: GEMINI_KEYS,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  // Pausa entre llamadas (ms) para respetar el límite del free tier.
  AI_DELAY_MS: parseInt(process.env.AI_DELAY_MS || '4500', 10),

  // ---- Integración con el sistema de asistencias ----
  // Clave compartida para el endpoint /api/estado-sucursal (debe coincidir con
  // STAND_API_KEY en el sistema de asistencias). Si está vacía, el endpoint se desactiva.
  INTEGRATION_KEY: process.env.INTEGRATION_KEY || '',
};
