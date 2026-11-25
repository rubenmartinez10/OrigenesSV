import { Router } from 'express';
import { q, tx, ts } from '../db.js';
import { fallo, si, noEncontrado, motivo as validarMotivo, HttpError } from '../lib/errores.js';
import { ahora, D, inicioDia } from '../lib/reloj.js';
import { bitacora, notificar } from '../lib/registro.js';
import { exigir } from '../lib/permisos.js';
import {
  cfg, r2, sum, recetas, uso, cabe, disponibles, estimado, ofertasActivas, precioCon, mesasOcupadas, costoReservas,
} from '../lib/negocio.js';
import { cargarPedidos, cargarPedido, cargarSolicitudes, cargarVentas } from '../lib/consultas.js';

const r = Router();
const EN_CURSO = ['Creado', 'Aceptado', 'Asignado', 'Preparando', 'Listo'];
const donde = (p) => (p.tipo === 'Aquí' ? 'Aquí' + (p.mesa ? ` · Mesa ${p.mesa}` : '') : p.tipo) + (p.ref || p.cliente ? ` · ${p.ref || p.cliente}` : '');

/** Pedido propio con bloqueo de fila. */
async function miPedido(c, u, id) {
  const { rows } = await c.query('SELECT * FROM pedidos WHERE id = $1 AND mesero_id = $2 FOR UPDATE', [id, u.id]);
  if (!rows[0]) throw noEncontrado('No se encontró el pedido');
  return rows[0];
}

/* ---------- pedidos ---------- */

// ?activos=1 → en curso + rechazados sin ver · ?porCobrar=1 → entregados sin cobrar
// ?abiertos=1 → todo lo que impide cerrar la caja · ?desde&hasta → historial por periodo
r.get('/pedidos', async (req, res) => {
  const u = req.usuario;
  if (req.query.porCobrar) {
    return res.json(await cargarPedidos({ query: q }, `p.mesero_id = $1 AND p.estado = 'Entregado' AND p.reposicion_de IS NULL`, [u.id], 'p.entregado'));
  }
  if (req.query.abiertos) {
    return res.json(await cargarPedidos({ query: q },
      `p.mesero_id = $1 AND p.reposicion_de IS NULL AND p.estado NOT IN ('Cobrado','Cancelado','Rechazado')`, [u.id]));
  }
  if (req.query.activos) {
    return res.json(await cargarPedidos({ query: q },
      `p.mesero_id = $1 AND (p.estado = ANY($2) OR (p.estado = 'Rechazado' AND NOT p.visto_mesero))`, [u.id, EN_CURSO]));
  }
  const desde = Number(req.query.desde) || 0;
  const hasta = Number(req.query.hasta) || 8.64e15;
  res.json(await cargarPedidos({ query: q }, 'p.mesero_id = $1 AND p.creado >= $2 AND p.creado < $3', [u.id, ts(desde), ts(hasta)], 'p.creado DESC'));
});

r.post('/pedidos', async (req, res) => {
  const u = req.usuario;
  const s = u.sucursal;
  exigir(u, 'pedido', 'pide', s);
  const { tipo, mesa, ref, lineas } = req.body || {};
  si(!['Aquí', 'Llevar', 'Delivery'].includes(tipo), 'Tipo de pedido inválido');
  const cliente = String(ref || '').trim();
  si(!cliente, 'Escribe el nombre del cliente');
  si(!Array.isArray(lineas) || !lineas.length, 'Agrega al menos un producto');

  const pedido = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(1000 + $1)', [s]); // un pedido a la vez por sucursal (mesas e inventario)
    const k = await cfg(c);
    if (tipo === 'Aquí') {
      const oc = await mesasOcupadas(c, s);
      const { rows } = await c.query('SELECT mesas FROM sucursales WHERE id = $1', [s]);
      si(rows[0].mesas - Object.keys(oc).length <= 0, 'Todas las mesas están ocupadas');
      si(!mesa, 'Elige la mesa del cliente');
      si(!(mesa >= 1 && mesa <= rows[0].mesas), 'Mesa inválida');
      si(oc[mesa], 'Esa mesa ya está ocupada');
    }
    const { rows: prods } = await c.query(
      `SELECT p.id, p.nombre, p.precio, p.tiempo_min AS tiempo, p.estado, p.es_extra,
              EXISTS (SELECT 1 FROM sucursal_menu m WHERE m.sucursal_id = $1 AND m.producto_id = p.id) AS en_menu,
              EXISTS (SELECT 1 FROM sucursal_revisar v WHERE v.sucursal_id = $1 AND v.producto_id = p.id) AS revisar,
              ARRAY(SELECT ep.producto_id FROM extra_productos ep WHERE ep.extra_id = p.id) AS prods
         FROM productos p`, [s]);
    const P = Object.fromEntries(prods.map((p) => [p.id, p]));
    const ofertas = await ofertasActivas(c, s);
    const norm = lineas.map((l) => {
      const x = P[l.pr];
      si(!x || x.es_extra || !x.en_menu || x.estado !== 'Activo' || x.revisar, `${x ? x.nombre : 'Un producto'} no está disponible`);
      const cant = Math.trunc(+l.cant);
      si(!(cant >= 1 && cant <= 99), 'Cantidad inválida');
      const extras = [...new Set((l.extras || []).map(Number))];
      for (const e of extras) si(!P[e] || !P[e].es_extra || P[e].estado !== 'Activo' || !P[e].prods.includes(x.id), 'Un extra no está disponible para ese producto');
      return { pr: x.id, cant, extras, nombre: x.nombre, unit: r2(precioCon(x.precio, ofertas[x.id]) + sum(extras, (e) => P[e].precio)) };
    });
    const rec = await recetas(c);
    const u2 = uso(norm, rec);
    const { disp } = await disponibles(c, s);
    si(!cabe(u2, disp), 'No alcanzan los insumos para el pedido');
    const est = estimado(norm, P, k);
    const total = r2(sum(norm, (l) => l.cant * l.unit));
    const { rows: ins } = await c.query(
      `INSERT INTO pedidos (sucursal_id, mesero_id, tipo, mesa, cliente, estado, total, est_seg, creado)
       VALUES ($1,$2,$3,$4,$5,'Creado',$6,$7,$8) RETURNING id, num`,
      [s, u.id, tipo, tipo === 'Aquí' ? mesa : null, cliente, total, est, ts(ahora())]);
    const { id, num } = ins[0];
    for (const [i, l] of norm.entries()) {
      const { rows: ln } = await c.query(
        'INSERT INTO pedido_lineas (pedido_id, orden, producto_id, nombre, cantidad, precio_unit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [id, i, l.pr, l.nombre, l.cant, l.unit]);
      for (const e of l.extras) {
        await c.query('INSERT INTO pedido_linea_extras (linea_id, extra_id, nombre, precio) VALUES ($1,$2,$3,$4)', [ln[0].id, e, P[e].nombre, P[e].precio]);
      }
    }
    for (const [mp, cant] of Object.entries(u2)) await c.query('INSERT INTO pedido_reservas (pedido_id, mp_id, cantidad) VALUES ($1,$2,$3)', [id, mp, cant]);
    await notificar(c, 'jefe', s, 'Pedido nuevo', `#${num} · ${donde({ tipo, mesa, ref: cliente })}`);
    await bitacora(c, u, { accion: 'pedido.crear', elemento: `Pedido #${num}`, sucursal: s });
    return cargarPedido(c, id);
  });
  res.status(201).json(pedido);
});

r.post('/pedidos/:id/entregar', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'pedido', 'pide', u.sucursal);
  await tx(async (c) => {
    const p = await miPedido(c, u, req.params.id);
    si(p.estado !== 'Listo', 'El pedido aún no está listo');
    await c.query(`UPDATE pedidos SET estado = 'Entregado', entregado = $2 WHERE id = $1`, [p.id, ts(ahora())]);
    await bitacora(c, u, { accion: 'pedido.entregar', elemento: `Pedido #${p.num}`, sucursal: p.sucursal_id });
  });
  res.json({ ok: true });
});

r.post('/pedidos/:id/cancelar', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'pedido', 'pide', u.sucursal);
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const p = await miPedido(c, u, req.params.id);
    si(!['Creado', 'Aceptado', 'Asignado'].includes(p.estado), 'Este pedido ya no se puede cancelar directamente');
    await c.query(`UPDATE pedidos SET estado = 'Cancelado', motivo_cancel = $2, cancelado = $3 WHERE id = $1`, [p.id, m, ts(ahora())]);
    await bitacora(c, u, { accion: 'pedido.cancelar', elemento: `Pedido #${p.num}`, motivo: m, sucursal: p.sucursal_id });
  });
  res.json({ ok: true });
});

/** Se superó el tiempo estimado + margen: el cliente puede cancelar (si ya se usaron insumos, es pérdida). */
r.post('/pedidos/:id/cancelar-demora', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'cancelarDemora', 'pide', u.sucursal);
  await tx(async (c) => {
    const k = await cfg(c);
    const p = await miPedido(c, u, req.params.id);
    const seg = (ahora() - p.creado) / 1000;
    si(!['Creado', 'Aceptado', 'Asignado', 'Preparando'].includes(p.estado) || seg <= p.est_seg + k.margen_min * 60,
      'El pedido no ha superado el tiempo de espera');
    const m = 'Cancelado por el cliente: demora mayor al tiempo estimado';
    await c.query(`UPDATE pedidos SET estado = 'Cancelado', motivo_cancel = $2, cancelado = $3, por_demora = TRUE WHERE id = $1`, [p.id, m, ts(ahora())]);
    if (p.consumido) {
      await c.query(`INSERT INTO mermas (sucursal_id, fecha, tipo, pedido_id, motivo, costo, registro_id) VALUES ($1,$2,'Cancelación por demora',$3,$4,$5,$6)`,
        [p.sucursal_id, ts(ahora()), p.id, m, await costoReservas(c, p.id, p.sucursal_id), u.id]);
    }
    await notificar(c, 'jefe', p.sucursal_id, 'Pedido cancelado por demora', `#${p.num}`);
    await bitacora(c, u, { accion: 'pedido.cancelar_demora', elemento: `Pedido #${p.num}`, motivo: m, sucursal: p.sucursal_id });
  });
  res.json({ ok: true });
});

r.post('/pedidos/:id/visto', async (req, res) => {
  await q(`UPDATE pedidos SET visto_mesero = TRUE WHERE id = $1 AND mesero_id = $2 AND estado = 'Rechazado'`, [req.params.id, req.usuario.id]);
  res.json({ ok: true });
});

/* ---------- solicitudes al jefe de cocina: cancelación, reposición y devolución de dinero ---------- */
const TIPOS = { Cancelación: 'cancelarIniciado', Reposición: 'reposicion', Devolución: 'devolucionDinero' };

r.get('/solicitudes', async (req, res) => {
  res.json(await cargarSolicitudes({ query: q }, `s.solicitante_id = $1 AND s.tipo IN ('Cancelación','Reposición','Devolución')`, [req.usuario.id]));
});

r.post('/pedidos/:id/solicitudes', async (req, res) => {
  const u = req.usuario;
  const { tipo, linea } = req.body || {};
  si(!TIPOS[tipo], 'Tipo de solicitud inválido');
  exigir(u, TIPOS[tipo], 'pide', u.sucursal);
  const m = validarMotivo(req.body?.motivo, 'La razón');
  await tx(async (c) => {
    const p = await miPedido(c, u, req.params.id);
    let venta = null;
    if (tipo === 'Cancelación') {
      si(!['Preparando', 'Listo'].includes(p.estado), 'Solo se pide cancelar un pedido que ya está en cocina');
      const ya = await c.query(`SELECT 1 FROM solicitudes WHERE pedido_id = $1 AND tipo = 'Cancelación' AND estado NOT IN ('Rechazada','Autorizada')`, [p.id]);
      si(ya.rowCount, 'Ya hay una cancelación solicitada');
    } else {
      si(p.reposicion_de, 'Una reposición no admite esta solicitud');
      const { rows } = await c.query('SELECT count(*)::int n FROM pedido_lineas WHERE pedido_id = $1', [p.id]);
      si(!(Number.isInteger(linea) && linea >= 0 && linea < rows[0].n), 'Elige el platillo');
      const veto = tipo === 'Reposición' ? 'Devolución' : 'Reposición';
      const choque = await c.query(
        `SELECT tipo FROM solicitudes WHERE pedido_id = $1 AND linea_orden = $2 AND tipo IN ($3, $4) AND estado <> 'Rechazada'`, [p.id, linea, veto, tipo]);
      si(choque.rows.some((x) => x.tipo === veto), `Ese platillo ya tiene una ${veto === 'Devolución' ? 'devolución' : 'reposición'}`);
      si(choque.rows.some((x) => x.tipo === tipo), 'Ese platillo ya tiene una solicitud igual');
      if (tipo === 'Reposición') si(!['Entregado', 'Cobrado'].includes(p.estado), 'El pedido aún no se ha entregado');
      if (tipo === 'Devolución') {
        const { rows: v } = await c.query('SELECT id FROM ventas WHERE pedido_id = $1', [p.id]);
        si(!v[0], 'El pedido aún no se ha cobrado');
        venta = v[0].id;
      }
    }
    await c.query(
      `INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, pedido_id, linea_orden, venta_id, aprueba_rol, motivo, fecha)
       VALUES ($1,'Solicitada',$2,$3,$4,$5,$6,'jefe',$7,$8)`,
      [tipo, p.sucursal_id, u.id, p.id, tipo === 'Cancelación' ? null : linea, venta, m, ts(ahora())]);
    await notificar(c, 'jefe', p.sucursal_id, `${tipo} solicitada`, `#${p.num}`);
    await bitacora(c, u, { accion: `solicitud.${tipo}`, elemento: `Pedido #${p.num}`, motivo: m, sucursal: p.sucursal_id });
  });
  res.status(201).json({ ok: true });
});

/* ---------- mesas ---------- */
r.get('/mesas', async (req, res) => {
  const s = req.usuario.sucursal;
  const { rows } = await q('SELECT mesas FROM sucursales WHERE id = $1', [s]);
  const oc = await mesasOcupadas({ query: q }, s);
  const ped = await cargarPedidos({ query: q }, 'p.id = ANY($1)', [Object.values(oc).map((p) => p.id)]);
  res.json({ total: rows[0].mesas, ocupadas: ped });
});

async function pedidoEnMesa(c, u, id) {
  const { rows } = await c.query(
    `SELECT * FROM pedidos WHERE id = $1 AND sucursal_id = $2 AND tipo = 'Aquí' AND mesa_liberada IS NULL AND reposicion_de IS NULL FOR UPDATE`,
    [id, u.sucursal]);
  if (!rows[0]) throw noEncontrado('Esa mesa ya está libre');
  return rows[0];
}

r.post('/mesas/:pedido/pedir-salida', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'pedido', 'pide', u.sucursal);
  await tx(async (c) => {
    const k = await cfg(c);
    const p = await pedidoEnMesa(c, u, req.params.pedido);
    si(!p.entregado || ahora() - p.entregado < k.minutos_mesa * 60e3, `Aún no lleva ${k.minutos_mesa} minutos comiendo`);
    si(p.salida_pedida, 'Ya se le pidió que desocupe');
    await c.query('UPDATE pedidos SET salida_pedida = $2 WHERE id = $1', [p.id, ts(ahora())]);
    await bitacora(c, u, { accion: 'mesa.pedir_salida', elemento: `Mesa ${p.mesa} · #${p.num}`, sucursal: u.sucursal });
  });
  res.json({ ok: true });
});

r.post('/mesas/:pedido/liberar', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'pedido', 'pide', u.sucursal);
  await tx(async (c) => {
    const p = await pedidoEnMesa(c, u, req.params.pedido);
    si(p.estado !== 'Cobrado', `Cobra el pedido #${p.num} antes de liberar la mesa`);
    await c.query('UPDATE pedidos SET mesa_liberada = $2 WHERE id = $1', [p.id, ts(ahora())]);
    await bitacora(c, u, { accion: 'mesa.liberar', elemento: `Mesa ${p.mesa} · #${p.num}`, sucursal: u.sucursal });
  });
  res.json({ ok: true });
});

/* ---------- caja del mesero ---------- */
async function totalesCaja(c, caja) {
  const { rows } = await c.query(
    `SELECT v.metodo, sum(v.total - COALESCE((SELECT sum(a.monto) FROM venta_ajustes a WHERE a.venta_id = v.id), 0) + v.propina) AS t, count(*)::int n
       FROM ventas v WHERE v.caja_id = $1 GROUP BY v.metodo`, [caja.id]);
  const t = { Efectivo: caja.fondo, Tarjeta: 0, Bitcoin: 0 };
  let ventas = 0;
  for (const x of rows) { t[x.metodo] = r2(t[x.metodo] + x.t); ventas += x.n; }
  return { totales: t, ventas };
}

const cajaJson = (k) => ({
  id: k.id, fondo: k.fondo, estado: k.estado, abierta: k.abierta, cerrada: k.cerrada, declarado: k.declarado,
  esp: k.esp_efectivo == null ? null : { Efectivo: k.esp_efectivo, Tarjeta: k.esp_tarjeta, Bitcoin: k.esp_bitcoin }, comentario: k.comentario,
});

r.get('/caja', async (req, res) => {
  const u = req.usuario;
  const { rows } = await q('SELECT * FROM cajas WHERE mesero_id = $1 ORDER BY id DESC', [u.id]);
  const abierta = rows.find((k) => k.estado === 'Abierta');
  res.json({
    abierta: abierta ? { ...cajaJson(abierta), ...(await totalesCaja({ query: q }, abierta)) } : null,
    cierres: rows.filter((k) => k.estado !== 'Abierta').sort((a, b) => b.cerrada - a.cerrada).map(cajaJson),
  });
});

r.post('/caja/abrir', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'pedido', 'pide', u.sucursal);
  const fondo = Number(req.body?.fondo);
  si(!(fondo >= 0), 'Escribe un fondo inicial válido');
  await tx(async (c) => {
    const ya = await c.query(`SELECT 1 FROM cajas WHERE mesero_id = $1 AND estado = 'Abierta'`, [u.id]);
    si(ya.rowCount, 'Ya tienes una caja abierta');
    await c.query(`INSERT INTO cajas (sucursal_id, mesero_id, fondo, estado, abierta) VALUES ($1,$2,$3,'Abierta',$4)`, [u.sucursal, u.id, r2(fondo), ts(ahora())]);
    await bitacora(c, u, { accion: 'caja.abrir', elemento: u.usuario, sucursal: u.sucursal });
  });
  res.json({ ok: true });
});

r.post('/caja/cerrar', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'cierreCaja', 'pide', u.sucursal);
  const declarado = Number(req.body?.declarado);
  si(!(declarado >= 0) || req.body?.declarado === '' || req.body?.declarado == null, 'Escribe el efectivo contado');
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM cajas WHERE mesero_id = $1 AND estado = 'Abierta' FOR UPDATE`, [u.id]);
    const caja = rows[0];
    si(!caja, 'No tienes caja abierta');
    const { rows: pend } = await c.query(
      `SELECT num, tipo, mesa, cliente FROM pedidos WHERE mesero_id = $1 AND reposicion_de IS NULL
         AND estado NOT IN ('Cobrado','Cancelado','Rechazado') ORDER BY num`, [u.id]);
    if (pend.length) {
      throw new HttpError(409, `Tienes ${pend.length} pedido${pend.length === 1 ? '' : 's'} sin terminar: cóbralos o cancélalos antes de cerrar la caja`,
        { pendientes: pend.map((p) => `#${p.num} · ${donde(p)}`) });
    }
    const { totales } = await totalesCaja(c, caja);
    await c.query(
      `UPDATE cajas SET estado = 'Pendiente de aprobación', cerrada = $2, declarado = $3, esp_efectivo = $4, esp_tarjeta = $5, esp_bitcoin = $6 WHERE id = $1`,
      [caja.id, ts(ahora()), r2(declarado), totales.Efectivo, totales.Tarjeta, totales.Bitcoin]);
    await notificar(c, 'gerente', u.sucursal, 'Cierre de caja', u.nombre);
    await bitacora(c, u, { accion: 'caja.cerrar', elemento: `Caja ${caja.id}`, sucursal: u.sucursal });
  });
  res.json({ ok: true });
});

/* ---------- cobro (ADENDA v6): documento, propina y método de pago ---------- */
const DOCS = ['Ticket simple', 'Factura de consumidor final', 'Comprobante de crédito fiscal (CCF)'];
const MARCAS = ['Visa', 'Mastercard', 'American Express', 'Otra'];
const MODOS = ['Chip', 'Contactless', 'Banda'];
const CUOTAS = ['Contado', '3 cuotas', '6 cuotas', '12 cuotas'];

r.post('/cobrar', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'pedido', 'pide', u.sucursal);
  const b = req.body || {};
  si(!DOCS.includes(b.tipoDoc), 'Elige el documento');
  const ccf = b.tipoDoc.startsWith('Comp');
  const fis = ccf ? { nombre: String(b.fis?.nombre || '').trim(), nit: String(b.fis?.nit || '').trim(), nrc: String(b.fis?.nrc || '').trim() } : null;
  if (ccf) {
    si(!fis.nombre, 'Falta el nombre o razón social');
    si(!/^\d{4}-\d{6}-\d{3}-\d$/.test(fis.nit), 'NIT inválido (0000-000000-000-0)');
    si(!/^\d{6}-\d$/.test(fis.nrc), 'NRC inválido (000000-0)');
  }
  const pct = Number(b.propinaPct || 0);
  si(![0, 5, 10, 15].includes(pct), 'Propina inválida');

  const venta = await tx(async (c) => {
    const k = await cfg(c);
    const { rows: cj } = await c.query(`SELECT id FROM cajas WHERE mesero_id = $1 AND estado = 'Abierta'`, [u.id]);
    si(!cj[0], 'Abre tu caja para cobrar');
    const p = await miPedido(c, u, b.pedidoId);
    si(p.estado !== 'Entregado' || p.reposicion_de, 'Ese pedido no está por cobrar');
    const total = p.total;
    const propina = r2((total * pct) / 100);
    const T = r2(total + propina);
    let pago = {};
    let ref = '';
    if (b.metodo === 'Efectivo') {
      const rec = Number(b.efectivo?.recibido);
      si(!(rec > 0), 'Escribe el monto recibido');
      si(rec < T, `Falta $${(T - rec).toFixed(2)}`);
      pago = { recibido: r2(rec), cambio: r2(rec - T) };
    } else if (b.metodo === 'Tarjeta') {
      const t = b.tarjeta || {};
      si(!['Débito', 'Crédito'].includes(t.tipo) || !MARCAS.includes(t.marca) || !MODOS.includes(t.modo), 'Revisa los datos de la tarjeta');
      si(!/^\d{4}$/.test(String(t.ult4 || '').trim()), 'Escribe los últimos 4 dígitos de la tarjeta');
      si(!/^[A-Za-z0-9]{4,8}$/.test(String(t.aut || '').trim()), 'Escribe el código de autorización que muestra la terminal (4 a 8 caracteres)');
      si(!/^\d{3,12}$/.test(String(t.voucher || '').trim()), 'Escribe el número de referencia o voucher del terminal (3 a 12 dígitos)');
      const cuotas = t.tipo === 'Crédito' && CUOTAS.includes(t.cuotas) ? t.cuotas : 'Contado';
      pago = { tipo: t.tipo, marca: t.marca, ult4: t.ult4.trim(), aut: t.aut.trim().toUpperCase(), voucher: t.voucher.trim(), modo: t.modo, cuotas };
      ref = `${t.tipo} ${t.marca} ····${pago.ult4} · ${pago.modo} · Aut. ${pago.aut} · Ref. ${pago.voucher}${cuotas !== 'Contado' ? ` · ${cuotas}` : ''}`;
    } else if (b.metodo === 'Bitcoin') {
      const t = b.bitcoin || {};
      const id = String(t.id || '').trim();
      if (t.red === 'Lightning') {
        si(!/^[0-9a-fA-F]{8,64}$/.test(id), 'Escribe el hash del pago Lightning (8 a 64 caracteres hexadecimales)');
        si(!t.ok, 'Confirma que el pago ya llegó a la billetera');
      } else {
        si(t.red !== 'On-chain', 'Elige la red de pago');
        si(!/^[0-9a-fA-F]{64}$/.test(id), 'El ID de la transacción (txid) debe tener 64 caracteres hexadecimales');
        si(!t.ok, 'Confirma que la transacción ya aparece en la billetera');
      }
      const btc = +(T / k.btc_usd).toFixed(8);
      pago = { red: t.red, id: id.toLowerCase(), inv: String(t.inv || ''), sats: Math.round((T / k.btc_usd) * 1e8), btc, tasa: k.btc_usd };
      if (t.red === 'On-chain') pago.conf = String(t.conf ?? '1');
      ref = `${t.red} · ${pago.id.slice(0, 12)}${pago.id.length > 12 ? '…' : ''} · ${btc.toFixed(8)} BTC${t.red === 'On-chain' ? ` · ${pago.conf} conf.` : ''}`;
    } else {
      throw fallo('Elige el método de pago');
    }
    await c.query('SELECT pg_advisory_xact_lock(2000 + $1)', [p.sucursal_id]); // correlativo sin huecos ni repetidos
    const { rows: cr } = await c.query('SELECT COALESCE(max(correlativo), 0) + 1 AS n FROM ventas WHERE sucursal_id = $1 AND tipo_doc = $2', [p.sucursal_id, b.tipoDoc]);
    const sub = r2(total / (1 + k.iva_pct / 100));
    const { rows: v } = await c.query(
      `INSERT INTO ventas (sucursal_id, pedido_id, mesero_id, caja_id, fecha, metodo, referencia, pago, propina, tipo_doc, correlativo,
                           fis_nombre, fis_nit, fis_nrc, total, subtotal, iva)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [p.sucursal_id, p.id, u.id, cj[0].id, ts(ahora()), b.metodo, ref, JSON.stringify(pago), propina, b.tipoDoc, cr[0].n,
        fis?.nombre ?? null, fis?.nit ?? null, fis?.nrc ?? null, total, sub, r2(total - sub)]);
    await c.query(`UPDATE pedidos SET estado = 'Cobrado' WHERE id = $1`, [p.id]);
    await bitacora(c, u, { accion: 'venta.cobrar', elemento: `Pedido #${p.num}`, sucursal: p.sucursal_id });
    return (await cargarVentas(c, 'v.id = $1', [v[0].id]))[0];
  });
  res.status(201).json(venta);
});

/* ---------- historial de ventas: mi turno, ayer o 7 días ---------- */
r.get('/ventas', async (req, res) => {
  const u = req.usuario;
  const rango = req.query.rango || 'turno';
  if (rango === 'turno') {
    const { rows } = await q(`SELECT id FROM cajas WHERE mesero_id = $1 ORDER BY (estado = 'Abierta') DESC, id DESC LIMIT 1`, [u.id]);
    return res.json(rows[0] ? await cargarVentas({ query: q }, 'v.mesero_id = $1 AND v.caja_id = $2', [u.id, rows[0].id]) : []);
  }
  const hoy = inicioDia(ahora());
  const [desde, hasta] = rango === 'ayer' ? [hoy - D, hoy] : [ahora() - 7 * D, 8.64e15];
  res.json(await cargarVentas({ query: q }, 'v.mesero_id = $1 AND v.fecha >= $2 AND v.fecha < $3', [u.id, ts(desde), ts(hasta)]));
});

r.get('/ventas/:id', async (req, res) => {
  const v = (await cargarVentas({ query: q }, 'v.id = $1 AND v.sucursal_id = $2', [req.params.id, req.usuario.sucursal]))[0];
  if (!v) throw noEncontrado('No se encontró la venta');
  res.json(v);
});

export default r;
