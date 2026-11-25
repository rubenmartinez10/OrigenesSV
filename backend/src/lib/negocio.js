import { ts } from '../db.js';
import { notificar } from './registro.js';
import { ahora, D, H, inicioDia, semanaKey, diaSemana, horaDelDia } from './reloj.js';

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
  envio: +k.envio_delivery, gananciaMin: k.ganancia_min_pct, btcUsd: k.btc_usd, minutosMesa: k.minutos_mesa, porVencerDias: k.por_vencer_dias,
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

/** Espera extra (s) por la cola de cocina: pedidos activos que exceden la capacidad de los cocineros en turno. */
export async function esperaCola(c, s, k) {
  const { rows: cocs } = await c.query(`SELECT id FROM usuarios WHERE rol_id = 'cocinero' AND estado = 'Activo' AND sucursal_id = $1`, [s]);
  const turnos = await turnosDe(c, cocs.map((x) => x.id));
  const activos = cocs.filter((x) => enTurno('cocinero', turnos[x.id])).length;
  const { rows } = await c.query(`SELECT COUNT(*)::int AS n, COALESCE(AVG(est_seg), 0)::int AS prom FROM pedidos WHERE sucursal_id = $1 AND estado IN ('Creado','Aceptado','Asignado','Preparando')`, [s]);
  const cap = Math.max(1, activos) * (k.cocina_simultaneos || 3);
  const exceso = Math.max(0, rows[0].n - cap);
  return Math.min(1800, Math.round((exceso * rows[0].prom) / cap));
}

/** Valoración de clientes por sucursal: promedio, votos y puntaje ponderado (pocos votos pesan menos). */
export async function valoraciones(c, m = 5) {
  const { rows } = await c.query(`SELECT sucursal_id AS id, COUNT(estrellas)::int AS votos, COALESCE(AVG(estrellas), 0)::float AS prom FROM ventas GROUP BY sucursal_id`);
  const tv = rows.reduce((a, x) => a + x.votos, 0);
  const C = tv ? rows.reduce((a, x) => a + x.prom * x.votos, 0) / tv : 0;
  return Object.fromEntries(rows.map((x) => [x.id, {
    votos: x.votos, prom: +x.prom.toFixed(2), puntaje: x.votos ? +((x.votos * x.prom + m * C) / (x.votos + m)).toFixed(2) : null,
  }]));
}
const SIN_VOTOS = { votos: 0, prom: 0, puntaje: null };
export const valDe = (V, id) => V[id] || SIN_VOTOS;

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
/** Precio sin IVA mínimo para un costo: costo + ganancia mínima configurada. */
export const netoMin = (costo, k) => r2(costo * (1 + (k.ganancia_min_pct ?? 30) / 100));
export const bajoMargen = (precio, costo, k) => neto(precio, k) + 1e-9 < netoMin(costo, k);
export const msgMargen = (costo, k) => `El precio sin IVA debe dejar al menos ${k.ganancia_min_pct ?? 30} % de ganancia sobre el costo (mínimo $${netoMin(costo, k).toFixed(2)} sin IVA)`;

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

/** Mesas ocupadas: pedidos para comer aquí que no se han liberado. Un pedido cancelado o rechazado sigue ocupando la mesa:
 *  el cliente sigue sentado hasta que el mesero la libera (o le toma otro pedido en esa misma mesa). */
export async function mesasOcupadas(c, s) {
  const { rows } = await c.query(
    `SELECT p.id, p.num, p.mesa, p.cliente, p.estado, p.mesero_id, p.entregado, p.salida_pedida, p.reposicion_de, p.cargo_cancel,
            EXISTS (SELECT 1 FROM ventas v WHERE v.pedido_id = p.id) AS pagado
       FROM pedidos p
      WHERE p.sucursal_id = $1 AND p.tipo = 'Aquí' AND p.mesa IS NOT NULL AND p.reposicion_de IS NULL
        AND p.mesa_liberada IS NULL`, [s]);
  const m = {};
  for (const r of rows) m[r.mesa] = r;
  return m;
}

/** Pedidos sin cerrar (ni cobrados, cancelados o rechazados) que llevan el producto o extra; opcionalmente solo de una sucursal. */
export async function pedidosPendientesCon(c, productoId, s = null) {
  const { rows } = await c.query(
    `SELECT count(DISTINCT p.id)::int n FROM pedidos p JOIN pedido_lineas l ON l.pedido_id = p.id LEFT JOIN pedido_linea_extras e ON e.linea_id = l.id
      WHERE p.estado NOT IN ('Cobrado','Cancelado','Rechazado') AND ($2::int IS NULL OR p.sucursal_id = $2) AND (l.producto_id = $1 OR e.extra_id = $1)`,
    [productoId, s]);
  return rows[0].n;
}
export const msgPendientes = (n) => `Hay ${n} ${n === 1 ? 'pedido pendiente' : 'pedidos pendientes'} con este producto: no se puede quitar hasta que terminen`;

/** El pedido que ocupa la mesa ya terminó sin consumo pendiente de pago (cancelado o rechazado): el mismo cliente puede pedir de nuevo. */
export const mesaReusable = (o) => o && ['Cancelado', 'Rechazado'].includes(o.estado) && (!(+o.cargo_cancel > 0) || o.pagado);

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

/** Minutos de tolerancia para abrir caja sin que cuente como tarde (y para abrir antes de que empiece el turno). */
export const MARGEN_TURNO_MIN = 15;

/** Turno que cubre el instante t: { ini, fin } en ms, o null si está fuera de turno o de descanso. Soporta turnos que cruzan la medianoche. */
export function ventanaTurno(turnosUsuario, t = ahora()) {
  if (!turnosUsuario) return null;
  for (const off of [0, -1]) {
    const dia = inicioDia(t) + off * D;
    const celdas = turnosUsuario[semanaKey(dia + H)] || turnosUsuario.base;
    const h = celdas && horas(celdas[diaSemana(dia + H)]);
    if (!h) continue;
    const ini = dia + h[0] * H;
    const fin = ini + (h[1] > h[0] ? h[1] - h[0] : h[1] + 24 - h[0]) * H;
    if (t >= ini - MARGEN_TURNO_MIN * 60e3 && t < fin) return { ini, fin };
  }
  return null;
}

/** Turnos de varios usuarios → { usuarioId: { base:[…], '2026-11-23':[…] } } */
export async function turnosDe(c, ids) {
  const { rows } = await c.query('SELECT usuario_id, semana, dias FROM turnos WHERE usuario_id = ANY($1)', [ids]);
  const out = {};
  for (const r of rows) (out[r.usuario_id] ||= {})[r.semana ? String(r.semana).slice(0, 10) : 'base'] = r.dias;
  return out;
}

export const DIA = D;

/** Texto del turno de hoy del usuario («Mañana · 07:00–15:00», «Libre»…). */
export function textoTurno(turnosUsuario, t = ahora()) {
  const celdas = turnosUsuario?.[semanaKey(t)] || turnosUsuario?.base;
  const x = celdas?.[diaSemana(t)];
  const h = horas(x);
  if (!h) return 'Libre hoy';
  const f = (n) => `${String(n % 24).padStart(2, '0')}:00`;
  return `${['Mañana', 'Tarde', 'Noche'].includes(x) ? `${x} · ` : ''}${f(h[0])}–${f(h[1])}`;
}

/** Caja abierta que ya pasó del fin de su turno: avisa en rojo al gerente y al mesero (una sola vez por caja). */
export async function revisarCajasPasadas(c, sucursal = null) {
  const { rows } = await c.query(
    `UPDATE cajas k SET aviso_fin = TRUE
       FROM usuarios u
      WHERE u.id = k.mesero_id AND k.estado = 'Abierta' AND NOT k.aviso_fin AND k.turno_fin IS NOT NULL AND k.turno_fin <= $1
        AND ($2::int IS NULL OR k.sucursal_id = $2)
      RETURNING k.id, k.sucursal_id, u.nombre`, [ts(ahora()), sucursal]);
  for (const k of rows) {
    await notificar(c, 'gerente', k.sucursal_id, 'Caja abierta fuera de turno', `${k.nombre} sigue con la caja abierta después de terminar su turno`, true);
    await notificar(c, 'mesero', k.sucursal_id, 'Tu turno terminó', 'Cierra tu caja: ya pasaste de tu horario', true);
  }
}
