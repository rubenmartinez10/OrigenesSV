import { ts } from '../db.js';
import { ahora } from './reloj.js';
import { r2 } from './negocio.js';
import { quincena, salarioDe, salarioRol } from './personal.js';

/*
 * Quincenas de pago (id «2026-11-2» = año-mes-mitad) en hora de El Salvador.
 * La planilla de cada quincena la genera Recursos Humanos; los reportes por sucursal los aprueba el gerente general.
 */
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const local = (t) => new Date(t - 6 * 36e5);
const dos = (n) => String(n).padStart(2, '0');

export function qActual(t = ahora()) {
  const d = local(t);
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${d.getUTCDate() > 15 ? 2 : 1}`;
}
export function qSiguiente(id) {
  let [y, m, h] = id.split('-').map(Number);
  if (h === 1) h = 2; else { h = 1; m += 1; if (m > 12) { m = 1; y += 1; } }
  return `${y}-${dos(m)}-${h}`;
}
export function qAnterior(id) {
  let [y, m, h] = id.split('-').map(Number);
  if (h === 2) h = 1; else { h = 2; m -= 1; if (m < 1) { m = 12; y -= 1; } }
  return `${y}-${dos(m)}-${h}`;
}
export function qLabel(id) {
  const [y, m, h] = id.split('-').map(Number);
  const fin = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${h === 1 ? '1.ª' : '2.ª'} quincena ${MES[m - 1]} ${y} · ${h === 1 ? '1–15' : `16–${fin}`} ${MES[m - 1]}`;
}
/** Las últimas n quincenas, la actual primero. */
export function quincenas(n = 6, t = ahora()) {
  const out = [];
  let q = qActual(t);
  for (let i = 0; i < n; i++) { out.push({ id: q, label: qLabel(q) }); q = qAnterior(q); }
  return out;
}

/** Fila de planilla de una persona activa. */
export async function filaPago(c, u) {
  const mensual = salarioDe(u, await salarioRol(c, u.rol_id));
  return { mensual, ...quincena(mensual) };
}

/** Genera la planilla de la quincena y un reporte de pago por sucursal (y otro para gerencia central). */
export async function generarPlanilla(c, q) {
  const t = ahora();
  const { rows: ins } = await c.query('INSERT INTO planillas (quincena, generada) VALUES ($1,$2) RETURNING id', [q, ts(t)]);
  const pid = ins[0].id;
  const { rows: us } = await c.query(`SELECT * FROM usuarios WHERE estado = 'Activo' ORDER BY id`);
  const grupos = new Map();
  for (const u of us) {
    const f = await filaPago(c, u);
    await c.query(
      `INSERT INTO planilla_filas (planilla_id, usuario_id, nombre, rol_id, sucursal_id, mensual, bruto, isss, afp, renta, liquido, base)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [pid, u.id, u.nombre, u.rol_id, u.sucursal_id, f.mensual, f.bruto, f.isss, f.afp, f.renta, f.liquido, f.base]);
    const k = u.sucursal_id ?? 0;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }
  for (const [k, L] of grupos) {
    await c.query('INSERT INTO reportes_pago (planilla_id, sucursal_id, personas, total, fecha) VALUES ($1,$2,$3,$4,$5)',
      [pid, k || null, L.length, r2(L.reduce((a, f) => a + f.liquido, 0)), ts(t)]);
  }
  return pid;
}

export const filaJson = (f) => ({
  uid: f.usuario_id, nombre: f.nombre, rol: f.rol_id, suc: f.sucursal_id, mensual: f.mensual, bruto: f.bruto,
  isss: f.isss, afp: f.afp, renta: f.renta, liquido: f.liquido, base: f.base,
});

/** «Mis pagos»: los ya generados y las próximas quincenas con sus descuentos. */
export async function pagosDe(c, u, n = 3) {
  const { rows } = await c.query(
    `SELECT p.quincena, f.* FROM planilla_filas f JOIN planillas p ON p.id = f.planilla_id WHERE f.usuario_id = $1 ORDER BY p.quincena DESC`, [u.id]);
  const { rows: gen } = await c.query('SELECT quincena FROM planillas');
  const hechas = new Set(gen.map((x) => x.quincena));
  const prox = [];
  let q = qActual();
  const f = await filaPago(c, u);
  for (let i = 0; prox.length < n && i < 8; i++) {
    if (!hechas.has(q)) prox.push({ q, label: qLabel(q), ...f });
    q = qSiguiente(q);
  }
  return { hechos: rows.map((x) => ({ q: x.quincena, label: qLabel(x.quincena), ...filaJson(x) })), prox };
}
