# Handoff — Proyecto Sidhe (Revisión de Stands + Asistencias)

> Documento para continuar el trabajo en otro chat. Última actualización: 2026‑08‑20.
> Guárdalo en la raíz del repo `stand-muebles`. Al abrir un chat nuevo, léelo primero.

> **Cambios sesión 2026‑08‑20:** se mergeó `feature/mejoras-sig-semana` → `main` (Escáner 3D, imágenes de referencia, avances vs. semana pasada). Se resolvió el cambio suelto de `ai.js` (§3). Se agregó la sección **Muestrario** (foto **obligatoria**). El **comentario de IA ahora se anexa al PDF**. Se subieron **13 imágenes de referencia** reales a `public/referencias/` (extraídas de reportes de sucursales). Todo commiteado en `main`; el push lo hace el usuario.

---

## 1. Qué es esto (2 apps)

### A) App de revisión de stands — "STAND MUEBLES"
- Carpeta: `C:\Users\produ\Downloads\STAND MUEBLES`
- Repo GitHub: `https://github.com/innovacion-sketch/stand-muebles` (privado)
- Servicio EasyPanel: proyecto `one` → servicio **`revision_stand_sidhe`**
- Dominio: `https://one-revision-stand-sidhe.dq9h1w.easypanel.host`
- **Formulario sucursales:** `/`  ·  **Panel admin:** `/admin.html` (protegido con `ADMIN_PASSWORD`)
- Qué hace: cada martes las **32 sucursales** suben fotos + estado por sección de su mueble; se genera un **PDF** por reporte; el panel admin (estilo editorial negro) muestra cumplimiento por región, incidencias, y análisis con IA de las fotos.

### B) Sistema de asistencias — "asistencias-sidhe" (SEPARADO)
- Carpeta: `C:\Users\produ\Documents\asistencias-sidhe`
- Repo GitHub: `innovacion-sketch/asistencias-sidhe` · Servicio EasyPanel: `asistencias-backend`
- Stack: Node + Express + **PostgreSQL** + reconocimiento facial (face-api.js) + geocerca GPS + PDFKit + cron.
- App real en `backend/src/`. Zona horaria México.
- Marcaje: `entrada → salida_comida → regreso_comida → salida` (tabla `jornadas`). Tablet por sucursal.
- **OJO:** las sucursales se guardan con prefijo **"Liverpool "** (ej. `Liverpool Península Tijuana`). La app de stands NO usa ese prefijo → se normaliza (ver §5).

---

## 2. Stack de la app de stands
- **Node.js + Express**, sin base de datos externa: `db.json` en `DATA_DIR` (volumen persistente `/app/data`).
- Fotos en `DATA_DIR/uploads`, optimizadas con **sharp** (JPEG). El cliente además comprime antes de subir.
- PDF con **pdfkit**. IA con **Gemini** (fetch, sin SDK). Deploy con **Dockerfile** (node:20-bookworm-slim).
- Archivos clave: `server.js` (API+estáticos), `config.js` (sucursales/secciones/claves), `db.js`, `pdf.js`,
  `ai.js` (IA), `utils.js` (semana ISO + normalizaNombre), `public/` (index.html=formulario, admin.html=panel, app.js, admin.js, styles.css).

---

## 3. Ramas de git (IMPORTANTE)
- **`main`** = PRODUCCIÓN (lo que corre en EasyPanel). Todo lo estable está aquí.
- **`feature/mejoras-sig-semana`** = **YA MEZCLADA a `main`** (merge del 2026‑08‑20). Sus mejoras ahora están en producción:
  - Sección **Escáner 3D** (config + checklist IA).
  - **Imágenes de referencia** por sección: pon `public/referencias/<clave>.jpg` y aparece solo (si no existe, no se muestra). Ver `public/referencias/LEEME.txt`. **Ya hay 13 referencias reales subidas** (ver §7).
  - Sección **"Avances vs. semana pasada"** (`reporte.avances`, en pdf.js/admin).
  - *Nota:* tras el merge, `feature` quedó **atrás** de `main`. Si se sigue usando, actualizarla (rebase) o crear una rama nueva desde `main`.
- **Flujo de deploy:** editar en `main` → `git push` → EasyPanel → **Implementar**. (El push lo hace el usuario; el clasificador me bloquea `git push` y `git remote add`.)

### ✅ Cambio suelto de `ai.js` — RESUELTO (2026‑08‑20)
El cambio sin commitear que agregaba `ultimaCuota`/`esCuota` en `geminiGenerate` ya se **completó y commiteó**: `ultimaCuota` se declara como `let` local (ya no es global implícita) y `esCuota` se consume en el log y en el registro de error del lote (`analizarReporte`), para distinguir errores de cuota (se reintentan) de errores reales.

---

## 4. Variables de entorno (EasyPanel)
En el servicio **`revision_stand_sidhe`** → Entorno:
```
ADMIN_PASSWORD=<clave del panel admin>
SESSION_SECRET=<cadena larga aleatoria>
PORT=3000
DATA_DIR=/app/data
INTEGRATION_KEY=<PON-AQUI-LA-INTEGRATION_KEY>   # clave compartida con asistencias
# --- IA (Gemini) ---
GEMINI_API_KEY=<clave cuenta principal>
GEMINI_API_KEY_1=<clave cuenta 1>
GEMINI_API_KEY_2=<clave cuenta 2>
... hasta GEMINI_API_KEY_30    # el usuario tiene ~7 cuentas
GEMINI_MODEL=gemini-3.6-flash  # gemini-2.0-flash quedó descontinuado
AI_DELAY_MS=4500
AI_RETRY_MIN=30                # reintento automático de reportes en error
```
Volumen persistente montado en **`/app/data`** (crítico: sin él se borran fotos y `db.json`).

En **`asistencias-backend`** (para el bloqueo de comida):
```
STAND_API_URL=https://one-revision-stand-sidhe.dq9h1w.easypanel.host
STAND_API_KEY=<PON-AQUI-LA-INTEGRATION_KEY>   # == INTEGRATION_KEY
# opcionales: GATE_COMIDA_STAND=false (apagar), GATE_FAIL_OPEN=false (bloqueo estricto),
#             GATE_COMIDA_DIAS=2 (días que aplica; 2=martes; para probar: hoy o 0..6)
```

---

## 5. Integración con asistencias (bloquear salida a comer)
- **Regla:** solo los **martes**, un empleado no puede marcar `salida_comida` si su sucursal no completó la revisión del stand de la semana. Por sucursal (una persona la hace y se desbloquea para todos). Bloqueo duro. **Fail‑open** (si el servicio de stands no responde, NO bloquea, para no dejar sin comer).
- **App de stands:** endpoint `GET /api/estado-sucursal?sucursal=<nombre>` con header `X-Integration-Key` → `{existe, semana, completo}`. `normalizaNombre` en `utils.js` **ignora el prefijo "Liverpool"** para casar los nombres.
- **Asistencias (rama `feature/gate-comida-stand`, YA MEZCLADA a `main` y pusheada):** `services/revision-stand.js`, `lib/fecha.js` (`diaSemanaMexico`), gate en `routes/marcaje.js` y `routes/marcaje-facial.js`.
- Estado: **desplegado y funcionando** (probado un martes real). El material para difundir a sucursales se generó como PDFs/artifacts (comunicado + guía de uso).

---

## 6. IA (análisis de fotos con Gemini) — estado actual
- Se activa con `GEMINI_API_KEY` (o las numeradas). Corre en **segundo plano** (cola), no retrasa el envío.
- **Rotación de claves:** varias cuentas; cuando una da 429/cuota o inválida, rota a la siguiente (con pausa de 700 ms).
- **Eficiente:** agrupa las secciones y analiza cada reporte en **1‑2 llamadas** (lotes de ≤20 imágenes) en vez de ~14. Devuelve un JSON con el veredicto por sección: `{estado: ok|atencion|falla, hallazgos[], faltantes[], resumen, confianza}`.
- **Reintento automático:** los reportes en `error` (por cuota) se reintentan al arrancar y cada `AI_RETRY_MIN` min. La cuota diaria de Gemini se libera ~1‑2 AM hora de México.
- **Estabilidad:** un error de cuota **no borra** un veredicto bueno previo (por eso el conteo en el panel ya no "sube y baja").
- Checklist editable por sección en `ai.js` (objeto `CHECKLIST`).
- Panel: sección **"Alertas de IA"** (resumen), marca `◆ IA: revisar` en celdas, bloque de veredicto en el modal, botón **Reanalizar IA**, endpoint `POST /api/admin/reportes/:id/reanalizar`.
- **PDF (desde 2026‑08‑20):** el veredicto de IA se **anexa al PDF** bajo cada sección (bloque "Análisis IA" en violeta: estado, resumen, hallazgos, faltantes, % confianza). Los errores de cuota se omiten (no ensucian el PDF). Ver `pdf.js` (`IA_ETQ`/`iaColor` + bloque `data.ia`).
- **Comparación con la referencia (desde 2026‑08‑21):** si la sección tiene `public/referencias/<clave>`, `geminiLote` envía esa foto de referencia ANTES de las fotos reales y el prompt pide comparar contra ella. El veredicto trae un campo **`vsReferencia`** (qué coincide y qué no) que se muestra en el panel (`renderIA`) y en el PDF. El batching cuenta la referencia como +1 imagen. `refImagen(key)` en `ai.js` la localiza.
- **Costo si algún día usan Claude en vez de Gemini:** ~$8 USD/mes con Haiku (o ~$4 con Batch) para 32 sucursales semanales. Gemini free tier con 7 cuentas rotando basta.

---

## 7. Sucursales y secciones (en `config.js`)
- **REGIONES** (32 sucursales): CDMX(10), Colombia(3), Foránea(19). `SUCURSALES` se deriva con flatMap. El form usa optgroups por región; el panel agrupa por región.
- **SECCIONES** (16 en main): Impresora 3D (6 fotos: 4 lados+arriba+interior), Cajones (≤6), Barandal lado 1 y 2, Puerta, Silla, Módem, Pantallas (opc), Tablets (opc), Baropodómetro, **Escáner 3D**, Computadora, **Muestrario (obligatorio)**, Zapatos/sandalias (opc), Otras cosas (opc), Desperfectos (opc).
- Cada sección: `key, grupo, label, estado(bool), estadoLabel, fotos, minFotos, opcional, requerida, hint`.
- **`requerida: true`** (bandera nueva, 2026‑08‑20) = la foto es **obligatoria** para poder enviar (mín. `minFotos`, o 1). Validada en cliente (`app.js` `enviar()` → alerta + scroll) **y en servidor** (`server.js` POST `/api/reportes` → 400 `faltan_fotos`). Chip **"Obligatoria"** (ámbar) en el formulario. **Solo `muestrario` está marcada así.** Ojo: el resto de secciones NUNCA ha exigido fotos — `minFotos` es solo informativo salvo que la sección tenga `requerida`.
- **Imágenes de referencia subidas (13)** en `public/referencias/`: `impresora, cajones, barandal_lado1, barandal_lado2, puerta, silla, modem, pantallas, tablets, baropodometro, escaner, computadora, zapatos`. Extraídas de reportes reales (Angelópolis Puebla y Delta). **Pendiente:** `muestrario.jpg` (no había foto de muestrario en los reportes). Ojo: `baropodometro` = tapete con marcadores; `escaner` = aparato circular con anillo iluminado (no confundirlas).

---

## 8. Diseño / UI
- Estilo editorial monocromático sobre **negro puro** (una sola identidad, sin light/dark). Números gigantes (Archivo), etiquetas mayúsculas con tracking, rejilla de hairlines. Acentos: **azul** `#5b8cff` (activo/funcional), **ámbar** `#ff7a45` (incidencia/no funcional), **violeta** `#b98cff` (IA). Tipografías: Archivo + IBM Plex Sans + IBM Plex Mono (Google Fonts).
- Responsive verificado (celular/tablet/desktop). Campos a 16px (evita zoom en iOS).

---

## 9. Gotchas / cosas que romper evitar
- **PDF:** el pie de página se escribe con `doc.page.margins.bottom = 0` temporal + `lineBreak:false` para no crear hojas en blanco. NO quitar eso.
- **PDF imágenes:** solo se incrustan `.jpg/.jpeg` (PDFKit se cuelga con ciertos PNG). sharp convierte todo a JPEG con `failOn:'none'`.
- **Nombres de sucursal:** casan entre sistemas gracias a `normalizaNombre` (sin acentos/mayúsculas + quita "liverpool "). Si agregan sucursales, revisar que casen.
- **Semana:** ISO (lunes‑domingo); el martes cae en la semana correcta.
- **Fotos obligatorias:** solo las secciones con `requerida: true` en `config.js` exigen foto (hoy solo `muestrario`). Se valida en cliente **y** servidor; si agregas otra obligatoria, marca la bandera (no basta `minFotos`).
- **Imágenes de referencia:** `public/referencias/<clave>.jpg` (JPEG, `binary` en `.gitattributes`). El servidor las detecta en `/api/config` (`referencias`) y el form las muestra si existen. Para extraerlas de un PDF de reporte: PyMuPDF (`pymupdf`) + Pillow (mapear por posición título→fotos). No hay poppler instalado (el Read de PDF no renderiza).
- **No** hacer `git push` desde Claude (clasificador lo bloquea) — lo hace el usuario. Los `git checkout`/`commit`/`cherry-pick` locales sí funcionan.
- El PDF/estado se generan al momento: tras un deploy, re‑descargar/recargar refleja los cambios sin reprocesar datos.

---

## 10. Pendientes / próximos pasos
1. **Push + Implementar** los commits de `main` de la sesión 2026‑08‑20 (referencias + muestrario + IA en PDF + merge). Revisar `git log origin/main..main`, hacer `git push`, luego EasyPanel → **Implementar**.
2. Subir **`public/referencias/muestrario.jpg`** cuando haya una buena foto del muestrario (única referencia pendiente).
3. (Opcional) Afinar la sección **"Avances vs. semana pasada"** si se quiere que muestre/gestione automáticamente los pendientes de la semana previa.
4. (Opcional) Agregar Claude como proveedor de IA alternativo (conectable por env), si quieren comparar calidad vs Gemini.

### ✅ Hecho en 2026‑08‑20
- Merge `feature/mejoras-sig-semana` → `main` (Escáner 3D, referencias, avances).
- Cambio suelto de `ai.js` resuelto (§3).
- Sección **Muestrario** con foto **obligatoria** (bandera `requerida`, validada cliente+servidor, chip "Obligatoria").
- **Comentario de IA anexado al PDF** (§6).
- **13 imágenes de referencia** reales subidas (§7).

---

## 11. Comandos útiles
```bash
# Correr local
cd "C:/Users/produ/Downloads/STAND MUEBLES"
npm install
ADMIN_PASSWORD=test123 npm start        # http://localhost:3000

# Ver estado de git
git branch --show-current
git log --oneline origin/main..main      # commits sin push en produccion
git log --oneline main..feature/mejoras-sig-semana

# Desplegar (produccion)
git checkout main && git push            # luego EasyPanel -> revision_stand_sidhe -> Implementar
```

---

**Contactos/IDs rápidos:** repo stand: `innovacion-sketch/stand-muebles` · dominio: `one-revision-stand-sidhe.dq9h1w.easypanel.host` · INTEGRATION_KEY compartida (arriba). El usuario trabaja en Windows + PowerShell (usar `;` no `&&`).
