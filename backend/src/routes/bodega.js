import { Router } from 'express';
import { q, tx, ts } from '../db.js';
import { fallo, si, noEncontrado, motivo as validarMotivo } from '../lib/errores.js';
import { ahora, D } from '../lib/reloj.js';
import { bitacora, notificar } from '../lib/registro.js';
import { cfg, r2, sum, recetas } from '../lib/negocio.js';
import { minimosYStock } from '../lib/procesos.js';
import { cargarCompras, cargarCompra, compraParaCambiar, cotizar, crearCompras, skuNuevo } from '../lib/compras.js';
import { cargarSolicitudes } from '../lib/consultas.js';

/* Encargado de bodega · Inventario, Alertas, Compras, Recepción y Conteo físico */
const r = Router();
const DB = { query: q };
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Inventario de la sucursal: stock, mínimo, nivel, próximo vencimiento e inhabilitadas. */
export async function inventario(c, s) {
  const t = ahora();
  const k = await cfg(c);
  const mats = await minimosYStock(c, s, t, await recetas(c));
  const { rows: cats } = await c.query('SELECT mp_id, categoria FROM materia_categorias ORDER BY categoria');
  const { rows: inh } = await c.query('SELECT mp_id FROM sucursal_mp_inhabilitada WHERE sucursal_id = $1', [s]);
  const { rows: prox } = await c.query(
    `SELECT mp_id, min(vence) AS vence FROM lotes WHERE sucursal_id = $1 AND cantidad > 0 AND vence > $2 GROUP BY mp_id`, [s, ts(t)]);
  const { rows: info } = await c.query('SELECT id, unidad, categoria, vida_dias, descripcion, foto_url FROM materias_primas');
  const I = Object.fromEntries(info.map((x) => [x.id, x]));
  const off = new Set(inh.map((x) => x.mp_id));
  const P = Object.fromEntries(prox.map((x) => [x.mp_id, x.vence]));
  return mats.filter((m) => m.estado !== 'Inhabilitado').map((m) => ({
    id: m.id, nombre: m.nombre, unidad: m.unidad, categoria: I[m.id].categoria, categorias: cats.filter((x) => x.mp_id === m.id).map((x) => x.categoria),
    vida: I[m.id].vida_dias, desc: I[m.id].descripcion, foto: I[m.id].foto_url, stock: r2(m.stock), minimo: m.minimo, usos: m.usos,
    inhabilitada: off.has(m.id), proximo: P[m.id] || null, porVencer: !!P[m.id] && P[m.id] - t <= k.por_vencer_dias * D,
  }));
}

r.get('/inventario', async (req, res) => {
  const { rows: un } = await q('SELECT nombre FROM mp_unidades ORDER BY predeterminada DESC, nombre');
  const { rows: ca } = await q('SELECT nombre FROM mp_categorias ORDER BY nombre');
  res.json({ materias: await inventario(DB, req.usuario.sucursal), unidades: un.map((x) => x.nombre), categorias: ca.map((x) => x.nombre) });
});

/** Ficha de una materia prima: lotes, productos que la usan y solicitud de inhabilitación pendiente. */
r.get('/materias/:id', async (req, res) => {
  const s = req.usuario.sucursal;
  const { rows: lotes } = await q(
    `SELECT l.id, l.sku, l.fecha_compra AS compra, l.vence, l.cantidad AS cant, l.precio, l.estado, v.nombre AS prov
       FROM lotes l LEFT JOIN proveedores v ON v.id = l.proveedor_id WHERE l.mp_id = $1 AND l.sucursal_id = $2 ORDER BY l.vence`, [req.params.id, s]);
  const { rows: usan } = await q(
    `SELECT p.nombre FROM productos p JOIN recetas r ON r.producto_id = p.id AND r.mp_id = $1
       JOIN sucursal_menu sm ON sm.producto_id = p.id AND sm.sucursal_id = $2 WHERE NOT p.es_extra AND p.estado <> 'Inhabilitado' ORDER BY p.nombre`, [req.params.id, s]);
  const { rows: sol } = await q(
    `SELECT id FROM solicitudes WHERE tipo = 'Inhabilitar materia prima' AND mp_id = $1 AND sucursal_id = $2 AND estado = 'Solicitada'`, [req.params.id, s]);
  res.json({ lotes, usan: usan.map((x) => x.nombre), solicitud: !!sol[0] });
});

async function validarCategorias(c, cats) {
  const { rows } = await c.query('SELECT nombre FROM mp_categorias');
  const ok = new Set(rows.map((x) => x.nombre));
  const out = [...new Set((cats || []).filter((x) => ok.has(x)))];
  si(!out.length, 'Elige al menos una categoría');
  return out;
}

r.post('/materias', async (req, res) => {
  const u = req.usuario;
  const nombre = String(req.body?.nombre || '').trim();
  si(!nombre, 'Escribe el nombre');
  const out = await tx(async (c) => {
    const cats = await validarCategorias(c, req.body?.categorias);
    const { rows: un } = await c.query('SELECT 1 FROM mp_unidades WHERE nombre = $1', [req.body?.unidad]);
    si(!un[0], 'Elige una unidad válida');
    const { rows: ya } = await c.query('SELECT nombre FROM materias_primas');
    si(ya.some((m) => norm(m.nombre) === norm(nombre)), 'Ya existe una materia prima con ese nombre');
    const { rows } = await c.query(
      `INSERT INTO materias_primas (nombre, unidad, categoria, vida_dias) VALUES ($1,$2,$3,14) RETURNING id`, [nombre, req.body.unidad, cats[0]]);
    for (const x of cats) await c.query('INSERT INTO materia_categorias (mp_id, categoria) VALUES ($1,$2)', [rows[0].id, x]);
    await bitacora(c, u, { accion: 'materia.crear', elemento: nombre, despues: { unidad: req.body.unidad, categorias: cats } });
    return { id: rows[0].id };
  });
  res.status(201).json(out);
});

r.put('/materias/:id', async (req, res) => {
  const u = req.usuario;
  const nombre = String(req.body?.nombre || '').trim();
  si(!nombre, 'Escribe un nombre y elige al menos una categoría');
  await tx(async (c) => {
    const cats = await validarCategorias(c, req.body?.categorias);
    const { rows: ya } = await c.query('SELECT nombre FROM materias_primas WHERE id <> $1', [req.params.id]);
    si(ya.some((m) => norm(m.nombre) === norm(nombre)), 'Ya existe una materia prima con ese nombre');
    const { rows: antes } = await c.query('SELECT nombre, descripcion FROM materias_primas WHERE id = $1', [req.params.id]);
    if (!antes[0]) throw noEncontrado();
    await c.query('UPDATE materias_primas SET nombre = $2, categoria = $3, descripcion = $4 WHERE id = $1', [req.params.id, nombre, cats[0], String(req.body?.desc || '').trim()]);
    await c.query('DELETE FROM materia_categorias WHERE mp_id = $1', [req.params.id]);
    for (const x of cats) await c.query('INSERT INTO materia_categorias (mp_id, categoria) VALUES ($1,$2)', [req.params.id, x]);
    await bitacora(c, u, { accion: 'materia.editar', elemento: nombre, antes: antes[0], despues: { nombre, categorias: cats } });
  });
  res.json({ ok: true });
});

r.post('/materias/:id/inhabilitar', async (req, res) => {
  const u = req.usuario;
  const s = u.sucursal;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows: mp } = await c.query('SELECT nombre FROM materias_primas WHERE id = $1', [req.params.id]);
    if (!mp[0]) throw noEncontrado();
    const ya = await c.query(`SELECT 1 FROM solicitudes WHERE tipo = 'Inhabilitar materia prima' AND mp_id = $1 AND sucursal_id = $2 AND estado = 'Solicitada'`, [req.params.id, s]);
    si(ya.rowCount, 'Ya hay una solicitud de inhabilitación pendiente');
    const { rows: usan } = await c.query(
      `SELECT p.nombre FROM productos p JOIN recetas r ON r.producto_id = p.id AND r.mp_id = $1 JOIN sucursal_menu sm ON sm.producto_id = p.id AND sm.sucursal_id = $2
        WHERE NOT p.es_extra AND p.estado <> 'Inhabilitado'`, [req.params.id, s]);
    await c.query(
      `INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, mp_id, aprueba_rol, nombre, motivo, datos, fecha)
       VALUES ('Inhabilitar materia prima','Solicitada',$1,$2,$3,'gerente',$4,$5,$6,$7)`,
      [s, u.id, req.params.id, mp[0].nombre, m, JSON.stringify({ usan: usan.map((x) => x.nombre) }), ts(ahora())]);
    await notificar(c, 'gerente', s, 'Inhabilitación de materia prima', `${mp[0].nombre} · ${m}`);
    await bitacora(c, u, { accion: 'materia.solicitar_inhabilitacion', elemento: mp[0].nombre, motivo: m });
  });
  res.status(201).json({ ok: true });
});

/** Solicitar una unidad o una categoría de materia prima nueva (gerente → Recursos Humanos). */
r.post('/catalogo', async (req, res) => {
  const u = req.usuario;
  const tipo = req.body?.tipo;
  si(!['Unidad nueva', 'Categoría de materia prima'].includes(tipo), 'Tipo inválido');
  const nombre = String(req.body?.nombre || '').trim();
  si(!nombre, 'Escribe el nombre');
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const tabla = tipo === 'Unidad nueva' ? 'mp_unidades' : 'mp_categorias';
    const { rows } = await c.query(`SELECT nombre FROM ${tabla}`);
    const { rows: sols } = await c.query(`SELECT nombre FROM solicitudes WHERE tipo = $1 AND estado NOT IN ('Rechazada','Aprobada','Aplicada')`, [tipo]);
    si([...rows, ...sols].some((x) => norm(x.nombre) === norm(nombre)), 'Ya existe o está en trámite');
    await c.query(`INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, aprueba_rol, nombre, motivo, fecha) VALUES ($1,'Solicitada',$2,$3,'gerente',$4,$5,$6)`,
      [tipo, u.sucursal, u.id, nombre, m, ts(ahora())]);
    await notificar(c, 'gerente', u.sucursal, `Solicitud de ${tipo === 'Unidad nueva' ? 'unidad' : 'categoría'}`, nombre);
    await bitacora(c, u, { accion: 'catalogoMP.solicitar', elemento: nombre, motivo: m });
  });
  res.status(201).json({ ok: true });
});

r.get('/solicitudes', async (req, res) => {
  res.json(await cargarSolicitudes(DB, `s.solicitante_id = $1 AND s.tipo IN ('Inhabilitar materia prima','Unidad nueva','Categoría de materia prima')`, [req.usuario.id]));
});

/* ---------- alertas ---------- */
r.get('/alertas', async (req, res) => {
  const s = req.usuario.sucursal;
  const k = await cfg(DB);
  const inv = await inventario(DB, s);
  const stockBajo = inv.filter((m) => !m.inhabilitada && m.minimo > 0 && m.stock < m.minimo).sort((a, b) => a.stock / a.minimo - b.stock / b.minimo);
  const t = ahora();
  const { rows: lotes } = await q(
    `SELECT l.id, l.sku, l.mp_id, l.cantidad AS cant, l.vence, m.nombre, m.unidad, o.estado AS oferta
       FROM lotes l JOIN materias_primas m ON m.id = l.mp_id LEFT JOIN ofertas o ON o.lote_id = l.id
      WHERE l.sucursal_id = $1 AND l.cantidad > 0 AND l.vence > $2 AND l.vence - $2 <= $3 * interval '1 day' ORDER BY l.vence`,
    [s, ts(t), k.por_vencer_dias]);
  const { rows: usan } = await q(
    `SELECT r.mp_id, p.nombre FROM recetas r JOIN productos p ON p.id = r.producto_id JOIN sucursal_menu sm ON sm.producto_id = p.id AND sm.sucursal_id = $1
      WHERE NOT p.es_extra AND p.estado <> 'Inhabilitado'`, [s]);
  res.json({
    stockBajo,
    porVencer: lotes.map((l) => ({ ...l, dias: Math.max(0, Math.ceil((l.vence - t) / D)), productos: usan.filter((x) => x.mp_id === l.mp_id).map((x) => x.nombre) })),
  });
});

/* ---------- compras ---------- */
r.get('/compras', async (req, res) => {
  const s = req.usuario.sucursal;
  res.json(await cargarCompras(DB, `c.sucursal_id = $1 ${req.query.estado ? 'AND c.estado = $2' : ''}`, req.query.estado ? [s, req.query.estado] : [s]));
});

r.get('/compras/:id', async (req, res) => {
  const cp = await cargarCompra(DB, req.params.id);
  if (!cp || cp.suc !== req.usuario.sucursal) throw noEncontrado('No se encontró la solicitud');
  res.json(cp);
});

r.get('/cotizar', async (req, res) => {
  const mps = String(req.query.mps || '').split(',').map(Number).filter(Boolean);
  res.json(await cotizar(DB, mps, req.usuario.sucursal));
});

r.post('/compras', async (req, res) => {
  const u = req.usuario;
  const creadas = await tx(async (c) => {
    const out = await crearCompras(c, u.sucursal, req.body?.items, u);
    for (const x of out) {
      await bitacora(c, u, { accion: 'compra.preparar', elemento: `Compra #${x.id}`, despues: { prov: x.prov, total: x.total } });
      await notificar(c, 'gerente', u.sucursal, 'Solicitud de compra por aceptar', `${x.prov} · $${x.total.toFixed(2)}`);
    }
    return out;
  });
  res.status(201).json(creadas);
});

r.post('/compras/:id/cancelar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const cp = await compraParaCambiar(c, req.params.id, u.sucursal);
    si(cp.estado !== 'Preparada', 'Ya fue aceptada por el gerente');
    await c.query(`UPDATE compras SET estado = 'Cancelada', detalle = detalle || $2::jsonb WHERE id = $1`,
      [cp.id, JSON.stringify({ cancelada: { por: u.nombre, fecha: ahora() } })]);
    await bitacora(c, u, { accion: 'compra.cancelar_preparada', elemento: `Compra #${cp.id}` });
  });
  res.json({ ok: true });
});

/* ---------- recepción ---------- */
r.get('/recepcion', async (req, res) => {
  const s = req.usuario.sucursal;
  const enCamino = await cargarCompras(DB, `c.sucursal_id = $1 AND c.estado = 'En camino'`, [s], 'c.llegada');
  const { rows: vida } = await q('SELECT id, vida_dias FROM materias_primas');
  const V = Object.fromEntries(vida.map((x) => [x.id, x.vida_dias]));
  for (const cp of enCamino) {
    cp.sugerido = {};
    for (const l of cp.lineas) cp.sugerido[l.mp] = { sku: await skuNuevo(DB, l.mp, s), vence: ahora() + (V[l.mp] || 14) * D };
  }
  const enviadas = await cargarCompras(DB, `c.sucursal_id = $1 AND EXISTS (SELECT 1 FROM compra_recepcion r WHERE r.compra_id = c.id)`, [s]);
  res.json({ enCamino, enviadas: enviadas.sort((a, b) => b.recepcion.fecha - a.recepcion.fecha), ahora: ahora() });
});

r.post('/compras/:id/recepcion', async (req, res) => {
  const u = req.usuario;
  const lotes = (req.body?.lotes || []).map((x) => ({ mp: +x.mp, sku: String(x.sku || '').trim(), cant: +x.cant, vence: +x.vence }));
  await tx(async (c) => {
    const cp = await compraParaCambiar(c, req.params.id, u.sucursal);
    si(cp.estado !== 'En camino' || !cp.llego, 'Todavía no llega la mercancía');
    const { rows: lineas } = await c.query('SELECT mp_id, cantidad FROM compra_lineas WHERE compra_id = $1', [cp.id]);
    si(!lotes.length, 'Registra al menos un lote');
    for (const x of lotes) {
      si(!lineas.some((l) => l.mp_id === x.mp), 'Hay un lote de una materia prima que no venía en la compra');
      si(!x.sku, 'Falta el código SKU');
      si(!(x.cant > 0), `Cantidad mayor que 0 en ${x.sku}`);
      si(!(x.vence > ahora()), `El vencimiento de ${x.sku} debe ser posterior a hoy`);
    }
    for (const l of lineas) si(sum(lotes.filter((x) => x.mp === l.mp_id), (x) => x.cant) > l.cantidad + 1e-9, 'Recibiste más de lo pedido');
    const skus = lotes.map((x) => x.sku);
    si(new Set(skus).size !== skus.length, 'Hay códigos SKU repetidos');
    const ya = await c.query('SELECT 1 FROM lotes WHERE sku = ANY($1) UNION SELECT 1 FROM compra_recepcion WHERE sku = ANY($1)', [skus]);
    si(ya.rowCount, 'Un código SKU ya existe en el inventario');
    for (const x of lotes) {
      await c.query('INSERT INTO compra_recepcion (compra_id, mp_id, sku, cantidad, vence, fecha, por) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [cp.id, x.mp, x.sku, x.cant, ts(x.vence), ts(ahora()), u.id]);
    }
    await c.query(`UPDATE compras SET estado = 'Recibida' WHERE id = $1`, [cp.id]);
    const { rows: v } = await c.query('SELECT nombre FROM proveedores WHERE id = $1', [cp.proveedor_id]);
    await notificar(c, 'gerente', u.sucursal, 'Mercancía por aceptar', `${v[0].nombre} · compra #${cp.id}`);
    await bitacora(c, u, { accion: 'compra.recepcion', elemento: `Compra #${cp.id}`, despues: { lotes: lotes.length } });
  });
  res.json({ ok: true });
});

/** Bodega propone devolver (llegó menos o más de lo pedido); decide el gerente. */
r.post('/compras/:id/devolver', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const cp = await compraParaCambiar(c, req.params.id, u.sucursal);
    si(cp.estado !== 'Recibida' || cp.detalle?.devolucionBodega, 'Ya no se puede proponer la devolución');
    await c.query('UPDATE compras SET detalle = detalle || $2::jsonb WHERE id = $1', [cp.id, JSON.stringify({ devolucionBodega: { por: u.id, porNombre: u.nombre, motivo: m, fecha: ahora() } })]);
    const { rows: v } = await c.query('SELECT nombre FROM proveedores WHERE id = $1', [cp.proveedor_id]);
    await notificar(c, 'gerente', u.sucursal, 'Bodega propone devolver mercancía', `${v[0].nombre}: ${m}`);
    await bitacora(c, u, { accion: 'compra.devolucion_bodega', elemento: `Compra #${cp.id}`, motivo: m });
  });
  res.json({ ok: true });
});

/* ---------- conteo físico ---------- */
export async function cargarConteos(c, s) {
  const { rows } = await c.query(
    `SELECT k.*, u.nombre AS bodega_nombre, d.nombre AS decidio_nombre FROM conteos k JOIN usuarios u ON u.id = k.bodega_id
       LEFT JOIN usuarios d ON d.id = k.decidio_id WHERE k.sucursal_id = $1 ORDER BY k.fecha DESC`, [s]);
  const { rows: filas } = await c.query(
    `SELECT f.*, m.nombre, m.unidad FROM conteo_filas f JOIN materias_primas m ON m.id = f.mp_id WHERE f.conteo_id = ANY($1)`, [rows.map((x) => x.id)]);
  return rows.map((k) => ({
    id: k.id, fecha: k.fecha, estado: k.estado, motivo: k.motivo, bodega: k.bodega_id, bodegaNombre: k.bodega_nombre,
    decidioNombre: k.decidio_nombre, decidido: k.decidido, motivoDecision: k.motivo_decision,
    filas: filas.filter((f) => f.conteo_id === k.id).map((f) => ({ mp: f.mp_id, nombre: f.nombre, unidad: f.unidad, sistema: f.sistema, contado: f.contado })),
  }));
}

r.get('/conteo', async (req, res) => {
  const s = req.usuario.sucursal;
  const { rows } = await q(
    `SELECT m.id, m.nombre, m.unidad,
            COALESCE((SELECT round(sum(l.cantidad), 2) FROM lotes l WHERE l.mp_id = m.id AND l.sucursal_id = $1 AND l.cantidad > 0 AND l.vence > $2), 0) AS sistema
       FROM materias_primas m WHERE m.estado = 'Activo'
        AND NOT EXISTS (SELECT 1 FROM sucursal_mp_inhabilitada x WHERE x.sucursal_id = $1 AND x.mp_id = m.id)
        AND EXISTS (SELECT 1 FROM lotes l WHERE l.mp_id = m.id AND l.sucursal_id = $1) ORDER BY m.nombre`, [s, ts(ahora())]);
  const conteos = await cargarConteos(DB, s);
  res.json({ materias: rows, conteos, pendiente: conteos.some((k) => k.estado === 'Enviado') });
});

r.post('/conteos', async (req, res) => {
  const u = req.usuario;
  const s = u.sucursal;
  await tx(async (c) => {
    const ya = await c.query(`SELECT 1 FROM conteos WHERE sucursal_id = $1 AND estado = 'Enviado'`, [s]);
    si(ya.rowCount, 'Ya tienes un conteo esperando al gerente');
    const filas = (req.body?.filas || []).filter((f) => f.contado !== '' && f.contado != null && +f.contado >= 0);
    si(!filas.length, 'Escribe al menos una cantidad contada');
    const out = [];
    for (const f of filas) {
      const { rows } = await c.query(
        `SELECT COALESCE(round(sum(cantidad), 2), 0) AS s FROM lotes WHERE mp_id = $1 AND sucursal_id = $2 AND cantidad > 0 AND vence > $3`, [f.mp, s, ts(ahora())]);
      out.push({ mp: +f.mp, sistema: rows[0].s, contado: r2(+f.contado) });
    }
    const hay = out.some((f) => f.contado !== f.sistema);
    const m = String(req.body?.motivo || '').trim();
    if (hay) si(m.length < 10, 'Explica el motivo de las diferencias (mínimo 10 caracteres)');
    const { rows } = await c.query(`INSERT INTO conteos (sucursal_id, bodega_id, fecha, motivo) VALUES ($1,$2,$3,$4) RETURNING id`, [s, u.id, ts(ahora()), m]);
    for (const f of out) await c.query('INSERT INTO conteo_filas (conteo_id, mp_id, sistema, contado) VALUES ($1,$2,$3,$4)', [rows[0].id, f.mp, f.sistema, f.contado]);
    await notificar(c, 'gerente', s, 'Conteo físico por aprobar', `${out.length} materias primas`);
    await bitacora(c, u, { accion: 'conteo.enviar', elemento: 'conteo', despues: { filas: out.length }, motivo: m });
  });
  res.status(201).json({ ok: true });
});

export default r;
