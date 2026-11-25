import { Router } from 'express';
import { q, tx, ts } from '../db.js';
import { fallo, si, noEncontrado, prohibido, motivo as validarMotivo } from '../lib/errores.js';
import { ahora } from '../lib/reloj.js';
import { bitacora, notificar } from '../lib/registro.js';
import { verificarClave } from '../lib/clave.js';
import { cfg, r2, sum, costoPropuesta, neto } from '../lib/negocio.js';
import { cargarSolicitudes } from '../lib/consultas.js';
import { creditoFactura, ajusteFactura } from '../lib/procesos.js';
import { cargarCompras, compraParaCambiar, aceptarGG, perdidaCompra } from '../lib/compras.js';
import { ROLN, ROLES_SUC, activos, necesarios, abrirVacantes, aplicarDespido } from '../lib/personal.js';
import { crearMateria, sustituirNueva, unidadDeNueva, altaPrecio, cambio } from '../lib/proveedores.js';
import { TAM, intervaloSuc, costoSuc, abiertosSuc, crearSucursal } from '../lib/sucursales.js';
import { rangos, ventasRango, gastos, porDia, totalDe } from '../lib/panel.js';
import { ranking, costoMax } from './gerente.js';
import { cargarReportes, filasReporte } from './rrhh.js';

/* Gerente general · 7.1 Panel a 7.10 Plantilla. Sin clave salvo al cambiar la receta de un producto. */
const r = Router();
const DB = { query: q };
const TP = ['Producto nuevo', 'Extra nuevo', 'Categoría nueva'];
const COMPRAS_PEND = ['Aceptada por gerente', 'Devolución en revisión', 'Cancelación en revisión', 'Descuento en revisión'];
const REVISION = ['Devolución en revisión', 'Cancelación en revisión', 'Descuento en revisión'];
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const sucursales = async (c) => (await c.query('SELECT id, nombre, zona, tamano, estado, costo, mesas FROM sucursales ORDER BY id')).rows;
const rechazo = (u, m, etapa = 'Gerente general') => JSON.stringify({ por: u.nombre, etapa, motivo: m, fecha: ahora() });

/* ---------- pendientes por tipo (y por sucursal) ---------- */
export async function pendientesGG(c, s = null) {
  const n = async (sql, p = []) => (await c.query(sql, [s, ...p])).rows[0].n;
  const sol = (tipo, extra = '') => n(`SELECT count(*)::int n FROM solicitudes WHERE ($1::int IS NULL OR sucursal_id = $1) AND tipo = $2 AND estado = 'Solicitada' ${extra}`, [tipo]);
  return {
    Compras: await n(`SELECT count(*)::int n FROM compras WHERE ($1::int IS NULL OR sucursal_id = $1) AND estado = ANY($2)`, [COMPRAS_PEND]),
    Proveedores: await sol('Materia sin proveedor'),
    Precios: await sol('Cambio de precio'),
    Menús: await sol('Agregar al menú'),
    Productos: await n(`SELECT count(*)::int n FROM solicitudes WHERE ($1::int IS NULL OR sucursal_id = $1) AND tipo = ANY($2) AND estado = 'Aprobado por gerente de sucursal'`, [TP]),
    Nómina: (s ? 0 : await n(`SELECT count(*)::int n FROM solicitudes WHERE $1::int IS NULL AND tipo = 'Salario' AND estado = 'Solicitada'`))
      + await n(`SELECT count(*)::int n FROM reportes_pago WHERE ($1::int IS NULL OR sucursal_id = $1) AND estado = 'Enviado'`),
    Despidos: await sol('Despido', `AND aprueba_rol = 'gg'`),
    Personal: await sol('Personal'),
  };
}

/* ---------- 7.1 Panel ---------- */
r.get('/panel', async (req, res) => {
  const s = +req.query.suc || null;
  const per = req.query.per || 'Hoy';
  const [[a, b], [pa, pb]] = rangos(per);
  const L = await ventasRango(DB, s, a, b);
  const P = await ventasRango(DB, s, pa, pb);
  const pen = await pendientesGG(DB, s);
  const sucs = (await sucursales(DB)).filter((x) => !s || x.id === s);
  const filas = [];
  for (const x of sucs) {
    const pend = await pendientesGG(DB, x.id);
    filas.push({
      id: x.id, nombre: x.nombre, zona: x.zona, tamano: TAM[x.tamano], estado: x.estado, ventas: totalDe(L, x.id), gastos: await gastos(DB, x.id, a, b),
      pendientes: Object.values(pend).reduce((p, v) => p + v, 0), personal: (await activos(DB, x.id)).length,
      top: (await ranking(DB, x.id, a, b, 'prod')).slice(0, 5),
    });
  }
  res.json({
    ventas: totalDe(L), ventasAnt: totalDe(P), gastos: await gastos(DB, s, a, b), gastosAnt: await gastos(DB, s, pa, pb),
    pendientes: pen, dias: await porDia(DB, s, per === '30 días' ? 30 : 7),
    porSucursal: filas.map((x) => [x.nombre, x.ventas]).sort((p, q2) => q2[1] - p[1]),
    porCategoria: await ranking(DB, s, a, b, 'cat'), topProductos: (await ranking(DB, s, a, b, 'prod')).slice(0, 5),
    filas, sucursales: (await sucursales(DB)).map((x) => ({ id: x.id, nombre: x.nombre })),
  });
});

/* ---------- 7.2 Compras ---------- */
r.get('/compras', async (req, res) => {
  const s = +req.query.suc || null;
  const base = await cargarCompras(DB, `($1::int IS NULL OR c.sucursal_id = $1) AND c.estado <> 'Preparada'`, [s]);
  const t = ahora();
  for (const c of base) c.cotVencida = c.estado === 'Aceptada por gerente' && c.cot.vence <= t;
  const grupos = {
    aceptar: base.filter((c) => c.estado === 'Aceptada por gerente'),
    rev: base.filter((c) => REVISION.includes(c.estado)),
    hist: base.filter((c) => !COMPRAS_PEND.includes(c.estado)),
  };
  res.json({ compras: grupos[req.query.vista] || grupos.aceptar, n: { aceptar: grupos.aceptar.length, rev: grupos.rev.length, hist: grupos.hist.length },
    sucursales: (await sucursales(DB)).map((x) => ({ id: x.id, nombre: x.nombre })) });
});

r.post('/compras/:id/aceptar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const cp = await compraParaCambiar(c, req.params.id);
    si(!COMPRAS_PEND.includes(cp.estado), 'Esta compra ya fue decidida');
    const { rows: pv } = await c.query('SELECT nombre FROM proveedores WHERE id = $1', [cp.proveedor_id]);
    const prov = pv[0].nombre;
    const d = cp.detalle || {};
    if (cp.estado === 'Aceptada por gerente') {
      si(cp.cot_vence <= ahora(), 'La cotización venció. Rechaza la solicitud para que se cotice de nuevo.');
      await aceptarGG(c, cp, u);
      await bitacora(c, u, { accion: 'compra.aceptar.gg', elemento: `Compra #${cp.id}`, despues: { total: cp.total }, sucursal: cp.sucursal_id });
    } else if (cp.estado === 'Descuento en revisión') {
      const inf = d.solDescuento;
      if (cp.factura_id) await creditoFactura(c, cp.factura_id, cp.proveedor_id, inf.tipo, inf.monto, inf.motivo);
      await c.query(`UPDATE compras SET estado = 'Recibida', detalle = (detalle - 'solDescuento') || $2::jsonb WHERE id = $1`,
        [cp.id, JSON.stringify({ solDescuentoRes: { tipo: inf.tipo, estado: 'Aprobada', monto: inf.monto }, descuentoAplicado: r2((d.descuentoAplicado || 0) + inf.monto) })]);
      await notificar(c, 'gerente', cp.sucursal_id, `${inf.tipo} aprobado`, `${prov} · $${(+inf.monto).toFixed(2)}`);
      await bitacora(c, u, { accion: 'compra.descuento.aprobar', elemento: `Compra #${cp.id}`, despues: { tipo: inf.tipo, monto: inf.monto }, sucursal: cp.sucursal_id });
    } else {
      const dev = cp.estado === 'Devolución en revisión';
      const inf = dev ? d.devolucion : d.cancelacion;
      const perd = r2(inf?.perdida || 0);
      await c.query('UPDATE compras SET estado = $2 WHERE id = $1', [cp.id, dev ? 'Devuelta' : 'Cancelada']);
      if (cp.factura_id) {
        const { rows: f } = await c.query('SELECT estado FROM facturas WHERE id = $1', [cp.factura_id]);
        if (f[0]?.estado === 'Pagada') await ajusteFactura(c, cp.factura_id, cp.proveedor_id, perd, dev ? 'Devolución aceptada' : 'Cancelación aceptada');
        else {
          await c.query('DELETE FROM factura_creditos WHERE factura_id = $1', [cp.factura_id]);
          await c.query(`UPDATE facturas SET monto = $2, estado = CASE WHEN $2::numeric = 0 THEN 'Anulada' ELSE estado END WHERE id = $1`, [cp.factura_id, perd]);
        }
      }
      if (perd) await perdidaCompra(c, { suc: cp.sucursal_id, tipo: dev ? 'Devolución de compra' : 'Cancelación de compra', compra: cp.id, motivo: inf.motivo, costo: perd, por: inf.por });
      const t = dev ? 'Devolución aceptada' : 'Cancelación aceptada';
      await notificar(c, 'gerente', cp.sucursal_id, t, prov);
      await notificar(c, 'bodega', cp.sucursal_id, t, prov);
      await bitacora(c, u, { accion: dev ? 'compra.devolucion.aceptar' : 'compra.cancelacion.aceptar', elemento: `Compra #${cp.id}`, despues: { perdida: perd }, sucursal: cp.sucursal_id });
    }
  });
  res.json({ ok: true });
});

r.post('/compras/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const cp = await compraParaCambiar(c, req.params.id);
    si(!COMPRAS_PEND.includes(cp.estado), 'Esta compra ya fue decidida');
    const { rows: pv } = await c.query('SELECT nombre FROM proveedores WHERE id = $1', [cp.proveedor_id]);
    const d = cp.detalle || {};
    const f = ahora();
    if (cp.estado === 'Aceptada por gerente') {
      await c.query(`UPDATE compras SET estado = 'Rechazada', detalle = detalle || $2::jsonb WHERE id = $1`,
        [cp.id, JSON.stringify({ rechazo: { por: 'Gerente general', etapa: 2, motivo: m } })]);
      await notificar(c, 'bodega', cp.sucursal_id, 'Solicitud rechazada', m);
    } else if (cp.estado === 'Descuento en revisión') {
      await c.query(`UPDATE compras SET estado = 'Recibida', detalle = (detalle - 'solDescuento') || $2::jsonb WHERE id = $1`,
        [cp.id, JSON.stringify({ solDescuentoRes: { tipo: d.solDescuento?.tipo, estado: 'Rechazada', motivoRes: m } })]);
    } else if (cp.estado === 'Devolución en revisión') {
      await c.query(`UPDATE compras SET estado = 'Recibida', detalle = (detalle - 'devolucion') || $2::jsonb WHERE id = $1`,
        [cp.id, JSON.stringify({ devolucionRechazada: { motivo: m, fecha: f } })]);
    } else {
      await c.query(`UPDATE compras SET estado = $2, detalle = (detalle - 'cancelacion') || $3::jsonb WHERE id = $1`,
        [cp.id, d.cancelacion?.estadoAnt || 'En camino', JSON.stringify({ cancelacionRechazada: { motivo: m, fecha: f } })]);
    }
    const rev = cp.estado !== 'Aceptada por gerente';
    await notificar(c, 'gerente', cp.sucursal_id, rev ? 'Compra sin cambios' : 'Compra rechazada', `${pv[0].nombre}: ${m}`);
    await bitacora(c, u, { accion: rev ? 'compra.rechazar_revision' : 'compra.rechazar.gg', elemento: `Compra #${cp.id}`, motivo: m, sucursal: cp.sucursal_id });
  });
  res.json({ ok: true });
});

/* ---------- 7.4 Materias primas sin proveedor ---------- */
r.get('/sin-proveedor', async (req, res) => {
  const L = await cargarSolicitudes(DB, `s.tipo = 'Materia sin proveedor' AND s.estado = 'Solicitada'`, [], 's.fecha');
  const { rows: mats } = await q('SELECT id, nombre, unidad FROM materias_primas');
  const M = Object.fromEntries(mats.map((m) => [m.id, m]));
  const { rows: pm } = await q(`SELECT pm.mp_id, v.id, v.nombre FROM proveedor_materias pm JOIN proveedores v ON v.id = pm.proveedor_id AND v.estado = 'Activo'`);
  const { rows: provs } = await q(`SELECT id, nombre FROM proveedores WHERE estado = 'Activo' ORDER BY nombre`);
  const { rows: sc } = await q('SELECT id, nombre FROM sucursales');
  const SN = Object.fromEntries(sc.map((x) => [x.id, x.nombre]));
  res.json(L.map((x) => {
    const ref = String(x.datos?.mp || '');
    const nueva = ref.startsWith('new:');
    return {
      id: x.id, ref, nueva, mpNombre: nueva ? `${ref.slice(4)} (nueva)` : M[+ref]?.nombre || '—', producto: x.datos?.producto || x.nombre,
      propone: x.datos?.propone || x.solicitanteNombre, suc: x.suc, sucNombre: SN[x.suc], fecha: x.fecha,
      candidatos: nueva ? provs : provs.filter((v) => pm.some((p) => p.id === v.id && p.mp_id === +ref)),
      todos: provs,
    };
  }));
});

r.post('/sin-proveedor/:id/asignar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = 'Materia sin proveedor' AND estado = 'Solicitada' FOR UPDATE`, [req.params.id]);
    const x = rows[0];
    si(!x, 'Esta solicitud ya fue atendida');
    const { rows: pv } = await c.query(`SELECT id, nombre FROM proveedores WHERE id = $1 AND estado = 'Activo'`, [req.body?.proveedor]);
    si(!pv[0], 'Elige un proveedor activo');
    const ref = String(x.datos?.mp || '');
    let mp = +ref;
    if (ref.startsWith('new:')) {
      mp = await crearMateria(c, u, ref.slice(4), await unidadDeNueva(c, ref));
      await sustituirNueva(c, ref, mp);
    }
    const { rows: ya } = await c.query('SELECT 1 FROM proveedor_materias WHERE proveedor_id = $1 AND mp_id = $2', [pv[0].id, mp]);
    const { rows: mn } = await c.query('SELECT nombre FROM materias_primas WHERE id = $1', [mp]);
    if (!ya[0]) { await altaPrecio(c, pv[0].id, mp); await cambio(c, pv[0].id, `Ofrece ${mn[0].nombre}`); }
    await c.query(`UPDATE solicitudes SET estado = 'Aplicada', mp_id = $2, decidio_id = $3, cierre = $4, datos = datos || $5::jsonb WHERE id = $1`,
      [x.id, mp, u.id, ts(ahora()), JSON.stringify({ mp: String(mp), proveedor: pv[0].id })]);
    await notificar(c, 'gerente', x.sucursal_id, 'Proveedor asignado', `${mn[0].nombre} · ${pv[0].nombre}`);
    await bitacora(c, u, { accion: 'proveedor.asignar', elemento: mn[0].nombre, despues: { proveedor: pv[0].nombre } });
  });
  res.json({ ok: true });
});

r.post('/sin-proveedor/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = 'Materia sin proveedor' AND estado = 'Solicitada' FOR UPDATE`, [req.params.id]);
    const x = rows[0];
    si(!x, 'Esta solicitud ya fue atendida');
    await c.query(`UPDATE solicitudes SET estado = 'Rechazada', rechazo = $2, decidio_id = $3, cierre = $4 WHERE id = $1`, [x.id, rechazo(u, m), u.id, ts(ahora())]);
    const { rows: pr } = await c.query(
      `UPDATE solicitudes SET estado = 'Rechazado', rechazo = $4 WHERE tipo = ANY($1) AND nombre = $2 AND sucursal_id = $3 AND estado NOT IN ('Rechazado','En catálogo')
        RETURNING nombre`, [TP, x.nombre, x.sucursal_id, rechazo(u, m)]);
    if (pr[0]) await notificar(c, 'cocinero', x.sucursal_id, 'Propuesta rechazada', `${pr[0].nombre}: ${m}`);
    await bitacora(c, u, { accion: 'proveedor.rechazar_sin_proveedor', elemento: x.nombre, motivo: m });
  });
  res.json({ ok: true });
});

/* ---------- 7.5 Precios ---------- */
r.get('/precios', async (req, res) => {
  const k = await cfg(DB);
  const L = await cargarSolicitudes(DB, `s.tipo = 'Cambio de precio' AND s.estado = 'Solicitada'`, [], 's.fecha');
  const { rows: sc } = await q('SELECT id, nombre FROM sucursales');
  const SN = Object.fromEntries(sc.map((x) => [x.id, x.nombre]));
  const out = [];
  for (const x of L) {
    const cm = await costoMax(DB, x.producto);
    const nt = r2(neto(x.datos.precio, k));
    out.push({ ...x, sucNombre: SN[x.suc], precioActual: x.datos.precioActual, precio: x.datos.precio, neto: nt, costoMax: cm, margen: r2(nt - cm), pct: nt ? Math.round(((nt - cm) / nt) * 100) : 0 });
  }
  const { rows: prods } = await q(`SELECT id, nombre FROM productos WHERE NOT es_extra AND estado <> 'Eliminado' ORDER BY nombre`);
  res.json({ pendientes: out, productos: prods });
});

r.get('/precios/historial/:prod', async (req, res) => {
  const { rows } = await q('SELECT precio, desde, hasta, aprobo FROM precios_historial WHERE producto_id = $1 ORDER BY desde DESC, id DESC', [req.params.prod]);
  res.json(rows);
});

/** Cierra el precio vigente y abre el nuevo (vale para todas las sucursales). */
async function cambiarPrecio(c, prodId, precio, u, solId) {
  const t = ts(ahora());
  await c.query('UPDATE precios_historial SET hasta = $2 WHERE producto_id = $1 AND hasta IS NULL', [prodId, t]);
  await c.query('INSERT INTO precios_historial (producto_id, precio, desde, aprobo, solicitud_id) VALUES ($1,$2,$3,$4,$5)', [prodId, precio, t, u.nombre, solId ?? null]);
  await c.query(`UPDATE productos SET precio = $2, estado = CASE WHEN estado = 'Precio por revisar' THEN 'Activo' ELSE estado END WHERE id = $1`, [prodId, precio]);
}

r.post('/precios/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = 'Cambio de precio' AND estado = 'Solicitada' FOR UPDATE`, [req.params.id]);
    const x = rows[0];
    si(!x, 'Esta solicitud ya fue decidida');
    const k = await cfg(c);
    si(neto(x.datos.precio, k) < (await costoMax(c, x.producto_id)), 'El precio es menor que el costo más alto');
    await cambiarPrecio(c, x.producto_id, x.datos.precio, u, x.id);
    await c.query(`UPDATE solicitudes SET estado = 'Aplicada', decidio_id = $2, cierre = $3 WHERE id = $1`, [x.id, u.id, ts(ahora())]);
    await notificar(c, 'gerente', x.sucursal_id, 'Precio aprobado', `${x.nombre} · $${(+x.datos.precio).toFixed(2)}`);
    await bitacora(c, u, { accion: 'precio.aprobar', elemento: x.nombre, antes: { precio: x.datos.precioActual }, despues: { precio: x.datos.precio }, motivo: x.motivo, sucursal: x.sucursal_id });
  });
  res.json({ ok: true });
});

/** Rechazo genérico de una solicitud «Solicitada» con aviso a quien corresponde. */
async function rechazarSolicitud(req, tipo, aviso) {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = $2 AND estado = 'Solicitada' FOR UPDATE`, [req.params.id, tipo]);
    const x = rows[0];
    si(!x, 'Esta solicitud ya fue decidida');
    if (x.aprueba_rol && x.aprueba_rol !== u.rol) throw prohibido();
    await c.query(`UPDATE solicitudes SET estado = 'Rechazada', rechazo = $2, decidio_id = $3, cierre = $4 WHERE id = $1`, [x.id, rechazo(u, m), u.id, ts(ahora())]);
    const [rol, titulo] = aviso;
    await notificar(c, rol, rol === 'gerente' ? x.sucursal_id : null, titulo, `${x.nombre || ''}: ${m}`);
    await bitacora(c, u, { accion: `${tipo.toLowerCase().replace(/\s+/g, '_')}.rechazar`, elemento: x.nombre, motivo: m, sucursal: x.sucursal_id });
  });
}
r.post('/precios/:id/rechazar', async (req, res) => { await rechazarSolicitud(req, 'Cambio de precio', ['gerente', 'Precio rechazado']); res.json({ ok: true }); });

/* ---------- agregar productos al menú de una sucursal ---------- */
r.get('/menus', async (req, res) => {
  const L = await cargarSolicitudes(DB, `s.tipo = 'Agregar al menú' AND s.estado = 'Solicitada'`, [], 's.fecha');
  const { rows: p } = await q(`SELECT p.id, p.precio, ARRAY(SELECT cg.nombre FROM producto_categorias pc JOIN categorias cg ON cg.id = pc.categoria_id WHERE pc.producto_id = p.id) AS cats FROM productos p`);
  const P = Object.fromEntries(p.map((x) => [x.id, x]));
  const { rows: sc } = await q('SELECT id, nombre FROM sucursales');
  const SN = Object.fromEntries(sc.map((x) => [x.id, x.nombre]));
  res.json(L.map((x) => ({ ...x, sucNombre: SN[x.suc], precio: P[x.producto]?.precio, cats: P[x.producto]?.cats || [] })));
});
r.post('/menus/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = 'Agregar al menú' AND estado = 'Solicitada' FOR UPDATE`, [req.params.id]);
    const x = rows[0];
    si(!x, 'Esta solicitud ya fue decidida');
    await c.query('INSERT INTO sucursal_menu (sucursal_id, producto_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [x.sucursal_id, x.producto_id]);
    await c.query(`INSERT INTO menu_historial (sucursal_id, producto_id, estado, fecha, razon, por) VALUES ($1,$2,'Activo',$3,'',$4)`, [x.sucursal_id, x.producto_id, ts(ahora()), u.nombre]);
    await c.query(`UPDATE solicitudes SET estado = 'Aplicada', decidio_id = $2, cierre = $3 WHERE id = $1`, [x.id, u.id, ts(ahora())]);
    await notificar(c, 'gerente', x.sucursal_id, 'Producto agregado a tu menú', x.nombre);
    await bitacora(c, u, { accion: 'menu.aprobar', elemento: x.nombre, sucursal: x.sucursal_id });
  });
  res.json({ ok: true });
});
r.post('/menus/:id/rechazar', async (req, res) => { await rechazarSolicitud(req, 'Agregar al menú', ['gerente', 'No se agregó al menú']); res.json({ ok: true }); });

/* ---------- 7.6 Productos nuevos ---------- */
async function conProveedor(c) {
  const { rows } = await c.query(`SELECT DISTINCT pm.mp_id FROM proveedor_materias pm JOIN proveedores v ON v.id = pm.proveedor_id WHERE v.estado = 'Activo'`);
  return new Set(rows.map((x) => x.mp_id));
}
async function nombresMp(c) {
  const { rows } = await c.query('SELECT id, nombre, unidad FROM materias_primas');
  return Object.fromEntries(rows.map((m) => [m.id, m]));
}
const mpNombre = (M, ref) => (String(ref).startsWith('new:') ? `${String(ref).slice(4)} (nueva)` : M[+ref]?.nombre || '—');

r.get('/propuestas', async (req, res) => {
  const L = await cargarSolicitudes(DB, `s.tipo = ANY($1) AND s.estado = 'Aprobado por gerente de sucursal'`, [TP], 's.fecha');
  const cp = await conProveedor(DB);
  const M = await nombresMp(DB);
  const { rows: pr } = await q('SELECT id, nombre FROM productos');
  const PN = Object.fromEntries(pr.map((x) => [x.id, x.nombre]));
  const { rows: sc } = await q('SELECT id, nombre FROM sucursales');
  const SN = Object.fromEntries(sc.map((x) => [x.id, x.nombre]));
  const out = [];
  for (const x of L) {
    const d = x.datos || {};
    const ings = (d.ings || []).map((i) => ({ ...i, nombre: mpNombre(M, i.mp), unidad: M[+i.mp]?.unidad || '', conProv: !String(i.mp).startsWith('new:') && cp.has(+i.mp) }));
    const faltan = [...new Set(ings.filter((i) => !i.conProv).map((i) => i.nombre))];
    const costo = x.tipo === 'Producto nuevo' ? await costoPropuesta(DB, d.ings, x.suc) : null;
    out.push({ ...x, sucNombre: SN[x.suc], propone: d.propone || x.solicitanteNombre, ings, faltan: x.tipo === 'Categoría nueva' ? [] : faltan, costo,
      precio: x.tipo === 'Producto nuevo' ? x.monto : d.precio, prodsNombres: (d.prods || []).map((i) => PN[i]).filter(Boolean) });
  }
  res.json({ propuestas: out, iva: (await cfg(DB)).iva_pct });
});

r.post('/propuestas/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = ANY($2) AND estado = 'Aprobado por gerente de sucursal' FOR UPDATE`, [req.params.id, TP]);
    const x = rows[0];
    si(!x, 'Esta propuesta ya fue decidida');
    const d = x.datos || {};
    if (x.tipo !== 'Categoría nueva') {
      const cp = await conProveedor(c);
      si((d.ings || []).some((i) => String(i.mp).startsWith('new:') || !cp.has(+i.mp)), 'Falta asignar proveedor a una materia prima: hazlo en Aprobaciones › Proveedores');
    }
    if (x.tipo === 'Producto nuevo') {
      const k = await cfg(c);
      const cst = await costoPropuesta(c, d.ings, x.sucursal_id);
      si(!(x.monto > 0) || neto(x.monto, k) <= cst.costo, 'El precio no cubre el costo: rechaza la propuesta para que el gerente lo corrija');
    }
    await c.query(`UPDATE solicitudes SET estado = 'Aprobado por gerente general', aprueba_rol = 'director', fecha = $2, datos = datos || $3::jsonb WHERE id = $1`,
      [x.id, ts(ahora()), JSON.stringify({ gg: u.id })]);
    await notificar(c, 'director', null, 'Producto por aprobar', x.nombre);
    await notificar(c, 'cocinero', x.sucursal_id, 'Propuesta aprobada por gerencia general', x.nombre);
    await bitacora(c, u, { accion: 'propuesta.aprobar.gg', elemento: x.nombre, sucursal: x.sucursal_id });
  });
  res.json({ ok: true });
});

r.post('/propuestas/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = ANY($2) AND estado = 'Aprobado por gerente de sucursal' FOR UPDATE`, [req.params.id, TP]);
    const x = rows[0];
    si(!x, 'Esta propuesta ya fue decidida');
    await c.query(`UPDATE solicitudes SET estado = 'Rechazado', rechazo = $2, decidio_id = $3 WHERE id = $1`, [x.id, rechazo(u, m), u.id]);
    await notificar(c, 'cocinero', x.sucursal_id, 'Propuesta rechazada', `${x.nombre}: ${m}`);
    await bitacora(c, u, { accion: 'propuesta.rechazar.gg', elemento: x.nombre, motivo: m, sucursal: x.sucursal_id });
  });
  res.json({ ok: true });
});

/* ---------- catálogo: solo el gerente general edita productos (la receta, con clave) ---------- */
export async function catalogoCompleto(c, where = `p.estado <> 'Eliminado'`) {
  const { rows } = await c.query(
    `SELECT p.*, ARRAY(SELECT cg.nombre FROM producto_categorias pc JOIN categorias cg ON cg.id = pc.categoria_id WHERE pc.producto_id = p.id ORDER BY cg.id) AS cats,
            (SELECT count(*)::int FROM sucursal_menu sm WHERE sm.producto_id = p.id) AS en_menus
       FROM productos p WHERE ${where} ORDER BY p.nombre`);
  const { rows: rec } = await c.query('SELECT r.producto_id, r.mp_id, r.cantidad, m.nombre, m.unidad FROM recetas r JOIN materias_primas m ON m.id = r.mp_id');
  const { rows: cg } = await c.query('SELECT nombre, icono FROM categorias ORDER BY id');
  return {
    productos: rows.map((p) => ({
      id: p.id, nombre: p.nombre, desc: p.descripcion, precio: p.precio, tiempo: p.tiempo_min, estado: p.estado, extra: p.es_extra, version: p.version,
      foto: p.foto_url, cats: p.cats, enMenus: p.en_menus,
      receta: rec.filter((x) => x.producto_id === p.id).map((x) => ({ mp: x.mp_id, cant: x.cantidad, nombre: x.nombre, unidad: x.unidad })),
    })),
    categorias: cg,
  };
}

r.get('/catalogo', async (req, res) => {
  const out = await catalogoCompleto(DB, `p.estado IN ('Activo','Precio por revisar')`);
  const { rows: m } = await q(`SELECT id, nombre, unidad, categoria FROM materias_primas WHERE estado = 'Activo' ORDER BY nombre`);
  res.json({ ...out, materias: m });
});

r.put('/catalogo/:id', async (req, res) => {
  const u = req.usuario;
  const b = req.body || {};
  const { rows } = await q('SELECT * FROM productos WHERE id = $1', [req.params.id]);
  const x = rows[0];
  if (!x || x.estado === 'Eliminado') throw noEncontrado('No se encontró el producto');
  const nombre = String(b.nombre || '').trim();
  const precio = r2(+b.precio);
  const tiempo = +b.tiempo;
  const receta = (b.receta || []).filter((z) => z.mp && +z.cant > 0).map((z) => ({ mp: +z.mp, cant: +z.cant })).sort((p, q2) => p.mp - q2.mp);
  const { rows: otros } = await q('SELECT id, nombre FROM productos WHERE id <> $1', [x.id]);
  si(!nombre, 'Escribe el nombre');
  si(otros.some((p) => norm(p.nombre) === norm(nombre)), 'Ya existe un producto o extra con ese nombre');
  si(!(precio > 0), 'El precio debe ser mayor que 0');
  si(!x.es_extra && !(b.cats || []).length, 'Elige al menos una categoría');
  si(!(tiempo > 0), 'El tiempo debe ser mayor que 0');
  si(!receta.length, 'Agrega al menos una materia prima');
  si(new Set(receta.map((z) => z.mp)).size < receta.length, 'Una materia prima está repetida en la receta');
  const { rows: ant } = await q('SELECT mp_id AS mp, cantidad AS cant FROM recetas WHERE producto_id = $1 ORDER BY mp_id', [x.id]);
  const cambio = JSON.stringify(ant) !== JSON.stringify(receta);
  let m = '';
  if (cambio) {
    m = validarMotivo(b.motivo, 'La razón');
    await verificarClave(u, b.clave);
  }
  await tx(async (c) => {
    if (cambio) {
      await c.query('INSERT INTO producto_versiones (producto_id, version, receta, motivo, fecha) VALUES ($1,$2,$3,$4,$5)',
        [x.id, x.version, JSON.stringify(ant.map((z) => ({ mp_id: z.mp, cantidad: z.cant }))), m, ts(ahora())]);
      await c.query('DELETE FROM recetas WHERE producto_id = $1', [x.id]);
      for (const z of receta) await c.query('INSERT INTO recetas (producto_id, mp_id, cantidad) VALUES ($1,$2,$3)', [x.id, z.mp, z.cant]);
      await c.query('UPDATE productos SET version = version + 1 WHERE id = $1', [x.id]);
    }
    if (precio !== x.precio) await cambiarPrecio(c, x.id, precio, u);
    await c.query('UPDATE productos SET nombre = $2, descripcion = $3, tiempo_min = $4 WHERE id = $1', [x.id, nombre, x.es_extra ? x.descripcion : String(b.desc || '').trim(), Math.round(tiempo)]);
    if (!x.es_extra) {
      await c.query('DELETE FROM producto_categorias WHERE producto_id = $1', [x.id]);
      await c.query('INSERT INTO producto_categorias (producto_id, categoria_id) SELECT $1, id FROM categorias WHERE nombre = ANY($2)', [x.id, b.cats]);
    }
    await bitacora(c, u, { accion: 'producto.editar', elemento: nombre, motivo: m, antes: { nombre: x.nombre, precio: x.precio }, despues: { nombre, precio }, clave: cambio });
  });
  res.json({ ok: true });
});

/* ---------- 7.3 Cuentas por pagar ---------- */
r.get('/cuentas', async (req, res) => {
  const t = ahora();
  const { rows } = await q(
    `SELECT f.*, v.nombre AS prov_nombre, s.nombre AS suc_nombre,
            COALESCE((SELECT sum(monto) FROM factura_creditos x WHERE x.factura_id = f.id), 0) AS creditos
       FROM facturas f JOIN proveedores v ON v.id = f.proveedor_id JOIN sucursales s ON s.id = f.sucursal_id ORDER BY f.emitida DESC`);
  const est = (f) => (f.estado !== 'Pendiente' ? f.estado : f.vence < t ? 'Vencida' : 'Pendiente');
  const L = rows.map((f) => ({
    id: f.id, num: f.num, prov: f.proveedor_id, provNombre: f.prov_nombre, suc: f.sucursal_id, sucNombre: f.suc_nombre, monto: f.monto,
    creditos: f.creditos, debe: r2(Math.max(0, f.monto - f.creditos)), condicion: f.condicion, emitida: f.emitida, vence: f.vence,
    estado: est(f), pagada: f.pagada, pagadoMonto: f.pagado_monto,
  }));
  const d0 = new Date(t - 6 * 36e5);
  const mes = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1) + 6 * 36e5;
  const act = L.filter((f) => ['Pendiente', 'Vencida'].includes(f.estado));
  const { rows: sf } = await q(`SELECT COALESCE(sum(saldo_favor), 0) AS s FROM proveedores`);
  const { rows: provs } = await q('SELECT id, nombre FROM proveedores ORDER BY nombre');
  res.json({
    facturas: L, porPagar: r2(sum(act, (f) => f.debe)), vencidas: r2(sum(act.filter((f) => f.estado === 'Vencida'), (f) => f.debe)),
    pagadasMes: r2(sum(L.filter((f) => f.estado === 'Pagada' && f.pagada >= mes), (f) => f.pagadoMonto ?? f.monto)),
    saldoFavor: r2(sf[0].s), proveedores: provs, sucursales: (await sucursales(DB)).map((x) => ({ id: x.id, nombre: x.nombre })),
  });
});

r.post('/facturas/:id/pagar', async (req, res) => {
  const u = req.usuario;
  const out = await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM facturas WHERE id = $1 AND estado = 'Pendiente' FOR UPDATE`, [req.params.id]);
    const f = rows[0];
    si(!f, 'Esta factura ya fue pagada');
    const { rows: cr } = await c.query('SELECT COALESCE(sum(monto), 0) AS s FROM factura_creditos WHERE factura_id = $1', [f.id]);
    const { rows: pv } = await c.query('SELECT * FROM proveedores WHERE id = $1 FOR UPDATE', [f.proveedor_id]);
    const debe = r2(Math.max(0, f.monto - cr[0].s));
    const uso = r2(Math.min(pv[0].saldo_favor || 0, debe));
    const pagado = r2(debe - uso);
    await c.query(`UPDATE facturas SET estado = 'Pagada', pagada = $2, saldo_usado = $3, pagado_monto = $4 WHERE id = $1`, [f.id, ts(ahora()), uso, pagado]);
    if (uso) await c.query('UPDATE proveedores SET saldo_favor = saldo_favor - $2 WHERE id = $1', [pv[0].id, uso]);
    await bitacora(c, u, { accion: 'factura.pagar', elemento: f.num, despues: { monto: pagado, saldoUsado: uso }, sucursal: f.sucursal_id });
    return { pagado, uso };
  });
  res.json({ ok: true, ...out });
});

/* ---------- 7.7 Nómina ---------- */
r.get('/nomina', async (req, res) => {
  const sal = await cargarSolicitudes(DB, `s.tipo = 'Salario' AND s.estado = 'Solicitada'`, [], 's.fecha');
  const k = await cfg(DB);
  const out = [];
  for (const x of sal) {
    out.push({ ...x, rolNombre: ROLN[x.rol], actual: x.datos.actual, propuesto: x.datos.propuesto, empleados: (await activos(DB, null, x.rol)).length,
      dif: Math.round(((x.datos.propuesto - x.datos.actual) / x.datos.actual) * 100) });
  }
  const { rows: au } = await q('SELECT a.*, u.nombre FROM aumentos a JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.fecha DESC, a.id DESC LIMIT 200');
  res.json({
    minimo: k.salario_minimo, salarios: out, reportes: await cargarReportes(DB, `r.estado = 'Enviado'`),
    aumentos: au.map((a) => ({ id: a.id, nombre: a.nombre, fecha: a.fecha, anios: a.anios, antes: a.antes, despues: a.despues })),
  });
});

r.post('/salarios/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = 'Salario' AND estado = 'Solicitada' FOR UPDATE`, [req.params.id]);
    const x = rows[0];
    si(!x, 'Esta solicitud ya fue decidida');
    await c.query('UPDATE roles SET salario = $2, salario_desde = $3 WHERE id = $1', [x.rol_id, x.datos.propuesto, ts(ahora())]);
    await c.query(`UPDATE solicitudes SET estado = 'Aplicada', decidio_id = $2, cierre = $3 WHERE id = $1`, [x.id, u.id, ts(ahora())]);
    await notificar(c, 'rrhh', null, 'Salario aprobado', `${ROLN[x.rol_id]} · $${(+x.datos.propuesto).toFixed(2)}`);
    await bitacora(c, u, { accion: 'salario.aprobar', elemento: x.rol_id, antes: { salario: x.datos.actual }, despues: { salario: x.datos.propuesto }, motivo: x.motivo });
  });
  res.json({ ok: true });
});
r.post('/salarios/:id/rechazar', async (req, res) => { await rechazarSolicitud(req, 'Salario', ['rrhh', 'Salario rechazado']); res.json({ ok: true }); });

r.get('/reportes/:id', async (req, res) => {
  const [x] = await cargarReportes(DB, 'r.id = $1', [req.params.id]);
  if (!x) throw noEncontrado('No se encontró el reporte');
  res.json({ ...x, filas: await filasReporte(DB, x) });
});
async function decidirReporte(req, aprobar) {
  const u = req.usuario;
  const m = aprobar ? null : validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`UPDATE reportes_pago SET estado = $2, decidio_id = $3, decidido = $4, motivo = $5 WHERE id = $1 AND estado = 'Enviado' RETURNING id`,
      [req.params.id, aprobar ? 'Aprobado' : 'Rechazado', u.id, ts(ahora()), m]);
    si(!rows[0], 'Este reporte ya fue decidido');
    const [x] = await cargarReportes(c, 'r.id = $1', [rows[0].id]);
    await notificar(c, 'rrhh', null, aprobar ? 'Reporte de pago aprobado' : 'Reporte de pago rechazado', aprobar ? x.sucNombre : `${x.sucNombre}: ${m}`);
    await bitacora(c, u, { accion: aprobar ? 'reporte.aprobar' : 'reporte.rechazar', elemento: `${x.sucNombre} · ${x.label}`, motivo: m || '', sucursal: x.suc });
  });
}
r.post('/reportes/:id/aprobar', async (req, res) => { await decidirReporte(req, true); res.json({ ok: true }); });
r.post('/reportes/:id/rechazar', async (req, res) => { await decidirReporte(req, false); res.json({ ok: true }); });

/* ---------- 7.8 Sucursales ---------- */
r.get('/sucursales', async (req, res) => {
  const sucs = await sucursales(DB);
  const { rows: vac } = await q(`SELECT sucursal_id, sum(cantidad)::int t, sum(cubiertas)::int c FROM vacantes WHERE origen = 'Apertura de sucursal' AND estado <> 'Cancelada' GROUP BY sucursal_id`);
  const { rows: pr } = await q(
    `SELECT p.*, s.nombre AS suc_nombre, u.nombre AS pide_nombre FROM propuestas_sucursal p LEFT JOIN sucursales s ON s.id = p.sucursal_id
       JOIN usuarios u ON u.id = p.pide_id ORDER BY p.fecha DESC`);
  const { rows: zonas } = await q('SELECT nombre FROM zonas ORDER BY nombre');
  res.json({
    sucursales: sucs.map((s) => ({ ...s, tamanoNombre: TAM[s.tamano], vacantes: vac.find((v) => v.sucursal_id === s.id) || null })),
    propuestas: pr.map((p) => ({
      id: p.id, tipo: p.tipo, zona: p.zona, tamano: p.tamano, tamanoNombre: TAM[p.tamano], costo: p.costo, suc: p.sucursal_id, sucNombre: p.suc_nombre,
      motivo: p.motivo, pideNombre: p.pide_nombre, estado: p.estado, fecha: p.fecha, rechazo: p.rechazo_motivo,
    })),
    zonas: zonas.map((z) => z.nombre), tamanos: Object.entries(TAM).map(([id, nombre]) => ({ id, nombre })),
  });
});

r.get('/sucursales/costo', async (req, res) => {
  const [a, b] = await intervaloSuc(DB, req.query.zona, req.query.tam);
  res.json({ costo: await costoSuc(DB, req.query.zona, req.query.tam), min: a, max: b });
});

r.get('/sucursales/:id/abiertos', async (req, res) => { res.json(await abiertosSuc(DB, req.params.id)); });

r.post('/sucursales/propuestas', async (req, res) => {
  const u = req.usuario;
  const b = req.body || {};
  const m = validarMotivo(b.motivo);
  await tx(async (c) => {
    let p;
    if (b.tipo === 'Compra') {
      const [a, z] = await intervaloSuc(c, b.zona, b.tamano);
      si(!(+b.costo >= a && +b.costo <= z), 'Calcula el costo antes de enviar');
      p = { zona: b.zona, tamano: b.tamano, costo: +b.costo, suc: null, txt: `${b.zona} · ${TAM[b.tamano]}` };
    } else if (b.tipo === 'Venta') {
      const { rows } = await c.query(`SELECT * FROM sucursales WHERE id = $1 AND estado = 'Operando'`, [b.suc]);
      si(!rows[0], 'Elige una sucursal que esté operando');
      const ab = await abiertosSuc(c, rows[0].id);
      si(ab.p || ab.c, `Hay ${ab.p} pedido${ab.p === 1 ? '' : 's'} abierto${ab.p === 1 ? '' : 's'} y ${ab.c} caja${ab.c === 1 ? '' : 's'} abierta${ab.c === 1 ? '' : 's'}`);
      p = { zona: rows[0].zona, tamano: rows[0].tamano, costo: rows[0].costo || 0, suc: rows[0].id, txt: rows[0].nombre };
    } else throw fallo('Elige comprar o vender');
    await c.query(`INSERT INTO propuestas_sucursal (tipo, zona, tamano, costo, sucursal_id, motivo, pide_id, fecha) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [b.tipo, p.zona, p.tamano, p.costo, p.suc, m, u.id, ts(ahora())]);
    await notificar(c, 'director', null, `Propuesta de ${b.tipo.toLowerCase()} de sucursal`, p.txt);
    await bitacora(c, u, { accion: 'sucursal.proponer', elemento: p.txt, despues: { tipo: b.tipo }, motivo: m });
  });
  res.status(201).json({ ok: true });
});

r.post('/sucursales/propuestas/:id/abrir', async (req, res) => {
  const u = req.usuario;
  const out = await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM propuestas_sucursal WHERE id = $1 AND estado = 'Compra aprobada' FOR UPDATE`, [req.params.id]);
    const p = rows[0];
    si(!p, 'Esta sucursal ya fue abierta');
    const s = await crearSucursal(c, { zona: p.zona, tamano: p.tamano, costo: p.costo, propId: p.id });
    await bitacora(c, u, { accion: 'sucursal.abrir', elemento: s.nombre, despues: { zona: p.zona, tamano: p.tamano }, sucursal: s.sid });
    return s;
  });
  res.json(out);
});

/* ---------- 7.9 Despidos ---------- */
r.get('/despidos', async (req, res) => {
  const L = await cargarSolicitudes(DB, `s.tipo = 'Despido' AND ((s.aprueba_rol = 'gg' AND s.estado = 'Solicitada') OR (s.aprueba_rol = 'gerente' AND s.estado = 'Aplicada'))`);
  const { rows } = await q('SELECT u.id, u.nombre, u.rol_id, s.nombre AS suc FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id');
  const U = Object.fromEntries(rows.map((x) => [x.id, x]));
  const { rows: dec } = await q('SELECT id, decidio_id FROM solicitudes WHERE id = ANY($1)', [L.map((x) => x.id)]);
  const D2 = Object.fromEntries(dec.map((x) => [x.id, U[x.decidio_id]?.nombre]));
  const j = (x) => ({ ...x, rolNombre: ROLN[U[x.usuario]?.rol_id], sucNombre: U[x.usuario]?.suc || 'Gerencia central', aproboNombre: D2[x.id] || null });
  res.json({ solicitudes: L.filter((x) => x.estado === 'Solicitada').map(j), reportes: L.filter((x) => x.estado === 'Aplicada').map(j) });
});
r.post('/despidos/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  const ind = await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = 'Despido' AND aprueba_rol = 'gg' AND estado = 'Solicitada'`, [req.params.id]);
    si(!rows[0], 'Este despido ya fue decidido');
    const i = await aplicarDespido(c, rows[0].id, u);
    await bitacora(c, u, { accion: 'despido.aprobar', elemento: rows[0].nombre, motivo: rows[0].motivo, despues: { indemnizacion: i.monto }, sucursal: rows[0].sucursal_id });
    return i;
  });
  res.json({ ok: true, indemnizacion: ind });
});
r.post('/despidos/:id/rechazar', async (req, res) => { await rechazarSolicitud(req, 'Despido', ['rrhh', 'Despido rechazado']); res.json({ ok: true }); });

/* ---------- 7.10 Plantilla ---------- */
r.get('/plantilla', async (req, res) => {
  const { rows: min } = await q('SELECT tamano, rol_id, cantidad FROM plantilla_minima');
  const minimos = {};
  for (const t of Object.keys(TAM)) minimos[t] = Object.fromEntries(ROLES_SUC.map((x) => [x, min.find((m) => m.tamano === t && m.rol_id === x)?.cantidad || 0]));
  const sucs = (await sucursales(DB)).filter((s) => s.estado === 'Operando');
  const plantillas = [];
  for (const s of sucs) {
    for (const x of ROLES_SUC) {
      const n = await necesarios(DB, s.id, x);
      const a = (await activos(DB, s.id, x)).length;
      plantillas.push({ suc: s.id, sucNombre: s.nombre, rol: x, rolNombre: ROLN[x], necesarios: n, actuales: a, faltan: Math.max(0, n - a) });
    }
  }
  const sol = await cargarSolicitudes(DB, `s.tipo = 'Personal' AND s.estado = 'Solicitada'`, [], 's.fecha');
  const out = [];
  for (const x of sol) {
    out.push({ ...x, rolNombre: ROLN[x.rol], sucNombre: sucs.find((s) => s.id === x.suc)?.nombre, cant: x.datos?.cant || x.monto,
      actuales: (await activos(DB, x.suc, x.rol)).length, necesarios: await necesarios(DB, x.suc, x.rol) });
  }
  res.json({ minimos, tamanos: Object.entries(TAM).map(([id, nombre]) => ({ id, nombre })), roles: ROLES_SUC.map((x) => ({ id: x, nombre: ROLN[x] })),
    plantillas, solicitudes: out, sucursales: sucs.map((s) => ({ id: s.id, nombre: s.nombre })) });
});

r.put('/minimos', async (req, res) => {
  const u = req.usuario;
  const d = req.body || {};
  await tx(async (c) => {
    for (const t of Object.keys(TAM)) {
      for (const x of ROLES_SUC) {
        const n = Math.round(+d[t]?.[x]);
        si(!(n >= 0), 'Las cantidades deben ser 0 o más');
        await c.query(`INSERT INTO plantilla_minima (tamano, rol_id, cantidad) VALUES ($1,$2,$3) ON CONFLICT (tamano, rol_id) DO UPDATE SET cantidad = $3`, [t, x, n]);
      }
    }
    await bitacora(c, u, { accion: 'plantilla.minimos', elemento: 'Mínimos por tamaño', despues: d });
  });
  res.json({ ok: true });
});

r.post('/personal/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = 'Personal' AND estado = 'Solicitada' FOR UPDATE`, [req.params.id]);
    const x = rows[0];
    si(!x, 'Esta solicitud ya fue decidida');
    const cant = Math.max(1, Math.round(x.datos?.cant || x.monto || 1));
    await abrirVacantes(c, x.sucursal_id, x.rol_id, cant, 'Solicitud de personal', 'Alta', x.id);
    await c.query(`UPDATE solicitudes SET estado = 'Aprobada', decidio_id = $2, cierre = $3 WHERE id = $1`, [x.id, u.id, ts(ahora())]);
    const { rows: s } = await c.query('SELECT nombre FROM sucursales WHERE id = $1', [x.sucursal_id]);
    await notificar(c, 'rrhh', null, 'Vacantes nuevas', `${s[0].nombre} · ${ROLN[x.rol_id]} ×${cant}`);
    await notificar(c, 'gerente', x.sucursal_id, 'Solicitud de personal aprobada', `${ROLN[x.rol_id]} ×${cant}`);
    await bitacora(c, u, { accion: 'personal.aprobar', elemento: `${ROLN[x.rol_id]} ×${cant}`, sucursal: x.sucursal_id });
  });
  res.json({ ok: true });
});
r.post('/personal/:id/rechazar', async (req, res) => { await rechazarSolicitud(req, 'Personal', ['gerente', 'Solicitud de personal rechazada']); res.json({ ok: true }); });

export { cambiarPrecio };
export default r;
