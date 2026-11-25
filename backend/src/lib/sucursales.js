import { ts } from '../db.js';
import { ahora } from './reloj.js';
import { fallo } from './errores.js';
import { notificar } from './registro.js';
import { generarCondiciones } from './proveedores.js';
import { abrirVacantes, ROLES_SUC } from './personal.js';

/* Sucursales: costo según zona y tamaño, apertura con menú, proveedores y vacantes de máxima prioridad. */
export const TAM = { pequena: 'Pequeña', mediana: 'Mediana', grande: 'Grande' };

/** Intervalo del costo (en dólares) según la zona y el tamaño. */
export async function intervaloSuc(c, zona, tam) {
  const { rows } = await c.query(
    `SELECT z.costo_min, z.costo_max, t.factor_costo FROM zonas z, tamanos_sucursal t WHERE z.nombre = $1 AND t.id = $2`, [zona, tam]);
  if (!rows[0]) throw fallo('Elige una zona y un tamaño válidos');
  const { costo_min: a, costo_max: b, factor_costo: k } = rows[0];
  return [Math.round(a * k) * 1000, Math.round(b * k) * 1000];
}
export async function costoSuc(c, zona, tam) {
  const [a, b] = await intervaloSuc(c, zona, tam);
  return Math.round((a + Math.random() * (b - a)) / 1000) * 1000;
}

/** Pedidos y cajas abiertos (una sucursal no se vende con operaciones en curso). */
export async function abiertosSuc(c, s) {
  const { rows } = await c.query(
    `SELECT (SELECT count(*)::int FROM pedidos WHERE sucursal_id = $1 AND estado NOT IN ('Cobrado','Cancelado','Rechazado')) AS p,
            (SELECT count(*)::int FROM cajas WHERE sucursal_id = $1 AND estado = 'Abierta') AS c`, [s]);
  return rows[0];
}

/** Crea la sucursal: menú con todo el catálogo, plantilla mínima, condiciones de cada proveedor y vacantes. */
export async function crearSucursal(c, { zona, tamano, costo, propId }) {
  const t = ahora();
  const { rows: tm } = await c.query('SELECT mesas_base FROM tamanos_sucursal WHERE id = $1', [tamano]);
  if (!tm[0]) throw fallo('Elige un tamaño válido');
  const { rows: usadas } = await c.query('SELECT nombre FROM sucursales');
  const nombres = new Set(usadas.map((x) => x.nombre));
  let nombre = zona;
  for (let i = 2; nombres.has(nombre); i++) nombre = `${zona} ${i}`;
  const { rows } = await c.query(
    `INSERT INTO sucursales (nombre, zona, tamano, estado, mesas, direccion, costo, abierta_en) VALUES ($1,$2,$3,'Operando',$4,$2,$5,$6) RETURNING id`,
    [nombre, zona, tamano, tm[0].mesas_base, costo, ts(t)]);
  const sid = rows[0].id;
  await c.query(`INSERT INTO sucursal_menu (sucursal_id, producto_id) SELECT $1, id FROM productos WHERE NOT es_extra AND estado IN ('Activo','Precio por revisar')`, [sid]);
  await c.query('INSERT INTO sucursal_plantilla (sucursal_id, rol_id, cantidad) SELECT $1, rol_id, cantidad FROM plantilla_minima WHERE tamano = $2', [sid, tamano]);
  await c.query(`INSERT INTO sucursal_historial (sucursal_id, fecha, tipo, detalle, por) VALUES ($1,$2,'Apertura',$3,'Sistema')`, [sid, ts(t), `${zona} · ${TAM[tamano]}`]);
  const { rows: provs } = await c.query(`SELECT id FROM proveedores WHERE estado = 'Activo'`);
  for (const v of provs) await generarCondiciones(c, v.id, sid);
  const { rows: min } = await c.query('SELECT rol_id, cantidad FROM plantilla_minima WHERE tamano = $1 AND cantidad > 0', [tamano]);
  for (const r of ROLES_SUC) {
    const m = min.find((x) => x.rol_id === r);
    if (m) await abrirVacantes(c, sid, r, m.cantidad, 'Apertura de sucursal', 'Máxima', null);
  }
  if (propId) {
    await c.query(`UPDATE propuestas_sucursal SET estado = 'Abierta', sucursal_abierta_id = $2, apertura = $3 WHERE id = $1`, [propId, sid, ts(t)]);
  }
  await notificar(c, 'rrhh', null, 'Sucursal abierta: vacantes con máxima prioridad', nombre);
  return { sid, nombre };
}
