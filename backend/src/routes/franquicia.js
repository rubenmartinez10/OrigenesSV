import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, tx, ts } from '../db.js';
import { si, noEncontrado, prohibido, motivo as validarMotivo } from '../lib/errores.js';
import { ahora } from '../lib/reloj.js';
import { bitacora } from '../lib/registro.js';
import { r2, sum } from '../lib/negocio.js';
import { ROLN } from '../lib/personal.js';
import { guardarImagen } from '../lib/fotos.js';
import { cargarSolicitudes } from '../lib/consultas.js';
import {
  listaProveedores, fichaProveedor, historialProveedor, guardarProveedor, ocupadoProv, cambio,
} from '../lib/proveedores.js';

/*
 * Lo que comparten Recursos Humanos, el gerente general y el director:
 * proveedores, detalle de facturas, materias primas para elegir y contraseñas por restablecer.
 */
const r = Router();
const DB = { query: q };

/* ---------- materias primas (para elegir qué ofrece un proveedor) ---------- */
r.get('/materias', async (req, res) => {
  const { rows } = await q(`SELECT id, nombre, unidad, categoria, foto_url AS foto FROM materias_primas WHERE estado = 'Activo' ORDER BY nombre`);
  res.json(rows);
});

/* ---------- proveedores ---------- */
r.get('/proveedores', async (req, res) => { res.json(await listaProveedores(DB)); });
r.get('/proveedores/:id', async (req, res) => { res.json(await fichaProveedor(DB, req.params.id)); });
r.get('/proveedores/:id/historial', async (req, res) => { res.json(await historialProveedor(DB, req.params.id)); });

r.post('/proveedores', async (req, res) => {
  const id = await tx((c) => guardarProveedor(c, req.usuario, null, req.body));
  res.status(201).json({ id });
});
r.put('/proveedores/:id', async (req, res) => {
  const id = await tx((c) => guardarProveedor(c, req.usuario, +req.params.id, req.body));
  res.json({ id });
});

r.post('/proveedores/:id/inhabilitar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM proveedores WHERE id = $1 AND estado = 'Activo' FOR UPDATE`, [req.params.id]);
    si(!rows[0], 'Este proveedor ya no está activo');
    si(await ocupadoProv(c, rows[0].id), 'Tiene compras en camino o facturas por pagar');
    await c.query(`UPDATE proveedores SET estado = 'Inhabilitado' WHERE id = $1`, [rows[0].id]);
    await cambio(c, rows[0].id, `Inhabilitado: ${m}`);
    await bitacora(c, u, { accion: 'proveedor.inhabilitar', elemento: rows[0].nombre, motivo: m });
  });
  res.json({ ok: true });
});

r.post('/proveedores/:id/eliminar', async (req, res) => {
  const u = req.usuario;
  if (u.rol !== 'director') throw prohibido();
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM proveedores WHERE id = $1 AND estado <> 'Eliminado' FOR UPDATE`, [req.params.id]);
    si(!rows[0], 'Este proveedor ya fue eliminado');
    si(await ocupadoProv(c, rows[0].id), 'Tiene compras o facturas pendientes: no se puede eliminar todavía');
    await c.query(`UPDATE proveedores SET estado = 'Eliminado' WHERE id = $1`, [rows[0].id]);
    await cambio(c, rows[0].id, `Eliminado: ${m}`);
    await bitacora(c, u, { accion: 'proveedor.eliminar', elemento: rows[0].nombre, motivo: m });
  });
  res.json({ ok: true });
});

r.put('/proveedores/:id/foto', async (req, res) => {
  const url = req.body?.dataUrl ? await guardarImagen(req.body.dataUrl, 'proveedores', `p${+req.params.id}`) : null;
  await tx(async (c) => {
    const { rows } = await c.query('UPDATE proveedores SET foto_url = $2 WHERE id = $1 RETURNING nombre', [req.params.id, url]);
    si(!rows[0], 'No se encontró el proveedor');
    await bitacora(c, req.usuario, { accion: url ? 'foto.cambiar' : 'foto.quitar', elemento: rows[0].nombre, motivo: 'proveedor' });
  });
  res.json({ ok: true, foto: url });
});

/* ---------- facturas ---------- */
export async function facturaJson(c, id) {
  const { rows } = await c.query(
    `SELECT f.*, v.nombre AS prov_nombre, v.foto_url AS prov_foto, s.nombre AS suc_nombre, c.transporte, u.nombre AS arch_nombre, u.rol_id AS arch_rol
       FROM facturas f JOIN proveedores v ON v.id = f.proveedor_id JOIN sucursales s ON s.id = f.sucursal_id
       LEFT JOIN compras c ON c.id = f.compra_id LEFT JOIN usuarios u ON u.id = f.archivada_por WHERE f.id = $1`, [id]);
  const f = rows[0];
  if (!f) throw noEncontrado('No se encontró la factura');
  const { rows: lineas } = await c.query(
    `SELECT l.mp_id AS mp, m.nombre, m.unidad, l.cantidad AS cant, l.precio FROM factura_lineas l JOIN materias_primas m ON m.id = l.mp_id WHERE l.factura_id = $1`, [id]);
  const { rows: cr } = await c.query('SELECT tipo, monto, fecha, motivo FROM factura_creditos WHERE factura_id = $1 ORDER BY id', [id]);
  return {
    id: f.id, num: f.num, compra: f.compra_id, suc: f.sucursal_id, sucNombre: f.suc_nombre, prov: f.proveedor_id, provNombre: f.prov_nombre,
    provFoto: f.prov_foto, monto: f.monto, original: f.original, condicion: f.condicion, emitida: f.emitida, vence: f.vence, estado: f.estado,
    pagada: f.pagada, pagadoMonto: f.pagado_monto, saldoUsado: f.saldo_usado, transporte: f.transporte || 0,
    archivo: f.archivada ? { fecha: f.archivada, por: f.arch_nombre ? `${f.arch_nombre} · ${ROLN[f.arch_rol]}` : '—' } : null,
    lineas, creditos: cr, debe: r2(Math.max(0, f.monto - sum(cr, (x) => x.monto))),
    subtotal: r2(sum(lineas, (l) => l.cant * l.precio)),
  };
}
r.get('/facturas/:id', async (req, res) => { res.json(await facturaJson(DB, req.params.id)); });

/* ---------- contraseñas por restablecer (cada rol atiende las suyas) ---------- */
const temporal = () => `Tmp${1000 + Math.floor(Math.random() * 9000)}`;
const pinTemp = () => String(1000 + Math.floor(Math.random() * 9000));

r.get('/contrasenas', async (req, res) => {
  const u = req.usuario;
  res.json(await cargarSolicitudes(DB, `s.tipo = 'Restablecer contraseña' AND s.aprueba_rol = $1 AND s.usuario_id <> $2`, [u.rol, u.id]));
});

r.post('/contrasenas/:id/asignar', async (req, res) => {
  const u = req.usuario;
  const out = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT s.*, x.usuario AS login, x.rol_id AS rol FROM solicitudes s JOIN usuarios x ON x.id = s.usuario_id
        WHERE s.id = $1 AND s.tipo = 'Restablecer contraseña' AND s.estado = 'Solicitada' FOR UPDATE OF s`, [req.params.id]);
    const x = rows[0];
    si(!x, 'Esta solicitud ya fue atendida');
    if (x.aprueba_rol !== u.rol || x.usuario_id === u.id) throw prohibido();
    const pass = temporal();
    const pin = x.rol === 'director' ? pinTemp() : null;
    await c.query(
      `UPDATE usuarios SET pass_hash = $2, cambiar_pass = TRUE, recup_pass = FALSE, recup_pin = FALSE
         ${pin ? ', pin_hash = $3, cambiar_pin = TRUE' : ''} WHERE id = $1`,
      [x.usuario_id, await bcrypt.hash(pass, 10), ...(pin ? [await bcrypt.hash(pin, 10)] : [])]);
    await c.query(`UPDATE solicitudes SET estado = 'Aplicada', decidio_id = $2, cierre = $3 WHERE id = $1`, [x.id, u.id, ts(ahora())]);
    await bitacora(c, u, { accion: 'contraseña.temporal', elemento: x.login });
    return { usuario: x.login, nombre: x.nombre, pass, pin };
  });
  res.json(out);
});

r.post('/contrasenas/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT s.*, x.usuario AS login FROM solicitudes s JOIN usuarios x ON x.id = s.usuario_id
        WHERE s.id = $1 AND s.tipo = 'Restablecer contraseña' AND s.estado = 'Solicitada' FOR UPDATE OF s`, [req.params.id]);
    const x = rows[0];
    si(!x, 'Esta solicitud ya fue atendida');
    if (x.aprueba_rol !== u.rol || x.usuario_id === u.id) throw prohibido();
    await c.query(`UPDATE solicitudes SET estado = 'Rechazada', rechazo = $2, decidio_id = $3, cierre = $4 WHERE id = $1`,
      [x.id, JSON.stringify({ por: u.nombre, motivo: m, fecha: ahora() }), u.id, ts(ahora())]);
    await bitacora(c, u, { accion: 'contraseña.rechazar', elemento: x.login, motivo: m });
  });
  res.json({ ok: true });
});

export default r;
