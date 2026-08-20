let CONFIG = null;
const state = { fotos: {}, estados: {}, avances: { estado: null } };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CAM_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

async function init() {
  const res = await fetch('/api/config');
  CONFIG = await res.json();

  const sel = document.getElementById('sucursal');
  if (CONFIG.regiones && CONFIG.regiones.length) {
    for (const reg of CONFIG.regiones) {
      const og = document.createElement('optgroup');
      og.label = reg.nombre;
      for (const s of reg.sucursales) {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
  } else {
    for (const s of CONFIG.sucursales) {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      sel.appendChild(opt);
    }
  }
  buildSecciones();

  document.getElementById('btn-empezar').addEventListener('click', empezar);
  document.getElementById('cambiar-sucursal').addEventListener('click', volver);
  document.getElementById('formulario').addEventListener('submit', enviar);
  document.getElementById('btn-otro').addEventListener('click', () => location.reload());
}

function buildSecciones() {
  const cont = document.getElementById('secciones');
  cont.innerHTML = '';
  let grupoPrev = null;
  CONFIG.secciones.forEach((sec, i) => {
    state.fotos[sec.key] = [];

    if (sec.grupo && sec.grupo !== grupoPrev) {
      grupoPrev = sec.grupo;
      const gh = document.createElement('div');
      gh.className = 'grupo-head';
      gh.innerHTML = `<span class="txt">${sec.grupo}</span><span class="line"></span>`;
      cont.appendChild(gh);
    }

    const card = document.createElement('section');
    card.className = 'card seccion';
    card.dataset.key = sec.key;
    card.innerHTML = `
      <div class="seccion-header">
        <h2><span class="seccion-num">${String(i + 1).padStart(2, '0')}</span> · ${sec.label}</h2>
        ${sec.opcional ? '<span class="chip-opt">Opcional</span>' : ''}
        ${sec.requerida ? '<span class="chip-req">Obligatoria</span>' : ''}
      </div>
      ${refHTML(sec)}
      ${sec.estado ? estadoHTML(sec) : ''}
      ${sec.fotos ? fotosHTML(sec) : ''}
      <div class="q-label">Comentarios</div>
      <textarea data-com="${sec.key}" rows="2" placeholder="Observaciones de esta sección (opcional)"></textarea>
    `;
    cont.appendChild(card);
  });

  cont.querySelectorAll('.estado-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const val = btn.dataset.val;
      state.estados[key] = val;
      cont.querySelectorAll(`.estado-btn[data-key="${key}"]`).forEach((b) => b.classList.remove('sel-ok', 'sel-bad'));
      btn.classList.add(val === 'ok' ? 'sel-ok' : 'sel-bad');
      const card = cont.querySelector(`.seccion[data-key="${key}"]`);
      card.classList.remove('is-ok', 'is-bad');
      card.classList.add(val === 'ok' ? 'is-ok' : 'is-bad');
      actualizarProgreso();
    });
  });

  cont.querySelectorAll('input[type=file]').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const key = input.dataset.key;
      const files = Array.from(e.target.files);
      input.value = '';
      const drop = document.querySelector(`.dropzone[data-drop="${key}"]`);
      if (drop) drop.classList.add('procesando');
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const comprimida = await comprimirImagen(file);
        state.fotos[key].push({ file: comprimida, url: URL.createObjectURL(comprimida) });
        renderPreviews(key);
      }
      if (drop) drop.classList.remove('procesando');
    });
  });
}

// Reduce el tamaño de la foto en el navegador antes de subirla (celulares suben fotos de varios MB).
async function comprimirImagen(file, maxLado = 1400, calidad = 0.65) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    let { width, height } = bitmap;
    if (width > maxLado || height > maxLado) {
      const r = Math.min(maxLado / width, maxLado / height);
      width = Math.round(width * r);
      height = Math.round(height * r);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close && bitmap.close();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', calidad));
    if (!blob) return file;
    const nombre = (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], nombre, { type: 'image/jpeg' });
  } catch (err) {
    console.warn('No se pudo comprimir, se sube original:', err);
    return file; // si algo falla, sube la original
  }
}

// Muestra una foto de referencia ("así debe verse") si existe el archivo
// public/referencias/<clave>.jpg. Si no existe, se oculta automáticamente.
function refHTML(sec) {
  const archivo = CONFIG.referencias && CONFIG.referencias[sec.key];
  if (!archivo) return '';
  return `
    <div class="ref-ejemplo">
      <div class="q-label">📌 Foto de referencia — así debe verse</div>
      <img src="/referencias/${archivo}" alt="Referencia de ${sec.label}" loading="lazy" />
    </div>`;
}

function estadoHTML(sec) {
  return `
    <div class="q-label">${sec.estadoLabel}</div>
    <div class="segmented">
      <button type="button" class="estado-btn" data-key="${sec.key}" data-val="ok"><span class="dot"></span> Funcional</button>
      <button type="button" class="estado-btn" data-key="${sec.key}" data-val="issue"><span class="dot"></span> No funcional</button>
    </div>`;
}

function fotosHTML(sec) {
  const hint = sec.hint
    ? sec.hint
    : (sec.minFotos > 0 ? `Sube al menos ${sec.minFotos} foto${sec.minFotos > 1 ? 's' : ''}` : 'Sube las fotos que necesites');
  return `
    <div class="q-label">Fotos</div>
    <label class="dropzone" data-drop="${sec.key}">
      <span class="ic">${CAM_ICON}</span>
      <span>Tomar o subir fotos<span class="hint">${hint}</span></span>
      <input type="file" accept="image/*" capture="environment" multiple data-key="${sec.key}" />
    </label>
    <div class="previews" data-prev="${sec.key}"></div>`;
}

function renderPreviews(key) {
  const cont = document.querySelector(`[data-prev="${key}"]`);
  cont.innerHTML = '';
  state.fotos[key].forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.innerHTML = `<img src="${item.url}" alt="" /><button type="button" title="Quitar" aria-label="Quitar foto">×</button>`;
    div.querySelector('button').addEventListener('click', () => {
      URL.revokeObjectURL(item.url);
      state.fotos[key].splice(idx, 1);
      renderPreviews(key);
    });
    cont.appendChild(div);
  });
}

function actualizarProgreso() {
  const total = CONFIG.secciones.filter((s) => s.estado).length;
  const hechas = Object.keys(state.estados).length;
  document.getElementById('conteo').textContent = `${hechas} / ${total}`;
  const pct = total ? Math.round((hechas / total) * 100) : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
}

function empezar() {
  const suc = document.getElementById('sucursal').value;
  if (!suc) { alert('Por favor selecciona tu sucursal.'); return; }
  document.getElementById('sucursal-nombre').textContent = suc;
  document.getElementById('avatar').textContent = suc.trim().charAt(0).toUpperCase();
  document.getElementById('paso-sucursal').classList.add('hidden');
  document.getElementById('formulario').classList.remove('hidden');
  state.avances = { estado: null };
  cargarAvances(suc);
  actualizarProgreso();
  window.scrollTo(0, 0);
}

// Trae los pendientes de la semana pasada y arma la sección de avances.
async function cargarAvances(suc) {
  const box = document.getElementById('avances-box');
  box.innerHTML = '';
  let data;
  try {
    const res = await fetch('/api/pendientes-semana-pasada?sucursal=' + encodeURIComponent(suc));
    data = await res.json();
  } catch (e) { return; }
  if (!data || !data.hayReporte) return; // primera semana: no hay con qué comparar

  let inner = `<div class="card avances"><div class="eyebrow">Seguimiento</div>
    <h2 style="font-size:18px">Avances de la semana pasada</h2>`;
  if (data.pendientes.length) {
    inner += `<p class="muted small" style="margin:6px 0 10px">La semana pasada quedaron estos pendientes. ¿Ya se atendieron?</p>
      <ul class="pend-list">${data.pendientes.map((p) =>
        `<li><b>${escapeHtml(p.seccion)}</b>${p.comentario ? ' — ' + escapeHtml(p.comentario) : ''}</li>`).join('')}</ul>
      <div class="q-label">¿Se atendieron estos pendientes?</div>
      <div class="segmented seg3">
        <button type="button" class="av-btn" data-val="si">✓ Sí</button>
        <button type="button" class="av-btn" data-val="parcial">◑ Parcial</button>
        <button type="button" class="av-btn" data-val="no">✕ No</button>
      </div>`;
  } else {
    inner += `<p class="muted small" style="margin:6px 0 8px">La semana pasada no hubo pendientes marcados. 🎉</p>`;
  }
  inner += `<div class="q-label">Comentarios de avances</div>
    <textarea id="avances-com" rows="2" placeholder="¿Qué se resolvió o qué sigue pendiente?"></textarea></div>`;
  box.innerHTML = inner;

  box.querySelectorAll('.av-btn').forEach((b) => b.addEventListener('click', () => {
    state.avances.estado = b.dataset.val;
    box.querySelectorAll('.av-btn').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
  }));
}

function volver() {
  document.getElementById('formulario').classList.add('hidden');
  document.getElementById('paso-sucursal').classList.remove('hidden');
  window.scrollTo(0, 0);
}

async function enviar(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-enviar');
  const prog = document.getElementById('progreso');
  const suc = document.getElementById('sucursal').value;

  // Secciones con foto obligatoria (requerida: true en config.js).
  for (const sec of CONFIG.secciones) {
    if (!sec.requerida) continue;
    const min = Math.max(1, sec.minFotos || 1);
    if ((state.fotos[sec.key] || []).length < min) {
      alert(`Falta subir la foto de "${sec.label}" (mínimo ${min}). Es obligatoria para enviar el reporte.`);
      const card = document.querySelector(`.seccion[data-key="${sec.key}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }

  const fd = new FormData();
  fd.append('sucursal', suc);
  fd.append('responsable', document.getElementById('responsable').value.trim());
  fd.append('sugerencias', document.getElementById('sugerencias').value.trim());
  if (state.avances.estado) fd.append('avances_estado', state.avances.estado);
  const avCom = document.getElementById('avances-com');
  if (avCom && avCom.value.trim()) fd.append('avances_comentarios', avCom.value.trim());

  for (const sec of CONFIG.secciones) {
    if (state.estados[sec.key]) fd.append(`estado_${sec.key}`, state.estados[sec.key]);
    const com = document.querySelector(`[data-com="${sec.key}"]`);
    if (com && com.value.trim()) fd.append(`comentarios_${sec.key}`, com.value.trim());
    for (const item of state.fotos[sec.key] || []) {
      fd.append(`foto_${sec.key}`, item.file, item.file.name);
    }
  }

  btn.disabled = true;
  prog.classList.remove('hidden');
  prog.textContent = 'Enviando fotos, esto puede tardar según tu conexión...';

  try {
    const res = await fetch('/api/reportes', { method: 'POST', body: fd });
    const texto = await res.text();
    let data;
    try { data = JSON.parse(texto); } catch (_) {
      // El servidor respondió HTML (proxy/tamaño/tiempo), no JSON.
      if (res.status === 413) throw new Error('Las fotos pesan demasiado. Intenta con menos fotos o repite el envío.');
      throw new Error(`El servidor respondió de forma inesperada (código ${res.status}). Revisa tu conexión e intenta de nuevo.`);
    }
    if (!res.ok) throw new Error(data.message || data.error || 'Error al enviar');
    document.getElementById('formulario').classList.add('hidden');
    document.getElementById('exito').classList.remove('hidden');
    document.getElementById('exito-semana').textContent = data.semana;
    window.scrollTo(0, 0);
  } catch (err) {
    alert('No se pudo enviar: ' + err.message);
    btn.disabled = false;
    prog.classList.add('hidden');
  }
}

init();
