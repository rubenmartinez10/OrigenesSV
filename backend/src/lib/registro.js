import { ahora } from './reloj.js';
import { ts } from '../db.js';

/**
 * Bitácora: toda acción queda registrada con usuario, fecha y motivo.
 * Nunca se guarda el valor de una contraseña, clave o PIN.
 */
export async function bitacora(c, usuario, { accion, elemento, motivo, antes, despues, sucursal, clave }) {
  await c.query(
    `INSERT INTO bitacora (fecha, usuario_id, usuario_nombre, rol_id, sucursal_id, accion, elemento, motivo, antes, despues, con_clave)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [ts(ahora()), usuario?.id ?? null, usuario?.nombre ?? 'Sistema', usuario?.rol ?? 'sistema',
      sucursal ?? usuario?.sucursal ?? null, accion, elemento == null ? null : String(elemento),
      motivo || '', antes == null ? null : JSON.stringify(antes), despues == null ? null : JSON.stringify(despues), !!clave],
  );
}

/** Registro automático del sistema (procesos del reloj). */
export const bitacoraSistema = (c, accion, elemento, motivo, sucursal) =>
  bitacora(c, null, { accion, elemento, motivo, sucursal });

/** Aviso para un rol (y su sucursal). Los roles de franquicia usan sucursal = null. */
export async function notificar(c, rol, sucursal, titulo, detalle) {
  await c.query(
    'INSERT INTO notificaciones (rol_id, sucursal_id, titulo, detalle, fecha) VALUES ($1,$2,$3,$4,$5)',
    [rol, sucursal ?? null, titulo, detalle ?? '', ts(ahora())],
  );
}
