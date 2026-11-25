import { Router } from 'express';
import { q, tx, ts } from '../db.js';
import { fallo, si, noEncontrado, prohibido, motivo as validarMotivo } from '../lib/errores.js';
import { ahora } from '../lib/reloj.js';
import { bitacora, notificar } from '../lib/registro.js';
import { exigir } from '../lib/permisos.js';
import { cargarSolicitudes } from '../lib/consultas.js';

/*
 * Producto, extra y categoría nuevos (ADENDA v4/v5):
 *   cocinero → jefe de cocina («Aprobado por jefe de cocina») → gerente de sucursal → gerente general → director.
 * Lo que propone el jefe sale ya aprobado por él y va directo al gerente.
 */
const r = Router();
const DB = { query: q };
const TP = ['Producto nuevo', 'Extra nuevo', 'Categoría nueva'];
const APROBADO_JEFE = 'Aprobado por jefe de cocina';

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Nombres únicos (sin tildes ni mayúsculas) entre productos, extras y propuestas en trámite. */
async function nombreUsado(c, nombre, exceptoId) {
  const n = norm(nombre);
  if (!n) return '';
  const { rows: prods } = await c.query('SELECT nombre FROM productos');
  if (prods.some((p) => norm(p.nombre) === n)) return 'Ya existe un producto o extra con ese nombre';
  const { rows: sols } = await c.query(
    `SELECT nombre FROM solicitudes WHERE tipo IN ('Producto nuevo','Extra nuevo') AND id <> $1
        AND estado NOT IN ('Borrador','Rechazado','En catálogo','Cancelado')`, [exceptoId || 0]);
  if (sols.some((s) => norm(s.nombre) === n)) return 'Ya hay una propuesta en trámite con ese nombre';
  return '';
}

const hayExtra = async (c, nombre) =>
  (await c.query(`SELECT 1 FROM productos WHERE es_extra AND estado <> 'Eliminado' AND lower(nombre) = lower($1)`, [String(nombre).trim()])).rowCount > 0;

const categoriasExistentes = async (c) => (await c.query('SELECT nombre FROM categorias ORDER BY id')).rows.map((x) => x.nombre);

/** Normaliza ingredientes [{mp, cant}] (mp = id o «new:Nombre» de una materia nueva). */
async function validarIngs(c, ings, nuevas = []) {
  const { rows } = await c.query(`SELECT id FROM materias_primas WHERE estado = 'Activo'`);
  const ids = new Set(rows.map((x) => x.id));
  const nuevasN = new Set(nuevas.map((x) => `new:${x.nombre}`));
  return (ings || [])
    .filter((x) => x.mp && +x.cant > 0)
    .map((x) => {
      const mp = String(x.mp).startsWith('new:') ? String(x.mp) : Number(x.mp);
      si(typeof mp === 'number' ? !ids.has(mp) : !nuevasN.has(mp), 'Hay un ingrediente que no existe');
      return { mp, cant: +x.cant };
    });
}

/** Producto: nombre, descripción, categorías, ingredientes y tiempo. */
async function datosProducto(c, d) {
  const cats = await categoriasExistentes(c);
  const nuevas = (d.nuevas || []).filter((x) => x && String(x.nombre || '').trim()).map((x) => ({ nombre: String(x.nombre).trim(), unidad: String(x.unidad || 'unidad') }));
  return {
    nombre: String(d.nombre || '').trim(),
    desc: String(d.desc || '').trim(),
    cats: (d.cats || []).filter((x) => cats.includes(x)),
    ings: await validarIngs(c, d.ings, nuevas),
    tiempo: Number(d.tiempo) || 0,
    nuevas,
    mods: [],
  };
}
async function errorProducto(c, e, exceptoId) {
  return !e.nombre ? 'Escribe el nombre' : !e.cats.length ? 'Elige al menos una categoría' : !e.ings.length ? 'Agrega al menos un ingrediente'
    : !(e.tiempo > 0) ? 'El tiempo debe ser mayor que 0' : await nombreUsado(c, e.nombre, exceptoId);
}

/** Extra: nombre, precio, minutos extra, productos donde aparece e ingredientes. */
async function datosExtra(c, d) {
  const { rows } = await c.query(`SELECT id FROM productos WHERE NOT es_extra AND estado IN ('Activo','Precio por revisar')`);
  const validos = new Set(rows.map((x) => x.id));
  return {
    nombre: String(d.nombre || '').trim(),
    precio: Number(d.precio),
    tiempo: Number(d.tiempo) || 0,
    prods: [...new Set((d.prods || []).map(Number))].filter((i) => validos.has(i)),
    ings: await validarIngs(c, d.ings),
  };
}
const errorExtra = (e) => (!e.nombre ? 'Escribe el nombre' : !(e.precio > 0) ? 'El precio debe ser mayor que 0' : !(e.tiempo >= 0) ? 'Los minutos deben ser 0 o más'
  : !e.prods.length ? 'Elige al menos un producto donde aparecerá' : !e.ings.length ? 'Agrega al menos un ingrediente' : '');

/** Materias primas nuevas o sin proveedor: se avisa al gerente general. */
async function pedirProveedor(c, sol, d, u) {
  const { rows } = await c.query(`SELECT DISTINCT pm.mp_id FROM proveedor_materias pm JOIN proveedores v ON v.id = pm.proveedor_id WHERE v.estado = 'Activo'`);
  const conProv = new Set(rows.map((x) => x.mp_id));
  const sinProv = [...new Set(d.ings.map((x) => x.mp))].filter((m) => typeof m === 'string' || !conProv.has(m));
  let n = 0;
  for (const m of sinProv) {
    const ya = await c.query(
      `SELECT 1 FROM solicitudes WHERE tipo = 'Materia sin proveedor' AND estado = 'Solicitada' AND nombre = $1 AND datos->>'mp' = $2`, [d.nombre, String(m)]);
    if (ya.rowCount) continue;
    await c.query(
      `INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, mp_id, aprueba_rol, nombre, datos, fecha)
       VALUES ('Materia sin proveedor','Solicitada',$1,$2,$3,'gg',$4,$5,$6)`,
      [sol.sucursal_id, u.id, typeof m === 'number' ? m : null, d.nombre,
        JSON.stringify({ mp: String(m), producto: d.nombre, propone: sol.propone || u.nombre }), ts(ahora())]);
    n += 1;
  }
  if (n) await notificar(c, 'gg', null, 'Materia prima sin proveedor', d.nombre);
}

const decisionJefe = (u, res, motivo = '') => JSON.stringify({ res, motivo, fecha: ahora(), por: u.id });

/* ---------- consultas ---------- */
r.get('/mias', async (req, res) => {
  res.json(await cargarSolicitudes(DB, 's.solicitante_id = $1 AND s.tipo = ANY($2)', [req.usuario.id, TP]));
});

r.get('/pendientes', async (req, res) => {
  if (req.usuario.rol !== 'jefe') throw prohibido();
  res.json(await cargarSolicitudes(DB, `s.sucursal_id = $1 AND s.tipo = ANY($2) AND s.estado = 'Propuesto'`, [req.usuario.sucursal, TP], 's.fecha'));
});

r.get('/decididas', async (req, res) => {
  if (req.usuario.rol !== 'jefe') throw prohibido();
  res.json(await cargarSolicitudes(DB, `s.sucursal_id = $1 AND s.tipo = ANY($2) AND s.jefe_decision IS NOT NULL`, [req.usuario.sucursal, TP],
    `(s.jefe_decision->>'fecha')::bigint DESC`));
});

/* ---------- producto nuevo (borrador o propuesta) ---------- */
r.post('/producto', async (req, res) => {
  const u = req.usuario;
  exigir(u, 'productoNuevo', 'pide', u.sucursal);
  const { id, estado } = req.body || {};
  const esJefe = u.rol === 'jefe';
  si(!esJefe && !['Borrador', 'Propuesto'].includes(estado), 'Estado inválido');
  const out = await tx(async (c) => {
    let previa = null;
    if (id) {
      const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND solicitante_id = $2 AND tipo = 'Producto nuevo' AND estado = 'Borrador' FOR UPDATE`, [id, u.id]);
      if (!rows[0]) throw noEncontrado('Ese borrador ya no se puede editar');
      previa = rows[0];
    }
    const d = await datosProducto(c, req.body.datos || {});
    const final = esJefe ? APROBADO_JEFE : estado;
    if (final !== 'Borrador') {
      const e = await errorProducto(c, d, previa?.id);
      if (e) throw fallo(e);
    }
    const nombre = d.nombre || '(sin nombre)';
    let sol;
    if (previa) {
      sol = (await c.query(`UPDATE solicitudes SET nombre = $2, datos = $3, estado = $4, fecha = $5, rechazo = NULL WHERE id = $1 RETURNING *`,
        [previa.id, nombre, JSON.stringify(d), final, ts(ahora())])).rows[0];
    } else {
      sol = (await c.query(
        `INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, aprueba_rol, nombre, datos, de_jefe, jefe_decision, fecha)
         VALUES ('Producto nuevo',$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [final, u.sucursal, u.id, esJefe ? 'gerente' : 'jefe', nombre, JSON.stringify(d), esJefe, esJefe ? decisionJefe(u, 'Aceptada') : null, ts(ahora())])).rows[0];
    }
    if (final === 'Borrador') return { id: sol.id };
    await pedirProveedor(c, sol, d, u);
    if (esJefe) {
      await notificar(c, 'gerente', u.sucursal, 'Producto por aprobar', `${d.nombre} (propuesto por el jefe de cocina)`);
      await bitacora(c, u, { accion: 'producto.proponer.jefe', elemento: d.nombre, sucursal: u.sucursal });
    } else {
      await notificar(c, 'jefe', u.sucursal, 'Producto propuesto', `${d.nombre} (de ${u.nombre})`);
      await bitacora(c, u, { accion: 'producto.proponer', elemento: d.nombre, sucursal: u.sucursal });
    }
    return { id: sol.id };
  });
  res.status(201).json(out);
});

/* ---------- extra nuevo ---------- */
r.post('/extra', async (req, res) => {
  const u = req.usuario;
  const esJefe = u.rol === 'jefe';
  exigir(u, 'extra', esJefe ? 'decide' : 'pide', u.sucursal);
  await tx(async (c) => {
    const d = await datosExtra(c, req.body?.datos || {});
    const e = errorExtra(d) || ((await hayExtra(c, d.nombre)) ? 'Ya existe un extra con ese nombre' : '');
    if (e) throw fallo(e);
    await c.query(
      `INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, aprueba_rol, nombre, datos, de_jefe, jefe_decision, fecha)
       VALUES ('Extra nuevo',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [esJefe ? APROBADO_JEFE : 'Propuesto', u.sucursal, u.id, esJefe ? 'gerente' : 'jefe', d.nombre, JSON.stringify(d), esJefe,
        esJefe ? decisionJefe(u, 'Aceptada') : null, ts(ahora())]);
    if (esJefe) {
      await notificar(c, 'gerente', u.sucursal, 'Extra por aprobar', `${d.nombre} (propuesto por el jefe de cocina)`);
      await bitacora(c, u, { accion: 'extra.proponer.jefe', elemento: d.nombre, sucursal: u.sucursal });
    } else {
      await notificar(c, 'jefe', u.sucursal, 'Extra propuesto', `${d.nombre} (de ${u.nombre})`);
      await bitacora(c, u, { accion: 'extra.proponer', elemento: d.nombre, sucursal: u.sucursal });
    }
  });
  res.status(201).json({ ok: true });
});

/* ---------- categoría nueva ---------- */
r.post('/categoria', async (req, res) => {
  const u = req.usuario;
  const esJefe = u.rol === 'jefe';
  exigir(u, 'categoria', esJefe ? 'decide' : 'pide', u.sucursal);
  const nombre = String(req.body?.nombre || '').trim();
  await tx(async (c) => {
    si(nombre.length < 3, 'Escribe el nombre de la categoría');
    si((await categoriasExistentes(c)).some((x) => x.toLowerCase() === nombre.toLowerCase()), 'Esa categoría ya existe');
    const pend = await c.query(`SELECT 1 FROM solicitudes WHERE tipo = 'Categoría nueva' AND estado IN ('Propuesto', $2) AND lower(nombre) = lower($1)`, [nombre, APROBADO_JEFE]);
    si(pend.rowCount, 'Ya hay una solicitud pendiente con ese nombre');
    const m = esJefe ? 'Propuesta del jefe de cocina' : validarMotivo(req.body?.motivo, 'Explica por qué hace falta: el motivo');
    await c.query(
      `INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, aprueba_rol, nombre, motivo, de_jefe, jefe_decision, fecha)
       VALUES ('Categoría nueva',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [esJefe ? APROBADO_JEFE : 'Propuesto', u.sucursal, u.id, esJefe ? 'gerente' : 'jefe', nombre, m, esJefe, esJefe ? decisionJefe(u, 'Aceptada') : null, ts(ahora())]);
    if (esJefe) {
      await notificar(c, 'gerente', u.sucursal, 'Categoría por aprobar', nombre);
      await bitacora(c, u, { accion: 'categoria.proponer.jefe', elemento: nombre, sucursal: u.sucursal });
    } else {
      await notificar(c, 'jefe', u.sucursal, 'Categoría solicitada', `${nombre} (de ${u.nombre})`);
      await bitacora(c, u, { accion: 'categoria.pedir', elemento: nombre, motivo: m, sucursal: u.sucursal });
    }
  });
  res.status(201).json({ ok: true });
});

/* ---------- revisión del jefe de cocina ---------- */
async function propuestaPendiente(c, u, id) {
  if (u.rol !== 'jefe') throw prohibido();
  const { rows } = await c.query(
    `SELECT s.*, so.nombre AS propone FROM solicitudes s LEFT JOIN usuarios so ON so.id = s.solicitante_id
      WHERE s.id = $1 AND s.sucursal_id = $2 AND s.tipo = ANY($3) AND s.estado = 'Propuesto' FOR UPDATE OF s`, [id, u.sucursal, TP]);
  if (!rows[0]) throw noEncontrado('La propuesta ya fue revisada');
  return rows[0];
}

/** Aprueba (con los ajustes del jefe) y la envía al gerente de sucursal. */
r.post('/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const x = await propuestaPendiente(c, u, req.params.id);
    let d = x.datos;
    if (x.tipo === 'Producto nuevo') {
      exigir(u, 'productoNuevo', 'decide', u.sucursal);
      d = await datosProducto(c, { ...x.datos, ...(req.body?.datos || {}) });
      si(!d.nombre || !(d.tiempo > 0) || !d.ings.length, 'Revisa nombre, tiempo e ingredientes');
      const e = await nombreUsado(c, d.nombre, x.id);
      if (e) throw fallo(e);
      await pedirProveedor(c, x, d, u);
      await notificar(c, 'gerente', x.sucursal_id, 'Producto por aprobar', d.nombre);
    } else if (x.tipo === 'Extra nuevo') {
      exigir(u, 'extra', 'decide', u.sucursal);
      d = await datosExtra(c, { ...x.datos, ...(req.body?.datos || {}) });
      const e = errorExtra(d) || ((await hayExtra(c, d.nombre)) ? 'Ya existe un extra con ese nombre' : '');
      if (e) throw fallo(e);
      await notificar(c, 'gerente', x.sucursal_id, 'Extra por aprobar', d.nombre);
    } else {
      exigir(u, 'categoria', 'decide', u.sucursal);
      si((await categoriasExistentes(c)).some((n) => n.toLowerCase() === x.nombre.toLowerCase()), 'Esa categoría ya existe');
      await notificar(c, 'gerente', x.sucursal_id, 'Categoría por aprobar', x.nombre);
    }
    const nombre = x.tipo === 'Categoría nueva' ? x.nombre : d.nombre;
    await c.query(
      `UPDATE solicitudes SET estado = $2, datos = $3, nombre = $4, aprueba_rol = 'gerente', jefe_decision = $5, fecha = $6 WHERE id = $1`,
      [x.id, APROBADO_JEFE, JSON.stringify(d || {}), nombre, decisionJefe(u, 'Aceptada'), ts(ahora())]);
    await notificar(c, 'cocinero', x.sucursal_id, 'Propuesta aceptada', `${x.tipo === 'Producto nuevo' ? '' : `${x.tipo}: `}${nombre} (de ${x.propone})`);
    await bitacora(c, u, { accion: x.tipo === 'Producto nuevo' ? 'producto.aprobar.jefe' : 'solicitud.aceptar.jefe', elemento: nombre, sucursal: x.sucursal_id });
  });
  res.json({ ok: true });
});

r.post('/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const x = await propuestaPendiente(c, u, req.params.id);
    await c.query(`UPDATE solicitudes SET estado = 'Rechazado', rechazo = $2, jefe_decision = $3 WHERE id = $1`,
      [x.id, JSON.stringify({ por: 'Jefe de cocina', etapa: 'Jefe de cocina', motivo: m, fecha: ahora() }), decisionJefe(u, 'Rechazada', m)]);
    await notificar(c, 'cocinero', x.sucursal_id, 'Propuesta rechazada', `${x.tipo}: ${x.nombre} (de ${x.propone})`);
    await bitacora(c, u, { accion: 'solicitud.rechazar.jefe', elemento: x.nombre, motivo: m, sucursal: x.sucursal_id });
  });
  res.json({ ok: true });
});

export default r;
