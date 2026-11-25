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

/** Tendencia de productos: unidades e ingresos del periodo, puesto y cambio frente al periodo anterior.
 *  Con `s` nulo (toda la franquicia) añade el puesto del producto en cada sucursal. */
export async function tendencia(c, s, per, t = ahora()) {
  const [[a, b], [pa, pb]] = rangos(per, t);
  const SQL = `SELECT v.sucursal_id AS suc, l.producto_id AS id, max(l.nombre) AS nombre, sum(l.cantidad)::int AS u, sum(l.precio_unit * l.cantidad) AS ing
                 FROM ventas v JOIN pedido_lineas l ON l.pedido_id = v.pedido_id
                WHERE ($1::int IS NULL OR v.sucursal_id = $1) AND v.fecha >= $2 AND v.fecha < $3 GROUP BY 1, 2`;
  const { rows: act } = await c.query(SQL, [s ?? null, ts(a), ts(b)]);
  const { rows: ant } = await c.query(SQL, [s ?? null, ts(pa), ts(pb)]);
  const total = (rows) => {
    const m = {};
    for (const x of rows) { const o = (m[x.id] ||= { id: x.id, nombre: x.nombre, u: 0, ing: 0 }); o.u += x.u; o.ing += +x.ing; }
    return Object.values(m).sort((p, q) => q.u - p.u || q.ing - p.ing || p.id - q.id);
  };
  const A = total(act);
  const prev = {};
  total(ant).forEach((x, i) => { prev[x.id] = { u: x.u, puesto: i + 1 }; });
  const { rows: pr } = await c.query(
    `SELECT p.id, p.foto_url AS foto, (SELECT array_agg(cg.nombre ORDER BY cg.id) FROM producto_categorias pc JOIN categorias cg ON cg.id = pc.categoria_id WHERE pc.producto_id = p.id) AS categorias,
            (p.estado IN ('Eliminado','Inhabilitado') OR NOT EXISTS (SELECT 1 FROM sucursal_menu sm WHERE sm.producto_id = p.id AND ($1::int IS NULL OR sm.sucursal_id = $1))) AS retirado FROM productos p`, [s ?? null]);
  const info = Object.fromEntries(pr.map((x) => [x.id, x]));
  const { rows: sucs } = await c.query('SELECT id, nombre FROM sucursales');
  const nomS = Object.fromEntries(sucs.map((x) => [x.id, x.nombre]));
  const porSuc = {};
  if (s == null) {
    const bySuc = {};
    for (const x of act) (bySuc[x.suc] ||= []).push(x);
    for (const [sid, L] of Object.entries(bySuc)) {
      L.sort((p, q) => q.u - p.u || q.ing - p.ing || p.id - q.id).forEach((x, i) => { (porSuc[x.id] ||= []).push({ id: +sid, nombre: nomS[sid], u: x.u, puesto: i + 1 }); });
    }
  }
  return {
    desde: a, hasta: b, total: A.length, hayAnt: ant.length > 0,
    items: A.slice(0, 20).map((x, i) => {
      const p = prev[x.id];
      return {
        id: x.id, nombre: x.nombre, foto: info[x.id]?.foto || null, categorias: info[x.id]?.categorias || [], retirado: !!info[x.id]?.retirado, puesto: i + 1,
        unidades: x.u, ingresos: r2(x.ing), antUnidades: p ? p.u : 0, cambio: p ? p.puesto - (i + 1) : null,
        sucursales: (porSuc[x.id] || []).sort((m, n) => m.puesto - n.puesto),
      };
    }),
  };
}
