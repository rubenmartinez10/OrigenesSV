import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { q } from '../db.js';
import { HttpError, prohibido } from '../lib/errores.js';

export const COOKIE = 'osv_sesion';
const opciones = { httpOnly: true, sameSite: 'lax', secure: config.cookieSegura, path: '/' };

export function abrirSesion(res, usuarioId) {
  const token = jwt.sign({ uid: usuarioId }, config.jwtSecret, { expiresIn: '12h' });
  res.cookie(COOKIE, token, { ...opciones, maxAge: 12 * 36e5 });
}
export const cerrarSesion = (res) => res.clearCookie(COOKIE, opciones);

/** Usuario con los datos que usa toda la app (sin hashes). */
export async function cargarUsuario(id) {
  const { rows } = await q(
    `SELECT u.id, u.usuario, u.nombre, u.rol_id AS rol, u.sucursal_id AS sucursal, u.estado, u.documento,
            u.telefono, u.correo, u.foto_url AS foto, u.ingreso, u.cambiar_pass, u.cambiar_pin, u.recup_pass, u.recup_pin,
            u.clave_hash IS NOT NULL AS tiene_clave, u.intentos_clave,
            r.nombre AS rol_nombre, r.pantalla_inicio, s.nombre AS sucursal_nombre
       FROM usuarios u JOIN roles r ON r.id = u.rol_id LEFT JOIN sucursales s ON s.id = u.sucursal_id
      WHERE u.id = $1`, [id]);
  return rows[0] || null;
}

export const usuarioPublico = (u) => ({
  id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, rolNombre: u.rol_nombre, entra: u.pantalla_inicio,
  sucursal: u.sucursal, sucursalNombre: u.sucursal_nombre, telefono: u.telefono || '', correo: u.correo || '',
  foto: u.foto, documento: u.documento, cambiarPass: u.cambiar_pass, cambiarPin: u.cambiar_pin,
  recupPass: u.recup_pass, recupPin: u.recup_pin, tieneClave: u.tiene_clave, claveBloqueada: u.intentos_clave >= 3,
});

/** Exige una sesión válida de alguien que sigue Activo. */
export async function autenticar(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new HttpError(401, 'Inicia sesión para continuar');
  let uid;
  try {
    uid = jwt.verify(token, config.jwtSecret).uid;
  } catch {
    cerrarSesion(res);
    throw new HttpError(401, 'Tu sesión venció. Vuelve a entrar');
  }
  const u = await cargarUsuario(uid);
  if (!u || u.estado !== 'Activo') {
    cerrarSesion(res);
    throw new HttpError(401, 'Tu sesión se cerró');
  }
  req.usuario = u;
  next();
}

/** Con contraseña o PIN temporal solo se puede estar en Perfil (RN-AUT-03). */
export function exigirCredencialesAlDia(req, res, next) {
  const u = req.usuario;
  if (u.cambiar_pass || u.cambiar_pin) throw new HttpError(423, 'Primero cambia tu contraseña en Mi perfil');
  next();
}

export const soloRoles = (...roles) => (req, res, next) => {
  if (!roles.includes(req.usuario.rol)) throw prohibido();
  next();
};
