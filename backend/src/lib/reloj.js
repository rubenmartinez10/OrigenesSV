import { q } from '../db.js';

/*
 * Reloj simulado. Se guarda en la tabla «sistema»:
 *   hora = reloj_base + (hora_real − real_base)      (pausado = false)
 *   hora = reloj_base                                  (pausado = true)
 * Como en el borrador, el tiempo solo corre mientras alguien usa la app: si nadie hace
 * peticiones durante PAUSA_MS, el reloj se congela y sigue donde quedó al volver.
 * También se puede adelantar (+1 hora, +1 día…).
 */
export const H = 36e5;
export const D = 864e5;
const SV = -6 * H; // El Salvador: UTC−6 todo el año (sin horario de verano)
const PAUSA_MS = 2 * 60e3;

let offset = 0;
let congelado = null; // hora simulada mientras está en pausa
let actividad = Date.now();

export const ahora = () => (congelado != null ? congelado : Date.now() + offset);
export const enPausa = () => congelado != null;

async function guardar(sim, pausado) {
  await q(`UPDATE sistema SET reloj_base = to_timestamp($1 / 1000.0), real_base = to_timestamp($2 / 1000.0),
             pausado = $3, actualizado = now() WHERE id = 1`, [sim, Date.now(), pausado]);
}

/** Al arrancar: retoma desde la última hora vista (no cuenta el tiempo con el servidor apagado). */
export async function cargarReloj() {
  const { rows } = await q('SELECT reloj_base, real_base, actualizado, pausado FROM sistema WHERE id = 1');
  const s = rows[0];
  const sim = s.pausado ? s.reloj_base : s.reloj_base + (s.actualizado - s.real_base);
  congelado = sim;
  offset = 0;
  await guardar(sim, true);
}

/** Cada petición a la API cuenta como actividad; si el reloj estaba en pausa, vuelve a correr. */
export async function marcarActividad() {
  actividad = Date.now();
  if (congelado == null) return;
  const sim = congelado;
  offset = sim - Date.now();
  congelado = null;
  await guardar(sim, false);
}

/** Se llama periódicamente: guarda la hora (latido) o congela el reloj si no hay actividad. */
export async function latido() {
  if (congelado != null) return false;
  if (Date.now() - actividad > PAUSA_MS) {
    congelado = ahora();
    await guardar(congelado, true);
    return false;
  }
  await q('UPDATE sistema SET actualizado = now() WHERE id = 1');
  return true;
}

export async function adelantar(ms) {
  const sim = ahora() + ms;
  if (congelado != null) congelado = sim; else offset += ms;
  await guardar(sim, congelado != null);
}

/* ---- fechas en hora de El Salvador, sin depender de la zona del servidor ---- */
const local = (t) => new Date(t + SV);
export const inicioDia = (t) => Math.floor((t + SV) / D) * D - SV;
export const horaDelDia = (t) => { const d = local(t); return d.getUTCHours() + d.getUTCMinutes() / 60; };
export const diaSemana = (t) => (local(t).getUTCDay() + 6) % 7; // 0 = lunes
export const lunes = (t) => inicioDia(t) - diaSemana(t) * D;
export const semanaKey = (t) => local(lunes(t)).toISOString().slice(0, 10);

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dos = (n) => String(n).padStart(2, '0');
/** «22 nov · 09:20» */
export function fmt(t) {
  const d = local(t);
  return `${d.getUTCDate()} ${MES[d.getUTCMonth()]} · ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`;
}
/** «24 nov 2026» */
export function fFecha(t) {
  const d = local(t);
  return `${d.getUTCDate()} ${MES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
