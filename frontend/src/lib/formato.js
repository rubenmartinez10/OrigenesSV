/* Formatos de dinero y fechas. Las fechas se muestran en hora de El Salvador (UTC−6, sin horario de verano). */
export const H = 36e5;
export const D = 864e5;
const SV = -6 * H;
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dos = (n) => String(n).padStart(2, '0');
const local = (t) => new Date(t + SV);

/** $1.25 · −$0.50 */
export const $ = (n) => (n < 0 ? '−$' : '$') + Math.abs(+n || 0).toFixed(2);
export const r2 = (n) => Math.round(n * 100) / 100;

/** «22 nov · 09:20» */
export function fmt(t) {
  if (t == null) return '—';
  const d = local(t);
  return `${d.getUTCDate()} ${MES[d.getUTCMonth()]} · ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`;
}
/** «24 nov 2026» */
export function fFecha(t) {
  const d = local(t);
  return `${d.getUTCDate()} ${MES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** segundos → «mm:ss» */
export const fm = (s) => `${dos(Math.floor(s / 60))}:${dos(Math.floor(s % 60))}`;

export const inicioDia = (t) => Math.floor((t + SV) / D) * D - SV;
export const hora = (t) => local(t).getUTCHours();

/** Rango [desde, hasta) de un periodo del historial. */
export function periodo(k, ahora) {
  const h = inicioDia(ahora);
  return { Hoy: [h, 8.64e15], Ayer: [h - D, h], '7 días': [ahora - 7 * D, 8.64e15], Todos: [0, 8.64e15] }[k];
}

export const saludo = (t) => { const h = hora(t); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; };

/* validaciones de datos personales */
const digitos = (v) => String(v || '').replace(/\D/g, '');
export const fTel = (v) => { const d = digitos(v).slice(0, 8); return d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d; };
export const valTel = (v) => (/^\d{4}-\d{4}$/.test(v) ? '' : 'El teléfono debe tener 8 números con el formato 0000-0000');
export const valCorreo = (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim()) ? '' : 'El correo no es válido (ejemplo: nombre@correo.com)');
