import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, tx, ts } from '../db.js';
import { fallo } from '../lib/errores.js';
import { ahora } from '../lib/reloj.js';
import { bitacora, notificar } from '../lib/registro.js';
import { cfg, cfgPublica } from '../lib/negocio.js';
import { abrirSesion, cerrarSesion, cargarUsuario, usuarioPublico, autenticar } from '../middleware/auth.js';

const r = Router();

/** Roles para la pantalla de entrada (primer paso: «¿Qué rol eres?») */
r.get('/roles', async (req, res) => {
  const { rows } = await q('SELECT id, nombre, alcance, pantalla_inicio AS entra FROM roles ORDER BY nivel, id');
  const orden = ['mesero', 'cocinero', 'jefe', 'bodega', 'gerente', 'rrhh', 'gg', 'director'];
  res.json(rows.sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id)));
});

/**
 * Entrada en dos pasos: rol, luego usuario y contraseña (el usuario debe pertenecer al rol).
 * Los directores escriben contraseña y PIN; con uno solo entran y deben fijar el otro en Perfil.
 */
r.post('/login', async (req, res) => {
  const { rol, usuario, password, pin } = req.body || {};
  const login = String(usuario || '').trim().toLowerCase();
  const { rows } = await q(`SELECT * FROM usuarios WHERE usuario = $1 AND rol_id = $2 AND estado = 'Activo'`, [login, rol]);
  const x = rows[0];
  const esDirector = rol === 'director';
  const okP = !!x && !!password && (await bcrypt.compare(String(password), x.pass_hash));
  const okN = !!x && esDirector && !!pin && !!x.pin_hash && (await bcrypt.compare(String(pin), x.pin_hash));
  if (!x || (esDirector ? !(okP || okN) : !okP)) {
    throw fallo(esDirector ? 'Usuario, contraseña o PIN incorrectos' : 'Usuario o contraseña incorrectos');
  }
  if (esDirector && !(okP && okN)) {
    await tx(async (c) => {
      if (okN) await c.query('UPDATE usuarios SET cambiar_pass = TRUE, recup_pass = TRUE WHERE id = $1', [x.id]);
      else await c.query('UPDATE usuarios SET cambiar_pin = TRUE, recup_pin = TRUE WHERE id = $1', [x.id]);
      await bitacora(c, { id: x.id, nombre: x.nombre, rol: x.rol_id }, {
        accion: 'login.recuperacion', elemento: x.usuario,
        motivo: okN ? 'Entró solo con el PIN: debe fijar una contraseña nueva' : 'Entró solo con la contraseña: debe fijar un PIN nuevo',
      });
    });
  }
  abrirSesion(res, x.id);
  const k = await cfg({ query: q });
  res.json({ usuario: usuarioPublico(await cargarUsuario(x.id)), config: cfgPublica(k) });
});

r.post('/logout', (req, res) => {
  cerrarSesion(res);
  res.json({ ok: true });
});

/** Sesión actual (se permite aunque tenga contraseña temporal: la usa la pantalla de Perfil). */
r.get('/yo', autenticar, async (req, res) => {
  const k = await cfg({ query: q });
  res.json({ usuario: usuarioPublico(req.usuario), config: cfgPublica(k) });
});

/** RN-AUT-01/02/04: «¿Olvidaste tu contraseña?» crea una solicitud para quien la atiende. */
r.post('/olvido', async (req, res) => {
  const login = String(req.body?.usuario || '').trim().toLowerCase();
  const out = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT u.id, u.nombre, u.rol_id, u.sucursal_id, r.atiende_reset, a.nombre AS atiende_nombre
         FROM usuarios u JOIN roles r ON r.id = u.rol_id JOIN roles a ON a.id = r.atiende_reset
        WHERE u.usuario = $1 AND u.estado = 'Activo'`, [login]);
    const u = rows[0];
    if (!u) throw fallo('No encontramos ese usuario');
    const pend = await c.query(
      `SELECT 1 FROM solicitudes WHERE tipo = 'Restablecer contraseña' AND usuario_id = $1 AND estado = 'Solicitada'`, [u.id]);
    if (pend.rowCount) throw fallo('Ya hay una solicitud pendiente');
    if (u.rol_id === 'director') {
      const otros = await c.query(`SELECT 1 FROM usuarios WHERE rol_id = 'director' AND estado = 'Activo' AND id <> $1`, [u.id]);
      if (!otros.rowCount) throw fallo('No hay otro director activo que pueda aprobar el cambio');
    }
    await c.query(
      `INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, usuario_id, aprueba_rol, nombre, fecha)
       VALUES ('Restablecer contraseña','Solicitada',$1,$2,$2,$3,$4,$5)`,
      [u.sucursal_id, u.id, u.atiende_reset, u.nombre, ts(ahora())]);
    await notificar(c, u.atiende_reset, null, 'Restablecer contraseña', `Solicitud de ${u.nombre}`);
    await bitacora(c, { id: u.id, nombre: u.nombre, rol: u.rol_id }, { accion: 'contraseña.solicitud', elemento: login, sucursal: u.sucursal_id });
    return { ok: `Solicitud enviada a ${u.atiende_nombre}.` };
  });
  res.json(out);
});

export default r;
