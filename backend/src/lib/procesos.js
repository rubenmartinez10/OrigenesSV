import { tx, ts } from '../db.js';
import { ahora, D, H, fFecha } from './reloj.js';
import { bitacoraSistema, notificar } from './registro.js';
import { cfg, r2, sum, recetas, costosMP, costosTope, costoReceta, neto } from './negocio.js';

/*
 * Procesos que mueve el reloj simulado (equivale a F.tick del borrador).
 * Se ejecutan cada pocos segundos y cada vez que alguien adelanta el tiempo.
 */
const VAR_PRECIOS = 0.06;
const rnd = (a, b) => a + Math.random() * (b - a);

export async function correrProcesos() {
  return tx(async (c) => {
    const { rows } = await c.query('SELECT pg_try_advisory_xact_lock(4242) AS ok');
    if (!rows[0].ok) return; // otro proceso ya está corriendo
    const b = ahora();
    const k = await cfg(c);
    await preciosSemanales(c, b, k);
    await llegadasYCotizaciones(c, b);
    await lotesVencidos(c, b, k);
    await ofertas(c, b, k);
    await aumentosPorAntiguedad(c, b, k);
    await avisosLotes(c, b, k);
    await stockBajoYPrecios(c, b, k);
    await cierresOrdenados(c, b);
  });
}

/* ---------- precios y transporte de proveedores: cada semana simulada ---------- */
async function preciosSemanales(c, b, k) {
  const semanaMs = k.semana_dias * D;
  const sem = Math.floor(b / semanaMs);
  const { rows } = await c.query('SELECT semana_aplicada FROM sistema WHERE id = 1');
  let sa = rows[0].semana_aplicada ?? sem;
  for (let n = 0; sa < sem && n < 8; n++) {
    sa += 1;
    await actualizarPrecios(c, sa * semanaMs);
  }
  if (sem - sa > 8) sa = sem;
  await c.query('UPDATE sistema SET semana_aplicada = $1 WHERE id = 1', [sa]);
}

async function actualizarPrecios(c, t) {
  const { rows: pm } = await c.query('SELECT proveedor_id, mp_id, precio_base, precio_actual FROM proveedor_materias');
  for (const r of pm) {
    const nuevo = r2(Math.max(0.01, r.precio_base * (1 + rnd(-VAR_PRECIOS, VAR_PRECIOS * 1.2))));
    if (nuevo === r.precio_actual) continue;
    await c.query('UPDATE proveedor_precios_hist SET hasta = $3 WHERE proveedor_id = $1 AND mp_id = $2 AND hasta IS NULL', [r.proveedor_id, r.mp_id, ts(t)]);
    await c.query('INSERT INTO proveedor_precios_hist (proveedor_id, mp_id, precio, desde) VALUES ($1,$2,$3,$4)', [r.proveedor_id, r.mp_id, nuevo, ts(t)]);
    await c.query('UPDATE proveedor_materias SET precio_actual = $3 WHERE proveedor_id = $1 AND mp_id = $2', [r.proveedor_id, r.mp_id, nuevo]);
  }
  const { rows: tr } = await c.query('SELECT proveedor_id, sucursal_id, transporte_min, transporte_max FROM proveedor_sucursales');
  for (const r of tr) {
    const nuevo = r2(rnd(r.transporte_min, r.transporte_max));
    await c.query('UPDATE proveedor_transporte_hist SET hasta = $3 WHERE proveedor_id = $1 AND sucursal_id = $2 AND hasta IS NULL', [r.proveedor_id, r.sucursal_id, ts(t)]);
    await c.query('INSERT INTO proveedor_transporte_hist (proveedor_id, sucursal_id, costo, desde) VALUES ($1,$2,$3,$4)', [r.proveedor_id, r.sucursal_id, nuevo, ts(t)]);
    await c.query('UPDATE proveedor_sucursales SET transporte = $3 WHERE proveedor_id = $1 AND sucursal_id = $2', [r.proveedor_id, r.sucursal_id, nuevo]);
  }
}

/* ---------- compras: llegada de mercancía y cotizaciones vencidas ---------- */
async function llegadasYCotizaciones(c, b) {
  const { rows: llegan } = await c.query(
    `SELECT c.*, v.nombre AS prov_nombre, v.politica_tipo, v.politica_tolerancia_h, v.politica_escala, v.politica_tope
       FROM compras c JOIN proveedores v ON v.id = c.proveedor_id
      WHERE c.estado = 'En camino' AND NOT c.llego AND c.llegada <= $1`, [ts(b)]);
  for (const cp of llegan) await alLlegar(c, cp);

  const { rows: vencidas } = await c.query(
    `SELECT c.id, c.sucursal_id FROM compras c
      WHERE c.estado IN ('Preparada','Aceptada por gerente') AND c.cot_vence <= $1`, [ts(b)]);
  for (const cp of vencidas) {
    await c.query(
      `UPDATE compras SET estado = 'Cancelada',
              detalle = detalle || jsonb_build_object('cancelada', jsonb_build_object('por','Sistema','motivo','Cotización vencida','fecha',$2::bigint))
        WHERE id = $1`, [cp.id, b]);
    const resumen = await resumenCompra(c, cp.id);
    await notificar(c, 'bodega', cp.sucursal_id, 'Solicitud cancelada: cotización vencida', resumen);
    await notificar(c, 'gerente', cp.sucursal_id, 'Solicitud cancelada: cotización vencida', resumen);
  }
}

export async function resumenCompra(c, compraId) {
  const { rows } = await c.query(
    `SELECT m.nombre, l.cantidad FROM compra_lineas l JOIN materias_primas m ON m.id = l.mp_id WHERE l.compra_id = $1 ORDER BY l.id`, [compraId]);
  return rows.map((r) => `${r.nombre} ×${r.cantidad}`).join(', ');
}

/** Compensación por retraso según la política del proveedor. */
function compensacion(cp) {
  const atraso = cp.llegada - cp.prometida;
  const tol = cp.politica_tolerancia_h * H;
  if (atraso <= tol) return null;
  const dias = Math.ceil((atraso - tol) / D);
  const pct = Math.min(cp.politica_tope, cp.politica_escala * dias);
  if (cp.politica_tipo === 'Descuento') return { tipo: 'Descuento', dias, pct };
  if (cp.politica_tipo === 'Indemnización') return { tipo: 'Indemnización', dias, monto: Math.min(cp.politica_tope, cp.politica_escala * dias) };
  return { tipo: 'Reembolso', dias, pct, monto: r2((cp.subtotal * pct) / 100) };
}

async function alLlegar(c, cp) {
  await c.query('UPDATE compras SET llego = TRUE WHERE id = $1', [cp.id]);
  const k = compensacion(cp);
  if (k) {
    await c.query('UPDATE compras SET atraso = $2 WHERE id = $1', [cp.id, JSON.stringify(k)]);
    if (k.tipo === 'Descuento') {
      await c.query('UPDATE compra_lineas SET precio_anterior = precio, precio = round(precio * (1 - $2::numeric / 100), 2) WHERE compra_id = $1', [cp.id, k.pct]);
      const { rows } = await c.query('SELECT sum(cantidad * precio) AS s FROM compra_lineas WHERE compra_id = $1', [cp.id]);
      const subtotal = r2(rows[0].s || 0);
      const total = r2(subtotal + (cp.transporte || 0));
      await c.query('UPDATE compras SET subtotal_anterior = subtotal, subtotal = $2, total = $3 WHERE id = $1', [cp.id, subtotal, total]);
      if (cp.factura_id) await ajusteFactura(c, cp.factura_id, cp.proveedor_id, total, 'Descuento por retraso');
    } else if (cp.factura_id) {
      await creditoFactura(c, cp.factura_id, cp.proveedor_id, k.tipo, k.monto, `Retraso de ${k.dias} día(s)`);
    }
  }
  await notificar(c, 'bodega', cp.sucursal_id, 'Llegó la mercancía', cp.prov_nombre + (k ? ' · con retraso' : ''));
}

export async function ajusteFactura(c, facturaId, proveedorId, nuevo, motivo) {
  const { rows } = await c.query('SELECT monto, estado FROM facturas WHERE id = $1', [facturaId]);
  const f = rows[0];
  if (!f) return;
  const dif = r2(f.monto - nuevo);
  if (dif <= 0) return;
  await c.query('UPDATE facturas SET monto = $2 WHERE id = $1', [facturaId, nuevo]);
  if (f.estado === 'Pagada') {
    await c.query('UPDATE proveedores SET saldo_favor = saldo_favor + $2 WHERE id = $1', [proveedorId, dif]);
    await c.query('INSERT INTO proveedor_creditos (proveedor_id, factura_id, fecha, tipo, monto, motivo) VALUES ($1,$2,$3,$4,$5,$6)',
      [proveedorId, facturaId, ts(ahora()), 'Ajuste por recepción', dif, motivo]);
  }
}

export async function creditoFactura(c, facturaId, proveedorId, tipo, monto, motivo) {
  const { rows } = await c.query('SELECT estado FROM facturas WHERE id = $1', [facturaId]);
  if (!rows[0]) return;
  if (rows[0].estado === 'Pagada') {
    await c.query('UPDATE proveedores SET saldo_favor = saldo_favor + $2 WHERE id = $1', [proveedorId, monto]);
    await c.query('INSERT INTO proveedor_creditos (proveedor_id, factura_id, fecha, tipo, monto, motivo) VALUES ($1,$2,$3,$4,$5,$6)',
      [proveedorId, facturaId, ts(ahora()), tipo, monto, motivo]);
  } else {
    await c.query('INSERT INTO factura_creditos (factura_id, tipo, monto, fecha, motivo) VALUES ($1,$2,$3,$4,$5)', [facturaId, tipo, monto, ts(ahora()), motivo]);
  }
}

/* ---------- lotes vencidos → pérdida; estado de cada lote ---------- */
async function lotesVencidos(c, b, k) {
  const { rows } = await c.query(
    `SELECT l.id, l.sku, l.mp_id, l.sucursal_id, l.cantidad, l.precio, m.nombre, m.unidad
       FROM lotes l JOIN materias_primas m ON m.id = l.mp_id
      WHERE l.vence <= $1 AND l.cantidad > 1e-9 FOR UPDATE OF l`, [ts(b)]);
  for (const l of rows) {
    await c.query(
      `INSERT INTO mermas (sucursal_id, fecha, tipo, mp_id, lote_id, cantidad, motivo, costo, automatica)
       VALUES ($1,$2,'Vencido',$3,$4,$5,'Vencido',$6,TRUE)`,
      [l.sucursal_id, ts(b), l.mp_id, l.id, l.cantidad, r2(l.cantidad * l.precio)]);
    await bitacoraSistema(c, 'lote.vencido', l.sku, `${l.nombre} ${l.cantidad} ${l.unidad} pasó a pérdida`, l.sucursal_id);
    await c.query(`UPDATE lotes SET perdido = cantidad, cantidad = 0, estado = 'Vencido' WHERE id = $1`, [l.id]);
  }
  await c.query(
    `UPDATE lotes SET estado = CASE
        WHEN cantidad <= 1e-9 THEN CASE WHEN vence <= $1 AND perdido > 0 THEN 'Vencido' ELSE 'Agotado' END
        WHEN vence <= $1 THEN 'Vencido'
        WHEN vence - $1 <= $2 * interval '1 day' THEN 'Por vencer'
        ELSE 'Disponible' END`, [ts(b), k.por_vencer_dias]);
}

/* ---------- ofertas por lote por vencer ---------- */
async function ofertas(c, b, k) {
  // caducadas (sin respuesta del gerente) y terminadas (se acabó o venció el lote)
  const { rows: abiertas } = await c.query(
    `SELECT o.id, o.estado, o.sucursal_id, l.sku, l.cantidad, l.vence
       FROM ofertas o JOIN lotes l ON l.id = o.lote_id WHERE o.estado IN ('Pendiente','Activa')`);
  for (const o of abiertas) {
    if (o.estado === 'Pendiente' && o.vence <= b) {
      await c.query(`UPDATE ofertas SET estado = 'Caducada', cierre = $2 WHERE id = $1`, [o.id, ts(b)]);
      await bitacoraSistema(c, 'oferta.caducada', o.sku, 'Sin respuesta del gerente antes del vencimiento', o.sucursal_id);
    } else if (o.estado === 'Activa' && (o.cantidad <= 1e-9 || o.vence <= b)) {
      await c.query(`UPDATE ofertas SET estado = 'Terminada', cierre = $2 WHERE id = $1`, [o.id, ts(b)]);
      await bitacoraSistema(c, 'oferta.terminada', o.sku, o.cantidad <= 1e-9 ? 'Se acabó el ingrediente del lote' : 'Llegó el vencimiento del lote', o.sucursal_id);
    }
  }
  // nuevas: lotes a menos de «oferta_dias» de vencer, sin oferta todavía
  const { rows: lotes } = await c.query(
    `SELECT l.id, l.sku, l.mp_id, l.sucursal_id, l.vence, m.nombre FROM lotes l JOIN materias_primas m ON m.id = l.mp_id
      WHERE l.cantidad > 1e-9 AND l.vence > $1 AND l.vence - $1 <= $2 * interval '1 day'
        AND NOT EXISTS (SELECT 1 FROM ofertas o WHERE o.lote_id = l.id)`, [ts(b), k.oferta_dias]);
  if (!lotes.length) return;
  const rec = await recetas(c);
  const costosPorSuc = {};
  for (const l of lotes) {
    const { rows: prods } = await c.query(
      `SELECT p.id, p.precio FROM productos p JOIN sucursal_menu sm ON sm.producto_id = p.id AND sm.sucursal_id = $1
        WHERE NOT p.es_extra AND p.estado = 'Activo'
          AND EXISTS (SELECT 1 FROM recetas r WHERE r.producto_id = p.id AND r.mp_id = $2) ORDER BY p.id`, [l.sucursal_id, l.mp_id]);
    if (!prods.length) continue;
    costosPorSuc[l.sucursal_id] ||= await costosMP(c, l.sucursal_id, b);
    let mx = k.oferta_max_pct;
    for (const p of prods) mx = Math.min(mx, Math.floor((1 - costoReceta(rec[p.id], costosPorSuc[l.sucursal_id]) / neto(p.precio, k)) * 100) - 1);
    if (mx < 2) continue;
    const { rows: ins } = await c.query(
      `INSERT INTO ofertas (sucursal_id, lote_id, mp_id, pct_sugerido, pct_max, creada, vence)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [l.sucursal_id, l.id, l.mp_id, Math.max(1, Math.round(mx * 0.6)), mx, ts(b), ts(l.vence)]);
    for (const p of prods) await c.query('INSERT INTO oferta_productos (oferta_id, producto_id) VALUES ($1,$2)', [ins[0].id, p.id]);
    await notificar(c, 'gerente', l.sucursal_id, 'Oferta por lote por vencer', `${l.nombre} · lote ${l.sku}`);
  }
}

/* ---------- aumentos automáticos por antigüedad ---------- */
async function aumentosPorAntiguedad(c, b, k) {
  const { rows } = await c.query(
    `SELECT u.id, u.ingreso, u.antig_aplicada, u.extra_antiguedad, r.salario
       FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.estado = 'Activo'`);
  for (const u of rows) {
    const anios = Math.floor((b - u.ingreso) / (365.25 * D));
    let aplicada = u.antig_aplicada;
    let extra = u.extra_antiguedad;
    while (aplicada < anios) {
      aplicada += 1;
      const antes = r2(u.salario + extra);
      extra = r2(extra + (u.salario * k.antiguedad_pct) / 100);
      const despues = r2(u.salario + extra);
      await c.query('INSERT INTO aumentos (usuario_id, fecha, anios, antes, despues) VALUES ($1,$2,$3,$4,$5)', [u.id, ts(b), aplicada, antes, despues]);
      await c.query(`INSERT INTO usuario_historial (usuario_id, fecha, tipo, detalle, por) VALUES ($1,$2,'Aumento por antigüedad',$3,'Sistema')`,
        [u.id, ts(b), `${antes} → ${despues}`]);
    }
    if (aplicada !== u.antig_aplicada) {
      await c.query('UPDATE usuarios SET antig_aplicada = $2, extra_antiguedad = $3 WHERE id = $1', [u.id, aplicada, extra]);
    }
  }
}

/* ---------- aviso único de lote por vencer ---------- */
async function avisosLotes(c, b, k) {
  const { rows } = await c.query(
    `UPDATE lotes l SET avisado = TRUE FROM materias_primas m
      WHERE m.id = l.mp_id AND l.cantidad > 0 AND l.vence > $1 AND l.vence - $1 <= $2 * interval '1 day' AND NOT l.avisado
      RETURNING l.sucursal_id, l.sku, l.vence, m.nombre`, [ts(b), k.por_vencer_dias]);
  for (const l of rows) await notificar(c, 'bodega', l.sucursal_id, 'Lote por vencer', `${l.nombre} · ${l.sku} vence el ${fFecha(l.vence)}`);
}

/* ---------- stock bajo y «precio por revisar» por sucursal ---------- */
export async function minimosYStock(c, s, b, rec) {
  const { rows: prods } = await c.query(
    `SELECT p.id, p.es_extra, p.estado,
            EXISTS (SELECT 1 FROM sucursal_menu sm WHERE sm.sucursal_id = $1 AND sm.producto_id = p.id) AS en_menu,
            ARRAY(SELECT ep.producto_id FROM extra_productos ep WHERE ep.extra_id = p.id) AS prods
       FROM productos p`, [s]);
  const { rows: mats } = await c.query(
    `SELECT m.id, m.nombre, m.unidad, m.estado,
            COALESCE((SELECT sum(cantidad) FROM lotes l WHERE l.mp_id = m.id AND l.sucursal_id = $1 AND l.cantidad > 0 AND l.vence > $2), 0) AS stock
       FROM materias_primas m ORDER BY m.id`, [s, ts(b)]);
  const usan = prods.filter((p) => !p.es_extra && p.estado !== 'Inhabilitado' && p.en_menu);
  const extras = prods.filter((p) => p.es_extra && p.estado === 'Activo');
  return mats.map((m) => {
    const pr = usan.filter((p) => (rec[p.id] || []).some((r) => r.mp === m.id));
    const ids = pr.map((p) => p.id);
    let minimo = sum(pr, (p) => sum((rec[p.id] || []).filter((r) => r.mp === m.id), (r) => r.cant)) * 10;
    for (const e of extras) if (e.prods.some((i) => ids.includes(i))) for (const r of (rec[e.id] || []).filter((x) => x.mp === m.id)) minimo += r.cant * 10;
    return { ...m, minimo: r2(minimo), usos: pr.length };
  });
}

async function stockBajoYPrecios(c, b, k) {
  const { rows: sucs } = await c.query(`SELECT id FROM sucursales WHERE estado = 'Operando'`);
  const rec = await recetas(c);
  for (const { id: s } of sucs) {
    const mats = await minimosYStock(c, s, b, rec);
    const bajos = mats.filter((m) => m.estado === 'Activo' && m.minimo > 0 && m.stock < m.minimo);
    const { rows: avisados } = await c.query('SELECT mp_id FROM avisos_stock WHERE sucursal_id = $1', [s]);
    const ya = new Set(avisados.map((r) => r.mp_id));
    for (const m of bajos.filter((x) => !ya.has(x.id))) {
      await notificar(c, 'bodega', s, 'Stock bajo', m.nombre);
      await c.query('INSERT INTO avisos_stock (sucursal_id, mp_id) VALUES ($1,$2)', [s, m.id]);
    }
    await c.query('DELETE FROM avisos_stock WHERE sucursal_id = $1 AND NOT (mp_id = ANY($2))', [s, bajos.map((m) => m.id)]);

    // productos cuyo costo tope alcanzó el precio de venta (sin IVA)
    const tope = await costosTope(c, s);
    const { rows: prods } = await c.query(
      `SELECT p.id, p.nombre, p.precio FROM productos p JOIN sucursal_menu sm ON sm.producto_id = p.id AND sm.sucursal_id = $1
        WHERE NOT p.es_extra AND p.estado = 'Activo'`, [s]);
    const rv = prods.filter((p) => neto(p.precio, k) <= costoReceta(rec[p.id], tope));
    const { rows: antes } = await c.query('SELECT producto_id FROM sucursal_revisar WHERE sucursal_id = $1', [s]);
    const previos = new Set(antes.map((r) => r.producto_id));
    for (const p of rv.filter((x) => !previos.has(x.id))) {
      await bitacoraSistema(c, 'precio.por_revisar', p.nombre, 'El costo alcanzó al precio de venta', s);
      await c.query('INSERT INTO sucursal_revisar (sucursal_id, producto_id) VALUES ($1,$2)', [s, p.id]);
    }
    await c.query('DELETE FROM sucursal_revisar WHERE sucursal_id = $1 AND NOT (producto_id = ANY($2))', [s, rv.map((p) => p.id)]);
  }
}

/* ---------- sucursal en «Cierre ordenado» sin pedidos ni cajas abiertas → Cerrada ---------- */
async function cierresOrdenados(c, b) {
  const { rows } = await c.query(
    `SELECT s.id, s.nombre FROM sucursales s WHERE s.estado = 'Cierre ordenado'
        AND NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.sucursal_id = s.id AND p.estado NOT IN ('Cobrado','Cancelado','Rechazado'))
        AND NOT EXISTS (SELECT 1 FROM cajas k WHERE k.sucursal_id = s.id AND k.estado = 'Abierta')`);
  for (const s of rows) {
    await c.query(`UPDATE sucursales SET estado = 'Cerrada', cerrada_en = $2 WHERE id = $1`, [s.id, ts(b)]);
    await c.query(`UPDATE vacantes SET estado = 'Cancelada' WHERE sucursal_id = $1 AND estado = 'Abierta'`, [s.id]);
    await bitacoraSistema(c, 'sucursal.cerrada', s.nombre, 'Sin pedidos ni cajas abiertas: la sucursal quedó cerrada', s.id);
  }
}
