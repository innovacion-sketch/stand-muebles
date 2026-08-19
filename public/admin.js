let SECCIONES_DEF = [];
let IA_ENABLED = false;
let REPORTE_ACTUAL = null;
const COLS = 5; // columnas de la cuadrícula (coincide con el CSS en desktop)

// ------------------------------- Reloj -------------------------------
function tick() {
  const d = new Date();
  const meses = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  document.getElementById('reloj').textContent = `${hh}:${mm}   ${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;
}
setInterval(tick, 1000); tick();

// ------------------------------- Auth --------------------------------
async function checkAuth() {
  const res = await fetch('/api/admin/me');
  const data = await res.json();
  if (data.admin) mostrarPanel(); else mostrarLogin();
}
function mostrarLogin() {
  document.getElementById('login').classList.remove('hidden');
  document.getElementById('panel').classList.add('hidden');
  document.getElementById('nav').style.visibility = 'hidden';
}
async function mostrarPanel() {
  document.getElementById('login').classList.add('hidden');
  document.getElementById('panel').classList.remove('hidden');
  document.getElementById('nav').style.visibility = 'visible';
  await cargarEstado();
  await cargarHistorial();
}
async function login() {
  const password = document.getElementById('password').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  });
  if (res.ok) { document.getElementById('login-error').classList.add('hidden'); mostrarPanel(); }
  else document.getElementById('login-error').classList.remove('hidden');
}

// ------------------------------ Estado -------------------------------
async function cargarEstado(semana) {
  const url = '/api/admin/estado' + (semana ? `?semana=${encodeURIComponent(semana)}` : '');
  const res = await fetch(url);
  if (res.status === 401) return mostrarLogin();
  const data = await res.json();

  const sel = document.getElementById('semana');
  if (!sel.dataset.filled) {
    for (const w of data.semanas) {
      const opt = document.createElement('option');
      opt.value = w.key; opt.textContent = `${w.key}  ·  ${w.rango}`;
      sel.appendChild(opt);
    }
    sel.dataset.filled = '1';
    sel.value = data.semana;
    sel.addEventListener('change', () => cargarEstado(sel.value));
  }
  document.getElementById('rango').textContent = data.rango;
  IA_ENABLED = !!data.iaEnabled;

  document.getElementById('s-ok').textContent = data.completadas;
  document.getElementById('s-ok-of').textContent = ` /${data.total}`;
  document.getElementById('s-pend').textContent = data.total - data.completadas;
  document.getElementById('s-total').textContent = data.total;
  document.getElementById('s-inc').textContent = data.incidencias;

  renderResumenIA(data);

  const cont = document.getElementById('regiones');
  cont.innerHTML = '';
  data.grupos.forEach((g, i) => {
    if (!g.filas.length) return;
    const sec = document.createElement('section');
    sec.className = 'region';
    const num = String(i + 1).padStart(2, '0');
    const celdas = g.filas.map((f) => celdaSucursal(f)).join('');
    // celdas de relleno para completar la última fila
    const resto = g.filas.length % COLS;
    const fillers = resto === 0 ? 0 : COLS - resto;
    const rellenos = '<div class="branch filler"></div>'.repeat(fillers);
    sec.innerHTML = `
      <div class="region-head"><span class="label">${num} — ${g.nombre} (${g.filas.length} sucursales)</span></div>
      <div class="branch-grid">${celdas}${rellenos}</div>`;
    cont.appendChild(sec);
  });

  // clic en sucursales que reportaron
  cont.querySelectorAll('.branch.reported').forEach((el) => {
    el.addEventListener('click', () => verDetalle(el.dataset.id));
  });
}

// Resumen de alertas de IA de la semana.
function renderResumenIA(data) {
  const sec = document.getElementById('resumen-ia');
  const cont = document.getElementById('ia-lista');
  const pend = document.getElementById('ia-pend');
  if (!data.iaEnabled) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');

  document.getElementById('ia-count').textContent =
    data.resumenIA.length === 0 ? 'sin alertas' : `${data.resumenIA.length} sucursal${data.resumenIA.length > 1 ? 'es' : ''}`;
  pend.textContent = data.iaPendientes ? `· ${data.iaPendientes} en análisis…` : '';

  if (!data.resumenIA.length) {
    cont.innerHTML = '<div class="ia-ok-empty">✓ Ninguna sucursal requiere revisión según la IA esta semana.</div>';
    return;
  }

  cont.innerHTML = '';
  for (const r of data.resumenIA) {
    const card = document.createElement('div');
    card.className = 'ia-summary-card';
    card.dataset.id = r.id;
    const items = r.items.map((it) => {
      const problemas = [...it.hallazgos, ...it.faltantes.map((x) => 'Falta: ' + x)];
      const cls = it.estado === 'falla' ? 'est-falla' : 'est-aten';
      return `<div class="ia-item"><span class="sname">${escapeHtml(it.seccion)}</span>
        <span class="est ${cls}">${it.estado === 'falla' ? 'falla' : 'revisar'}</span>
        ${problemas.length ? '— ' + escapeHtml(problemas.join('; ')) : ''}</div>`;
    }).join('');
    card.innerHTML = `
      <div class="top"><span class="suc">${escapeHtml(r.sucursal)}</span>
        <span class="mono small muted">${escapeHtml(r.region)} · ${r.items.length} sección(es)</span></div>
      ${items}`;
    cont.appendChild(card);
  }
  cont.querySelectorAll('.ia-summary-card').forEach((el) => el.addEventListener('click', () => verDetalle(el.dataset.id)));
}

function celdaSucursal(f) {
  const cls = f.reporto ? 'reported' : 'pending';
  const estado = f.reporto ? 'Reportó' : 'Pendiente';
  let tags = '';
  if (f.incidencia) tags += '<div class="tag">! Incidencia</div>';
  if (f.alertaIA) tags += '<div class="tag ia">◆ IA: revisar</div>';
  else if (f.reporto && f.iaEstado === 'pendiente') tags += '<div class="tag pend">IA analizando…</div>';
  const idAttr = f.reporto ? ` data-id="${f.id}"` : '';
  return `
    <div class="branch ${cls}"${idAttr}>
      <span class="dot"></span>
      <div class="name">${escapeHtml(f.sucursal)}</div>
      <div class="st">${estado}</div>
      ${tags}
    </div>`;
}

// Bloque visual del veredicto de IA de una sección.
function motivoIA(err) {
  const e = (err || '').toLowerCase();
  if (e.includes('api key not valid') || e.includes('api_key_invalid') || e.includes('invalid_argument')) return 'La API key de Gemini no es válida. Revísala en EasyPanel (Entorno) y da Implementar.';
  if (e.includes('429') || e.includes('quota') || e.includes('resource_exhausted') || e.includes('rate')) return 'Se alcanzó el límite del plan gratuito de Gemini. Espera unos minutos y usa "Reanalizar IA".';
  if (e.includes('not found') || e.includes('404') || e.includes('is not found for api version')) return 'El modelo configurado no existe. Revisa la variable GEMINI_MODEL.';
  if (e.includes('permission') || e.includes('403')) return 'La API key no tiene permiso o la API no está habilitada en tu proyecto de Google.';
  if (!err) return 'No se pudo analizar (sin detalle). Verifica GEMINI_API_KEY y da "Reanalizar IA".';
  return 'No se pudo analizar: ' + err;
}

function renderIA(ia) {
  if (!ia) return '';
  if (ia.estado === 'error') {
    return `<div class="ia-box ia-error">
      <span class="ia-badge">IA · no disponible</span>
      <div class="ia-res">${escapeHtml(motivoIA(ia.error))}</div>
    </div>`;
  }
  const etiqueta = { ok: 'Se ve bien', atencion: 'Requiere revisión', falla: 'Falla detectada' }[ia.estado] || ia.estado;
  const conf = (typeof ia.confianza === 'number') ? ` · ${Math.round(ia.confianza * 100)}% confianza` : '';
  const lista = (titulo, arr) => (arr && arr.length)
    ? `<div class="ia-list"><b>${titulo}:</b><ul>${arr.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : '';
  return `
    <div class="ia-box ia-${ia.estado}">
      <div class="ia-head"><span class="ia-badge">◆ IA · ${etiqueta}</span><span class="ia-conf">${conf}</span></div>
      ${ia.resumen ? `<div class="ia-res">${escapeHtml(ia.resumen)}</div>` : ''}
      ${lista('Hallazgos', ia.hallazgos)}
      ${lista('Faltantes', ia.faltantes)}
    </div>`;
}

// ----------------------------- Historial ------------------------------
async function cargarHistorial() {
  const res = await fetch('/api/admin/reportes');
  if (res.status === 401) return mostrarLogin();
  const data = await res.json();
  const cont = document.getElementById('historial');
  cont.innerHTML = '';
  if (!data.reportes.length) {
    cont.innerHTML = '<div class="empty">Aún no hay reportes registrados.</div>';
    return;
  }
  for (const r of data.reportes) {
    const row = document.createElement('div');
    row.className = 'hist-row';
    const fecha = new Date(r.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
    row.innerHTML = `
      <div class="h-name">${escapeHtml(r.sucursal)}</div>
      <div class="mono muted h-hide">${r.semana}</div>
      <div class="mono muted h-hide">${r.totalFotos} fotos</div>
      <div class="mono muted small h-hide">${fecha}</div>
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" data-ver="${r.id}">Ver</button>
        <a class="btn btn-primary btn-sm" href="/api/admin/reportes/${r.id}/pdf">PDF</a>
      </div>`;
    cont.appendChild(row);
  }
  cont.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verDetalle(b.dataset.ver)));
}

// ------------------------------ Detalle -------------------------------
async function verDetalle(id) {
  const res = await fetch('/api/admin/reportes/' + id);
  if (res.status === 401) return mostrarLogin();
  const data = await res.json();
  const r = data.reporte;
  SECCIONES_DEF = data.secciones;
  REPORTE_ACTUAL = r.id;

  const btnRe = document.getElementById('modal-reanalizar');
  if (IA_ENABLED) {
    btnRe.classList.remove('hidden');
    btnRe.textContent = r.iaEstado === 'pendiente' ? 'IA analizando…' : 'Reanalizar IA';
    btnRe.disabled = r.iaEstado === 'pendiente';
  } else {
    btnRe.classList.add('hidden');
  }

  document.getElementById('modal-titulo').textContent = `${r.sucursal} — ${r.semana}`;
  document.getElementById('modal-sub').textContent =
    `${data.rango} · Enviado ${new Date(r.createdAt).toLocaleString('es-MX')}${r.responsable ? ' · ' + r.responsable : ''}`;
  document.getElementById('modal-pdf').href = `/api/admin/reportes/${id}/pdf`;

  const body = document.getElementById('modal-body');
  body.innerHTML = '';
  for (const sec of SECCIONES_DEF) {
    const d = (r.secciones && r.secciones[sec.key]) || {};
    const fotos = d.fotos || [];
    if (sec.opcional && fotos.length === 0 && !d.comentarios && !d.estado) continue;
    const div = document.createElement('div');
    div.className = 'det-sec' + (d.estado === 'issue' ? ' bad' : '');
    let estadoBadge = '';
    if (sec.estado) {
      if (d.estado === 'ok') estadoBadge = '<span class="badge si">Funcional</span>';
      else if (d.estado === 'issue') estadoBadge = '<span class="badge no">No funcional</span>';
      else estadoBadge = '<span class="badge gris">Sin marcar</span>';
    }
    const galeria = fotos.length
      ? `<div class="gallery">${fotos.map((f) => `<a href="/api/admin/foto/${f}" target="_blank" rel="noopener"><img src="/api/admin/foto/${f}" loading="lazy" alt="" /></a>`).join('')}</div>`
      : '<p class="muted small">Sin fotos.</p>';
    div.innerHTML = `<div class="head"><h3>${sec.label}</h3>${estadoBadge}</div>${galeria}
      ${d.comentarios ? `<div class="det-com"><strong>Comentarios:</strong> ${escapeHtml(d.comentarios)}</div>` : ''}
      ${renderIA(d.ia)}`;
    body.appendChild(div);
  }
  if (r.avances && (r.avances.estado || r.avances.comentarios)) {
    const av = document.createElement('div');
    av.className = 'det-sec';
    const etq = { si: 'Sí se atendieron', parcial: 'Atendidos parcialmente', no: 'No se atendieron' }[r.avances.estado] || '—';
    const badge = r.avances.estado === 'si' ? '<span class="badge si">Sí</span>'
      : r.avances.estado === 'no' ? '<span class="badge no">No</span>'
      : r.avances.estado === 'parcial' ? '<span class="badge gris">Parcial</span>' : '';
    av.innerHTML = `<div class="head"><h3>Avances vs. semana pasada</h3>${badge}</div>
      <div class="det-com"><strong>${etq}.</strong>${r.avances.comentarios ? ' ' + escapeHtml(r.avances.comentarios) : ''}</div>`;
    body.appendChild(av);
  }

  const sug = document.createElement('div');
  sug.className = 'det-sec';
  sug.innerHTML = `<div class="head"><h3>Comentarios y sugerencias generales</h3></div>
    <div class="det-com">${r.sugerencias ? escapeHtml(r.sugerencias) : '<span class="muted">Sin comentarios.</span>'}</div>`;
  body.appendChild(sug);

  document.getElementById('modal').classList.remove('hidden');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('btn-login').addEventListener('click', login);
document.getElementById('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
document.getElementById('modal-reanalizar').addEventListener('click', async (e) => {
  if (!REPORTE_ACTUAL) return;
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = 'Encolando…';
  try {
    const res = await fetch(`/api/admin/reportes/${REPORTE_ACTUAL}/reanalizar`, { method: 'POST' });
    if (!res.ok) throw new Error();
    btn.textContent = 'IA analizando…';
    alert('Reanálisis encolado. Vuelve a abrir el reporte en un momento para ver el resultado.');
  } catch (err) { btn.disabled = false; btn.textContent = 'Reanalizar IA'; alert('No se pudo reanalizar.'); }
});
document.getElementById('modal-close').addEventListener('click', () => document.getElementById('modal').classList.add('hidden'));
document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.target.classList.add('hidden'); });
document.getElementById('logout').addEventListener('click', async (e) => {
  e.preventDefault(); await fetch('/api/admin/logout', { method: 'POST' }); location.reload();
});

window.verDetalle = verDetalle;
checkAuth();
