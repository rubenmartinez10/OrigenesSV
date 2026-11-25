import { Router } from 'express';
import { q, tx, ts } from '../db.js';
import { si, noEncontrado, motivo as validarMotivo } from '../lib/errores.js';
import { ahora } from '../lib/reloj.js';
import { bitacora, notificar } from '../lib/registro.js';
import { exigir } from '../lib/permisos.js';
import {
  cfg, r2, recetas, uso, cabe, disponibles, estimado, consumir, costoReservas, enTurno, turnosDe,
} from '../lib/negocio.js';
import { cargarPedidos, cargarPedido, cargarSolicitudes } from '../lib/consultas.js';

const DB = { query: q };
const donde = (p) => (p.tipo === 'Aquí' ? 'Aquí' + (p.mesa ? ` · Mesa ${p.mesa}` : '') : p.tipo) + (p.cliente ? ` · ${p.cliente}` : '');
const nom = (p) => `${p.reposicion_de ? 'Reposición' : 'Pedido'} #${p.num}`;

/** Cocineros activos de la sucursal que están en turno ahora. */
async function cocinerosEnTurno(c, s) {
  const { rows } = await c.query(
    `SELECT id, nombre, foto_url AS foto FROM usuarios WHERE rol_id = 'cocinero' AND estado = 'Activo' AND sucursal_id = $1 ORDER BY id`, [s]);
  const turnos = await turnosDe(c, rows.map((x) => x.id));
  return rows.filter((x) => enTurno('cocinero', turnos[x.id]));
}

async function pedidoDeSucursal(c, s, id) {
  const { rows } = await c.query('SELECT * FROM pedidos WHERE id = $1 AND sucursal_id = $2 FOR UPDATE', [id, s]);
  if (!rows[0]) throw noEncontrado('No se encontró el pedido');
  return rows[0];
}

/* ======================= Jefe de cocina ======================= */
export const jefe = Router();

jefe.get('/cola', async (req, res) => {
  const s = req.usuario.sucursal;
  const pedidos = await cargarPedidos(DB, `p.sucursal_id = $1 AND p.estado IN ('Creado','Aceptado','Asignado','Preparando')`, [s]);
  const cocs = await cocinerosEnTurno(DB, s);
  const cocineros = cocs.map((x) => {
    const ocupado = pedidos.find((p) => p.cocinero === x.id && p.estado === 'Preparando') || null;
    const cola = pedidos.filter((p) => p.cocinero === x.id && p.estado === 'Asignado').sort((a, b) => (a.asignado || 0) - (b.asignado || 0));
    return { ...x, ocupado: ocupado && { id: ocupado.id, num: ocupado.num }, cola: cola.map((p) => ({ id: p.id, num: p.num })) };
  });
  res.json({ pedidos, cocineros });
});

jefe.post('/pedidos/:id/aceptar', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'cocina', 'decide', u.sucursal);
  await tx(async (c) => {
    const p = await pedidoDeSucursal(c, u.sucursal, req.params.id);
    si(p.estado !== 'Creado', 'El pedido ya no está en «Nuevos»');
    await c.query(`UPDATE pedidos SET estado = 'Aceptado', aceptado = $2 WHERE id = $1`, [p.id, ts(ahora())]);
    await bitacora(c, u, { accion: 'pedido.aceptar', elemento: nom(p), sucursal: p.sucursal_id });
  });
  res.json({ ok: true });
});

jefe.post('/pedidos/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'cocina', 'decide', u.sucursal);
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const p = await pedidoDeSucursal(c, u.sucursal, req.params.id);
    si(!['Creado', 'Aceptado'].includes(p.estado), 'Ese pedido ya no se puede rechazar');
    await c.query(`UPDATE pedidos SET estado = 'Rechazado', rechazo_por = $2, rechazo_motivo = $3, rechazo_fecha = $4 WHERE id = $1`, [p.id, u.id, m, ts(ahora())]);
    await notificar(c, 'mesero', p.sucursal_id, 'Pedido rechazado', `#${p.num}: ${m}`);
    await bitacora(c, u, { accion: 'pedido.rechazar', elemento: nom(p), motivo: m, sucursal: p.sucursal_id });
  });
  res.json({ ok: true });
});

/** ADENDA v5: el jefe puede asignar a cualquier cocinero en turno, aunque esté ocupado (queda en su cola). */
jefe.post('/pedidos/:id/asignar', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'cocina', 'decide', u.sucursal);
  const cocineroId = Number(req.body?.cocinero);
  await tx(async (c) => {
    const p = await pedidoDeSucursal(c, u.sucursal, req.params.id);
    si(p.estado !== 'Aceptado', 'Solo se asignan pedidos aceptados');
    const cocs = await cocinerosEnTurno(c, u.sucursal);
    si(!cocs.some((x) => x.id === cocineroId), 'Ese cocinero no está disponible en este turno');
    await c.query(`UPDATE pedidos SET estado = 'Asignado', cocinero_id = $2, asignado = $3 WHERE id = $1`, [p.id, cocineroId, ts(ahora())]);
    await notificar(c, 'cocinero', p.sucursal_id, 'Pedido asignado', `#${p.num} · ${donde(p)}`);
    await bitacora(c, u, { accion: 'pedido.asignar', elemento: nom(p), sucursal: p.sucursal_id });
  });
  res.json({ ok: true });
});

/* ---- reposiciones, cancelaciones y devoluciones de dinero (las decide el jefe, ADENDA v6) ---- */
jefe.get('/solicitudes', async (req, res) => {
  const s = req.usuario.sucursal;
  const sols = await cargarSolicitudes(DB, `s.sucursal_id = $1 AND s.estado = 'Solicitada' AND s.tipo IN ('Reposición','Cancelación','Devolución')`, [s], 's.fecha');
  const pedidos = await cargarPedidos(DB, 'p.id = ANY($1)', [[...new Set(sols.map((x) => x.pedido))]]);
  const { rows: ventas } = await q(
    'SELECT id, tipo_doc, correlativo, metodo FROM ventas WHERE id = ANY($1)', [sols.map((x) => x.venta).filter(Boolean)]);
  res.json({ solicitudes: sols, pedidos, ventas });
});

async function solicitudPendiente(c, s, id, tipo) {
  const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND sucursal_id = $2 AND tipo = $3 AND estado = 'Solicitada' FOR UPDATE`, [id, s, tipo]);
  if (!rows[0]) throw noEncontrado('La solicitud ya fue atendida');
  return rows[0];
}

jefe.post('/solicitudes/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'cocina', 'decide', u.sucursal);
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM solicitudes WHERE id = $1 AND sucursal_id = $2 AND estado = 'Solicitada' AND tipo IN ('Reposición','Cancelación','Devolución') FOR UPDATE`,
      [req.params.id, u.sucursal]);
    const x = rows[0];
    if (!x) throw noEncontrado('La solicitud ya fue atendida');
    await c.query(`UPDATE solicitudes SET estado = 'Rechazada', rechazo = $2, decidio_id = $3, cierre = $4 WHERE id = $1`,
      [x.id, JSON.stringify({ por: 'Jefe de cocina', motivo: m, etapa: 1, fecha: ahora() }), u.id, ts(ahora())]);
    await bitacora(c, u, { accion: `${x.tipo}.rechazar`, elemento: `Solicitud ${x.id}`, motivo: m, sucursal: x.sucursal_id });
  });
  res.json({ ok: true });
});

jefe.post('/solicitudes/:id/aceptar-reposicion', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'reposicion', 'decide', u.sucursal);
  await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(1000 + $1)', [u.sucursal]);
    const x = await solicitudPendiente(c, u.sucursal, req.params.id, 'Reposición');
    const p = await cargarPedido(c, x.pedido_id);
    const l = p.lineas.find((z) => z.orden === x.linea_orden);
    const ls = [{ pr: l.pr, cant: l.cant, extras: l.extras.map((e) => e.pr) }];
    const rec = await recetas(c);
    const u2 = uso(ls, rec);
    si(!cabe(u2, (await disponibles(c, u.sucursal)).disp), 'No alcanzan los insumos para reponer');
    const k = await cfg(c);
    const { rows: tiempos } = await c.query('SELECT id, tiempo_min AS tiempo FROM productos WHERE id = ANY($1)', [[l.pr, ...ls[0].extras]]);
    const est = estimado(ls, Object.fromEntries(tiempos.map((t) => [t.id, t])), k);
    const { rows: ins } = await c.query(
      `INSERT INTO pedidos (sucursal_id, mesero_id, tipo, mesa, cliente, estado, total, est_seg, reposicion_de, creado)
       VALUES ($1,$2,$3,$4,$5,'Creado',0,$6,$7,$8) RETURNING id`,
      [p.suc, p.mesero, p.tipo, p.mesa, p.ref, est, p.id, ts(ahora())]);
    const nuevo = ins[0].id;
    const { rows: ln } = await c.query(
      'INSERT INTO pedido_lineas (pedido_id, orden, producto_id, nombre, cantidad, precio_unit) VALUES ($1,0,$2,$3,$4,$5) RETURNING id',
      [nuevo, l.pr, l.nombre, l.cant, l.unit]);
    for (const e of l.extras) await c.query('INSERT INTO pedido_linea_extras (linea_id, extra_id, nombre, precio) VALUES ($1,$2,$3,$4)', [ln[0].id, e.pr, e.nombre, e.unit]);
    for (const [mp, cant] of Object.entries(u2)) await c.query('INSERT INTO pedido_reservas (pedido_id, mp_id, cantidad) VALUES ($1,$2,$3)', [nuevo, mp, cant]);
    await c.query(`UPDATE solicitudes SET estado = 'Aceptada', decidio_id = $2, cierre = $3 WHERE id = $1`, [x.id, u.id, ts(ahora())]);
    await c.query(`INSERT INTO mermas (sucursal_id, fecha, tipo, pedido_id, motivo, costo, registro_id) VALUES ($1,$2,'Reposición',$3,$4,$5,$6)`,
      [u.sucursal, ts(ahora()), p.id, x.motivo, await costoReservas(c, nuevo, u.sucursal), u.id]);
    await bitacora(c, u, { accion: 'reposicion.aceptar', elemento: `Pedido #${p.num}`, motivo: x.motivo, sucursal: u.sucursal });
  });
  res.json({ ok: true });
});

jefe.post('/solicitudes/:id/autorizar-cancelacion', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'cancelarIniciado', 'decide', u.sucursal);
  await tx(async (c) => {
    const x = await solicitudPendiente(c, u.sucursal, req.params.id, 'Cancelación');
    const p = await pedidoDeSucursal(c, u.sucursal, x.pedido_id);
    si(['Cobrado', 'Cancelado', 'Rechazado'].includes(p.estado), 'El pedido ya está cerrado');
    await c.query(`UPDATE pedidos SET estado = 'Cancelado', motivo_cancel = $2, cancelado = $3 WHERE id = $1`, [p.id, x.motivo, ts(ahora())]);
    await c.query(`UPDATE solicitudes SET estado = 'Autorizada', decidio_id = $2, cierre = $3 WHERE id = $1`, [x.id, u.id, ts(ahora())]);
    if (p.consumido) {
      await c.query(`INSERT INTO mermas (sucursal_id, fecha, tipo, pedido_id, motivo, costo, registro_id) VALUES ($1,$2,'Cancelación autorizada',$3,$4,$5,$6)`,
        [u.sucursal, ts(ahora()), p.id, x.motivo, await costoReservas(c, p.id, u.sucursal), u.id]);
    }
    await notificar(c, 'mesero', u.sucursal, 'Cancelación autorizada', `#${p.num}`);
    await notificar(c, 'cocinero', u.sucursal, 'Pedido cancelado', `#${p.num}`);
    await bitacora(c, u, { accion: 'cancelacion.autorizar', elemento: nom(p), motivo: x.motivo, sucursal: u.sucursal });
  });
  res.json({ ok: true });
});

jefe.post('/solicitudes/:id/devolver', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'devolucionDinero', 'decide', u.sucursal);
  const pct = Number(req.body?.pct);
  si(![50, 100].includes(pct), 'Elige 50 % o 100 %');
  await tx(async (c) => {
    const x = await solicitudPendiente(c, u.sucursal, req.params.id, 'Devolución');
    si(!x.venta_id, 'No se encontró la venta de este pedido');
    const { rows } = await c.query('SELECT cantidad, precio_unit FROM pedido_lineas WHERE pedido_id = $1 AND orden = $2', [x.pedido_id, x.linea_orden]);
    const monto = r2((rows[0].precio_unit * rows[0].cantidad * pct) / 100);
    await c.query('INSERT INTO venta_ajustes (venta_id, monto, pct, fecha, solicitud_id) VALUES ($1,$2,$3,$4,$5)', [x.venta_id, monto, pct, ts(ahora()), x.id]);
    await c.query(`UPDATE solicitudes SET estado = $2, monto = $3, decidio_id = $4, cierre = $5 WHERE id = $1`, [x.id, `Aprobada al ${pct} %`, monto, u.id, ts(ahora())]);
    const { rows: pe } = await c.query('SELECT num FROM pedidos WHERE id = $1', [x.pedido_id]);
    await notificar(c, 'mesero', u.sucursal, 'Devolución aprobada', `#${pe[0].num} · $${monto.toFixed(2)}`);
    await bitacora(c, u, { accion: 'devolucion.aprobar', elemento: `Solicitud ${x.id}`, motivo: x.motivo, despues: `${pct} %`, sucursal: u.sucursal });
  });
  res.json({ ok: true });
});

jefe.get('/perdidas', async (req, res) => {
  const { rows } = await q(
    `SELECT m.id, m.fecha, m.tipo, m.motivo, m.costo, p.num AS pedido
       FROM mermas m LEFT JOIN pedidos p ON p.id = m.pedido_id
      WHERE m.sucursal_id = $1 AND m.tipo IN ('Reposición','Cancelación autorizada','Cancelación por demora') ORDER BY m.fecha DESC`,
    [req.usuario.sucursal]);
  res.json(rows);
});

/** Pedidos atendidos por la cocina (preparados, en preparación o rechazados) en un periodo. */
jefe.get('/historial', async (req, res) => {
  const s = req.usuario.sucursal;
  const desde = Number(req.query.desde) || 0;
  const hasta = Number(req.query.hasta) || 8.64e15;
  const pedidos = await cargarPedidos(DB,
    `p.sucursal_id = $1 AND ((p.cocinero_id IS NOT NULL AND (p.iniciado IS NOT NULL OR p.terminado IS NOT NULL)) OR p.estado = 'Rechazado')
     AND COALESCE(p.terminado, p.rechazo_fecha, p.creado) >= $2 AND COALESCE(p.terminado, p.rechazo_fecha, p.creado) < $3`,
    [s, ts(desde), ts(hasta)], 'COALESCE(p.terminado, p.rechazo_fecha, p.creado) DESC');
  const { rows: cocineros } = await q(`SELECT id, nombre FROM usuarios WHERE rol_id = 'cocinero' AND sucursal_id = $1 ORDER BY nombre`, [s]);
  res.json({ pedidos, cocineros });
});

/* ======================= Cocinero ======================= */
export const cocinero = Router();

/** Prepara uno a la vez: el actual (Preparando o el primero asignado) y su cola. */
cocinero.get('/mi-pedido', async (req, res) => {
  const u = req.usuario;
  const mis = await cargarPedidos(DB, `p.cocinero_id = $1 AND p.estado IN ('Asignado','Preparando')`, [u.id], 'p.asignado');
  const actual = mis.find((p) => p.estado === 'Preparando') || mis[0] || null;
  const cancelado = (await cargarPedidos(DB, `p.cocinero_id = $1 AND p.estado = 'Cancelado' AND NOT p.visto_cocinero`, [u.id], 'p.cancelado'))[0] || null;
  res.json({ actual, cola: mis.filter((p) => p !== actual), cancelado });
});

async function pedidoMio(c, u, id) {
  const { rows } = await c.query('SELECT * FROM pedidos WHERE id = $1 AND cocinero_id = $2 FOR UPDATE', [id, u.id]);
  if (!rows[0]) throw noEncontrado('Ese pedido no está asignado a ti');
  return rows[0];
}

cocinero.post('/pedidos/:id/iniciar', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'preparar', 'decide', u.sucursal);
  await tx(async (c) => {
    const p = await pedidoMio(c, u, req.params.id);
    si(p.estado !== 'Asignado', 'Ese pedido ya se inició');
    const otro = await c.query(`SELECT num FROM pedidos WHERE cocinero_id = $1 AND estado = 'Preparando'`, [u.id]);
    si(otro.rowCount, `Termina el pedido #${otro.rows[0]?.num} antes de iniciar otro`);
    await consumir(c, p.id, p.sucursal_id);
    await c.query(`UPDATE pedidos SET estado = 'Preparando', iniciado = $2 WHERE id = $1`, [p.id, ts(ahora())]);
    await bitacora(c, u, { accion: 'pedido.iniciar', elemento: nom(p), sucursal: p.sucursal_id });
  });
  res.json({ ok: true });
});

cocinero.post('/pedidos/:id/terminar', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'preparar', 'decide', u.sucursal);
  await tx(async (c) => {
    const p = await pedidoMio(c, u, req.params.id);
    si(p.estado !== 'Preparando', 'Primero inicia la preparación');
    await c.query(`UPDATE pedidos SET estado = 'Listo', terminado = $2 WHERE id = $1`, [p.id, ts(ahora())]);
    await bitacora(c, u, { accion: 'pedido.listo', elemento: nom(p), sucursal: p.sucursal_id });
  });
  res.json({ ok: true });
});

cocinero.post('/pedidos/:id/visto', async (req, res) => {
  await q(`UPDATE pedidos SET visto_cocinero = TRUE WHERE id = $1 AND cocinero_id = $2 AND estado = 'Cancelado'`, [req.params.id, req.usuario.id]);
  res.json({ ok: true });
});

/** Lo que este cocinero ha preparado (solo lectura). */
cocinero.get('/historial', async (req, res) => {
  const desde = Number(req.query.desde) || 0;
  const hasta = Number(req.query.hasta) || 8.64e15;
  res.json(await cargarPedidos(DB,
    `p.cocinero_id = $1 AND (p.terminado IS NOT NULL OR (p.estado = 'Cancelado' AND p.iniciado IS NOT NULL))
     AND COALESCE(p.terminado, p.creado) >= $2 AND COALESCE(p.terminado, p.creado) < $3`,
    [req.usuario.id, ts(desde), ts(hasta)], 'COALESCE(p.terminado, p.creado) DESC'));
});
