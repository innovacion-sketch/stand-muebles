const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { SECCIONES, DATA_DIR } = require('./config');
const { weekRange } = require('./utils');

const COLORS = {
  primary: '#111114',   // encabezado negro editorial
  accent:  '#2f5fd6',   // azul (secciones / acentos)
  dark: '#111114',
  gray: '#6a7278',
  light: '#e4e6ea',
  ok: '#2f5fd6',        // funcional = azul (coherente con el panel)
  bad: '#e0642f',       // no funcional = ámbar
  ia: '#7a4fd0',        // análisis con IA = violeta (coherente con el panel)
};

// Etiqueta y color del veredicto de IA por sección.
const IA_ETQ = { ok: 'Se ve bien', atencion: 'Requiere revisión', falla: 'Falla detectada' };
function iaColor(estado) {
  return estado === 'ok' ? COLORS.ok : estado === 'falla' ? COLORS.bad : '#c07a1e';
}

// Genera el PDF de un reporte y lo escribe en el stream (res o archivo).
function buildPDF(reporte, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // -------- Encabezado --------
  doc.rect(0, 0, doc.page.width, 90).fill(COLORS.primary);
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
    .text('Reporte de Stand', 40, 28);
  doc.fontSize(12).font('Helvetica')
    .text('Sidhe — Estado de mueble por sucursal', 40, 58);
  doc.fillColor(COLORS.dark);
  doc.moveDown(3);

  // -------- Datos generales --------
  let y = 110;
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.dark)
    .text(`Sucursal: ${reporte.sucursal}`, 40, y);
  y += 22;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.gray);
  doc.text(`Semana: ${reporte.semana}  (${weekRange(reporte.semana)})`, 40, y);
  y += 15;
  const fecha = new Date(reporte.createdAt);
  doc.text(`Enviado: ${fecha.toLocaleString('es-MX')}`, 40, y);
  if (reporte.responsable) {
    y += 15;
    doc.text(`Responsable: ${reporte.responsable}`, 40, y);
  }
  y += 25;
  doc.moveTo(40, y).lineTo(40 + pageWidth, y).strokeColor(COLORS.light).stroke();
  y += 15;

  // -------- Secciones --------
  for (const sec of SECCIONES) {
    const data = (reporte.secciones && reporte.secciones[sec.key]) || {};
    const fotos = data.fotos || [];
    if (sec.opcional && fotos.length === 0 && !data.comentarios && !data.estado) continue;

    // Salto de página si no cabe el encabezado de sección
    if (y > doc.page.height - 140) { doc.addPage(); y = 50; }

    // Título de sección
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.dark).text(sec.label, 40, y);
    if (sec.estado) {
      const est = data.estado;
      const txt = est === 'ok' ? 'FUNCIONAL / BUEN ESTADO' : est === 'issue' ? 'NO FUNCIONAL / DAÑADO' : 'Sin marcar';
      const color = est === 'ok' ? COLORS.ok : est === 'issue' ? COLORS.bad : COLORS.gray;
      doc.fontSize(9).fillColor('#ffffff');
      const badgeW = doc.widthOfString(txt) + 14;
      doc.roundedRect(40 + pageWidth - badgeW, y - 2, badgeW, 16, 4).fill(color);
      doc.fillColor('#ffffff').text(txt, 40 + pageWidth - badgeW + 7, y + 1);
    }
    y += 22;
    doc.fillColor(COLORS.dark);

    // Fotos en cuadrícula (2 por fila)
    if (fotos.length) {
      const gap = 10;
      const imgW = (pageWidth - gap) / 2;
      const imgH = imgW * 0.72;
      let col = 0;
      for (const f of fotos) {
        if (y + imgH > doc.page.height - 40) { doc.addPage(); y = 50; col = 0; }
        const x = 40 + col * (imgW + gap);
        const filePath = path.join(DATA_DIR, 'uploads', f);
        const ext = path.extname(f).toLowerCase();
        // Solo se incrustan JPEG: PDFKit puede colgarse con ciertos PNG.
        const esJpeg = ext === '.jpg' || ext === '.jpeg';
        try {
          if (fs.existsSync(filePath) && esJpeg) {
            doc.image(filePath, x, y, { fit: [imgW, imgH], align: 'center', valign: 'center' });
            doc.rect(x, y, imgW, imgH).strokeColor(COLORS.light).stroke();
          } else if (fs.existsSync(filePath)) {
            doc.rect(x, y, imgW, imgH).fill('#f9fafb').strokeColor(COLORS.light).stroke();
            doc.fontSize(8).fillColor(COLORS.gray)
              .text('Foto disponible en el panel web', x + 6, y + imgH / 2 - 4, { width: imgW - 12, align: 'center' });
          } else {
            doc.rect(x, y, imgW, imgH).strokeColor(COLORS.light).stroke();
            doc.fontSize(8).fillColor(COLORS.gray).text('(imagen no encontrada)', x + 6, y + imgH / 2);
          }
        } catch (e) {
          doc.rect(x, y, imgW, imgH).strokeColor(COLORS.light).stroke();
          doc.fontSize(8).fillColor(COLORS.gray).text('(no se pudo cargar imagen)', x + 6, y + imgH / 2);
        }
        col++;
        if (col === 2) { col = 0; y += imgH + gap; }
      }
      if (col === 1) { y += imgH + gap; }
    } else {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLORS.gray).text('Sin fotos.', 40, y);
      y += 16;
    }

    // Comentarios de la sección
    if (data.comentarios) {
      if (y > doc.page.height - 80) { doc.addPage(); y = 50; }
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.dark).text('Comentarios:', 40, y);
      y += 13;
      doc.font('Helvetica').fontSize(10).fillColor('#333333');
      doc.text(data.comentarios, 40, y, { width: pageWidth });
      y = doc.y + 8;
    }

    // Análisis con IA (si existe y no fue error de cuota/servicio)
    const ia = data.ia;
    if (ia && ia.estado && ia.estado !== 'error') {
      if (y > doc.page.height - 90) { doc.addPage(); y = 50; }
      const etq = IA_ETQ[ia.estado] || ia.estado;
      const conf = (typeof ia.confianza === 'number') ? `  ·  ${Math.round(ia.confianza * 100)}% confianza` : '';
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ia)
        .text(`Análisis IA: ${etq}${conf}`, 40, y);
      y = doc.y + 3;
      if (ia.resumen) {
        doc.font('Helvetica').fontSize(9.5).fillColor('#444444').text(ia.resumen, 40, y, { width: pageWidth });
        y = doc.y + 2;
      }
      const lista = (titulo, arr) => {
        if (!arr || !arr.length) return;
        if (y > doc.page.height - 70) { doc.addPage(); y = 50; }
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#444444').text(`${titulo}:`, 40, y);
        y = doc.y + 1;
        doc.font('Helvetica').fontSize(9.5).fillColor('#444444');
        for (const item of arr) {
          if (y > doc.page.height - 55) { doc.addPage(); y = 50; }
          doc.text(`•  ${item}`, 48, y, { width: pageWidth - 8 });
          y = doc.y + 1;
        }
      };
      lista('Hallazgos', ia.hallazgos);
      lista('Faltantes', ia.faltantes);
      y += 8;
    }

    y += 8;
    doc.moveTo(40, y).lineTo(40 + pageWidth, y).strokeColor(COLORS.light).stroke();
    y += 12;
  }

  // -------- Avances vs. semana pasada --------
  if (reporte.avances && (reporte.avances.estado || reporte.avances.comentarios)) {
    if (y > doc.page.height - 120) { doc.addPage(); y = 50; }
    const etq = { si: 'Sí se atendieron', parcial: 'Atendidos parcialmente', no: 'No se atendieron' }[reporte.avances.estado] || '—';
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.accent).text('Avances vs. semana pasada', 40, y);
    y += 18;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.dark).text(etq + '.', 40, y);
    y = doc.y + 4;
    if (reporte.avances.comentarios) {
      doc.font('Helvetica').fontSize(10).fillColor('#333333').text(reporte.avances.comentarios, 40, y, { width: pageWidth });
      y = doc.y;
    }
    y += 14;
  }

  // -------- Sugerencias generales --------
  if (y > doc.page.height - 120) { doc.addPage(); y = 50; }
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.accent).text('Comentarios y sugerencias generales', 40, y);
  y += 20;
  doc.font('Helvetica').fontSize(10).fillColor('#333333')
    .text(reporte.sugerencias || 'Sin comentarios.', 40, y, { width: pageWidth });

  // -------- Pie de página con numeración --------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Escribir en el margen inferior sin que PDFKit crea que el contenido
    // se desbordó (eso agregaba una página en blanco por cada pie).
    const bottomOrig = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.gray)
      .text(`${reporte.sucursal} — ${reporte.semana}   |   Página ${i - range.start + 1} de ${range.count}`,
        40, doc.page.height - 28, { width: pageWidth, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottomOrig;
  }

  doc.end();
}

module.exports = { buildPDF };
