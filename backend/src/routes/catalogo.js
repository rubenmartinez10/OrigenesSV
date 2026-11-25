import { Router } from 'express';
import { pool, ts } from '../db.js';
import { ahora, D } from '../lib/reloj.js';
import { cfg, cfgPublica, disponibles, ofertasActivas, mesasOcupadas, costosTope } from '../lib/negocio.js';

/*
 * Catálogo y estado de la sucursal en una sola llamada: productos, extras, recetas,
 * materias primas, menú, ofertas activas, tendencia, existencias y mesas.
 * El frontend lo usa para pintar el menú del mesero, las recetas y los formularios.
 */
const r = Router();

r.get('/', async (req, res) => {
  const u = req.usuario;
  const s = u.sucursal;
  const c = pool;
  const k = await cfg(c);

  const { rows: productos } = await c.query(
    `SELECT p.id, p.nombre, p.descripcion AS "desc", p.precio, p.tiempo_min AS tiempo, p.estado, p.es_extra AS extra,
            p.es_reventa AS reventa, p.version, p.foto_url AS foto,
            ARRAY(SELECT cg.nombre FROM producto_categorias pc JOIN categorias cg ON cg.id = pc.categoria_id
                   WHERE pc.producto_id = p.id ORDER BY cg.id) AS categorias,
            ARRAY(SELECT ep.producto_id FROM extra_productos ep WHERE ep.extra_id = p.id ORDER BY ep.producto_id) AS prods,
            COALESCE((SELECT json_agg(json_build_object('mp', r.mp_id, 'cant', r.cantidad) ORDER BY r.mp_id)
                        FROM recetas r WHERE r.producto_id = p.id), '[]') AS receta
       FROM productos p ORDER BY p.id`);
  // un extra pertenece a las categorías de los productos donde se ofrece
  const porId = Object.fromEntries(productos.map((p) => [p.id, p]));
  for (const p of productos) {
    p.receta = p.receta.map((x) => ({ mp: x.mp, cant: +x.cant }));
    if (p.extra) p.categorias = [...new Set(p.prods.flatMap((i) => porId[i]?.categorias || []))];
  }

  const { rows: categorias } = await c.query('SELECT id, nombre, icono FROM categorias ORDER BY id');
  const { rows: materias } = await c.query(
    'SELECT id, nombre, unidad, categoria, vida_dias AS vida, estado, foto_url AS foto, descripcion AS "desc" FROM materias_primas ORDER BY id');
  const { rows: unidades } = await c.query('SELECT nombre FROM mp_unidades ORDER BY predeterminada DESC, nombre');

  const out = {
    config: cfgPublica(k), categorias, productos, materias, unidades: unidades.map((x) => x.nombre), ahora: ahora(),
  };

  if (s) {
    const { rows: suc } = await c.query('SELECT id, nombre, mesas, tamano, estado FROM sucursales WHERE id = $1', [s]);
    const { rows: menu } = await c.query('SELECT producto_id FROM sucursal_menu WHERE sucursal_id = $1', [s]);
    const { rows: revisar } = await c.query('SELECT producto_id FROM sucursal_revisar WHERE sucursal_id = $1', [s]);
    const { rows: tend } = await c.query(
      `SELECT l.producto_id, sum(l.cantidad) AS n FROM ventas v JOIN pedido_lineas l ON l.pedido_id = v.pedido_id
        WHERE v.sucursal_id = $1 AND v.fecha >= $2 GROUP BY l.producto_id ORDER BY n DESC, l.producto_id LIMIT $3`,
      [s, ts(ahora() - k.tendencia_dias * D), k.tendencia_top]);
    const { disp, stock } = await disponibles(c, s);
    const oc = await mesasOcupadas(c, s);
    Object.assign(out, {
      sucursal: suc[0],
      menu: menu.map((x) => x.producto_id),
      revisar: revisar.map((x) => x.producto_id),
      ofertas: await ofertasActivas(c, s),
      tendencia: tend.map((x) => x.producto_id),
      disp, stock,
      mesas: {
        total: suc[0].mesas,
        ocupadas: Object.fromEntries(Object.entries(oc).map(([m, p]) => [m, { id: p.id, num: p.num, ref: p.cliente, estado: p.estado }])),
      },
    });
    if (['cocinero', 'jefe'].includes(u.rol)) {
      const { rows: conProv } = await c.query(
        `SELECT DISTINCT pm.mp_id FROM proveedor_materias pm JOIN proveedores v ON v.id = pm.proveedor_id WHERE v.estado = 'Activo'`);
      out.costoTope = await costosTope(c, s);
      out.conProveedor = conProv.map((x) => x.mp_id);
    }
  }
  res.json(out);
});

export default r;
