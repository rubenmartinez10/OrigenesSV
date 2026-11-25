import bcrypt from 'bcryptjs';
import { q } from '../db.js';
import { HttpError, prohibido } from './errores.js';

/**
 * Clave de aprobaciones (gerente de sucursal y gerente general). Es distinta de la contraseña.
 * Tres intentos fallidos la bloquean. Se verifica fuera de la transacción de la acción
 * para que el contador de intentos se guarde aunque la acción no se ejecute.
 */
export async function verificarClave(usuario, clave) {
  const { rows } = await q('SELECT clave_hash, intentos_clave FROM usuarios WHERE id = $1', [usuario.id]);
  const u = rows[0];
  if (!u?.clave_hash) throw prohibido();
  if (u.intentos_clave >= 3) throw new HttpError(423, 'Tu clave está bloqueada', { clave: 'bloqueada' });
  if (await bcrypt.compare(String(clave || ''), u.clave_hash)) {
    if (u.intentos_clave) await q('UPDATE usuarios SET intentos_clave = 0 WHERE id = $1', [usuario.id]);
    return true;
  }
  const n = u.intentos_clave + 1;
  await q('UPDATE usuarios SET intentos_clave = $2 WHERE id = $1', [usuario.id, n]);
  const quedan = 3 - n;
  if (quedan <= 0) throw new HttpError(423, 'Tu clave está bloqueada', { clave: 'bloqueada' });
  throw new HttpError(400, `Clave incorrecta. Te quedan ${quedan} intentos`, { clave: 'incorrecta', quedan });
}
