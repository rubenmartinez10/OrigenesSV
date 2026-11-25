import { Router } from 'express';
import { q, tx, ts } from '../db.js';
import { fallo, si, noEncontrado, motivo as validarMotivo } from '../lib/errores.js';
import { ahora, D, inicioDia } from '../lib/reloj.js';
import { bitacora, notificar } from '../lib/registro.js';
import { verificarClave } from '../lib/clave.js';
import { cfg, r2, sum, recetas, costosMP, costosTope, costoReceta, costoPropuesta, neto, turnosDe } from '../lib/negocio.js';
import { minimosYStock } from '../lib/procesos.js';
import { cargarCompras, compraParaCambiar, aceptarMercancia, valorRecibido, skuNuevo } from '../lib/compras.js';
import { cargarSolicitudes, cargarVentas } from '../lib/consultas.js';
import { cargarConteos } from './bodega.js';
import {
  ROLN, ROLES_SUC, salarioRol, salarioDe, activos, necesarios, aplicarDespido, despidoBloqueo, usuarioPorId,
  cambiarRol, despedirDirecto, puedeSobre, rolesDestino, turnoHoy,
} from '../lib/personal.js';

/* Gerente de sucursal · interfaces 5.1 a 5.12 */
const r = Router();
const DB = { query: q };
const TP = ['Producto nuevo', 'Extra nuevo', 'Categoría nueva'];
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/* ---------- ventas para el resumen ---------- */
async function totalVentas(c, s, a, b) {
  const { rows } = await c.query(
    `SELECT COALESCE(sum(v.total - COALESCE((SELECT sum(x.monto) FROM venta_ajustes x WHERE x.venta_id = v.id), 0)), 0) AS t, count(*)::int n
       FROM ventas v WHERE ($1::int IS NULL OR v.sucursal_id = $1) AND v.fecha >= $2 AND v.fecha < $3`, [s, ts(a), ts(b)]);
  return { total: r2(rows[0].t), n: rows[0].n };
}
export async function ranking(c, s, a, b, por) {
  const { rows } = await c.query(
    `SELECT ${por === 'cat' ? `COALESCE((SELECT cg.nombre FROM producto_categorias pc JOIN categorias cg ON cg.id = pc.categoria_id
                                         WHERE pc.producto_id = l.producto_id ORDER BY cg.id LIMIT 1), '—')` : 'l.nombre'} AS k,
            sum(l.precio_unit * l.cantidad) AS v
       FROM ventas v JOIN pedido_lineas l ON l.pedido_id = v.pedido_id
      WHERE ($1::int IS NULL OR v.sucursal_id = $1) AND v.fecha >= $2 AND v.fecha < $3 GROUP BY 1 ORDER BY 2 DESC`, [s, ts(a), ts(b)]);
  return rows.map((x) => [x.k, r2(x.v)]);
}
export { totalVentas };

r.get('/resumen', async (req, res) => {
  const s = req.usuario.sucursal;
  const t = ahora();
  const h = inicioDia(t);
  const hoy = await totalVentas(DB, s, h, h + D);
  const ayer = await totalVentas(DB, s, h - D, t - D);
  const per = { Hoy: [h, h + D], '7 días': [h - 6 * D, h + D], '30 días': [h - 29 * D, h + D] }[req.query.per] || [h, h + D];
  const mats = await minimosYStock(DB, s, t, await recetas(DB));
  const k = await cfg(DB);
  const { rows: pv } = await q(`SELECT count(*)::int n FROM lotes WHERE sucursal_id = $1 AND cantidad > 0 AND vence > $2 AND vence - $2 <= $3 * interval '1 day'`, [s, ts(t), k.por_vencer_dias]);
  const costos = await costosMP(DB, s);
  const rec = await recetas(DB);
  const { rows: rv } = await q(`SELECT p.id, p.nombre, p.precio FROM sucursal_revisar sr JOIN productos p ON p.id = sr.producto_id WHERE sr.sucursal_id = $1`, [s]);
  res.json({
    hoy, ayer,
    rank: await ranking(DB, s, per[0], per[1], req.query.vista === 'cat' ? 'cat' : 'prod'),
    stockBajo: mats.filter((m) => m.estado === 'Activo' && m.minimo > 0 && m.stock < m.minimo).map((m) => ({ nombre: m.nombre, unidad: m.unidad, stock: m.stock, minimo: m.minimo })),
    porVencer: pv[0].n,
    revisar: rv.map((p) => ({ ...p, costo: r2(costoReceta(rec[p.id], costos)) })),
  });
});

/* ---------- 5.2 propuestas de productos, extras y categorías ---------- */
r.get('/propuestas', async (req, res) => {
  const s = req.usuario.sucursal;
  const L = await cargarSolicitudes(DB, `s.sucursal_id = $1 AND s.tipo = ANY($2) AND s.estado = 'Aprobado por jefe de cocina'`, [s, TP], 's.fecha');
  const { rows: conProv } = await q(`SELECT DISTINCT pm.mp_id FROM proveedor_materias pm JOIN proveedores v ON v.id = pm.proveedor_id WHERE v.estado = 'Activo'`);
  const cp = new Set(conProv.map((x) => x.mp_id));
  for (const x of L) {
    if (x.tipo === 'Producto nuevo') x.costo = await costoPropuesta(DB, x.datos.ings, s);
    x.sinProveedor = [...new Set((x.datos?.ings || []).map((i) => i.mp))].filter((m) => typeof m === 'string' || !cp.has(m));
  }
  res.json(L);
});

r.post('/propuestas/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND sucursal_id = $2 AND tipo = ANY($3) AND estado = 'Aprobado por jefe de cocina' FOR UPDATE`, [req.params.id, u.sucursal, TP]);
    const x = rows[0];
    if (!x) throw noEncontrado('La propuesta ya fue revisada');
    let precio = null;
    if (x.tipo === 'Producto nuevo') {
      precio = r2(+req.body?.precio);
      si(!(precio > 0), 'Escribe el precio propuesto');
      const k = await cfg(c);
      const cp = await costoPropuesta(c, x.datos.ings, u.sucursal);
      si(!cp.incompleto && neto(precio, k) <= cp.costo, 'Sin IVA, el precio debe superar el costo');
    }
    if (x.tipo !== 'Categoría nueva') {
      const { rows: ps } = await c.query('SELECT nombre FROM productos');
      si(ps.some((p) => norm(p.nombre) === norm(x.nombre)), 'Ya existe un producto o extra con ese nombre');
    }
    await c.query(`UPDATE solicitudes SET estado = 'Aprobado por gerente de sucursal', aprueba_rol = 'gg', monto = COALESCE($2, monto), decidio_id = $3, fecha = $4,
                   datos = datos || $5::jsonb WHERE id = $1`, [x.id, precio, u.id, ts(ahora()), JSON.stringify(precio ? { precio, gerente: u.id } : { gerente: u.id })]);
    const { rows: suc } = await c.query('SELECT nombre FROM sucursales WHERE id = $1', [u.sucursal]);
    await notificar(c, 'gg', null, 'Propuesta por aprobar', `${x.tipo}: ${x.nombre} · ${suc[0].nombre}`);
    await notificar(c, 'cocinero', u.sucursal, 'Propuesta aprobada por el gerente', x.nombre);
    await bitacora(c, u, { accion: 'propuesta.aprobar.gerente', elemento: x.nombre });
  });
  res.json({ ok: true });
});

r.post('/propuestas/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND sucursal_id = $2 AND tipo = ANY($3) AND estado = 'Aprobado por jefe de cocina' FOR UPDATE`, [req.params.id, u.sucursal, TP]);
    if (!rows[0]) throw noEncontrado('La propuesta ya fue revisada');
    await c.query(`UPDATE solicitudes SET estado = 'Rechazado', rechazo = $2, decidio_id = $3 WHERE id = $1`,
      [rows[0].id, JSON.stringify({ por: 'Gerente de sucursal', etapa: 'Gerente de sucursal', motivo: m, fecha: ahora() }), u.id]);
    await notificar(c, 'cocinero', u.sucursal, 'Propuesta rechazada', `${rows[0].nombre}: ${m}`);
    await bitacora(c, u, { accion: 'propuesta.rechazar.gerente', elemento: rows[0].nombre, motivo: m });
  });
  res.json({ ok: true });
});

/* ---------- 5.3 compras y recepción ---------- */
r.get('/compras', async (req, res) => {
  const s = req.usuario.sucursal;
  const vista = req.query.vista || 'preparadas';
  const est = { preparadas: ['Preparada'], recibidas: ['Recibida'], curso: ['Aceptada por gerente', 'En camino', 'Cancelación en revisión', 'Devolución en revisión', 'Descuento en revisión'] }[vista];
  const L = await cargarCompras(DB, 'c.sucursal_id = $1 AND c.estado = ANY($2)', [s, est]);
  for (const cp of L) if (cp.recepcion) cp.valorRecibido = await valorRecibido(DB, cp.id);
  res.json(L);
});

r.post('/compras/:id/aceptar', async (req, res) => {
  const u = req.usuario;
  await verificarClave(u, req.body?.clave);
  await tx(async (c) => {
    const cp = await compraParaCambiar(c, req.params.id, u.sucursal);
    si(cp.estado !== 'Preparada', 'Esta solicitud ya fue decidida');
    si(cp.cot_vence <= ahora(), 'Cotización vencida. El encargado de bodega debe cotizar de nuevo.');
    await c.query(`UPDATE compras SET estado = 'Aceptada por gerente', gerente_id = $2, gerente_fecha = $3 WHERE id = $1`, [cp.id, u.id, ts(ahora())]);
    const { rows } = await c.query('SELECT v.nombre AS prov, s.nombre AS suc FROM proveedores v, sucursales s WHERE v.id = $1 AND s.id = $2', [cp.proveedor_id, cp.sucursal_id]);
    await notificar(c, 'gg', null, 'Compra por aceptar', `${rows[0].prov} · ${rows[0].suc} · $${cp.total.toFixed(2)}`);
    await bitacora(c, u, { accion: 'compra.aceptar.gerente', elemento: `Compra #${cp.id}`, clave: true });
  });
  res.json({ ok: true });
});

r.post('/compras/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const cp = await compraParaCambiar(c, req.params.id, u.sucursal);
    si(cp.estado !== 'Preparada', 'Esta solicitud ya fue decidida');
    await c.query(`UPDATE compras SET estado = 'Rechazada', detalle = detalle || $2::jsonb WHERE id = $1`,
      [cp.id, JSON.stringify({ rechazo: { por: 'Gerente de sucursal', etapa: 1, motivo: m } })]);
    await notificar(c, 'bodega', u.sucursal, 'Solicitud denegada', `#${cp.id}: ${m}`);
    await bitacora(c, u, { accion: 'compra.rechazar.gerente', elemento: `Compra #${cp.id}`, motivo: m });
  });
  res.json({ ok: true });
});

r.post('/compras/:id/aceptar-mercancia', async (req, res) => {
  const u = req.usuario;
  const pendiente = req.body?.pendiente === 'cancelar' ? 'cancelar' : 'seguir';
  await tx(async (c) => {
    const cp = await compraParaCambiar(c, req.params.id, u.sucursal);
    const parcial = await aceptarMercancia(c, cp.id, u, pendiente);
    if (cp.detalle?.devolucionBodega) await c.query(`UPDATE compras SET detalle = jsonb_set(detalle, '{devolucionBodega,resuelta}', '"conservada"') WHERE id = $1`, [cp.id]);
    await notificar(c, 'bodega', u.sucursal, 'Mercancía aceptada', `#${cp.id} · el stock ya subió`);
    await bitacora(c, u, { accion: 'compra.aceptar_mercancia', elemento: `Compra #${cp.id}`, despues: { parcial, pendiente: parcial ? pendiente : null } });
  });
  res.json({ ok: true });
});

r.post('/compras/:id/devolver', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo, 'La justificación');
  await verificarClave(u, req.body?.clave);
  await tx(async (c) => {
    const cp = await compraParaCambiar(c, req.params.id, u.sucursal);
    si(cp.estado !== 'Recibida', 'Esta mercancía ya fue decidida');
    const extra = { devolucion: { por: u.id, porNombre: u.nombre, motivo: m, fecha: ahora(), perdida: cp.transporte || 0 } };
    if (cp.detalle?.devolucionBodega) extra.devolucionBodega = { ...cp.detalle.devolucionBodega, resuelta: 'aprobada' };
    await c.query(`UPDATE compras SET estado = 'Devolución en revisión', detalle = detalle || $2::jsonb WHERE id = $1`, [cp.id, JSON.stringify(extra)]);
    await notificar(c, 'gg', null, 'Devolución de mercancía por revisar', `Compra #${cp.id}`);
    await bitacora(c, u, { accion: 'compra.devolver', elemento: `Compra #${cp.id}`, motivo: m, clave: true });
  });
  res.json({ ok: true });
});

r.post('/compras/:id/descuento', async (req, res) => {
  const u = req.usuario;
  const tipo = req.body?.tipo === 'Reembolso' ? 'Reembolso' : 'Descuento';
  const monto = r2(+req.body?.monto);
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const cp = await compraParaCambiar(c, req.params.id, u.sucursal);
    si(cp.estado !== 'Recibida', 'Esta mercancía ya fue decidida');
    const max = r2((await valorRecibido(c, cp.id)) + (cp.transporte || 0));
    si(!(monto > 0), 'Escribe el monto');
    si(monto > max, `El monto no puede superar $${max.toFixed(2)}`);
    await c.query(`UPDATE compras SET estado = 'Descuento en revisión', detalle = detalle || $2::jsonb WHERE id = $1`,
      [cp.id, JSON.stringify({ solDescuento: { tipo, monto, motivo: m, por: u.id, fecha: ahora() } })]);
    await notificar(c, 'gg', null, `Solicitud de ${tipo.toLowerCase()} por revisar`, `Compra #${cp.id} · $${monto.toFixed(2)}`);
    await bitacora(c, u, { accion: 'compra.solicitar_descuento', elemento: `Compra #${cp.id}`, motivo: m, despues: { tipo, monto } });
  });
  res.json({ ok: true });
});

r.post('/compras/:id/cancelar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo, 'La justificación');
  await verificarClave(u, req.body?.clave);
  await tx(async (c) => {
    const cp = await compraParaCambiar(c, req.params.id, u.sucursal);
    si(!['Aceptada por gerente', 'En camino'].includes(cp.estado) || cp.llego, 'Ya llegó: usa Devolver');
    const perdida = cp.estado === 'En camino' ? cp.transporte || 0 : 0;
    await c.query(`UPDATE compras SET estado = 'Cancelación en revisión', detalle = detalle || $2::jsonb WHERE id = $1`,
      [cp.id, JSON.stringify({ cancelacion: { por: u.id, porNombre: u.nombre, motivo: m, fecha: ahora(), estadoAnt: cp.estado, perdida } })]);
    await notificar(c, 'gg', null, 'Cancelación de compra por revisar', `Compra #${cp.id}`);
    await bitacora(c, u, { accion: 'compra.cancelar', elemento: `Compra #${cp.id}`, motivo: m, clave: true });
  });
  res.json({ ok: true });
});

/* ---------- 5.5 ofertas por lote por vencer ---------- */
r.get('/ofertas', async (req, res) => {
  const s = req.usuario.sucursal;
  const { rows } = await q(
    `SELECT o.*, l.sku, l.cantidad AS resta, l.vence AS lote_vence, m.nombre AS mp_nombre, m.unidad
       FROM ofertas o JOIN lotes l ON l.id = o.lote_id JOIN materias_primas m ON m.id = o.mp_id WHERE o.sucursal_id = $1 ORDER BY o.creada DESC`, [s]);
  const { rows: op } = await q('SELECT op.oferta_id, p.id, p.nombre, p.precio FROM oferta_productos op JOIN productos p ON p.id = op.producto_id WHERE op.oferta_id = ANY($1)', [rows.map((o) => o.id)]);
  const costos = await costosMP(DB, s);
  const rec = await recetas(DB);
  res.json(rows.map((o) => ({
    id: o.id, lote: o.sku, mp: o.mp_id, mpNombre: o.mp_nombre, unidad: o.unidad, resta: o.resta, vence: o.lote_vence, estado: o.estado,
    pctSug: o.pct_sugerido, pctMax: o.pct_max, pct: o.pct, creada: o.creada, cierre: o.cierre,
    productos: op.filter((x) => x.oferta_id === o.id).map((x) => ({ id: x.id, nombre: x.nombre, precio: x.precio, costo: r2(costoReceta(rec[x.id], costos)) })),
  })));
});

r.post('/ofertas/:id/autorizar', async (req, res) => {
  const u = req.usuario;
  await verificarClave(u, req.body?.clave);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT o.*, m.nombre FROM ofertas o JOIN materias_primas m ON m.id = o.mp_id WHERE o.id = $1 AND o.sucursal_id = $2 FOR UPDATE OF o`, [req.params.id, u.sucursal]);
    const o = rows[0];
    si(!o || o.estado !== 'Pendiente', 'Esta oferta ya fue decidida');
    const pct = Math.round(+req.body?.pct);
    si(!(pct >= 1 && pct <= o.pct_sugerido), `El descuento debe estar entre 1 % y ${o.pct_sugerido} %`);
    await c.query(`UPDATE ofertas SET estado = 'Activa', pct = $2, decidio_id = $3, desde = $4 WHERE id = $1`, [o.id, pct, u.id, ts(ahora())]);
    await notificar(c, 'mesero', u.sucursal, 'Nueva oferta', `${o.nombre} · ${pct} %`);
    await bitacora(c, u, { accion: 'oferta.autorizar', elemento: `Oferta ${o.id}`, despues: { pct }, clave: true });
  });
  res.json({ ok: true });
});

r.post('/ofertas/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`UPDATE ofertas SET estado = 'Rechazada', cierre = $3, decidio_id = $4 WHERE id = $1 AND sucursal_id = $2 AND estado = 'Pendiente' RETURNING id`,
      [req.params.id, u.sucursal, ts(ahora()), u.id]);
    si(!rows[0], 'Esta oferta ya fue decidida');
    await bitacora(c, u, { accion: 'oferta.rechazar', elemento: `Oferta ${rows[0].id}` });
  });
  res.json({ ok: true });
});

/* ---------- 5.7 cierres de caja ---------- */
r.get('/cajas', async (req, res) => {
  const s = req.usuario.sucursal;
  const pend = req.query.vista !== 'hist';
  const { rows } = await q(
    `SELECT k.*, u.nombre AS mesero_nombre FROM cajas k JOIN usuarios u ON u.id = k.mesero_id
      WHERE k.sucursal_id = $1 AND k.estado = ANY($2) ORDER BY k.cerrada DESC NULLS LAST LIMIT 40`,
    [s, pend ? ['Pendiente de aprobación'] : ['Aprobada', 'Observada']]);
  res.json(rows.map((k) => ({
    id: k.id, mesero: k.mesero_id, meseroNombre: k.mesero_nombre, fondo: k.fondo, estado: k.estado, abierta: k.abierta, cerrada: k.cerrada,
    declarado: k.declarado, esp: { Efectivo: k.esp_efectivo, Tarjeta: k.esp_tarjeta, Bitcoin: k.esp_bitcoin }, comentario: k.comentario,
  })));
});

r.get('/cajas/:id/ventas', async (req, res) => {
  res.json(await cargarVentas(DB, 'v.caja_id = $1 AND v.sucursal_id = $2', [req.params.id, req.usuario.sucursal]));
});

async function decidirCaja(req, estado, comentario) {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE cajas SET estado = $3, comentario = COALESCE($4, comentario), decidio_id = $5, decidida = $6
        WHERE id = $1 AND sucursal_id = $2 AND estado = 'Pendiente de aprobación' RETURNING id`, [req.params.id, u.sucursal, estado, comentario, u.id, ts(ahora())]);
    si(!rows[0], 'Este cierre ya fue decidido');
    if (estado === 'Observada') await notificar(c, 'mesero', u.sucursal, 'Cierre observado', comentario);
    await bitacora(c, u, { accion: estado === 'Aprobada' ? 'caja.aprobar' : 'caja.observar', elemento: `Caja ${rows[0].id}`, motivo: comentario || '' });
  });
}
r.post('/cajas/:id/aprobar', async (req, res) => { await decidirCaja(req, 'Aprobada', null); res.json({ ok: true }); });
r.post('/cajas/:id/observar', async (req, res) => { await decidirCaja(req, 'Observada', validarMotivo(req.body?.motivo, 'El comentario')); res.json({ ok: true }); });

/* ---------- conteos físicos ---------- */
r.get('/conteos', async (req, res) => {
  const s = req.usuario.sucursal;
  const L = await cargarConteos(DB, s);
  const costos = await costosMP(DB, s);
  for (const k of L) k.valor = r2(sum(k.filas.filter((f) => f.contado !== f.sistema), (f) => (f.contado - f.sistema) * (costos[f.mp] || 0)));
  res.json(L);
});

/** Aprobar el conteo: faltantes como merma «Ajuste de conteo», sobrantes suman al lote más reciente. */
r.post('/conteos/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  const s = u.sucursal;
  await verificarClave(u, req.body?.clave);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM conteos WHERE id = $1 AND sucursal_id = $2 AND estado = 'Enviado' FOR UPDATE`, [req.params.id, s]);
    si(!rows[0], 'Este conteo ya fue decidido');
    const k = rows[0];
    const t = ahora();
    const costos = await costosMP(c, s);
    const { rows: filas } = await c.query('SELECT f.*, m.vida_dias FROM conteo_filas f JOIN materias_primas m ON m.id = f.mp_id WHERE conteo_id = $1', [k.id]);
    const dif = filas.filter((f) => f.contado !== f.sistema);
    for (const f of dif) {
      const dd = r2(f.contado - f.sistema);
      const { rows: lotes } = await c.query('SELECT id, cantidad FROM lotes WHERE mp_id = $1 AND sucursal_id = $2 AND cantidad > 0 AND vence > $3 ORDER BY vence FOR UPDATE', [f.mp_id, s, ts(t)]);
      if (dd < 0) {
        let resta = -dd;
        for (const l of lotes) {
          const tomar = Math.min(l.cantidad, resta);
          await c.query(`UPDATE lotes SET cantidad = $2::numeric, estado = CASE WHEN $2::numeric <= 0 THEN 'Agotado' ELSE estado END WHERE id = $1`, [l.id, r2(l.cantidad - tomar)]);
          resta = r2(resta - tomar);
          if (resta <= 0) break;
        }
        await c.query(`INSERT INTO mermas (sucursal_id, fecha, tipo, mp_id, cantidad, motivo, costo, registro_id) VALUES ($1,$2,'Ajuste de conteo',$3,$4,$5,$6,$7)`,
          [s, ts(t), f.mp_id, -dd, k.motivo, r2(-dd * (costos[f.mp_id] || 0)), u.id]);
      } else if (lotes.length) {
        const l = lotes[lotes.length - 1];
        await c.query('UPDATE lotes SET cantidad = $2 WHERE id = $1', [l.id, r2(l.cantidad + dd)]);
      } else {
        await c.query(`INSERT INTO lotes (sku, mp_id, sucursal_id, fecha_compra, vence, cantidad, precio) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [await skuNuevo(c, f.mp_id, s), f.mp_id, s, ts(t), ts(t + (f.vida_dias || 14) * D), dd, costos[f.mp_id] || 0]);
      }
    }
    await c.query(`UPDATE conteos SET estado = 'Aprobado', decidio_id = $2, decidido = $3 WHERE id = $1`, [k.id, u.id, ts(t)]);
    await notificar(c, 'bodega', s, 'Conteo aprobado: inventario ajustado', `${dif.length} diferencias`);
    await bitacora(c, u, { accion: 'conteo.aprobar', elemento: `Conteo ${k.id}`, despues: { diferencias: dif.length }, clave: true });
  });
  res.json({ ok: true });
});

r.post('/conteos/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`UPDATE conteos SET estado = 'Rechazado', decidio_id = $3, decidido = $4, motivo_decision = $5
                                    WHERE id = $1 AND sucursal_id = $2 AND estado = 'Enviado' RETURNING id`, [req.params.id, u.sucursal, u.id, ts(ahora()), m]);
    si(!rows[0], 'Este conteo ya fue decidido');
    await notificar(c, 'bodega', u.sucursal, 'Conteo rechazado', m);
    await bitacora(c, u, { accion: 'conteo.rechazar', elemento: `Conteo ${rows[0].id}`, motivo: m });
  });
  res.json({ ok: true });
});

/* ---------- 5.10 solicitudes del equipo: inhabilitación, catálogo de MP y despidos ---------- */
const TIPOS_EQUIPO = ['Inhabilitar materia prima', 'Unidad nueva', 'Categoría de materia prima', 'Despido'];
r.get('/solicitudes', async (req, res) => {
  res.json(await cargarSolicitudes(DB,
    `s.sucursal_id = $1 AND s.estado = 'Solicitada' AND s.tipo = ANY($2) AND (s.tipo <> 'Despido' OR s.aprueba_rol = 'gerente')`, [req.usuario.sucursal, TIPOS_EQUIPO], 's.fecha'));
});

r.post('/solicitudes/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  const s = u.sucursal;
  const { rows: pre } = await q(`SELECT * FROM solicitudes WHERE id = $1 AND sucursal_id = $2 AND estado = 'Solicitada' AND tipo = ANY($3)`, [req.params.id, s, TIPOS_EQUIPO]);
  const x0 = pre[0];
  si(!x0, 'Esta solicitud ya fue decidida');
  si(x0.solicitante_id === u.id, 'No puedes aprobar tus propias solicitudes');
  if (x0.tipo === 'Despido') {
    const bl = await despidoBloqueo(DB, await usuarioPorId(DB, x0.usuario_id));
    si(bl, bl);
  }
  await verificarClave(u, req.body?.clave);
  await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM solicitudes WHERE id = $1 AND estado = \'Solicitada\' FOR UPDATE', [x0.id]);
    const x = rows[0];
    si(!x, 'Esta solicitud ya fue decidida');
    if (x.tipo === 'Despido') {
      await aplicarDespido(c, x.id, u);
      await bitacora(c, u, { accion: 'despido.aprobar', elemento: x.nombre || `Usuario ${x.usuario_id}`, motivo: x.motivo, clave: true });
    } else if (x.tipo === 'Inhabilitar materia prima') {
      await c.query(`INSERT INTO sucursal_mp_inhabilitada (sucursal_id, mp_id, fecha, solicitud_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [s, x.mp_id, ts(ahora()), x.id]);
      await c.query(`UPDATE solicitudes SET estado = 'Aplicada', decidio_id = $2, cierre = $3 WHERE id = $1`, [x.id, u.id, ts(ahora())]);
      await notificar(c, 'bodega', s, 'Inhabilitación aprobada', x.nombre);
      await bitacora(c, u, { accion: 'materia.inhabilitar', elemento: x.nombre, motivo: x.motivo, clave: true });
    } else {
      await c.query(`UPDATE solicitudes SET estado = 'Aprobada por gerente', aprueba_rol = 'rrhh', decidio_id = $2, datos = datos || $3::jsonb WHERE id = $1`,
        [x.id, u.id, JSON.stringify({ gerente: u.id, fechaGer: ahora() })]);
      await notificar(c, 'rrhh', null, 'Catálogo por aprobar', `${x.tipo}: ${x.nombre}`);
      await notificar(c, 'bodega', s, 'Solicitud aprobada por el gerente', `${x.nombre} · falta Recursos Humanos`);
      await bitacora(c, u, { accion: 'catalogoMP.aprobar.gerente', elemento: x.nombre, clave: true });
    }
  });
  res.json({ ok: true });
});

r.post('/solicitudes/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`UPDATE solicitudes SET estado = 'Rechazada', rechazo = $3, decidio_id = $4, cierre = $5
                                    WHERE id = $1 AND sucursal_id = $2 AND estado = 'Solicitada' AND tipo = ANY($6) RETURNING tipo`,
    [req.params.id, u.sucursal, JSON.stringify({ por: u.nombre, motivo: m }), u.id, ts(ahora()), TIPOS_EQUIPO]);
    si(!rows[0], 'Esta solicitud ya fue decidida');
    await notificar(c, rows[0].tipo === 'Despido' ? 'rrhh' : 'bodega', rows[0].tipo === 'Despido' ? null : u.sucursal, 'Solicitud rechazada', m);
    await bitacora(c, u, { accion: 'solicitud.rechazar', elemento: `Solicitud ${req.params.id}`, motivo: m });
  });
  res.json({ ok: true });
});

/* ---------- 5.12 historial de aprobaciones (bitácora de la sucursal) ---------- */
r.get('/historial', async (req, res) => {
  const { rows } = await q(
    `SELECT id, fecha, usuario_nombre AS usuario, accion, elemento, motivo, con_clave AS clave FROM bitacora
      WHERE sucursal_id = $1 AND rol_id = 'gerente'
        AND accion ~ '(aprobar|aceptar|rechazar|denegar|autorizar|observ|inhabilit|devolver|cancelar|descuento|conteo|caja|producto\\.|rol|despido|menu\\.|oferta|precio|personal|merma)'
      ORDER BY fecha DESC LIMIT 150`, [req.usuario.sucursal]);
  res.json(rows);
});

/* ---------- 5.6 menú de la sucursal ---------- */
r.get('/menu', async (req, res) => {
  const s = req.usuario.sucursal;
  const { rows } = await q(
    `SELECT p.id, p.nombre, p.precio, p.estado, p.es_reventa, p.foto_url AS foto, p.publicado,
            ARRAY(SELECT cg.nombre FROM producto_categorias pc JOIN categorias cg ON cg.id = pc.categoria_id WHERE pc.producto_id = p.id ORDER BY cg.id) AS categorias,
            EXISTS (SELECT 1 FROM sucursal_menu sm WHERE sm.sucursal_id = $1 AND sm.producto_id = p.id) AS en_menu,
            EXISTS (SELECT 1 FROM sucursal_revisar sr WHERE sr.sucursal_id = $1 AND sr.producto_id = p.id) AS revisar,
            EXISTS (SELECT 1 FROM solicitudes x WHERE x.tipo = 'Agregar al menú' AND x.producto_id = p.id AND x.sucursal_id = $1 AND x.estado = 'Solicitada') AS solicitado
       FROM productos p WHERE NOT p.es_extra AND p.estado <> 'Eliminado' ORDER BY p.id`, [s]);
  const { rows: hist } = await q(
    `SELECT h.*, p.nombre FROM menu_historial h JOIN productos p ON p.id = h.producto_id WHERE h.sucursal_id = $1 ORDER BY h.fecha DESC`, [s]);
  res.json({ productos: rows, historial: hist, ahora: ahora() });
});

r.post('/menu/:id/inhabilitar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo, 'La razón');
  await verificarClave(u, req.body?.clave);
  await tx(async (c) => {
    const { rows } = await c.query('DELETE FROM sucursal_menu WHERE sucursal_id = $1 AND producto_id = $2 RETURNING producto_id', [u.sucursal, req.params.id]);
    si(!rows[0], 'Ese producto no está en tu menú');
    await c.query(`INSERT INTO menu_historial (sucursal_id, producto_id, estado, fecha, razon, por) VALUES ($1,$2,'Inhabilitado',$3,$4,$5)`, [u.sucursal, req.params.id, ts(ahora()), m, u.nombre]);
    await bitacora(c, u, { accion: 'producto.inhabilitar', elemento: `Producto ${req.params.id}`, motivo: m, clave: true });
  });
  res.json({ ok: true });
});

r.post('/menu/:id/agregar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows: p } = await c.query(`SELECT nombre FROM productos WHERE id = $1 AND estado = 'Activo' AND NOT es_extra`, [req.params.id]);
    si(!p[0], 'Ese producto no está disponible');
    const ya = await c.query(`SELECT 1 FROM sucursal_menu WHERE sucursal_id = $1 AND producto_id = $2
                              UNION SELECT 1 FROM solicitudes WHERE tipo = 'Agregar al menú' AND producto_id = $2 AND sucursal_id = $1 AND estado = 'Solicitada'`, [u.sucursal, req.params.id]);
    si(ya.rowCount, 'Ya está en tu menú o hay una solicitud enviada');
    await c.query(`INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, producto_id, aprueba_rol, nombre, fecha) VALUES ('Agregar al menú','Solicitada',$1,$2,$3,'gg',$4,$5)`,
      [u.sucursal, u.id, req.params.id, p[0].nombre, ts(ahora())]);
    await notificar(c, 'gg', null, 'Producto por agregar a un menú', `${p[0].nombre} · ${u.sucursal_nombre}`);
    await bitacora(c, u, { accion: 'menu.solicitar', elemento: p[0].nombre });
  });
  res.status(201).json({ ok: true });
});

/* ---------- 5.4 mermas ---------- */
r.get('/mermas', async (req, res) => {
  const s = req.usuario.sucursal;
  const { rows } = await q(
    `SELECT me.id, me.fecha, me.tipo, me.cantidad AS cant, me.motivo, me.costo, m.nombre AS mp, m.unidad, l.sku AS lote, u.nombre AS por
       FROM mermas me JOIN materias_primas m ON m.id = me.mp_id LEFT JOIN lotes l ON l.id = me.lote_id LEFT JOIN usuarios u ON u.id = me.registro_id
      WHERE me.sucursal_id = $1 ORDER BY me.fecha DESC LIMIT 300`, [s]);
  const { rows: lotes } = await q(
    `SELECT l.id, l.sku, l.mp_id, l.vence, l.cantidad AS cant, m.nombre, m.unidad FROM lotes l JOIN materias_primas m ON m.id = l.mp_id
      WHERE l.sucursal_id = $1 AND l.cantidad > 0 AND l.vence > $2 AND m.estado = 'Activo' ORDER BY m.nombre, l.vence`, [s, ts(ahora())]);
  res.json({ mermas: rows, lotes, ahora: ahora() });
});

r.post('/mermas', async (req, res) => {
  const u = req.usuario;
  const s = u.sucursal;
  const cant = r2(+req.body?.cant);
  const motivo = String(req.body?.motivo || '').trim();
  si(motivo.length < 3, 'Elige o describe el motivo');
  si(!(cant > 0), 'Escribe la cantidad');
  await verificarClave(u, req.body?.clave);
  await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM lotes WHERE id = $1 AND sucursal_id = $2 AND cantidad > 0 AND vence > $3 FOR UPDATE', [req.body?.lote, s, ts(ahora())]);
    const l = rows[0];
    si(!l, 'Ese lote ya no tiene existencias');
    si(cant > l.cantidad + 1e-9, `El lote solo tiene ${l.cantidad}`);
    const queda = r2(l.cantidad - cant);
    await c.query(`UPDATE lotes SET cantidad = $2::numeric, estado = CASE WHEN $2::numeric <= 0 THEN 'Agotado' ELSE estado END WHERE id = $1`, [l.id, Math.max(0, queda)]);
    await c.query(`INSERT INTO mermas (sucursal_id, fecha, tipo, mp_id, lote_id, cantidad, motivo, costo, registro_id) VALUES ($1,$2,'Manual',$3,$4,$5,$6,$7,$8)`,
      [s, ts(ahora()), l.mp_id, l.id, cant, motivo, r2(cant * l.precio), u.id]);
    await bitacora(c, u, { accion: 'merma.registrar', elemento: l.sku, motivo, despues: { cant }, clave: true });
  });
  res.status(201).json({ ok: true });
});

/* ---------- 5.8 pedir a gerencia: cambio de precio ---------- */
async function costoMax(c, productoId) {
  const rec = await recetas(c);
  const { rows } = await c.query(`SELECT id FROM sucursales WHERE estado = 'Operando'`);
  let mx = 0;
  for (const s of rows) mx = Math.max(mx, costoReceta(rec[productoId], await costosTope(c, s.id)));
  return r2(mx);
}
export { costoMax };

r.get('/precios', async (req, res) => {
  const s = req.usuario.sucursal;
  const sols = await cargarSolicitudes(DB, `s.tipo = 'Cambio de precio' AND s.sucursal_id = $1`, [s]);
  const { rows } = await q(
    `SELECT p.id, p.nombre, p.precio FROM productos p JOIN sucursal_menu sm ON sm.producto_id = p.id AND sm.sucursal_id = $1 WHERE NOT p.es_extra ORDER BY p.nombre`, [s]);
  for (const p of rows) p.costoMax = await costoMax(DB, p.id);
  res.json({ solicitudes: sols, productos: rows, iva: (await cfg(DB)).iva_pct });
});

r.post('/precios', async (req, res) => {
  const u = req.usuario;
  const precio = r2(+req.body?.precio);
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT p.* FROM productos p JOIN sucursal_menu sm ON sm.producto_id = p.id AND sm.sucursal_id = $2 WHERE p.id = $1`, [req.body?.producto, u.sucursal]);
    const p = rows[0];
    si(!p, 'Elige un producto de tu menú');
    si(!(precio > 0) || precio === p.precio, 'Escribe un precio distinto del actual');
    const k = await cfg(c);
    si(neto(precio, k) < (await costoMax(c, p.id)), 'El precio sin IVA no puede ser menor que el costo de producción');
    await c.query(`INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, producto_id, aprueba_rol, nombre, motivo, monto, datos, fecha)
                   VALUES ('Cambio de precio','Solicitada',$1,$2,$3,'gg',$4,$5,$6,$7,$8)`,
    [u.sucursal, u.id, p.id, p.nombre, m, precio, JSON.stringify({ precioActual: p.precio, precio }), ts(ahora())]);
    await notificar(c, 'gg', null, 'Cambio de precio solicitado', `${p.nombre} · ${u.sucursal_nombre}`);
    await bitacora(c, u, { accion: 'precio.solicitar', elemento: p.nombre, motivo: m });
  });
  res.status(201).json({ ok: true });
});

/* ---------- 5.9 equipo ---------- */
export async function personaJson(c, x, t = ahora()) {
  const turnos = (await turnosDe(c, [x.id]))[x.id];
  const salRol = await salarioRol(c, x.rol_id);
  const { rows: sol } = await c.query(`SELECT 1 FROM solicitudes WHERE tipo = 'Despido' AND usuario_id = $1 AND estado = 'Solicitada'`, [x.id]);
  return {
    id: x.id, nombre: x.nombre, usuario: x.usuario, rol: x.rol_id, rolNombre: ROLN[x.rol_id], sucursal: x.sucursal_id, foto: x.foto_url,
    turno: turnoHoy(turnos, t), sinTurno: !turnos, salario: salarioDe(x, salRol), salarioRol: salRol, extraAnt: x.extra_antiguedad,
    ingreso: x.ingreso, telefono: x.telefono, correo: x.correo, documento: x.documento, estado: x.estado, despidoSolicitado: !!sol[0],
  };
}

r.get('/equipo', async (req, res) => {
  const u = req.usuario;
  const L = await activos(DB, u.sucursal);
  const out = [];
  for (const x of L.filter((z) => z.id !== u.id)) {
    const p = await personaJson(DB, x);
    p.puede = puedeSobre(u, x);
    p.rolesDestino = p.puede ? rolesDestino(u, x).map((r0) => ({ id: r0, nombre: ROLN[r0] })) : [];
    out.push(p);
  }
  const { rows: sal } = await q('SELECT id, salario FROM roles');
  res.json({ personas: out, salarios: Object.fromEntries(sal.map((x) => [x.id, x.salario])) });
});

r.post('/equipo/:id/rol', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await verificarClave(u, req.body?.clave);
  const clave = await tx(async (c) => cambiarRol(c, await usuarioPorId(c, req.params.id), req.body?.rol, u, m));
  res.json({ ok: true, clave });
});

r.post('/equipo/:id/despedir', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await verificarClave(u, req.body?.clave);
  const ind = await tx(async (c) => despedirDirecto(c, await usuarioPorId(c, req.params.id), u, m));
  res.json({ ok: true, indemnizacion: ind });
});

/* ---------- 5.11 plantilla ---------- */
r.get('/plantilla', async (req, res) => {
  const s = req.usuario.sucursal;
  const { rows: suc } = await q('SELECT nombre, tamano FROM sucursales WHERE id = $1', [s]);
  const roles = [];
  for (const rol of ROLES_SUC) {
    const { rows } = await q('SELECT cantidad FROM plantilla_minima WHERE tamano = $1 AND rol_id = $2', [suc[0].tamano, rol]);
    roles.push({ rol, nombre: ROLN[rol], minimo: rows[0]?.cantidad || 0, necesarios: await necesarios(DB, s, rol), actuales: (await activos(DB, s, rol)).length });
  }
  const sols = await cargarSolicitudes(DB, `s.tipo = 'Personal' AND s.sucursal_id = $1`, [s]);
  const { rows: vac } = await q('SELECT solicitud_id, estado FROM vacantes WHERE solicitud_id = ANY($1)', [sols.map((x) => x.id)]);
  for (const x of sols) x.vacante = vac.find((v) => v.solicitud_id === x.id)?.estado || null;
  res.json({ sucursal: suc[0], roles, solicitudes: sols });
});

r.put('/plantilla', async (req, res) => {
  const u = req.usuario;
  const s = u.sucursal;
  await tx(async (c) => {
    const { rows: suc } = await c.query('SELECT tamano FROM sucursales WHERE id = $1', [s]);
    for (const rol of ROLES_SUC) {
      const n = Math.round(+req.body?.[rol]);
      const { rows } = await c.query('SELECT cantidad FROM plantilla_minima WHERE tamano = $1 AND rol_id = $2', [suc[0].tamano, rol]);
      si(!(n >= (rows[0]?.cantidad || 0)), `${ROLN[rol]}: no puede bajar del mínimo de la sucursal`);
      await c.query(`INSERT INTO sucursal_plantilla (sucursal_id, rol_id, cantidad) VALUES ($1,$2,$3)
                     ON CONFLICT (sucursal_id, rol_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`, [s, rol, n]);
    }
    await bitacora(c, u, { accion: 'plantilla.guardar', elemento: `Sucursal ${s}`, despues: req.body });
  });
  res.json({ ok: true });
});

r.post('/personal', async (req, res) => {
  const u = req.usuario;
  const rol = req.body?.rol;
  const cant = Math.round(+req.body?.cant);
  si(!ROLES_SUC.includes(rol), 'Elige un rol');
  si(!(cant > 0), 'La cantidad debe ser mayor que 0');
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    await c.query(`INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, rol_id, aprueba_rol, motivo, monto, datos, fecha)
                   VALUES ('Personal','Solicitada',$1,$2,$3,'gg',$4,$5,$6,$7)`, [u.sucursal, u.id, rol, m, cant, JSON.stringify({ cant }), ts(ahora())]);
    await notificar(c, 'gg', null, 'Solicitud de personal', `${u.sucursal_nombre} · ${ROLN[rol]} ×${cant}`);
    await bitacora(c, u, { accion: 'personal.solicitar', elemento: ROLN[rol], motivo: m });
  });
  res.status(201).json({ ok: true });
});

export default r;
