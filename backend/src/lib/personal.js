import bcrypt from 'bcryptjs';
import { ts } from '../db.js';
import { ahora, D, lunes, semanaKey } from './reloj.js';
import { fallo } from './errores.js';
import { bitacora, notificar } from './registro.js';
import { r2 } from './negocio.js';

/* Reglas de personal (mismas del borrador): niveles, despidos, cambios de rol, vacantes, nómina. */
export const NIVEL = { mesero: 1, cocinero: 1, jefe: 2, bodega: 2, gerente: 3, rrhh: 4, gg: 5, director: 6 };
export const ROLN = { mesero: 'Mesero', cocinero: 'Cocinero', jefe: 'Jefe de cocina', bodega: 'Encargado de bodega', gerente: 'Gerente de sucursal', rrhh: 'Recursos Humanos', gg: 'Gerente general', director: 'Director' };
export const ROLES_SUC = ['mesero', 'cocinero', 'jefe', 'bodega', 'gerente'];
const RENTA = [[236, 0, 0], [447.62, 10, 8.83], [1019.05, 20, 30], [Infinity, 30, 144.28]];

export async function salarioRol(c, rol) {
  return (await c.query('SELECT salario FROM roles WHERE id = $1', [rol])).rows[0]?.salario || 0;
}
export const salarioDe = (u, salRol) => r2(salRol + (u.extra_antiguedad || 0));

/** Indemnización (Código de Trabajo, art. 58): 30 días por año, mínimo 15, tope de 4 salarios mínimos diarios. */
export function indemnizacion(u, salario, t = ahora()) {
  const anios = Math.max(0, (t - u.ingreso) / (365.25 * D));
  const diario = Math.min(salario / 30, 4 * 13.44);
  const dias = Math.max(15, 30 * anios);
  return { anios: r2(anios), dias: r2(dias), base: r2(diario), monto: r2(dias * diario) };
}

/** Quincena: ISSS 3 % (tope $15), AFP 7.25 % y renta según la tabla de retención. */
export function quincena(mensual) {
  const q = r2(mensual / 2);
  const isss = r2(Math.min((q * 3) / 100, 15));
  const afp = r2((q * 7.25) / 100);
  const base = q - isss - afp;
  let renta = 0;
  for (let i = 0; i < RENTA.length; i++) {
    const [lim, p, fijo] = RENTA[i];
    if (base <= lim) { renta = i ? r2((base - RENTA[i - 1][0]) * p / 100 + fijo) : 0; break; }
  }
  return { bruto: q, isss, afp, renta, base: r2(base), liquido: r2(q - isss - afp - renta) };
}

export const activos = async (c, s, rol) => (await c.query(
  `SELECT * FROM usuarios WHERE estado = 'Activo' AND ($1::int IS NULL OR sucursal_id = $1) AND ($2::text IS NULL OR rol_id = $2)`,
  [s ?? null, rol ?? null])).rows;

export async function necesarios(c, s, rol) {
  const { rows } = await c.query(
    `SELECT COALESCE(pm.cantidad, 0) AS minimo, sp.cantidad AS plantilla FROM sucursales su
       LEFT JOIN plantilla_minima pm ON pm.tamano = su.tamano AND pm.rol_id = $2
       LEFT JOIN sucursal_plantilla sp ON sp.sucursal_id = su.id AND sp.rol_id = $2 WHERE su.id = $1`, [s, rol]);
  return Math.max(rows[0]?.minimo || 0, rows[0]?.plantilla ?? 0);
}

export async function vacantesPend(c, s, rol) {
  const { rows } = await c.query(`SELECT COALESCE(sum(cantidad - cubiertas), 0)::int n FROM vacantes WHERE sucursal_id = $1 AND rol_id = $2 AND estado = 'Abierta'`, [s, rol]);
  return rows[0].n;
}

export async function abrirVacantes(c, s, rol, cant, origen, prioridad, solicitudId) {
  await c.query(
    `INSERT INTO vacantes (sucursal_id, rol_id, cantidad, origen, prioridad, fecha, solicitud_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [s, rol, cant, origen, prioridad, ts(ahora()), solicitudId ?? null]);
}

/** Si al salir alguien la sucursal queda por debajo de lo necesario, se abre una vacante de prioridad alta. */
export async function vacanteSiFalta(c, s, rol, origen, solicitudId) {
  if (!s || !ROLES_SUC.includes(rol)) return;
  if ((await activos(c, s, rol)).length + (await vacantesPend(c, s, rol)) < (await necesarios(c, s, rol))) {
    await abrirVacantes(c, s, rol, 1, origen, 'Alta', solicitudId);
  }
}

export async function historial(c, usuarioId, tipo, detalle, por) {
  await c.query('INSERT INTO usuario_historial (usuario_id, fecha, tipo, detalle, por) VALUES ($1,$2,$3,$4,$5)',
    [usuarioId, ts(ahora()), tipo, detalle, por || 'Sistema']);
}

/* ---------- bloqueos ---------- */
export async function ocupado(c, u) {
  if (u.rol_id === 'mesero') {
    if ((await c.query(`SELECT 1 FROM cajas WHERE mesero_id = $1 AND estado = 'Abierta'`, [u.id])).rowCount) return 'Tiene una caja abierta: debe cerrarla antes';
    const n = (await c.query(`SELECT count(*)::int n FROM pedidos WHERE mesero_id = $1 AND estado NOT IN ('Cobrado','Cancelado','Rechazado')`, [u.id])).rows[0].n;
    if (n) return `Tiene ${n} pedido${n === 1 ? '' : 's'} sin cobrar`;
  }
  if (u.rol_id === 'cocinero') {
    const n = (await c.query(`SELECT count(*)::int n FROM pedidos WHERE cocinero_id = $1 AND estado IN ('Asignado','Preparando')`, [u.id])).rows[0].n;
    if (n) return `Tiene ${n} pedido${n === 1 ? '' : 's'} en preparación`;
  }
  return '';
}
/** Siempre debe quedar al menos una persona por rol en la sucursal (el gerente se repone con vacante). */
export async function ultimoRol(c, u) {
  if (!u.sucursal_id || !ROLES_SUC.includes(u.rol_id) || u.rol_id === 'gerente') return '';
  const otros = (await activos(c, u.sucursal_id, u.rol_id)).filter((x) => x.id !== u.id).length;
  return otros < 1 ? `Es la única persona con el rol ${ROLN[u.rol_id]} en la sucursal: siempre debe quedar al menos una` : '';
}
export async function ultimoCentral(c, u) {
  if (!['rrhh', 'gg'].includes(u.rol_id)) return '';
  const otros = (await activos(c, null, u.rol_id)).filter((x) => x.id !== u.id).length;
  return otros < 1 ? `Es la única persona con el rol ${ROLN[u.rol_id]}: ese puesto nunca puede quedar vacío` : '';
}
export const despidoBloqueo = async (c, u) => (await ocupado(c, u)) || (await ultimoRol(c, u)) || (await ultimoCentral(c, u));

/** Solo se actúa sobre personas de nivel inferior (el gerente, solo en su sucursal). */
export function puedeSobre(por, u) {
  return !!u && u.estado === 'Activo' && u.id !== por.id && NIVEL[u.rol_id] < NIVEL[por.rol]
    && (por.rol === 'director' || !!u.sucursal_id) && (por.rol !== 'gerente' || u.sucursal_id === por.sucursal);
}
export function rolesDestino(por, u) {
  if (!u.sucursal_id) return por.rol === 'director' && u.rol_id === 'rrhh' ? ['gg'] : [];
  const b = ROLES_SUC.filter((r) => r !== u.rol_id && (por.rol === 'director' || NIVEL[r] < NIVEL[por.rol]));
  return por.rol === 'director' ? [...b, 'rrhh', 'gg'] : b;
}

export async function usuarioPorId(c, id) {
  const { rows } = await c.query('SELECT * FROM usuarios WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw fallo('No se encontró a la persona');
  return rows[0];
}

/** Cambia el rol. Si pasa a gerente y no tenía clave, se genera una y se devuelve para mostrarla una vez. */
export async function cambiarRol(c, u, nuevo, por, motivo) {
  if (!puedeSobre(por, u)) throw fallo('No puedes cambiar el rol de esta persona');
  if (!rolesDestino(por, u).includes(nuevo)) throw fallo('Ese rol no está a tu alcance');
  if (nuevo === 'gerente' && (await activos(c, u.sucursal_id, 'gerente')).length) throw fallo('La sucursal ya tiene gerente');
  const bl = await despidoBloqueo(c, u);
  if (bl) throw fallo(bl);
  const ant = u.rol_id;
  const suc0 = u.sucursal_id;
  // gerente y gerente general aprueban con clave: si no tenía, se genera y se muestra una sola vez
  const clave = ['gerente', 'gg'].includes(nuevo) && !u.clave_hash ? String(1000 + Math.floor(Math.random() * 9000)) : null;
  const central = ['rrhh', 'gg'].includes(nuevo);
  const hash = clave ? await bcrypt.hash(clave, 10) : nuevo === 'rrhh' ? null : u.clave_hash;
  await c.query(`UPDATE usuarios SET rol_id = $2, sucursal_id = $3, clave_hash = $4, intentos_clave = 0 WHERE id = $1`,
    [u.id, nuevo, central ? null : u.sucursal_id, hash]);
  await historial(c, u.id, NIVEL[nuevo] > NIVEL[ant] ? 'Ascenso' : 'Cambio de rol', `${ROLN[ant]} → ${ROLN[nuevo]} · ${motivo}`, por.nombre);
  await vacanteSiFalta(c, suc0, ant, 'Cambio de rol');
  await bitacora(c, por, { accion: 'empleado.cambiar_rol', elemento: u.usuario, motivo, antes: { rol: ant }, despues: { rol: nuevo }, sucursal: suc0, clave: por.rol === 'gerente' });
  await notificar(c, 'rrhh', null, 'Cambio de rol', `${u.nombre}: ${ROLN[ant]} → ${ROLN[nuevo]}`);
  await notificar(c, 'gg', null, 'Cambio de rol', `${u.nombre}: ${ROLN[ant]} → ${ROLN[nuevo]}`);
  return clave;
}

/** Aplica un despido aprobado: indemnización, libera turnos, cancela solicitudes y abre vacante si falta gente. */
export async function aplicarDespido(c, solicitudId, aprobador) {
  const { rows } = await c.query('SELECT * FROM solicitudes WHERE id = $1 FOR UPDATE', [solicitudId]);
  const sol = rows[0];
  const u = await usuarioPorId(c, sol.usuario_id);
  const bl = await despidoBloqueo(c, u);
  if (bl) throw fallo(bl);
  const t = ahora();
  const ind = indemnizacion(u, salarioDe(u, await salarioRol(c, u.rol_id)), t);
  await c.query(`UPDATE usuarios SET estado = 'Despedido', fecha_baja = $2 WHERE id = $1`, [u.id, ts(t)]);
  await historial(c, u.id, 'Despido', `Aprobado por ${aprobador.nombre} · ${sol.motivo}`, aprobador.nombre);
  await c.query(`UPDATE solicitudes SET estado = 'Aplicada', decidio_id = $2, cierre = $3, monto = $4, datos = datos || $5::jsonb WHERE id = $1`,
    [sol.id, aprobador.id, ts(t), ind.monto, JSON.stringify({ indemn: ind })]);
  await c.query(`DELETE FROM turnos WHERE usuario_id = $1 AND (semana IS NULL OR semana >= $2::date)`, [u.id, semanaKey(lunes(t))]);
  await c.query(`UPDATE solicitudes SET estado = 'Cancelada', cierre = $3 WHERE id <> $2 AND estado = 'Solicitada'
                   AND tipo IN ('Despido','Restablecer contraseña') AND (usuario_id = $1 OR solicitante_id = $1)`, [u.id, sol.id, ts(t)]);
  await vacanteSiFalta(c, u.sucursal_id, u.rol_id, 'Reemplazo por despido', sol.id);
  if (aprobador.rol !== 'gg') await notificar(c, 'gg', null, 'Despido aprobado en sucursal', `${u.nombre} · indemnización $${ind.monto.toFixed(2)}`);
  await notificar(c, 'rrhh', null, 'Despido aprobado: vacante abierta', u.nombre);
  return ind;
}

/** Despido directo (gerente con clave o director): se crea la solicitud y se aplica de inmediato. */
export async function despedirDirecto(c, u, por, motivo) {
  if (!puedeSobre(por, u)) throw fallo('No puedes despedir a esta persona');
  const bl = await despidoBloqueo(c, u);
  if (bl) throw fallo(bl);
  const { rows } = await c.query(
    `INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, usuario_id, aprueba_rol, motivo, fecha)
     VALUES ('Despido','Solicitada',$1,$2,$3,$4,$5,$6) RETURNING id`, [u.sucursal_id, por.id, u.id, por.rol, motivo, ts(ahora())]);
  const ind = await aplicarDespido(c, rows[0].id, por);
  await bitacora(c, por, { accion: 'despido.directo', elemento: u.usuario, motivo, sucursal: u.sucursal_id, clave: por.rol === 'gerente' });
  return ind;
}

/** Turno de hoy («Mañana», «7–22 h», «Libre» o «—» si no tiene). */
export function turnoHoy(turnosUsuario, t = ahora()) {
  const celdas = turnosUsuario?.[semanaKey(t)] || turnosUsuario?.base;
  if (!celdas) return null;
  const x = celdas[(new Date(t - 6 * 36e5).getUTCDay() + 6) % 7];
  return x ? (['Mañana', 'Tarde', 'Noche'].includes(x) ? x : `${x.replace('-', '–')} h`) : 'Libre';
}
