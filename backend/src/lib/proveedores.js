import { ts } from '../db.js';
import { ahora } from './reloj.js';
import { fallo, si } from './errores.js';
import { bitacora } from './registro.js';
import { r2 } from './negocio.js';
import { ROLN } from './personal.js';

/*
 * Proveedores: los registran Recursos Humanos, el gerente general y el director.
 * No se piden precios, transporte ni tiempos: el sistema los genera para cada materia prima y sucursal.
 */
const rnd = (a, b) => a + Math.random() * (b - a);
const TRANSP_VAR = 0.25;
export const PAGOS = ['Contado', '15 días', '30 días'];
export const POLITICAS = ['Descuento', 'Indemnización', 'Reembolso'];
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const politicaTxt = (v) => `${v.politica_tipo} · tolerancia ${v.politica_tolerancia_h} h · ${v.politica_tipo === 'Indemnización' ? `$${v.politica_escala} por día` : `${v.politica_escala} % por día`} · tope ${v.politica_tipo === 'Indemnización' ? `$${v.politica_tope}` : `${v.politica_tope} %`}`;

export async function cambio(c, provId, detalle) {
  await c.query('INSERT INTO proveedor_cambios (proveedor_id, fecha, detalle) VALUES ($1,$2,$3)', [provId, ts(ahora()), detalle]);
}

/** Tiempo de entrega y transporte de un proveedor para una sucursal. */
export async function generarCondiciones(c, provId, sucId) {
  const b = r2(2 + Math.random() * 2);
  const h = [24, 48, 72][Math.floor(Math.random() * 3)];
  await c.query(
    `INSERT INTO proveedor_sucursales (proveedor_id, sucursal_id, entrega_h, transporte, transporte_min, transporte_max) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT DO NOTHING`, [provId, sucId, h, b, r2(b * (1 - TRANSP_VAR)), r2(b * (1 + TRANSP_VAR))]);
  await c.query('INSERT INTO proveedor_transporte_hist (proveedor_id, sucursal_id, costo, desde) VALUES ($1,$2,$3,$4)', [provId, sucId, b, ts(ahora())]);
}

/** Precio inicial de una materia prima: cerca del que ya cobran otros proveedores. */
export async function altaPrecio(c, provId, mpId) {
  const { rows } = await c.query('SELECT avg(precio_base) AS ref FROM proveedor_materias WHERE mp_id = $1 AND proveedor_id <> $2', [mpId, provId]);
  const ref = rows[0].ref ? rows[0].ref * rnd(0.92, 1.1) : rnd(0.5, 3);
  const p = r2(Math.max(0.05, ref));
  await c.query(`INSERT INTO proveedor_materias (proveedor_id, mp_id, precio_base, precio_actual) VALUES ($1,$2,$3,$3)
                 ON CONFLICT (proveedor_id, mp_id) DO UPDATE SET precio_base = $3, precio_actual = $3`, [provId, mpId, p]);
  await c.query('INSERT INTO proveedor_precios_hist (proveedor_id, mp_id, precio, desde) VALUES ($1,$2,$3,$4)', [provId, mpId, p, ts(ahora())]);
}

/** Crea una materia prima propuesta en una receta («new:Nombre») o devuelve la que ya existe con ese nombre. */
export async function crearMateria(c, u, nombre, unidad = 'unidad') {
  const { rows } = await c.query('SELECT id, nombre FROM materias_primas');
  const ex = rows.find((m) => norm(m.nombre) === norm(nombre));
  if (ex) return ex.id;
  const { rows: un } = await c.query('SELECT 1 FROM mp_unidades WHERE nombre = $1', [unidad]);
  const { rows: ins } = await c.query(
    `INSERT INTO materias_primas (nombre, unidad, categoria, vida_dias) VALUES ($1,$2,'General',14) RETURNING id`, [nombre.trim(), un[0] ? unidad : 'unidad']);
  await c.query(`INSERT INTO materia_categorias (mp_id, categoria) VALUES ($1,'General') ON CONFLICT DO NOTHING`, [ins[0].id]);
  await bitacora(c, u, { accion: 'materia.crear', elemento: nombre, despues: { origen: 'propuesta de producto' } });
  return ins[0].id;
}

/** Reemplaza «new:Nombre» por el id real en las propuestas de producto y extras. */
export async function sustituirNueva(c, ref, id) {
  const { rows } = await c.query(`SELECT id, datos FROM solicitudes WHERE tipo IN ('Producto nuevo','Extra nuevo') AND datos::text LIKE $1`, [`%${ref.replace(/[%_]/g, '\\$&')}%`]);
  for (const s of rows) {
    const d = s.datos || {};
    for (const k of ['ings', 'mods']) for (const r of d[k] || []) if (r.mp === ref) r.mp = id;
    if (d.nuevas) d.nuevas = d.nuevas.filter((n) => `new:${n.nombre}` !== ref);
    await c.query('UPDATE solicitudes SET datos = $2 WHERE id = $1', [s.id, JSON.stringify(d)]);
  }
  await c.query(`UPDATE solicitudes SET mp_id = $2, datos = datos || jsonb_build_object('mp', $3::text) WHERE tipo = 'Materia sin proveedor' AND datos->>'mp' = $1`, [ref, id, String(id)]);
}

/** Unidad de una materia nueva según lo que escribió quien la propuso. */
export async function unidadDeNueva(c, ref) {
  const { rows } = await c.query(`SELECT datos FROM solicitudes WHERE tipo IN ('Producto nuevo','Extra nuevo') AND datos::text LIKE $1 LIMIT 1`, [`%${ref.replace(/[%_]/g, '\\$&')}%`]);
  return ((rows[0]?.datos?.nuevas || []).find((n) => `new:${n.nombre}` === ref) || {}).unidad || 'unidad';
}

/** ¿Tiene compras en curso o facturas por pagar? Entonces no se puede inhabilitar ni eliminar. */
export async function ocupadoProv(c, id) {
  const { rows } = await c.query(
    `SELECT EXISTS (SELECT 1 FROM compras WHERE proveedor_id = $1 AND estado IN ('Aceptada por gerente','En camino','Recibida'))
         OR EXISTS (SELECT 1 FROM facturas WHERE proveedor_id = $1 AND estado = 'Pendiente') AS ocupado`, [id]);
  return rows[0].ocupado;
}

const quienSql = `CASE WHEN u.id IS NULL THEN NULL ELSE u.nombre END`;

export async function listaProveedores(c) {
  const { rows } = await c.query(
    `SELECT v.*, ${quienSql} AS creo_nombre, u.rol_id AS creo_rol,
            ARRAY(SELECT m.nombre FROM proveedor_materias pm JOIN materias_primas m ON m.id = pm.mp_id WHERE pm.proveedor_id = v.id ORDER BY m.nombre) AS mps
       FROM proveedores v LEFT JOIN usuarios u ON u.id = v.creado_por WHERE v.estado <> 'Eliminado' ORDER BY v.nombre`);
  return rows.map((v) => ({
    id: v.id, nombre: v.nombre, pago: v.condicion_pago, estado: v.estado, foto: v.foto_url, mps: v.mps, saldoFavor: v.saldo_favor,
    creo: v.creo_nombre ? `${v.creo_nombre} · ${ROLN[v.creo_rol]}` : null,
  }));
}

export async function fichaProveedor(c, id) {
  const { rows } = await c.query(
    `SELECT v.*, u.nombre AS creo_nombre, u.rol_id AS creo_rol, e.nombre AS edito_nombre, e.rol_id AS edito_rol
       FROM proveedores v LEFT JOIN usuarios u ON u.id = v.creado_por LEFT JOIN usuarios e ON e.id = v.editado_por WHERE v.id = $1`, [id]);
  const v = rows[0];
  if (!v) throw fallo('No se encontró el proveedor');
  const { rows: mps } = await c.query(
    `SELECT pm.mp_id AS id, m.nombre, m.unidad, pm.precio_actual AS precio FROM proveedor_materias pm JOIN materias_primas m ON m.id = pm.mp_id
      WHERE pm.proveedor_id = $1 ORDER BY m.nombre`, [id]);
  const { rows: fs } = await c.query('SELECT id, num, emitida, monto, estado FROM facturas WHERE proveedor_id = $1 ORDER BY emitida DESC LIMIT 6', [id]);
  const { rows: cambios } = await c.query('SELECT fecha, detalle FROM proveedor_cambios WHERE proveedor_id = $1 ORDER BY id DESC', [id]);
  return {
    id: v.id, nombre: v.nombre, pago: v.condicion_pago, estado: v.estado, foto: v.foto_url, saldoFavor: v.saldo_favor,
    politica: { tipo: v.politica_tipo, tolH: v.politica_tolerancia_h, escala: v.politica_escala, tope: v.politica_tope },
    politicaTxt: politicaTxt(v), mps, facturas: fs, cambios, ocupado: await ocupadoProv(c, id),
    creo: v.creo_nombre ? { nombre: `${v.creo_nombre} · ${ROLN[v.creo_rol]}`, fecha: v.creado } : null,
    edito: v.edito_nombre ? { nombre: `${v.edito_nombre} · ${ROLN[v.edito_rol]}`, fecha: v.editado } : null,
  };
}

export async function historialProveedor(c, id) {
  const { rows: precios } = await c.query(
    `SELECT h.precio, h.desde, h.hasta, m.nombre FROM proveedor_precios_hist h JOIN materias_primas m ON m.id = h.mp_id
      WHERE h.proveedor_id = $1 ORDER BY h.desde DESC, h.id DESC LIMIT 40`, [id]);
  const { rows: transporte } = await c.query(
    `SELECT h.costo, h.desde, h.hasta, s.nombre AS sucursal FROM proveedor_transporte_hist h JOIN sucursales s ON s.id = h.sucursal_id
      WHERE h.proveedor_id = $1 ORDER BY h.desde DESC, h.id DESC LIMIT 30`, [id]);
  return { precios, transporte };
}

/**
 * Alta o edición. d = {nombre, pago, mps:[id | 'new:Nombre'], tipo, tol, esc, tope}
 * Devuelve el id del proveedor.
 */
export async function guardarProveedor(c, u, id, d) {
  const nombre = String(d?.nombre || '').trim();
  const pol = { tipo: d?.tipo, tol: Math.round(+d?.tol), esc: r2(+d?.esc), tope: r2(+d?.tope) };
  si(nombre.length < 3, 'El nombre necesita al menos 3 caracteres');
  si(!PAGOS.includes(d?.pago), 'Elige la condición de pago');
  si(!POLITICAS.includes(pol.tipo), 'Elige el tipo de política');
  si(!(pol.tol >= 0) || !(pol.esc > 0) || !(pol.tope > 0) || pol.tope < pol.esc, 'Revisa la política: la escala y el tope deben ser mayores que 0 y el tope no puede ser menor que la escala');
  const lista = [...new Set((d?.mps || []).map((m) => (String(m).startsWith('new:') ? String(m) : Number(m))))];
  si(!lista.length, 'Elige al menos una materia prima');
  const { rows: todos } = await c.query('SELECT id, nombre FROM proveedores WHERE estado <> $1', ['Eliminado']);
  si(todos.some((x) => x.id !== +id && norm(x.nombre) === norm(nombre)), 'Ya existe un proveedor con ese nombre');
  // materias nuevas propuestas por cocina: se crean ahora
  const ids = [];
  for (const m of lista) {
    if (typeof m === 'string') {
      const nuevo = await crearMateria(c, u, m.slice(4), await unidadDeNueva(c, m));
      await sustituirNueva(c, m, nuevo);
      ids.push(nuevo);
    } else ids.push(m);
  }
  const { rows: okMp } = await c.query(`SELECT id, nombre FROM materias_primas WHERE id = ANY($1)`, [ids]);
  si(okMp.length !== new Set(ids).size, 'Hay una materia prima que no existe');
  const nomMp = Object.fromEntries(okMp.map((m) => [m.id, m.nombre]));
  const t = ahora();
  if (!id) {
    const { rows } = await c.query(
      `INSERT INTO proveedores (nombre, condicion_pago, politica_tipo, politica_tolerancia_h, politica_escala, politica_tope, creado_por, creado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [nombre, d.pago, pol.tipo, pol.tol, pol.esc, pol.tope, u.id, ts(t)]);
    const pid = rows[0].id;
    const { rows: sucs } = await c.query(`SELECT id FROM sucursales WHERE estado = 'Operando'`);
    for (const s of sucs) await generarCondiciones(c, pid, s.id);
    for (const m of ids) await altaPrecio(c, pid, m);
    await cambio(c, pid, 'Alta del proveedor');
    await bitacora(c, u, { accion: 'proveedor.crear', elemento: nombre, despues: { materias: ids.length } });
    return pid;
  }
  const { rows } = await c.query('SELECT * FROM proveedores WHERE id = $1 FOR UPDATE', [id]);
  const v = rows[0];
  si(!v || v.estado === 'Eliminado', 'No se encontró el proveedor');
  si(v.estado !== 'Activo', 'Primero habilita al proveedor');
  const cambios = [];
  if (v.nombre !== nombre) cambios.push(`Nombre: ${nombre}`);
  if (v.condicion_pago !== d.pago) cambios.push(`Pago: ${d.pago}`);
  if (v.politica_tipo !== pol.tipo || v.politica_tolerancia_h !== pol.tol || v.politica_escala !== pol.esc || v.politica_tope !== pol.tope) {
    cambios.push(`Política: ${politicaTxt({ politica_tipo: pol.tipo, politica_tolerancia_h: pol.tol, politica_escala: pol.esc, politica_tope: pol.tope })}`);
  }
  const { rows: act } = await c.query('SELECT mp_id FROM proveedor_materias WHERE proveedor_id = $1', [id]);
  const antes = new Set(act.map((x) => x.mp_id));
  for (const m of ids.filter((x) => !antes.has(x))) { await altaPrecio(c, id, m); cambios.push(`Ofrece ${nomMp[m]}`); }
  const quitar = [...antes].filter((x) => !ids.includes(x));
  if (quitar.length) {
    const { rows: nq } = await c.query('SELECT id, nombre FROM materias_primas WHERE id = ANY($1)', [quitar]);
    for (const m of nq) {
      await c.query('DELETE FROM proveedor_materias WHERE proveedor_id = $1 AND mp_id = $2', [id, m.id]);
      await c.query('UPDATE proveedor_precios_hist SET hasta = $3 WHERE proveedor_id = $1 AND mp_id = $2 AND hasta IS NULL', [id, m.id, ts(t)]);
      cambios.push(`Deja de ofrecer ${m.nombre}`);
    }
  }
  await c.query(
    `UPDATE proveedores SET nombre = $2, condicion_pago = $3, politica_tipo = $4, politica_tolerancia_h = $5, politica_escala = $6, politica_tope = $7
       ${cambios.length ? ', editado_por = $8, editado = $9' : ''} WHERE id = $1`,
    [id, nombre, d.pago, pol.tipo, pol.tol, pol.esc, pol.tope, ...(cambios.length ? [u.id, ts(t)] : [])]);
  for (const x of cambios) await cambio(c, id, x);
  await bitacora(c, u, { accion: 'proveedor.editar', elemento: nombre, despues: { cambios } });
  return +id;
}
