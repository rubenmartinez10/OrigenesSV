import { ts } from '../db.js';
import { ahora, D, inicioDia } from './reloj.js';
import { r2, sum } from './negocio.js';

/* Datos de los tableros del gerente general y del director (ventas por día, por sucursal, por categoría y productos). */
const local = (t) => new Date(t - 6 * 36e5);

export function rangos(per, t = ahora()) {
  const h = inicioDia(t);
  if (per === '7 días' || per === '7') return [[h - 6 * D, h + D], [h - 13 * D, h - 6 * D]];
  if (per === '30 días' || per === '30') return [[h - 29 * D, h + D], [h - 59 * D, h - 29 * D]];
  return [[h, t + 1], [h - D, t + 1 - D]];
}

/** Ventas netas (total menos devoluciones) entre a y b. */
export async function ventasRango(c, s, a, b) {
  const { rows } = await c.query(
    `SELECT v.sucursal_id, v.fecha, v.total - COALESCE((SELECT sum(x.monto) FROM venta_ajustes x WHERE x.venta_id = v.id), 0) AS neto
       FROM ventas v WHERE ($1::int IS NULL OR v.sucursal_id = $1) AND v.fecha >= $2 AND v.fecha < $3`, [s ?? null, ts(a), ts(b)]);
  return rows;
}

/** Gastos: facturas de proveedores emitidas y reportes de pago aprobados. */
export async function gastos(c, s, a, b) {
  const { rows } = await c.query(
    `SELECT COALESCE((SELECT sum(monto) FROM facturas WHERE ($1::int IS NULL OR sucursal_id = $1) AND emitida >= $2 AND emitida < $3), 0)
          + COALESCE((SELECT sum(total) FROM reportes_pago WHERE estado = 'Aprobado' AND ($1::int IS NULL OR sucursal_id = $1)
                        AND COALESCE(decidido, fecha) >= $2 AND COALESCE(decidido, fecha) < $3), 0) AS g`, [s ?? null, ts(a), ts(b)]);
  return r2(rows[0].g);
}

/** Serie de ventas por día de los últimos n días. */
export async function porDia(c, s, n, t = ahora()) {
  const h = inicioDia(t);
  const L = await ventasRango(c, s, h - (n - 1) * D, h + D);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const a = h - i * D;
    const d = local(a);
    out.push({ l: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, v: r2(sum(L.filter((x) => x.fecha >= a && x.fecha < a + D), (x) => x.neto)) });
  }
  return out;
}

export const totalDe = (L, s) => r2(sum(L.filter((x) => !s || x.sucursal_id === s), (x) => x.neto));
