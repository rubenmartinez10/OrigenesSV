import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, tx, ts } from '../db.js';
import { si, noEncontrado, motivo as validarMotivo } from '../lib/errores.js';
import { ahora, D, inicioDia } from '../lib/reloj.js';
import { bitacora, notificar } from '../lib/registro.js';
import { r2, costoPropuesta } from '../lib/negocio.js';
import { cargarSolicitudes } from '../lib/consultas.js';
import { guardarImagen } from '../lib/fotos.js';
import {
  NIVEL, ROLN, activos, usuarioPorId, cambiarRol, despedirDirecto, puedeSobre, rolesDestino, historial,
} from '../lib/personal.js';
import { TAM, intervaloSuc, costoSuc, abiertosSuc, crearSucursal } from '../lib/sucursales.js';
import { ventasRango, porDia, totalDe } from '../lib/panel.js';
import { ranking, personaJson } from './gerente.js';
import { catalogoCompleto } from './gg.js';

/* Director · 8.1 Ingresos, 8.2 Aprobaciones, 8.3 Sucursales, 8.4 Directores, 8.5 Catálogo, 8.6 Bitácora (sin clave: confirma y, al rechazar, motivo) */
const r = Router();
const DB = { query: q };
const TP = ['Producto nuevo', 'Extra nuevo', 'Categoría nueva'];
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const temporal = () => `Tmp${1000 + Math.floor(Math.random() * 9000)}`;
const cuatro = () => String(1000 + Math.floor(Math.random() * 9000));

/* ---------- 8.1 Ingresos (sin gastos ni utilidades: eso solo lo ven los gerentes) ---------- */
r.get('/ingresos', async (req, res) => {
  const v = ['1', '7', '30'].includes(req.query.v) ? req.query.v : '7';
  const t = inicioDia(ahora());
  const a = v === '1' ? t : v === '7' ? t - 6 * D : t - 29 * D;
  const b = ahora() + 1;
  const L = await ventasRango(DB, null, a, b);
  const { rows: sucs } = await q('SELECT id, nombre, zona, tamano, estado FROM sucursales ORDER BY id');
  const filas = [];
  for (const s of sucs) {
    filas.push({
      id: s.id, nombre: s.nombre, zona: s.zona, tamano: TAM[s.tamano], estado: s.estado, ingresos: totalDe(L, s.id), personal: (await activos(DB, s.id)).length,
      top: (await ranking(DB, s.id, a, b, 'prod')).slice(0, 5), cats: (await ranking(DB, s.id, a, b, 'cat')).slice(0, 5),
    });
  }
  const tot = totalDe(L);
  res.json({
    total: tot, pedidos: L.length, ticket: L.length ? r2(tot / L.length) : null, operando: sucs.filter((s) => s.estado === 'Operando').length,
    dias: await porDia(DB, null, v === '1' ? 7 : +v), porCategoria: await ranking(DB, null, a, b, 'cat'),
    topProductos: (await ranking(DB, null, a, b, 'prod')).slice(0, 5), filas,
  });
});

/* ---------- 8.2 Aprobaciones: productos nuevos ---------- */
r.get('/productos', async (req, res) => {
  const L = await cargarSolicitudes(DB, `s.tipo = ANY($1) AND s.estado = 'Aprobado por gerente general'`, [TP], 's.fecha');
  const { rows: m } = await q('SELECT id, nombre, unidad FROM materias_primas');
  const M = Object.fromEntries(m.map((x) => [x.id, x]));
  const { rows: pr } = await q('SELECT id, nombre FROM productos');
  const PN = Object.fromEntries(pr.map((x) => [x.id, x.nombre]));
  const { rows: sc } = await q('SELECT id, nombre FROM sucursales');
  const SN = Object.fromEntries(sc.map((x) => [x.id, x.nombre]));
  const out = [];
  for (const x of L) {
    const d = x.datos || {};
    out.push({
      ...x, sucNombre: SN[x.suc], propone: d.propone || x.solicitanteNombre, precio: x.tipo === 'Producto nuevo' ? x.monto : d.precio,
      costo: x.tipo === 'Producto nuevo' ? await costoPropuesta(DB, d.ings, x.suc) : null,
      ings: (d.ings || []).map((i) => ({ ...i, nombre: M[+i.mp]?.nombre || String(i.mp).replace(/^new:/, ''), unidad: M[+i.mp]?.unidad || '' })),
      prodsNombres: (d.prods || []).map((i) => PN[i]).filter(Boolean),
    });
  }
  res.json(out);
});

r.post('/productos/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = ANY($2) AND estado = 'Aprobado por gerente general' FOR UPDATE`, [req.params.id, TP]);
    const x = rows[0];
    si(!x, 'Esta propuesta ya fue decidida');
    const d = x.datos || {};
    const t = ts(ahora());
    if (x.tipo === 'Categoría nueva') {
      const { rows: cg } = await c.query('SELECT nombre FROM categorias');
      si(cg.some((z) => norm(z.nombre) === norm(x.nombre)), 'Ya existe una categoría con ese nombre');
      await c.query('INSERT INTO categorias (nombre) VALUES ($1)', [x.nombre]);
    } else {
      const prod = x.tipo === 'Producto nuevo';
      const { rows: ps } = await c.query('SELECT nombre FROM productos');
      si(ps.some((z) => norm(z.nombre) === norm(x.nombre)), 'Ya existe un producto o extra con ese nombre');
      si((d.ings || []).some((i) => String(i.mp).startsWith('new:')), 'Falta asignar proveedor a una materia prima nueva');
      const precio = r2(+(prod ? x.monto : d.precio));
      si(!(precio > 0), 'La propuesta no tiene precio');
      const { rows: ins } = await c.query(
        `INSERT INTO productos (nombre, descripcion, precio, tiempo_min, es_extra, creado, publicado) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
        [x.nombre, prod ? d.desc || '' : '', precio, Math.round(+d.tiempo || 0), !prod, t]);
      const pid = ins[0].id;
      for (const i of d.ings || []) {
        await c.query('INSERT INTO recetas (producto_id, mp_id, cantidad) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [pid, +i.mp, +i.cant]);
      }
      if (prod) {
        await c.query('INSERT INTO producto_categorias (producto_id, categoria_id) SELECT $1, id FROM categorias WHERE nombre = ANY($2)', [pid, d.cats || []]);
        await c.query(`INSERT INTO sucursal_menu (sucursal_id, producto_id) SELECT id, $1 FROM sucursales WHERE estado <> 'Cerrada'`, [pid]);
      } else {
        for (const p of d.prods || []) await c.query('INSERT INTO extra_productos (extra_id, producto_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [pid, p]);
        await c.query(`INSERT INTO producto_categorias (producto_id, categoria_id)
                       SELECT DISTINCT $1, pc.categoria_id FROM producto_categorias pc WHERE pc.producto_id = ANY($2)`, [pid, d.prods || []]);
      }
      await c.query('INSERT INTO precios_historial (producto_id, precio, desde, aprobo, solicitud_id) VALUES ($1,$2,$3,$4,$5)', [pid, precio, t, u.nombre, x.id]);
      await c.query('UPDATE solicitudes SET producto_id = $2 WHERE id = $1', [x.id, pid]);
    }
    await c.query(`UPDATE solicitudes SET estado = 'En catálogo', decidio_id = $2, cierre = $3, datos = datos || $4::jsonb WHERE id = $1`,
      [x.id, u.id, t, JSON.stringify({ director: u.id })]);
    await notificar(c, 'cocinero', x.sucursal_id, 'Propuesta aprobada', `${x.nombre} ya está en el catálogo`);
    await notificar(c, 'gerente', x.sucursal_id, 'Nuevo en el catálogo', x.nombre);
    await bitacora(c, u, { accion: 'catalogo.aprobar', elemento: x.nombre, despues: { tipo: x.tipo }, sucursal: x.sucursal_id });
  });
  res.json({ ok: true });
});

r.post('/productos/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = ANY($2) AND estado = 'Aprobado por gerente general' FOR UPDATE`, [req.params.id, TP]);
    const x = rows[0];
    si(!x, 'Esta propuesta ya fue decidida');
    await c.query(`UPDATE solicitudes SET estado = 'Rechazado', rechazo = $2, decidio_id = $3 WHERE id = $1`,
      [x.id, JSON.stringify({ por: 'Director', etapa: 'Director', motivo: m, fecha: ahora() }), u.id]);
    await notificar(c, 'cocinero', x.sucursal_id, 'Propuesta rechazada', `${x.nombre}: ${m}`);
    await bitacora(c, u, { accion: 'catalogo.rechazar', elemento: x.nombre, motivo: m, sucursal: x.sucursal_id });
  });
  res.json({ ok: true });
});

/* ---------- 8.2 Aprobaciones: compra y venta de sucursales ---------- */
r.get('/propuestas-sucursal', async (req, res) => {
  const { rows } = await q(
    `SELECT p.*, s.nombre AS suc_nombre, u.nombre AS pide_nombre FROM propuestas_sucursal p LEFT JOIN sucursales s ON s.id = p.sucursal_id
       JOIN usuarios u ON u.id = p.pide_id WHERE p.estado = 'Solicitada' ORDER BY p.fecha`);
  const L = rows.map((p) => ({
    id: p.id, tipo: p.tipo, zona: p.zona, tamano: p.tamano, tamanoNombre: TAM[p.tamano], costo: p.costo, suc: p.sucursal_id, sucNombre: p.suc_nombre,
    motivo: p.motivo, pideNombre: p.pide_nombre, fecha: p.fecha,
  }));
  res.json({ compra: L.filter((p) => p.tipo === 'Compra'), venta: L.filter((p) => p.tipo === 'Venta') });
});

r.post('/propuestas-sucursal/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT p.*, s.nombre AS suc_nombre FROM propuestas_sucursal p LEFT JOIN sucursales s ON s.id = p.sucursal_id
                                     WHERE p.id = $1 AND p.estado = 'Solicitada' FOR UPDATE OF p`, [req.params.id]);
    const p = rows[0];
    si(!p, 'Esta propuesta ya fue decidida');
    const compra = p.tipo === 'Compra';
    if (!compra) {
      const ab = await abiertosSuc(c, p.sucursal_id);
      si(ab.p + ab.c, `La sucursal tiene ${ab.p + ab.c} pedidos o cajas abiertos`);
      await c.query(`UPDATE sucursales SET estado = 'Cierre ordenado' WHERE id = $1`, [p.sucursal_id]);
    }
    await c.query(`UPDATE propuestas_sucursal SET estado = $2, decidio_id = $3, decidido = $4 WHERE id = $1`, [p.id, compra ? 'Compra aprobada' : 'Venta aprobada', u.id, ts(ahora())]);
    const txt = compra ? `${p.zona} · ${TAM[p.tamano]}` : p.suc_nombre;
    await notificar(c, 'gg', null, compra ? 'Compra de sucursal aprobada: ábrela' : 'Venta de sucursal aprobada', txt);
    await bitacora(c, u, { accion: `sucursal.${compra ? 'compra' : 'venta'}.aprobar`, elemento: txt, sucursal: p.sucursal_id });
  });
  res.json({ ok: true });
});

r.post('/propuestas-sucursal/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`UPDATE propuestas_sucursal SET estado = 'Rechazada', rechazo_motivo = $2, decidio_id = $3, decidido = $4
                                     WHERE id = $1 AND estado = 'Solicitada' RETURNING *`, [req.params.id, m, u.id, ts(ahora())]);
    si(!rows[0], 'Esta propuesta ya fue decidida');
    await notificar(c, 'gg', null, 'Propuesta de sucursal rechazada', m);
    await bitacora(c, u, { accion: 'sucursal.rechazar', elemento: `${rows[0].tipo} · ${rows[0].zona}`, motivo: m });
  });
  res.json({ ok: true });
});

/* ---------- 8.3 Sucursales ---------- */
r.get('/sucursales', async (req, res) => {
  const t = inicioDia(ahora());
  const a = t - 29 * D;
  const b = ahora() + 1;
  const L = await ventasRango(DB, null, a, b);
  const { rows } = await q('SELECT id, nombre, zona, tamano, estado FROM sucursales ORDER BY id');
  const { rows: z } = await q('SELECT nombre FROM zonas ORDER BY nombre');
  const out = [];
  for (const s of rows) {
    out.push({ ...s, tamanoNombre: TAM[s.tamano], ingresos: totalDe(L, s.id), personal: (await activos(DB, s.id)).length,
      top: (await ranking(DB, s.id, a, b, 'prod')).slice(0, 5), cats: (await ranking(DB, s.id, a, b, 'cat')).slice(0, 5) });
  }
  res.json({ sucursales: out, zonas: z.map((x) => x.nombre), tamanos: Object.entries(TAM).map(([id, nombre]) => ({ id, nombre })) });
});

r.get('/sucursales/costo', async (req, res) => {
  const [a, b] = await intervaloSuc(DB, req.query.zona, req.query.tam);
  res.json({ costo: await costoSuc(DB, req.query.zona, req.query.tam), min: a, max: b });
});

r.post('/sucursales', async (req, res) => {
  const u = req.usuario;
  const { zona, tamano, costo } = req.body || {};
  const out = await tx(async (c) => {
    const [a, b] = await intervaloSuc(c, zona, tamano);
    si(!(+costo >= a && +costo <= b), 'Calcula el costo antes de crear la sucursal');
    const s = await crearSucursal(c, { zona, tamano, costo: +costo });
    await bitacora(c, u, { accion: 'sucursal.crear_director', elemento: s.nombre, despues: { zona, tamano, costo: +costo }, sucursal: s.sid });
    return s;
  });
  res.status(201).json(out);
});

/* ---------- personal: cambiar rol o despedir a cualquier persona de nivel inferior ---------- */
r.get('/personal', async (req, res) => {
  const u = req.usuario;
  const { rows } = await q(`SELECT * FROM usuarios WHERE estado = 'Activo' AND id <> $1`, [u.id]);
  const { rows: sc } = await q('SELECT id, nombre FROM sucursales');
  const SN = Object.fromEntries(sc.map((x) => [x.id, x.nombre]));
  const out = [];
  for (const x of rows) {
    const p = await personaJson(DB, x);
    p.sucNombre = SN[x.sucursal_id] || 'Gerencia central';
    p.puede = puedeSobre(u, x);
    p.rolesDestino = p.puede ? rolesDestino(u, x).map((id) => ({ id, nombre: ROLN[id] })) : [];
    p.nivel = NIVEL[x.rol_id];
    out.push(p);
  }
  out.sort((p, q2) => q2.nivel - p.nivel || p.nombre.localeCompare(q2.nombre));
  const { rows: sal } = await q('SELECT id, salario FROM roles');
  res.json({
    personas: out, salarios: Object.fromEntries(sal.map((x) => [x.id, x.salario])),
    gg: out.filter((p) => p.rol === 'gg').length, sucursales: sc,
  });
});

r.post('/personal/:id/rol', async (req, res) => {
  const m = validarMotivo(req.body?.motivo);
  const clave = await tx(async (c) => cambiarRol(c, await usuarioPorId(c, req.params.id), req.body?.rol, req.usuario, m));
  res.json({ ok: true, clave });
});

r.post('/personal/:id/despedir', async (req, res) => {
  const m = validarMotivo(req.body?.motivo);
  const ind = await tx(async (c) => despedirDirecto(c, await usuarioPorId(c, req.params.id), req.usuario, m));
  res.json({ ok: true, indemnizacion: ind });
});

/* ---------- 8.4 Directores ---------- */
r.get('/directores', async (req, res) => {
  const { rows } = await q(`SELECT id, nombre, usuario, ingreso, foto_url AS foto FROM usuarios WHERE rol_id = 'director' AND estado = 'Activo' ORDER BY nombre`);
  const { rows: g } = await q(`SELECT count(*)::int n FROM usuarios WHERE rol_id = 'gg' AND estado = 'Activo'`);
  res.json({ directores: rows, gg: g[0].n, yo: req.usuario.id });
});

r.post('/personal/:id/promover', async (req, res) => {
  const u = req.usuario;
  const out = await tx(async (c) => {
    const x = await usuarioPorId(c, req.params.id);
    si(x.estado !== 'Activo' || x.rol_id !== 'gg', 'Para llegar a director primero debe ser gerente general');
    si((await activos(c, null, 'gg')).length < 2, 'Para promover a un gerente general debe existir otro gerente general: ese puesto nunca puede quedar vacío');
    const pass = temporal();
    const pin = cuatro();
    await c.query(`UPDATE usuarios SET rol_id = 'director', sucursal_id = NULL, clave_hash = NULL, pass_hash = $2, pin_hash = $3, cambiar_pass = TRUE, cambiar_pin = TRUE WHERE id = $1`,
      [x.id, await bcrypt.hash(pass, 10), await bcrypt.hash(pin, 10)]);
    await historial(c, x.id, 'Ascenso', 'Gerente general → Director', u.nombre);
    await notificar(c, 'director', null, 'Nuevo director', x.nombre);
    await bitacora(c, u, { accion: 'director.promover', elemento: x.usuario });
    return { usuario: x.usuario, nombre: x.nombre, pass, pin };
  });
  res.json(out);
});

r.post('/directores/dejar', async (req, res) => {
  const u = req.usuario;
  const clave = await tx(async (c) => {
    si((await activos(c, null, 'director')).length < 2, 'Debe quedar al menos un director activo');
    const x = await usuarioPorId(c, u.id);
    const k = x.clave_hash ? null : cuatro();
    await c.query(`UPDATE usuarios SET rol_id = 'gg', pin_hash = NULL ${k ? ', clave_hash = $2, intentos_clave = 0' : ''} WHERE id = $1`, [u.id, ...(k ? [await bcrypt.hash(k, 10)] : [])]);
    await historial(c, u.id, 'Cambio de rol', 'Director → Gerente general', u.nombre);
    await bitacora(c, u, { accion: 'director.dejar', elemento: u.usuario });
    return k;
  });
  res.json({ ok: true, clave });
});

/* ---------- 8.5 Catálogo ---------- */
r.get('/catalogo', async (req, res) => { res.json(await catalogoCompleto(DB)); });

r.put('/catalogo/:id/foto', async (req, res) => {
  const url = req.body?.dataUrl ? await guardarImagen(req.body.dataUrl, 'productos', `pr${+req.params.id}`) : null;
  await tx(async (c) => {
    const { rows } = await c.query(`UPDATE productos SET foto_url = $2 WHERE id = $1 AND estado <> 'Eliminado' RETURNING nombre`, [req.params.id, url]);
    if (!rows[0]) throw noEncontrado('No se encontró el producto');
    await bitacora(c, req.usuario, { accion: url ? 'catalogo.foto' : 'catalogo.foto_quitar', elemento: rows[0].nombre });
  });
  res.json({ ok: true, foto: url });
});

r.post('/catalogo/:id/eliminar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM productos WHERE id = $1 AND estado <> 'Eliminado' FOR UPDATE`, [req.params.id]);
    const x = rows[0];
    si(!x, 'Este producto ya fue eliminado');
    const { rows: act } = await c.query(
      `SELECT count(DISTINCT p.id)::int n FROM pedidos p JOIN pedido_lineas l ON l.pedido_id = p.id LEFT JOIN pedido_linea_extras e ON e.linea_id = l.id
        WHERE p.estado NOT IN ('Cobrado','Cancelado','Rechazado') AND (l.producto_id = $1 OR e.extra_id = $1)`, [x.id]);
    si(act[0].n, `Hay ${act[0].n} pedidos en curso con este ${x.es_extra ? 'extra' : 'producto'}: espera a que terminen`);
    await c.query(`UPDATE productos SET estado = 'Eliminado' WHERE id = $1`, [x.id]);
    await c.query('DELETE FROM sucursal_menu WHERE producto_id = $1', [x.id]);
    await c.query('DELETE FROM extra_productos WHERE producto_id = $1 OR extra_id = $1', [x.id]);
    await bitacora(c, u, { accion: 'catalogo.eliminar', elemento: x.nombre, motivo: m });
  });
  res.json({ ok: true });
});

/* ---------- 8.6 Bitácora (solo lectura) ---------- */
r.get('/bitacora', async (req, res) => {
  const n = Math.min(500, Math.max(10, +req.query.n || 10));
  const filtro = `($1::text IS NULL OR b.rol_id = $1) AND ($2::int IS NULL OR b.sucursal_id = $2)
    AND ($3::text IS NULL OR (b.accion || ' ' || COALESCE(b.elemento,'') || ' ' || b.usuario_nombre || ' ' || b.motivo) ILIKE '%' || $3 || '%')`;
  const p = [req.query.rol || null, +req.query.suc || null, req.query.q ? String(req.query.q) : null];
  const { rows: tot } = await q(`SELECT count(*)::int n FROM bitacora b WHERE ${filtro}`, p);
  const { rows } = await q(`SELECT b.*, s.nombre AS suc_nombre FROM bitacora b LEFT JOIN sucursales s ON s.id = b.sucursal_id WHERE ${filtro} ORDER BY b.fecha DESC, b.id DESC LIMIT ${n}`, p);
  const { rows: sc } = await q('SELECT id, nombre FROM sucursales ORDER BY id');
  res.json({
    total: tot[0].n, sucursales: sc, roles: Object.entries(ROLN).map(([id, nombre]) => ({ id, nombre })),
    registros: rows.map((b) => ({
      id: b.id, fecha: b.fecha, usuario: b.usuario_nombre, rol: b.rol_id, rolNombre: ROLN[b.rol_id] || (b.rol_id === 'sistema' ? 'Sistema' : b.rol_id),
      suc: b.sucursal_id, sucNombre: b.suc_nombre, accion: b.accion, elemento: b.elemento, motivo: b.motivo, antes: b.antes, despues: b.despues, clave: b.con_clave,
    })),
  });
});

export default r;
