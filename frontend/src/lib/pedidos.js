/* Reglas de pedidos del lado de la interfaz (las mismas fórmulas del borrador y del backend). */

export const EN_CURSO = ['Creado', 'Aceptado', 'Asignado', 'Preparando', 'Listo'];
export const ETAPAS = ['Creado', 'Aceptado', 'Asignado', 'Preparando', 'Listo'];

/** «Pedido #12» o «Reposición #13» */
export const nom = (p) => `${p.rep ? 'Reposición' : 'Pedido'} #${p.num}`;
/** «Aquí · Mesa 4 · Ana» */
export const donde = (p) => (p.tipo === 'Aquí' ? 'Aquí' + (p.mesa ? ` · Mesa ${p.mesa}` : '') : p.tipo) + (p.ref ? ` · ${p.ref}` : '');
/** «2× Pupusa revuelta + Curtido, Salsa roja» */
export const txt = (l) => `${l.cant}× ${l.nombre}${l.extras?.length ? ` + ${l.extras.map((e) => e.nombre).join(', ')}` : ''}`;
export const resumen = (p) => p.lineas.map((l) => `${l.cant}× ${l.nombre}`).join(', ');

export const minutos = (s) => Math.ceil(s / 60);
export const margen = (cfg) => (cfg?.margenMin ?? 15) * 60;
export const est = (p) => p.estSeg;
export const lim = (p, cfg) => p.estSeg + margen(cfg);
/** Una sola línea de tiempo: desde que se hizo el pedido hasta que queda listo, se entrega, se cancela o se rechaza. */
export const seg = (p, ahora) => ((p.fin || p.entregado || p.canc || p.rechazo?.fecha || ahora) - p.creado) / 1000;
export const demora = (p, ahora, cfg) => ['Creado', 'Aceptado', 'Asignado', 'Preparando'].includes(p.estado) && seg(p, ahora) > lim(p, cfg);
export function punt(p, ahora, cfg) {
  const t = seg(p, ahora);
  return t <= est(p) ? ['A tiempo', 'ok'] : t <= lim(p, cfg) ? ['En margen', 'wa'] : ['Retrasado', 'er'];
}

/** Tiempo estimado de unas líneas (segundos). */
export function estimar(lineas, productos, cfg) {
  const fac = (n) => 1 + ((cfg?.extraUnidad ?? 35) / 100) * (n - 1);
  const tiempo = (id) => productos[id]?.tiempo || 0;
  return Math.round(lineas.reduce((a, l) => a + (tiempo(l.pr) + (l.extras || []).reduce((b, e) => b + tiempo(e), 0)) * fac(l.cant), 0) * 60);
}

/** Insumos que usan unas líneas [{pr, cant, extras:[id]}] */
export function uso(lineas, productos) {
  const u = {};
  const add = (m, n) => { u[m] = (u[m] || 0) + n; };
  for (const l of lineas) {
    for (const r of productos[l.pr]?.receta || []) add(r.mp, r.cant * l.cant);
    for (const e of l.extras || []) for (const r of productos[e]?.receta || []) add(r.mp, r.cant * l.cant);
  }
  return u;
}
export const cabe = (lineas, productos, disp) => {
  const u = uso(lineas, productos);
  return Object.keys(u).every((m) => u[m] <= (disp?.[m] || 0) + 1e-9);
};

export const precioCon = (precio, pct) => (pct ? +(precio * (1 - pct / 100)).toFixed(2) : precio);

/** Correlativo del documento: T-0001, F-0001, CCF-0001 */
export const corr = (v) => `${{ 'Ticket simple': 'T', 'Factura de consumidor final': 'F' }[v.tipo] || 'CCF'}-${String(v.corr).padStart(4, '0')}`;
