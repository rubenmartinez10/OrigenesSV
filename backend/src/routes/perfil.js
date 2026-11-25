import { Router } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { q, tx } from '../db.js';
import { config } from '../config.js';
import { fallo, si, prohibido } from '../lib/errores.js';
import { bitacora } from '../lib/registro.js';
import { cargarUsuario, usuarioPublico } from '../middleware/auth.js';
import { pagosDe } from '../lib/nomina.js';

/* ADENDA §1: cada quien edita solo lo suyo (teléfono, correo, contraseña, foto; PIN y clave según su rol). */
const r = Router();

const yo = async (req) => usuarioPublico(await cargarUsuario(req.usuario.id));
const hashDe = async (id, col) => (await q(`SELECT ${col} AS h FROM usuarios WHERE id = $1`, [id])).rows[0].h;

r.put('/', async (req, res) => {
  const telefono = String(req.body?.telefono || '').trim();
  const correo = String(req.body?.correo || '').trim();
  si(telefono && !/^\d{4}-\d{4}$/.test(telefono), 'El teléfono debe tener 8 números con el formato 0000-0000');
  si(correo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo), 'El correo no es válido (ejemplo: nombre@correo.com)');
  await tx(async (c) => {
    await c.query('UPDATE usuarios SET telefono = $2, correo = $3 WHERE id = $1', [req.usuario.id, telefono || null, correo || null]);
    await bitacora(c, req.usuario, { accion: 'perfil.editar', elemento: req.usuario.usuario });
  });
  res.json({ usuario: await yo(req) });
});

r.put('/password', async (req, res) => {
  const u = req.usuario;
  const { actual = '', nueva = '', repetir = '' } = req.body || {};
  if (!u.recup_pass) si(!(await bcrypt.compare(String(actual), await hashDe(u.id, 'pass_hash'))), 'La contraseña actual no es correcta');
  si(String(nueva).length < 6, 'La nueva contraseña debe tener al menos 6 caracteres');
  si(!u.recup_pass && nueva === actual, 'La nueva debe ser distinta de la actual');
  si(nueva !== repetir, 'Las contraseñas no coinciden');
  await tx(async (c) => {
    await c.query('UPDATE usuarios SET pass_hash = $2, cambiar_pass = FALSE, recup_pass = FALSE WHERE id = $1', [u.id, await bcrypt.hash(String(nueva), 10)]);
    await bitacora(c, u, { accion: 'perfil.contraseña', elemento: u.usuario });
  });
  res.json({ usuario: await yo(req) });
});

r.put('/pin', async (req, res) => {
  const u = req.usuario;
  if (u.rol !== 'director') throw prohibido();
  const { actual = '', nuevo = '', repetir = '' } = req.body || {};
  if (!u.recup_pin) si(!(await bcrypt.compare(String(actual), (await hashDe(u.id, 'pin_hash')) || '')), 'El PIN actual no es correcto');
  si(!/^\d{4,6}$/.test(nuevo), 'El PIN nuevo debe tener de 4 a 6 números');
  si(!u.recup_pin && nuevo === actual, 'El PIN nuevo debe ser distinto');
  si(nuevo !== repetir, 'Los PIN no coinciden');
  await tx(async (c) => {
    await c.query('UPDATE usuarios SET pin_hash = $2, cambiar_pin = FALSE, recup_pin = FALSE WHERE id = $1', [u.id, await bcrypt.hash(nuevo, 10)]);
    await bitacora(c, u, { accion: 'perfil.pin', elemento: u.usuario });
  });
  res.json({ usuario: await yo(req) });
});

/** Clave de aprobaciones del gerente de sucursal (distinta de la contraseña). */
r.put('/clave', async (req, res) => {
  const u = req.usuario;
  if (!['gerente', 'gg'].includes(u.rol)) throw prohibido();
  const { actual = '', nueva = '', repetir = '' } = req.body || {};
  si(!(await bcrypt.compare(String(actual), (await hashDe(u.id, 'clave_hash')) || '')), 'La clave actual no es correcta');
  si(!/^\d{4,6}$/.test(nueva), 'La clave nueva debe tener de 4 a 6 números');
  si(nueva === actual, 'La clave nueva debe ser distinta de la actual');
  si(nueva !== repetir, 'Las claves no coinciden');
  await tx(async (c) => {
    await c.query('UPDATE usuarios SET clave_hash = $2, intentos_clave = 0 WHERE id = $1', [u.id, await bcrypt.hash(nueva, 10)]);
    await bitacora(c, u, { accion: 'perfil.clave', elemento: u.usuario, clave: true });
  });
  res.json({ usuario: await yo(req) });
});

/** Foto de perfil: llega reducida desde el navegador como data URL (JPG/PNG). */
r.put('/foto', async (req, res) => {
  const u = req.usuario;
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.dataUrl || ''));
  if (!m) throw fallo('No se pudo leer la imagen. Elige un archivo JPG o PNG.');
  const datos = Buffer.from(m[2], 'base64');
  si(datos.length > 1.5 * 1024 * 1024, 'La imagen es demasiado grande');
  const dir = path.join(config.uploadsDir, 'personas');
  await fs.mkdir(dir, { recursive: true });
  const nombre = `u${u.id}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  await fs.writeFile(path.join(dir, nombre), datos);
  await tx(async (c) => {
    await c.query('UPDATE usuarios SET foto_url = $2 WHERE id = $1', [u.id, `/uploads/personas/${nombre}`]);
    await bitacora(c, u, { accion: 'foto.cambiar', elemento: u.usuario, motivo: 'persona' });
  });
  res.json({ usuario: await yo(req) });
});

/** Mis pagos: quincenas ya generadas y las próximas con sus descuentos. */
r.get('/pagos', async (req, res) => {
  const { rows } = await q('SELECT * FROM usuarios WHERE id = $1', [req.usuario.id]);
  res.json(await pagosDe({ query: q }, rows[0]));
});

r.delete('/foto', async (req, res) => {
  await tx(async (c) => {
    await c.query('UPDATE usuarios SET foto_url = NULL WHERE id = $1', [req.usuario.id]);
    await bitacora(c, req.usuario, { accion: 'foto.quitar', elemento: req.usuario.usuario });
  });
  res.json({ usuario: await yo(req) });
});

export default r;
