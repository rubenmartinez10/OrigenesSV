import { ts } from '../db.js';
import { ahora, D, semanaKey, diaSemana, horaDelDia } from './reloj.js';

/* Reglas de negocio compartidas (las mismas fórmulas del borrador). */

export const r2 = (n) => Math.round(n * 100) / 100;
export const sum = (a, f) => a.reduce((x, y) => x + f(y), 0);

/* ---------- configuración (una fila; se guarda en memoria) ---------- */
let CFG = null;
export async function cfg(c) {
  if (!CFG) CFG = (await c.query('SELECT * FROM configuracion WHERE id = 1')).rows[0];
  return CFG;
}
export const olvidarCfg = () => { CFG = null; };

/** Configuración que necesita el frontend para calcular tiempos y totales. */
export const cfgPublica = (k) => ({
  iva: k.iva_pct, margenMin: k.margen_min, extraUnidad: k.extra_unidad_pct, tendencia: [k.tendencia_top, k.tendencia_dias],
  btcUsd: k.btc_usd, minutosMesa: k.minutos_mesa, porVencerDias: k.por_vencer_dias,
});

/* ---------- existencias ---------- */

/** Disponible por materia prima en una sucursal: lotes vigentes − lo reservado por pedidos sin preparar. */
export async function disponibles(c, s, t = ahora()) {
  const { rows } = await c.query(
    `SELECT m.id AS mp, COALESCE(st.stock, 0) AS stock, COALESCE(rs.reservado, 0) AS reservado
       FROM materias_primas m
       LEFT JOIN (SELECT mp_id, sum(cantidad) AS stock FROM lotes
                   WHERE sucursal_id = $1 AND cantidad > 0 AND vence > $2 GROUP BY mp_id) st ON st.mp_id = m.id
       LEFT JOIN (SELECT r.mp_id, sum(r.cantidad) AS reservado FROM pedido_reservas r JOIN pedidos p ON p.id = r.pedido_id
                   WHERE p.sucursal_id = $1 AND NOT p.consumido AND p.estado NOT IN ('Cancelado','Rechazado')
                   GROUP BY r.mp_id) rs ON rs.mp_id = m.id`,
    [s, ts(t)],
  );
  const disp = {};
  const stock = {};
  for (const r of rows) { disp[r.mp] = r.stock - r.reservado; stock[r.mp] = r.stock; }
  return { disp, stock };
}

/** Recetas → { productoId: [{mp, cant}] } */
export async function recetas(c) {
  const { rows } = await c.query('SELECT producto_id, mp_id, cantidad FROM recetas ORDER BY producto_id, mp_id');
  const out = {};
  for (const r of rows) (out[r.producto_id] ||= []).push({ mp: r.mp_id, cant: r.cantidad });
  return out;
}

/** Insumos que usan unas líneas [{pr, cant, extras:[id]}] */
export function uso(lineas, rec) {
  const u = {};
  const add = (m, n) => { u[m] = (u[m] || 0) + n; };
  for (const l of lineas) {
    for (const r of rec[l.pr] || []) add(r.mp, r.cant * l.cant);
    for (const e of l.extras || []) for (const r of rec[e] || []) add(r.mp, r.cant * l.cant);
  }
  return u;
}
export const cabe = (u, disp) => Object.keys(u).every((m) => u[m] <= (disp[m] || 0) + 1e-9);

/** Tiempo estimado en segundos: (tiempo + extras) × factor por unidades adicionales. */
export function estimado(lineas, prods, k) {
  const fac = (n) => 1 + (k.extra_unidad_pct / 100) * (n - 1);
  return Math.round(sum(lineas, (l) => ((prods[l.pr]?.tiempo || 0) + sum(l.extras || [], (e) => prods[e]?.tiempo || 0)) * fac(l.cant)) * 60);
}

/** Ofertas activas de una sucursal → { productoId: pct } */
export async function ofertasActivas(c, s) {
  const { rows } = await c.query(
    `SELECT op.producto_id, o.pct FROM ofertas o JOIN oferta_productos op ON op.oferta_id = o.id
      WHERE o.estado = 'Activa' AND o.sucursal_id = $1 ORDER BY o.creada DESC`, [s]);
  const out = {};
  for (const r of rows) if (out[r.producto_id] == null) out[r.producto_id] = r.pct;
  return out;
}
export const precioCon = (precio, pct) => (pct ? +(precio * (1 - pct / 100)).toFixed(2) : precio);

/* ---------- costos ---------- */

/** Costo actual por materia prima en una sucursal: promedio de lotes vigentes, si no el último lote, si no el proveedor más barato. */
export async function costosMP(c, s, t = ahora()) {
  const { rows } = await c.query(
    `SELECT m.id,
       (SELECT sum(l.cantidad * l.precio) / NULLIF(sum(l.cantidad), 0) FROM lotes l
         WHERE l.mp_id = m.id AND l.sucursal_id = $1 AND l.cantidad > 0 AND l.vence > $2) AS prom,
       (SELECT l.precio FROM lotes l WHERE l.mp_id = m.id AND l.sucursal_id = $1 ORDER BY l.fecha_compra DESC LIMIT 1) AS ultimo,
       (SELECT min(pm.precio_actual) FROM proveedor_materias pm JOIN proveedores v ON v.id = pm.proveedor_id
         WHERE pm.mp_id = m.id AND v.estado = 'Activo') AS ref
     FROM materias_primas m`, [s, ts(t)]);
  const out = {};
  for (const r of rows) out[r.id] = r.prom ?? r.ultimo ?? r.ref ?? 0;
  return out;
}

/** Costo tope: el mayor precio posible (proveedores que entregan en la sucursal, con su variación, y lotes en bodega). */
export async function costosTope(c, s) {
  const { rows } = await c.query(
    `SELECT m.id,
       (SELECT max(round(pm.precio_base * 1.072, 2)) FROM proveedor_materias pm
          JOIN proveedores v ON v.id = pm.proveedor_id AND v.estado = 'Activo'
          JOIN proveedor_sucursales ps ON ps.proveedor_id = v.id AND ps.sucursal_id = $1
         WHERE pm.mp_id = m.id) AS prov,
       (SELECT max(l.precio) FROM lotes l WHERE l.mp_id = m.id AND l.sucursal_id = $1 AND l.cantidad > 0) AS lote,
       (SELECT min(pm.precio_actual) FROM proveedor_materias pm JOIN proveedores v ON v.id = pm.proveedor_id
         WHERE pm.mp_id = m.id AND v.estado = 'Activo') AS ref
     FROM materias_primas m`, [s]);
  const out = {};
  for (const r of rows) out[r.id] = Math.max(r.prov || 0, r.lote || 0) || r.ref || 0;
  return out;
}

export const costoReceta = (receta, costos) => sum(receta || [], (r) => r.cant * (costos[r.mp] || 0));

/** Costo de una propuesta: si hay materias nuevas o sin proveedor, queda incompleto. */
export async function costoPropuesta(c, ings, s) {
  const { rows } = await c.query(
    `SELECT DISTINCT pm.mp_id FROM proveedor_materias pm JOIN proveedores v ON v.id = pm.proveedor_id WHERE v.estado = 'Activo'`);
  const conProv = new Set(rows.map((r) => r.mp_id));
  const tope = await costosTope(c, s);
  let costo = 0;
  let incompleto = false;
  for (const r of ings || []) {
    if (!r.mp) continue;
    if (String(r.mp).startsWith('new:') || !conProv.has(+r.mp)) incompleto = true;
    else costo += (+r.cant || 0) * tope[r.mp];
  }
  return { costo: r2(costo), incompleto };
}

export const neto = (precio, k) => precio / (1 + k.iva_pct / 100);

/** Descuenta del inventario lo reservado por el pedido (primero los lotes que vencen antes). */
export async function consumir(c, pedidoId, s, t = ahora()) {
  const { rows: res } = await c.query('SELECT mp_id, cantidad FROM pedido_reservas WHERE pedido_id = $1', [pedidoId]);
  for (const r of res) {
    let n = r.cantidad;
    const { rows: lotes } = await c.query(
      'SELECT id, cantidad FROM lotes WHERE mp_id = $1 AND sucursal_id = $2 AND cantidad > 0 AND vence > $3 ORDER BY vence FOR UPDATE',
      [r.mp_id, s, ts(t)]);
    for (const l of lotes) {
      if (n <= 1e-9) break;
      const tomar = Math.min(n, l.cantidad);
      const queda = l.cantidad - tomar;
      n -= tomar;
      await c.query(
        `UPDATE lotes SET cantidad = $2, estado = CASE WHEN $2 <= 1e-9 THEN 'Agotado' ELSE estado END WHERE id = $1`,
        [l.id, queda <= 1e-9 ? 0 : queda]);
    }
  }
  await c.query('UPDATE pedidos SET consumido = TRUE WHERE id = $1', [pedidoId]);
}

/** Costo de lo reservado por un pedido (para registrar pérdidas). */
export async function costoReservas(c, pedidoId, s) {
  const costos = await costosMP(c, s);
  const { rows } = await c.query('SELECT mp_id, cantidad FROM pedido_reservas WHERE pedido_id = $1', [pedidoId]);
  return r2(sum(rows, (r) => r.cantidad * (costos[r.mp_id] || 0)));
}

/* ---------- mesas ---------- */

/** Mesas ocupadas: pedidos para comer aquí que no se han liberado ni cancelado. */
export async function mesasOcupadas(c, s) {
  const { rows } = await c.query(
    `SELECT p.id, p.num, p.mesa, p.cliente, p.estado, p.mesero_id, p.entregado, p.salida_pedida, p.reposicion_de
       FROM pedidos p
      WHERE p.sucursal_id = $1 AND p.tipo = 'Aquí' AND p.mesa IS NOT NULL AND p.reposicion_de IS NULL
        AND p.mesa_liberada IS NULL AND p.estado NOT IN ('Cancelado','Rechazado')`, [s]);
  const m = {};
  for (const r of rows) m[r.mesa] = r;
  return m;
}

/* ---------- turnos ---------- */
export const TURNOS = { Mañana: [7, 15], Tarde: [15, 23], Noche: [23, 7] };
const horas = (x) => (!x ? null : TURNOS[x] || (/^\d+-\d+$/.test(x) ? x.split('-').map(Number) : null));

/** ¿El cocinero está en turno? (solo aplica a cocineros) */
export function enTurno(rol, turnosUsuario, t = ahora()) {
  if (rol !== 'cocinero') return true;
  if (!turnosUsuario) return true;
  const celdas = turnosUsuario[semanaKey(t)] || turnosUsuario.base;
  if (!celdas) return true;
  const h = horas(celdas[diaSemana(t)]);
  if (!h) return false;
  const hh = horaDelDia(t);
  return h[0] < h[1] ? hh >= h[0] && hh < h[1] : hh >= h[0] || hh < h[1];
}

/** Turnos de varios usuarios → { usuarioId: { base:[…], '2026-11-23':[…] } } */
export async function turnosDe(c, ids) {
  const { rows } = await c.query('SELECT usuario_id, semana, dias FROM turnos WHERE usuario_id = ANY($1)', [ids]);
  const out = {};
  for (const r of rows) (out[r.usuario_id] ||= {})[r.semana ? String(r.semana).slice(0, 10) : 'base'] = r.dias;
  return out;
}

export const DIA = D;
