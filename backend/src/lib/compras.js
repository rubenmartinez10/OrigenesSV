import { ts } from '../db.js';
import { ahora, D, H } from './reloj.js';
import { fallo, si } from './errores.js';
import { notificar } from './registro.js';
import { cfg, r2, sum } from './negocio.js';
import { ajusteFactura } from './procesos.js';

/*
 * Compras a proveedores: cotización, solicitudes (una por proveedor), factura, llegada,
 * recepción por lotes y aceptación de la mercancía. Mismas reglas que el borrador.
 */
export const ETAPAS_COMPRA = ['Preparada', 'Aceptada por gerente', 'Aceptada por gerente general', 'En camino'];
const DIAS_PAGO = { Contado: 0, '15 días': 15, '30 días': 30 };
const rnd = (a, b) => a + Math.random() * (b - a);

/** Compras con proveedor, líneas, recepción y factura. `where` usa el alias c. */
export async function cargarCompras(c, where, params = [], orden = 'c.creada DESC') {
  const { rows } = await c.query(
    `SELECT c.*, v.nombre AS prov_nombre, v.politica_tipo, v.politica_tolerancia_h, v.politica_escala, v.politica_tope,
            s.nombre AS suc_nombre, u.nombre AS por_nombre, f.num AS factura_num, f.monto AS factura_monto, f.estado AS factura_estado,
            g.nombre AS gerente_nombre, gg.nombre AS gg_nombre, ac.nombre AS acepto_nombre, h.id AS hijo
       FROM compras c JOIN proveedores v ON v.id = c.proveedor_id JOIN sucursales s ON s.id = c.sucursal_id
       JOIN usuarios u ON u.id = c.creada_por LEFT JOIN facturas f ON f.id = c.factura_id
       LEFT JOIN usuarios g ON g.id = c.gerente_id LEFT JOIN usuarios gg ON gg.id = c.gg_id LEFT JOIN usuarios ac ON ac.id = c.aceptada_por
       LEFT JOIN compras h ON h.pendiente_de = c.id
      WHERE ${where} ORDER BY ${orden}`, params);
  if (!rows.length) return [];
  const ids = rows.map((x) => x.id);
  const { rows: lineas } = await c.query(
    `SELECT l.*, m.nombre, m.unidad FROM compra_lineas l JOIN materias_primas m ON m.id = l.mp_id WHERE l.compra_id = ANY($1) ORDER BY l.id`, [ids]);
  const { rows: rec } = await c.query(
    `SELECT r.*, m.nombre, u.nombre AS por_nombre FROM compra_recepcion r JOIN materias_primas m ON m.id = r.mp_id
       LEFT JOIN usuarios u ON u.id = r.por WHERE r.compra_id = ANY($1) ORDER BY r.id`, [ids]);
  return rows.map((x) => {
    const lotes = rec.filter((r) => r.compra_id === x.id);
    return {
      id: x.id, suc: x.sucursal_id, sucNombre: x.suc_nombre, prov: x.proveedor_id, provNombre: x.prov_nombre, estado: x.estado,
      creada: x.creada, por: x.creada_por, porNombre: x.por_nombre, pago: x.condicion_pago, transporte: x.transporte, entregaH: x.entrega_h,
      cot: { creada: x.cot_creada, vence: x.cot_vence }, subtotal: x.subtotal, subtotalAnt: x.subtotal_anterior, total: x.total,
      gerente: x.gerente_id && { por: x.gerente_id, nombre: x.gerente_nombre, fecha: x.gerente_fecha },
      gg: x.gg_id && { por: x.gg_id, nombre: x.gg_nombre, fecha: x.gg_fecha },
      enviada: x.enviada, prom: x.prometida, llegada: x.llegada, llego: x.llego, factura: x.factura_id, facturaNum: x.factura_num,
      facturaMonto: x.factura_monto, facturaEstado: x.factura_estado, pendienteDe: x.pendiente_de, hijo: x.hijo, descPend: x.desc_pendiente,
      parcial: x.parcial, aceptada: x.aceptada_por && { por: x.aceptada_por, nombre: x.acepto_nombre, fecha: x.aceptada_fecha },
      atraso: x.atraso, detalle: x.detalle || {},
      politica: { tipo: x.politica_tipo, tolH: x.politica_tolerancia_h, escala: x.politica_escala, tope: x.politica_tope },
      lineas: lineas.filter((l) => l.compra_id === x.id).map((l) => ({
        mp: l.mp_id, nombre: l.nombre, unidad: l.unidad, cant: l.cantidad, precio: l.precio, precioAnt: l.precio_anterior, recibido: l.recibido,
      })),
      recepcion: lotes.length ? {
        por: lotes[0].por, porNombre: lotes[0].por_nombre, fecha: lotes[0].fecha,
        lotes: lotes.map((r) => ({ mp: r.mp_id, nombre: r.nombre, sku: r.sku, cant: r.cantidad, vence: r.vence })),
      } : null,
    };
  });
}

export async function cargarCompra(c, id) {
  return (await cargarCompras(c, 'c.id = $1', [id]))[0] || null;
}

/** Compra con bloqueo de fila. */
export async function compraParaCambiar(c, id, s) {
  const { rows } = await c.query(`SELECT * FROM compras WHERE id = $1 ${s ? 'AND sucursal_id = $2' : ''} FOR UPDATE`, s ? [id, s] : [id]);
  if (!rows[0]) throw fallo('No se encontró la solicitud de compra');
  return rows[0];
}

/** Cotización por materia prima: proveedores activos con precio, transporte, entrega y vigencia. */
export async function cotizar(c, mps, s) {
  const k = await cfg(c);
  const t = ahora();
  const { rows: provs } = await c.query(
    `SELECT v.id, v.nombre, v.condicion_pago, ps.entrega_h, ps.transporte FROM proveedores v
       LEFT JOIN proveedor_sucursales ps ON ps.proveedor_id = v.id AND ps.sucursal_id = $1 WHERE v.estado = 'Activo' ORDER BY v.id`, [s]);
  const { rows: precios } = await c.query('SELECT proveedor_id, mp_id, precio_actual FROM proveedor_materias WHERE mp_id = ANY($1)', [mps]);
  const { rows: mats } = await c.query('SELECT id, vida_dias FROM materias_primas WHERE id = ANY($1)', [mps]);
  const vida = Object.fromEntries(mats.map((m) => [m.id, m.vida_dias]));
  const out = {};
  for (const mp of mps) {
    out[mp] = provs.map((v) => {
      const p = precios.find((x) => x.proveedor_id === v.id && x.mp_id === mp);
      const cond = v.entrega_h != null;
      return {
        prov: v.id, provNombre: v.nombre, ok: !!p && cond, motivo: !p ? 'No tiene este producto' : !cond ? 'Sin condiciones para esta sucursal' : '',
        precio: p?.precio_actual ?? null, transp: v.transporte, horas: v.entrega_h, pago: v.condicion_pago,
        vence: t + (vida[mp] || 14) * D, vig: t + k.vigencia_cotizacion_h * H,
      };
    });
  }
  return out;
}

/** Crea una solicitud de compra por proveedor. items: [{mp, cant, prov}] */
export async function crearCompras(c, s, items, u) {
  const k = await cfg(c);
  const t = ahora();
  si(!items?.length, 'Elige al menos una materia prima');
  const grupos = {};
  for (const i of items) {
    si(!(+i.cant > 0), 'Cada cantidad debe ser mayor que 0');
    (grupos[i.prov] ||= []).push(i);
  }
  const creadas = [];
  for (const [pid, lista] of Object.entries(grupos)) {
    const { rows: v } = await c.query(
      `SELECT v.*, ps.entrega_h, ps.transporte FROM proveedores v JOIN proveedor_sucursales ps ON ps.proveedor_id = v.id AND ps.sucursal_id = $2
        WHERE v.id = $1 AND v.estado = 'Activo'`, [pid, s]);
    si(!v[0], 'Ese proveedor no entrega en tu sucursal');
    const lineas = [];
    for (const i of lista) {
      const { rows: p } = await c.query(
        `SELECT pm.precio_actual FROM proveedor_materias pm JOIN materias_primas m ON m.id = pm.mp_id AND m.estado = 'Activo'
          WHERE pm.proveedor_id = $1 AND pm.mp_id = $2
            AND NOT EXISTS (SELECT 1 FROM sucursal_mp_inhabilitada x WHERE x.sucursal_id = $3 AND x.mp_id = m.id)`, [pid, i.mp, s]);
      si(!p[0], 'Una materia prima no está disponible con ese proveedor');
      lineas.push({ mp: +i.mp, cant: +i.cant, precio: p[0].precio_actual });
    }
    const subtotal = r2(sum(lineas, (l) => l.cant * l.precio));
    const { rows: ins } = await c.query(
      `INSERT INTO compras (sucursal_id, proveedor_id, estado, creada, creada_por, condicion_pago, transporte, entrega_h, cot_creada, cot_vence, subtotal, total)
       VALUES ($1,$2,'Preparada',$3,$4,$5,$6,$7,$3,$8,$9,$10) RETURNING id`,
      [s, pid, ts(t), u.id, v[0].condicion_pago, v[0].transporte, v[0].entrega_h, ts(t + k.vigencia_cotizacion_h * H), subtotal, r2(subtotal + v[0].transporte)]);
    for (const l of lineas) await c.query('INSERT INTO compra_lineas (compra_id, mp_id, cantidad, precio) VALUES ($1,$2,$3,$4)', [ins[0].id, l.mp, l.cant, l.precio]);
    creadas.push({ id: ins[0].id, prov: v[0].nombre, total: r2(subtotal + v[0].transporte) });
  }
  return creadas;
}

/** Hora de llegada simulada: 65 % a tiempo, 25 % tarde, 10 % antes. */
export async function horaLlegada(c, inicio, entregaH) {
  const k = await cfg(c);
  const h = entregaH * H;
  const roll = Math.random() * 100;
  const off = roll < k.llegada_a_tiempo_pct ? rnd(-0.03, 0.03) * h : roll < k.llegada_a_tiempo_pct + k.llegada_tarde_pct ? rnd(0.25, 1.1) * h : -rnd(0.15, 0.4) * h;
  return { prom: inicio + h, llegada: Math.round(inicio + h + off) };
}

/** Factura del proveedor (FP-0001) a partir de las líneas de la compra. */
export async function crearFactura(c, compraId) {
  const { rows } = await c.query('SELECT * FROM compras WHERE id = $1', [compraId]);
  const cp = rows[0];
  const t = ahora();
  const { rows: sec } = await c.query(`SELECT nextval(pg_get_serial_sequence('facturas','id')) AS id`);
  const id = sec[0].id;
  await c.query(
    `INSERT INTO facturas (id, num, compra_id, sucursal_id, proveedor_id, monto, original, condicion, emitida, vence)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)`,
    [id, `FP-${String(id).padStart(4, '0')}`, cp.id, cp.sucursal_id, cp.proveedor_id, cp.total, cp.condicion_pago, ts(t), ts(t + (DIAS_PAGO[cp.condicion_pago] || 0) * D)]);
  await c.query('INSERT INTO factura_lineas (factura_id, mp_id, cantidad, precio) SELECT $1, mp_id, cantidad, precio FROM compra_lineas WHERE compra_id = $2', [id, cp.id]);
  await c.query('UPDATE compras SET factura_id = $2 WHERE id = $1', [cp.id, id]);
  return id;
}

/** Sugerencia de código de lote: L<mp>S<suc>-001 */
export async function skuNuevo(c, mp, s, extra = 0) {
  const pref = `L${mp}S${s}-`;
  const { rows } = await c.query(
    `SELECT sku FROM lotes WHERE sku LIKE $1 UNION SELECT sku FROM compra_recepcion WHERE sku LIKE $1`, [`${pref}%`]);
  const n = Math.max(0, ...rows.map((r) => +r.sku.slice(pref.length) || 0)) + 1 + extra;
  return pref + String(n).padStart(3, '0');
}

/** Valor de lo recibido (sin transporte). */
export async function valorRecibido(c, compraId) {
  const { rows } = await c.query(
    `SELECT COALESCE(sum(r.cantidad * l.precio), 0) AS v FROM compra_recepcion r
       JOIN compra_lineas l ON l.compra_id = r.compra_id AND l.mp_id = r.mp_id WHERE r.compra_id = $1`, [compraId]);
  return r2(rows[0].v);
}

/**
 * El gerente acepta la mercancía: el stock sube por lote, se ajusta la factura a lo recibido
 * y lo pendiente sigue en camino con 10–20 % de descuento o se cancela.
 */
export async function aceptarMercancia(c, compraId, u, pendiente) {
  const k = await cfg(c);
  const t = ahora();
  const cp = await compraParaCambiar(c, compraId);
  si(cp.estado !== 'Recibida', 'Esta mercancía ya fue decidida');
  const { rows: lineas } = await c.query('SELECT * FROM compra_lineas WHERE compra_id = $1', [cp.id]);
  const { rows: rec } = await c.query('SELECT * FROM compra_recepcion WHERE compra_id = $1', [cp.id]);
  let parcial = false;
  for (const l of lineas) {
    const recibido = r2(sum(rec.filter((x) => x.mp_id === l.mp_id), (x) => x.cantidad));
    if (recibido < l.cantidad - 1e-9) parcial = true;
    await c.query('UPDATE compra_lineas SET recibido = $2 WHERE id = $1', [l.id, recibido]);
  }
  for (const x of rec) {
    const l = lineas.find((z) => z.mp_id === x.mp_id);
    await c.query(
      `INSERT INTO lotes (sku, mp_id, sucursal_id, proveedor_id, compra_id, fecha_compra, vence, cantidad, precio, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Disponible')`,
      [x.sku, x.mp_id, cp.sucursal_id, cp.proveedor_id, cp.id, ts(t), ts(x.vence), x.cantidad, l.precio]);
  }
  await c.query(`UPDATE compras SET estado = 'Aceptada', aceptada_por = $2, aceptada_fecha = $3, parcial = $4 WHERE id = $1`, [cp.id, u.id, ts(t), parcial]);
  if (cp.factura_id) {
    await ajusteFactura(c, cp.factura_id, cp.proveedor_id, r2((await valorRecibido(c, cp.id)) + (cp.pendiente_de ? 0 : cp.transporte || 0)),
      `Recepción ${parcial ? 'parcial' : 'completa'}`);
  }
  if (parcial && pendiente === 'seguir') {
    const pct = Math.round(rnd(k.desc_pendiente_min, k.desc_pendiente_max));
    const falta = lineas.map((l) => {
      const recibido = sum(rec.filter((x) => x.mp_id === l.mp_id), (x) => x.cantidad);
      const base = l.precio_anterior || l.precio;
      return { mp: l.mp_id, cant: r2(l.cantidad - recibido), base, precio: r2(base * (1 - pct / 100)) };
    }).filter((l) => l.cant > 1e-9);
    const subtotal = r2(sum(falta, (l) => l.cant * l.precio));
    const { prom, llegada } = await horaLlegada(c, t, cp.entrega_h);
    const { rows: ins } = await c.query(
      `INSERT INTO compras (sucursal_id, proveedor_id, estado, creada, creada_por, condicion_pago, transporte, entrega_h, cot_creada, cot_vence,
                            subtotal, total, gerente_id, gerente_fecha, gg_id, gg_fecha, enviada, prometida, llegada, pendiente_de, desc_pendiente)
       VALUES ($1,$2,'En camino',$3,$4,$5,0,$6,$7,$8,$9,$9,$10,$11,$12,$13,$3,$14,$15,$16,$17) RETURNING id`,
      [cp.sucursal_id, cp.proveedor_id, ts(t), cp.creada_por, cp.condicion_pago, cp.entrega_h, cp.cot_creada, cp.cot_vence, subtotal,
        cp.gerente_id, cp.gerente_fecha, cp.gg_id, cp.gg_fecha, ts(prom), ts(llegada), cp.id, pct]);
    for (const l of falta) await c.query('INSERT INTO compra_lineas (compra_id, mp_id, cantidad, precio, precio_anterior) VALUES ($1,$2,$3,$4,$5)', [ins[0].id, l.mp, l.cant, l.precio, l.base]);
    await crearFactura(c, ins[0].id);
    await notificar(c, 'bodega', cp.sucursal_id, 'Lo pendiente sigue en camino', `Con ${pct} % de descuento`);
  } else if (parcial) {
    await c.query(`UPDATE compras SET detalle = detalle || '{"pendiente":"cancelado"}' WHERE id = $1`, [cp.id]);
  }
  return parcial;
}

/** Agrega datos a compras.detalle (cancelación, devolución, descuento, rechazo…). */
export const detalle = (c, id, obj) => c.query('UPDATE compras SET detalle = detalle || $2::jsonb WHERE id = $1', [id, JSON.stringify(obj)]);

/**
 * El gerente general acepta: se confirma con el proveedor, sale una sola factura por toda la solicitud
 * (cuenta por pagar si es a crédito) y la compra queda en camino con su hora de llegada simulada.
 */
export async function aceptarGG(c, cp, u) {
  const t = ahora();
  const { prom, llegada } = await horaLlegada(c, t, cp.entrega_h);
  await c.query(`UPDATE compras SET estado = 'En camino', gg_id = $2, gg_fecha = $3, enviada = $3, prometida = $4, llegada = $5, llego = FALSE WHERE id = $1`,
    [cp.id, u.id, ts(t), ts(prom), ts(llegada)]);
  const fid = await crearFactura(c, cp.id);
  const { rows } = await c.query('SELECT v.nombre, f.num FROM proveedores v, facturas f WHERE v.id = $1 AND f.id = $2', [cp.proveedor_id, fid]);
  const { rows: ls } = await c.query('SELECT m.nombre, l.cantidad FROM compra_lineas l JOIN materias_primas m ON m.id = l.mp_id WHERE l.compra_id = $1 ORDER BY l.id', [cp.id]);
  const llega = cp.entrega_h < 48 ? `${cp.entrega_h} h` : `${cp.entrega_h / 24} días`;
  await notificar(c, 'rrhh', null, 'Factura de proveedor por archivar', `${rows[0].nombre} · ${rows[0].num}`);
  await notificar(c, 'bodega', cp.sucursal_id, 'Compra en camino', `${rows[0].nombre} · llega en ${llega}`);
  await notificar(c, 'gerente', cp.sucursal_id, 'Compra aceptada por gerencia general', ls.map((l) => `${l.nombre} ×${l.cantidad}`).join(', '));
  return fid;
}

/** Pérdida de la sucursal por devolver o cancelar una compra (queda en Mermas). */
export async function perdidaCompra(c, { suc, tipo, compra, motivo, costo, por }) {
  await c.query(`INSERT INTO mermas (sucursal_id, fecha, tipo, motivo, costo, registro_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [suc, ts(ahora()), tipo, `Compra #${compra}: ${motivo}`, costo, por ?? null]);
}
