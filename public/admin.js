let SECCIONES_DEF = [];
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

  document.getElementById('s-ok').textContent = data.completadas;
  document.getElementById('s-ok-of').textContent = ` /${data.total}`;
  document.getElementById('s-pend').textContent = data.total - data.completadas;
  document.getElementById('s-total').textContent = data.total;
  document.getElementById('s-inc').textContent = data.incidencias;

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

function celdaSucursal(f) {
  const cls = f.reporto ? 'reported' : 'pending';
  const estado = f.reporto ? 'Reportó' : 'Pendiente';
  const tag = f.incidencia
    ? '<div class="tag">! Incidencia</div>'
    : (f.reporto ? '' : '');
  const idAttr = f.reporto ? ` data-id="${f.id}"` : '';
  return `
    <div class="branch ${cls}"${idAttr}>
      <span class="dot"></span>
      <div class="name">${escapeHtml(f.sucursal)}</div>
      <div class="st">${estado}</div>
      ${tag}
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
      ${d.comentarios ? `<div class="det-com"><strong>Comentarios:</strong> ${escapeHtml(d.comentarios)}</div>` : ''}`;
    body.appendChild(div);
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
document.getElementById('modal-close').addEventListener('click', () => document.getElementById('modal').classList.add('hidden'));
document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.target.classList.add('hidden'); });
document.getElementById('logout').addEventListener('click', async (e) => {
  e.preventDefault(); await fetch('/api/admin/logout', { method: 'POST' }); location.reload();
});

window.verDetalle = verDetalle;
checkAuth();
