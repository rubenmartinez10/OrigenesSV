import { $, fmt } from './formato.js';
import { corr, donde } from './pedidos.js';

/* Ticket de 80 mm (ADENDA v4): se imprime desde Mis pedidos, Mi historial y Ventas. */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function html(p, v, sucursal, iva) {
  const tot = p.total;
  const sub = v ? v.sub : +(tot / (1 + iva / 100)).toFixed(2);
  const im = v ? v.iva : +(tot - sub).toFixed(2);
  const pr = v?.propina || 0;
  const f = (a, b) => `<div class="f"><span>${a}</span><span>${b}</span></div>`;
  const fila = (l) => `<tr><td class="q">${l.cant}×</td><td>${esc(l.nombre)}${l.extras?.length ? `<br><small>+ ${esc(l.extras.map((e) => e.nombre).join(', '))}</small>` : ''}</td><td class="r">${$(l.unit * l.cant)}</td></tr>`;
  const pago = v
    ? f('Método', esc(v.metodo)) + (v.ref ? `<div class="c">${esc(v.ref)}</div>` : '') + (v.pago?.recibido != null ? f('Recibido', $(v.pago.recibido)) + f('Cambio', $(v.pago.cambio)) : '')
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ticket #${p.num}</title><style>
@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:0 auto;font:12px/1.35 "Courier New",monospace;color:#000}
.c{text-align:center}.r{text-align:right;white-space:nowrap}.q{width:9mm;vertical-align:top}h1{font-size:16px;margin:0}hr{border:0;border-top:1px dashed #000;margin:6px 0}
table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}.f{display:flex;justify-content:space-between}.t{font-size:15px;font-weight:700}small{font-size:10px}
</style></head><body>
<div class="c"><img src="${location.origin}/assets/logo-azul.png" style="height:46px;margin-bottom:4px"><h1>Orígenes SV</h1><div>Puchica, qué buen sabor</div><div>Sucursal ${esc(sucursal)}</div></div><hr>
<div class="c"><b>${v ? `${esc(v.tipo)} ${esc(corr(v))}` : 'CUENTA'}</b>${v ? '' : '<br><small>No es un documento fiscal</small>'}</div>
${f(p.rep ? 'Reposición' : 'Pedido', `#${p.num}`)}${f('Servicio', esc(donde(p)))}${f('Cocinero', esc(p.cocineroNombre || '—'))}${f('Fecha', fmt(v ? v.fecha : p.entregado || p.creado))}${f('Atendió', esc(p.meseroNombre || ''))}
${v?.fis ? `<hr><div>${esc(v.fis.nombre)}<br>NIT ${esc(v.fis.nit)}<br>NRC ${esc(v.fis.nrc)}</div>` : ''}
<hr><table>${p.lineas.map(fila).join('')}</table><hr>
${f('Subtotal sin IVA', $(sub))}${f(`IVA ${iva} %`, $(im))}${pr ? f('Propina', $(pr)) : ''}<div class="f t"><span>TOTAL</span><span>${$(tot + pr)}</span></div>
${pago ? `<hr>${pago}` : ''}<hr><div class="c">¡Gracias por su visita!</div></body></html>`;
}

/** Imprime el ticket en un iframe oculto. */
export function imprimirTicket(pedido, venta, sucursal, iva = 13) {
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(fr);
  const w = fr.contentWindow;
  w.document.open();
  w.document.write(html(pedido, venta, sucursal, iva));
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); setTimeout(() => fr.remove(), 2000); }, 300);
}
