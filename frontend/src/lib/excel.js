/* Excel (.xlsx sin librerías: zip sin compresión + XML) e impresión en un iframe oculto (sin ventanas emergentes). */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc = (b) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

function zip(files) {
  const enc = new TextEncoder();
  const out = [];
  const cd = [];
  let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.n);
    const d = enc.encode(f.d);
    const c = crc(d);
    const h = new DataView(new ArrayBuffer(30));
    const e = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, c, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nm.length, true);
    e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(8, 0x0800, true); e.setUint16(14, 0x21, true);
    e.setUint32(16, c, true); e.setUint32(20, d.length, true); e.setUint32(24, d.length, true); e.setUint16(28, nm.length, true); e.setUint32(42, off, true);
    out.push(new Uint8Array(h.buffer), nm, d);
    cd.push(new Uint8Array(e.buffer), nm);
    off += 30 + nm.length + d.length;
  }
  const n = cd.reduce((a, x) => a + x.length, 0);
  const z = new DataView(new ArrayBuffer(22));
  z.setUint32(0, 0x06054b50, true); z.setUint16(8, files.length, true); z.setUint16(10, files.length, true); z.setUint32(12, n, true); z.setUint32(16, off, true);
  return new Blob([...out, ...cd, new Uint8Array(z.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const col = (i) => String.fromCharCode(65 + i);

/** hojas: [{nombre, cols:[…], filas:[[…]], dinero:[índices de columnas en $]}] */
export function xlsx(hojas) {
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const hoja = (h) => {
    const filas = [h.cols, ...h.filas];
    const w = h.cols.map((c, i) => Math.min(40, Math.max(...filas.map((f) => String(f[i] == null ? '' : f[i]).length)) + 2));
    return `${X}<worksheet ${ns}><cols>${w.map((x, i) => `<col min="${i + 1}" max="${i + 1}" width="${x}" customWidth="1"/>`).join('')}</cols><sheetData>${
      filas.map((f, r) => `<row r="${r + 1}">${f.map((v, i) => {
        const ref = col(i) + (r + 1);
        if (r === 0) return `<c r="${ref}" s="1" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
        if (typeof v === 'number') return `<c r="${ref}" s="${(h.dinero || []).includes(i) ? 2 : 0}"><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
      }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  };
  const files = [
    { n: '[Content_Types].xml', d: `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((h, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { n: '_rels/.rels', d: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { n: 'xl/workbook.xml', d: `${X}<workbook ${ns} xmlns:r="${R}"><sheets>${hojas.map((h, i) => `<sheet name="${esc(h.nombre.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { n: 'xl/_rels/workbook.xml.rels', d: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((h, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>` },
    { n: 'xl/styles.xml', d: `${X}<styleSheet ${ns}><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...hojas.map((h, i) => ({ n: `xl/worksheets/sheet${i + 1}.xml`, d: hoja(h) })),
  ];
  return zip(files);
}

export function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export const tablaHtml = (cols, filas) => `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
  filas.map((r) => `<tr>${r.map((c, i) => `<td${i > 0 && /^[−-]?\$/.test(String(c)) ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/** Imprime un documento con el logo de Orígenes SV. */
export function imprimir(titulo, html, fecha = Date.now()) {
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(fr);
  const d = fr.contentWindow.document;
  d.open();
  d.write(`<!doctype html><meta charset="utf-8"><title>${esc(titulo)}</title><style>body{font:13px system-ui,sans-serif;margin:24px;color:#222}h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:18px 0 6px}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #bbb;padding:5px 8px;text-align:left}th{background:#f1f1f1}td.n{text-align:right}.mut{color:#666}</style><img src="${new URL('/assets/logo-azul.png', window.location.href).href}" style="height:44px;float:right"><h1>Orígenes SV · ${esc(titulo)}</h1><div class="mut">Impreso el ${esc(new Date(fecha).toLocaleDateString('es-SV', { timeZone: 'America/El_Salvador' }))}</div>${html}`);
  d.close();
  setTimeout(() => {
    try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { /* sin impresora */ }
    setTimeout(() => fr.remove(), 2000);
  }, 300);
}
