import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, tx, ts } from '../db.js';
import { si, noEncontrado, motivo as validarMotivo } from '../lib/errores.js';
import { ahora, D, lunes, semanaKey } from '../lib/reloj.js';
import { bitacora, notificar } from '../lib/registro.js';
import { cfg, r2, TURNOS, turnosDe } from '../lib/negocio.js';
import { cargarSolicitudes } from '../lib/consultas.js';
import {
  NIVEL, ROLN, ROLES_SUC, activos, historial, ultimoRol, vacanteSiFalta, usuarioPorId, turnoHoy,
} from '../lib/personal.js';
import { quincenas, qLabel, generarPlanilla, filaJson } from '../lib/nomina.js';

/* Recursos Humanos · 6.1 Personal, 6.2 Roles y salarios, 6.3 Turnos, 6.4 Planilla, 6.5 Reportes de pago, proveedores y facturas */
const r = Router();
const DB = { query: q };
const BAJOS = Object.keys(NIVEL).filter((x) => NIVEL[x] < NIVEL.rrhh);
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const temporal = () => `Tmp${1000 + Math.floor(Math.random() * 9000)}`;
const claveNueva = () => String(1000 + Math.floor(Math.random() * 9000));

/** Usuario a partir del nombre: inicial + apellido (sin tildes), con número si ya existe. */
async function usuarioDe(c, nombre) {
  const p = norm(nombre).replace(/[^a-z ]/g, '').trim().split(/\s+/);
  const base = (p[0][0] || 'u') + (p.length > 2 ? p[p.length - 2] : p[p.length - 1] || 'x');
  const { rows } = await c.query('SELECT usuario FROM usuarios WHERE usuario LIKE $1', [`${base}%`]);
  const usados = new Set(rows.map((x) => x.usuario));
  let u = base;
  for (let i = 2; usados.has(u); i++) u = base + i;
  return u;
}
/** Turno base: el cocinero de 7 a 22 toda la semana; el resto, su turno de lunes a viernes. */
const turnoBase = (rol, t) => (rol === 'cocinero' && t === '7-22' ? Array(7).fill(t) : [t, t, t, t, t, '', '']);
const celdaValida = (x) => x === '' || !!TURNOS[x] || (/^\d{1,2}-\d{1,2}$/.test(x) && x.split('-').every((n) => +n >= 0 && +n <= 23) && x.split('-')[0] !== x.split('-')[1]);

/* ---------- 6.1 Personal ---------- */
async function personas(c, where = 'TRUE', params = []) {
  const { rows } = await c.query(
    `SELECT u.*, r.salario AS salario_rol, s.nombre AS suc_nombre,
            EXISTS (SELECT 1 FROM solicitudes x WHERE x.tipo = 'Despido' AND x.usuario_id = u.id AND x.estado = 'Solicitada') AS desp
       FROM usuarios u JOIN roles r ON r.id = u.rol_id LEFT JOIN sucursales s ON s.id = u.sucursal_id WHERE ${where} ORDER BY u.nombre`, params);
  return rows.map((u) => {
    const estado = u.estado === 'Despedido' ? 'Despedido' : u.desp ? 'Despido solicitado' : 'Activo';
    const puede = u.estado === 'Activo' && NIVEL[u.rol_id] < NIVEL.rrhh && !u.desp;
    return {
      id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol_id, rolNombre: ROLN[u.rol_id], suc: u.sucursal_id,
      sucNombre: u.suc_nombre || 'Gerencia central', ingreso: u.ingreso, foto: u.foto_url, estado, puede,
      salarioRol: u.salario_rol, extraAnt: u.extra_antiguedad, salario: r2(u.salario_rol + u.extra_antiguedad),
      documento: u.documento, telefono: u.telefono, correo: u.correo, fechaBaja: u.fecha_baja,
      ascensos: puede ? BAJOS.filter((x) => NIVEL[x] > NIVEL[u.rol_id]).map((x) => ({ id: x, nombre: ROLN[x] })) : [],
    };
  });
}
const sucursalesOp = async (c) => (await c.query(`SELECT id, nombre FROM sucursales WHERE estado = 'Operando' ORDER BY id`)).rows;
async function rolesInfo(c) {
  const { rows } = await c.query('SELECT id, nombre, nivel, salario, salario_desde FROM roles ORDER BY nivel, id');
  return rows;
}

r.get('/empleados', async (req, res) => {
  res.json({ personas: await personas(DB), sucursales: await sucursalesOp(DB), roles: await rolesInfo(DB), bajos: BAJOS, turnos: Object.keys(TURNOS) });
});

r.get('/empleados/:id', async (req, res) => {
  const [p] = await personas(DB, 'u.id = $1', [req.params.id]);
  if (!p) throw noEncontrado('No se encontró a la persona');
  const t = (await turnosDe(DB, [p.id]))[p.id];
  const { rows: h } = await q('SELECT fecha, tipo, detalle, por FROM usuario_historial WHERE usuario_id = $1 ORDER BY fecha DESC, id DESC', [p.id]);
  const { rows: d } = await q(`SELECT monto, datos FROM solicitudes WHERE tipo = 'Despido' AND usuario_id = $1 AND estado = 'Aplicada' ORDER BY id DESC LIMIT 1`, [p.id]);
  res.json({ ...p, turno: turnoHoy(t), sinTurno: !t, historial: h, indemn: d[0]?.datos?.indemn || null });
});

r.post('/empleados', async (req, res) => {
  const u = req.usuario;
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim().replace(/\s+/g, ' ');
  si(nombre.split(' ').length < 2, 'Escribe el nombre completo (nombre y apellido)');
  si(!/^\d{8}-\d$/.test(String(b.doc || '')), 'El DUI debe tener el formato 00000000-0');
  si(!/^\d{4}-\d{4}$/.test(String(b.tel || '')), 'El teléfono debe tener 8 números con el formato 0000-0000');
  const mail = String(b.mail || '').trim();
  si(mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail), 'El correo no es válido (ejemplo: nombre@correo.com)');
  si(!BAJOS.includes(b.rol), 'Elige un rol');
  si(!TURNOS[b.turno], 'Elige el turno');
  const ingreso = b.ingreso ? Date.parse(`${b.ingreso}T08:00:00-06:00`) : ahora();
  si(!Number.isFinite(ingreso), 'Revisa la fecha de ingreso');
  const out = await tx(async (c) => {
    const { rows: sc } = await c.query(`SELECT id, nombre FROM sucursales WHERE id = $1 AND estado = 'Operando'`, [b.suc]);
    si(!sc[0], 'Elige una sucursal que esté operando');
    const s = sc[0].id;
    const { rows: dui } = await c.query(`SELECT 1 FROM usuarios WHERE documento = $1 AND estado = 'Activo'`, [b.doc]);
    si(dui[0], 'Ya hay una persona activa con ese DUI');
    if (b.rol === 'gerente') si((await activos(c, s, 'gerente')).length, 'La sucursal ya tiene gerente');
    let vac = null;
    if (b.vacante) {
      const { rows: v } = await c.query(`SELECT * FROM vacantes WHERE id = $1 AND estado = 'Abierta' FOR UPDATE`, [b.vacante]);
      si(!v[0], 'Esta vacante ya fue cubierta');
      si(v[0].rol_id !== b.rol || v[0].sucursal_id !== s, 'La vacante es de otro rol o sucursal');
      vac = v[0];
    }
    const login = await usuarioDe(c, nombre);
    const pass = temporal();
    const clave = b.rol === 'gerente' ? claveNueva() : null;
    const { rows: ins } = await c.query(
      `INSERT INTO usuarios (usuario, nombre, rol_id, sucursal_id, pass_hash, clave_hash, documento, telefono, correo, ingreso, cambiar_pass)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE) RETURNING id`,
      [login, nombre, b.rol, s, await bcrypt.hash(pass, 10), clave ? await bcrypt.hash(clave, 10) : null, b.doc, b.tel, mail || null, ts(ingreso)]);
    const id = ins[0].id;
    await c.query('INSERT INTO turnos (usuario_id, semana, dias) VALUES ($1, NULL, $2)', [id, turnoBase(b.rol, b.turno)]);
    await historial(c, id, 'Contratación', `${ROLN[b.rol]} · ${sc[0].nombre}`, u.nombre);
    if (vac) {
      await c.query(`UPDATE vacantes SET cubiertas = cubiertas + 1, estado = CASE WHEN cubiertas + 1 >= cantidad THEN 'Cubierta' ELSE estado END WHERE id = $1`, [vac.id]);
    }
    await notificar(c, 'gerente', s, 'Nueva persona en tu equipo', `${nombre} · ${ROLN[b.rol]}`);
    await bitacora(c, u, { accion: 'empleado.contratar', elemento: login, despues: { rol: b.rol, sucursal: s }, sucursal: s });
    return { usuario: login, nombre, pass, clave };
  });
  res.status(201).json(out);
});

r.post('/empleados/:id/ascender', async (req, res) => {
  const u = req.usuario;
  const nuevo = req.body?.rol;
  const clave = await tx(async (c) => {
    const x = await usuarioPorId(c, req.params.id);
    si(x.estado !== 'Activo' || NIVEL[x.rol_id] >= NIVEL.rrhh, 'No puedes ascender a esta persona');
    si(!BAJOS.includes(nuevo) || NIVEL[nuevo] <= NIVEL[x.rol_id], 'Elige un rol superior al actual');
    const bl = await ultimoRol(c, x);
    si(bl, bl);
    if (nuevo === 'gerente') si((await activos(c, x.sucursal_id, 'gerente')).length, 'La sucursal ya tiene gerente');
    const k = nuevo === 'gerente' && !x.clave_hash ? claveNueva() : null;
    await c.query(`UPDATE usuarios SET rol_id = $2 ${k ? ', clave_hash = $3, intentos_clave = 0' : ''} WHERE id = $1`, [x.id, nuevo, ...(k ? [await bcrypt.hash(k, 10)] : [])]);
    await historial(c, x.id, 'Ascenso', `${ROLN[x.rol_id]} → ${ROLN[nuevo]}`, u.nombre);
    await vacanteSiFalta(c, x.sucursal_id, x.rol_id, 'Ascenso');
    await notificar(c, 'gerente', x.sucursal_id, 'Ascenso en tu equipo', `${x.nombre} ahora es ${ROLN[nuevo]}`);
    await bitacora(c, u, { accion: 'empleado.ascender', elemento: x.usuario, antes: { rol: x.rol_id }, despues: { rol: nuevo }, sucursal: x.sucursal_id });
    return k;
  });
  res.json({ ok: true, clave });
});

r.post('/empleados/:id/despido', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo, 'La razón');
  const out = await tx(async (c) => {
    const x = await usuarioPorId(c, req.params.id);
    si(x.estado !== 'Activo' || NIVEL[x.rol_id] >= NIVEL.rrhh, 'No puedes solicitar el despido de esta persona');
    const { rows: ya } = await c.query(`SELECT 1 FROM solicitudes WHERE tipo = 'Despido' AND usuario_id = $1 AND estado = 'Solicitada'`, [x.id]);
    si(ya[0], 'Ya hay un despido solicitado para esta persona');
    const ap = x.rol_id === 'gerente' || !x.sucursal_id ? 'gg' : 'gerente';
    await c.query(
      `INSERT INTO solicitudes (tipo, estado, sucursal_id, solicitante_id, usuario_id, aprueba_rol, nombre, motivo, fecha)
       VALUES ('Despido','Solicitada',$1,$2,$3,$4,$5,$6,$7)`, [x.sucursal_id, u.id, x.id, ap, x.nombre, m, ts(ahora())]);
    await notificar(c, ap, ap === 'gg' ? null : x.sucursal_id, 'Despido por aprobar', `${x.nombre} · ${m}`);
    await bitacora(c, u, { accion: 'despido.solicitar', elemento: x.usuario, motivo: m, sucursal: x.sucursal_id });
    return { aprueba: ap === 'gg' ? 'el gerente general' : 'el gerente de la sucursal' };
  });
  res.status(201).json(out);
});

r.get('/vacantes', async (req, res) => {
  const { rows } = await q(
    `SELECT v.*, s.nombre AS suc_nombre FROM vacantes v JOIN sucursales s ON s.id = v.sucursal_id
      WHERE v.estado = 'Abierta' ORDER BY (v.prioridad = 'Máxima') DESC, (v.prioridad = 'Alta') DESC, v.fecha`);
  res.json(rows.map((v) => ({
    id: v.id, suc: v.sucursal_id, sucNombre: v.suc_nombre, rol: v.rol_id, rolNombre: ROLN[v.rol_id], cant: v.cantidad, cubiertas: v.cubiertas,
    origen: v.origen, prioridad: v.prioridad, fecha: v.fecha,
  })));
});

r.get('/despidos', async (req, res) => {
  const L = await cargarSolicitudes(DB, `s.tipo = 'Despido'`);
  const { rows } = await q('SELECT id, nombre, rol_id FROM usuarios');
  const U = Object.fromEntries(rows.map((x) => [x.id, x]));
  const { rows: dec } = await q('SELECT id, decidio_id FROM solicitudes WHERE id = ANY($1)', [L.map((x) => x.id)]);
  const decN = Object.fromEntries(dec.map((x) => [x.id, U[x.decidio_id]?.nombre || null]));
  res.json(L.map((x) => ({ ...x, rolNombre: ROLN[U[x.usuario]?.rol_id], decidioNombre: decN[x.id] })));
});

/* ---------- 6.2 Roles y salarios ---------- */
r.get('/roles', async (req, res) => {
  const roles = (await rolesInfo(DB)).filter((x) => BAJOS.includes(x.id));
  const sols = await cargarSolicitudes(DB, `s.tipo = 'Salario'`);
  const k = await cfg(DB);
  res.json({
    minimo: k.salario_minimo,
    roles: roles.map((x) => ({ ...x, pendiente: sols.some((s) => s.rol === x.id && s.estado === 'Solicitada') })),
    solicitudes: sols.map((s) => ({ ...s, rolNombre: ROLN[s.rol] })),
  });
});

r.post('/roles/:id/salario', async (req, res) => {
  const u = req.usuario;
  const rol = req.params.id;
  const sal = r2(+req.body?.salario);
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    si(!BAJOS.includes(rol), 'Ese rol no está a tu alcance');
    const k = await cfg(c);
    const { rows } = await c.query('SELECT * FROM roles WHERE id = $1', [rol]);
    si(!(sal >= k.salario_minimo), `No puede ser menor al mínimo legal ($${(+k.salario_minimo).toFixed(2)})`);
    si(sal === rows[0].salario, 'El salario nuevo debe ser distinto del actual');
    const { rows: ya } = await c.query(`SELECT 1 FROM solicitudes WHERE tipo = 'Salario' AND rol_id = $1 AND estado = 'Solicitada'`, [rol]);
    si(ya[0], 'Ya hay un cambio solicitado para este rol');
    await c.query(
      `INSERT INTO solicitudes (tipo, estado, solicitante_id, rol_id, aprueba_rol, nombre, motivo, monto, datos, fecha)
       VALUES ('Salario','Solicitada',$1,$2,'gg',$3,$4,$5,$6,$7)`,
      [u.id, rol, rows[0].nombre, m, sal, JSON.stringify({ actual: rows[0].salario, propuesto: sal }), ts(ahora())]);
    await notificar(c, 'gg', null, 'Cambio de salario solicitado', `${rows[0].nombre} · $${sal.toFixed(2)}`);
    await bitacora(c, u, { accion: 'salario.solicitar', elemento: rol, motivo: m, despues: { salario: sal } });
  });
  res.status(201).json({ ok: true });
});

r.get('/aumentos', async (req, res) => {
  const { rows } = await q(`SELECT a.*, u.nombre FROM aumentos a JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.fecha DESC, a.id DESC LIMIT 200`);
  res.json(rows.map((a) => ({ id: a.id, nombre: a.nombre, fecha: a.fecha, anios: a.anios, antes: a.antes, despues: a.despues })));
});

r.get('/salarios', async (req, res) => {
  res.json((await personas(DB, `u.estado = 'Activo'`)).sort((a, b) => b.salario - a.salario));
});

/* catálogos de materia prima: aprobación final de unidades y categorías */
const TCAT = ['Unidad nueva', 'Categoría de materia prima'];
r.get('/catalogos', async (req, res) => {
  const { rows: un } = await q('SELECT nombre FROM mp_unidades ORDER BY predeterminada DESC, nombre');
  const { rows: ca } = await q('SELECT nombre FROM mp_categorias ORDER BY predeterminada DESC, nombre');
  const L = await cargarSolicitudes(DB, `s.tipo = ANY($1) AND s.estado IN ('Aprobada por gerente','Aprobada','Rechazada')`, [TCAT]);
  const { rows: g } = await q('SELECT id, nombre FROM usuarios');
  const nom = Object.fromEntries(g.map((x) => [x.id, x.nombre]));
  const { rows: sc } = await q('SELECT id, nombre FROM sucursales');
  const sn = Object.fromEntries(sc.map((x) => [x.id, x.nombre]));
  res.json({
    unidades: un.map((x) => x.nombre), categorias: ca.map((x) => x.nombre),
    pendientes: L.filter((x) => x.estado === 'Aprobada por gerente').map((x) => ({ ...x, sucNombre: sn[x.suc], gerenteNombre: nom[x.datos?.gerente] || '—' })),
    historial: L.filter((x) => x.estado !== 'Aprobada por gerente'),
  });
});

r.post('/catalogos/:id/aprobar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = ANY($2) AND estado = 'Aprobada por gerente' FOR UPDATE`, [req.params.id, TCAT]);
    const x = rows[0];
    si(!x, 'Esta solicitud ya fue decidida');
    const tabla = x.tipo === 'Unidad nueva' ? 'mp_unidades' : 'mp_categorias';
    const { rows: ex } = await c.query(`SELECT nombre FROM ${tabla}`);
    if (!ex.some((e) => norm(e.nombre) === norm(x.nombre))) await c.query(`INSERT INTO ${tabla} (nombre, predeterminada) VALUES ($1, FALSE)`, [x.nombre]);
    await c.query(`UPDATE solicitudes SET estado = 'Aprobada', cierre = $2, decidio_id = $3, datos = datos || $4::jsonb WHERE id = $1`,
      [x.id, ts(ahora()), u.id, JSON.stringify({ rrhh: u.id })]);
    await notificar(c, 'bodega', x.sucursal_id, 'Catálogo aprobado', `${x.nombre} ya está disponible`);
    await bitacora(c, u, { accion: 'catalogoMP.aprobar', elemento: x.nombre, sucursal: x.sucursal_id });
  });
  res.json({ ok: true });
});

r.post('/catalogos/:id/rechazar', async (req, res) => {
  const u = req.usuario;
  const m = validarMotivo(req.body?.motivo);
  await tx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM solicitudes WHERE id = $1 AND tipo = ANY($2) AND estado = 'Aprobada por gerente' FOR UPDATE`, [req.params.id, TCAT]);
    si(!rows[0], 'Esta solicitud ya fue decidida');
    await c.query(`UPDATE solicitudes SET estado = 'Rechazada', rechazo = $2, cierre = $3, decidio_id = $4 WHERE id = $1`,
      [rows[0].id, JSON.stringify({ por: u.nombre, etapa: 'Recursos Humanos', motivo: m, fecha: ahora() }), ts(ahora()), u.id]);
    await notificar(c, 'bodega', rows[0].sucursal_id, 'Solicitud rechazada por Recursos Humanos', m);
    await bitacora(c, u, { accion: 'catalogoMP.rechazar', elemento: rows[0].nombre, motivo: m, sucursal: rows[0].sucursal_id });
  });
  res.json({ ok: true });
});

/* ---------- 6.3 Turnos ---------- */
r.get('/turnos', async (req, res) => {
  const sucs = await sucursalesOp(DB);
  const s = +req.query.suc || sucs[0]?.id;
  const ini = lunes(ahora()) + (Math.round(+req.query.sem) || 0) * 7 * D;
  const sk = semanaKey(ini);
  const pk = semanaKey(ini - 7 * D);
  const L = await activos(DB, s);
  const T = await turnosDe(DB, L.map((x) => x.id));
  const { rows: libres } = await q(`SELECT id, nombre FROM usuarios WHERE estado = 'Activo' AND rol_id = 'cocinero' AND sucursal_id IS NULL ORDER BY nombre`);
  const { rows: sin } = await q(`SELECT u.id, u.nombre FROM usuarios u WHERE u.estado = 'Activo' AND NOT EXISTS (SELECT 1 FROM turnos t WHERE t.usuario_id = u.id) ORDER BY u.nombre`);
  res.json({
    suc: s, sucursales: sucs, semana: sk, ini, turnos: TURNOS, libres, sinTurno: sin,
    personas: L.filter((x) => ROLES_SUC.includes(x.rol_id)).sort((a, b) => a.nombre.localeCompare(b.nombre)).map((x) => ({
      id: x.id, nombre: x.nombre, rol: x.rol_id, rolNombre: ROLN[x.rol_id],
      celdas: T[x.id]?.[sk] || T[x.id]?.base || null, propia: !!T[x.id]?.[sk], prev: T[x.id]?.[pk] || T[x.id]?.base || null,
    })),
  });
});

r.put('/turnos', async (req, res) => {
  const u = req.usuario;
  const sem = String(req.body?.semana || '');
  const celdas = req.body?.celdas || {};
  si(!/^\d{4}-\d{2}-\d{2}$/.test(sem), 'Revisa la semana');
  si(semanaKey(lunes(Date.parse(`${sem}T12:00:00-06:00`))) !== sem, 'La semana debe empezar en lunes');
  await tx(async (c) => {
    const ids = Object.keys(celdas).map(Number);
    si(!ids.length, 'No hay cambios');
    const { rows } = await c.query(`SELECT id FROM usuarios WHERE id = ANY($1) AND estado = 'Activo'`, [ids]);
    si(rows.length !== ids.length, 'Hay una persona que ya no está activa');
    for (const id of ids) {
      const d = celdas[id];
      si(!Array.isArray(d) || d.length !== 7 || !d.every((x) => celdaValida(String(x))), 'Revisa los horarios: hay una celda que no es válida');
      await c.query(`INSERT INTO turnos (usuario_id, semana, dias) VALUES ($1,$2,$3) ON CONFLICT (usuario_id, semana) DO UPDATE SET dias = $3`, [id, sem, d.map(String)]);
    }
    await bitacora(c, u, { accion: 'turnos.guardar', elemento: `Semana ${sem}`, despues: { personas: ids.length } });
  });
  res.json({ ok: true });
});

r.post('/turnos/asignar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const x = await usuarioPorId(c, req.body?.usuario);
    si(x.rol_id !== 'cocinero' || x.sucursal_id || x.estado !== 'Activo', 'Esta persona ya tiene sucursal');
    const { rows } = await c.query(`SELECT id, nombre FROM sucursales WHERE id = $1 AND estado = 'Operando'`, [req.body?.suc]);
    si(!rows[0], 'Elige una sucursal que esté operando');
    await c.query('UPDATE usuarios SET sucursal_id = $2 WHERE id = $1', [x.id, rows[0].id]);
    await historial(c, x.id, 'Asignación', `Sucursal ${rows[0].nombre}`, u.nombre);
    await bitacora(c, u, { accion: 'turnos.asignar_cocinero', elemento: x.usuario, sucursal: rows[0].id });
  });
  res.json({ ok: true });
});

/* ---------- 6.4 Planilla ---------- */
async function planillaDe(c, quincena) {
  const { rows } = await c.query('SELECT * FROM planillas WHERE quincena = $1', [quincena]);
  if (!rows[0]) return null;
  const { rows: f } = await c.query('SELECT * FROM planilla_filas WHERE planilla_id = $1 ORDER BY nombre', [rows[0].id]);
  return { id: rows[0].id, q: quincena, label: qLabel(quincena), generada: rows[0].generada, boletas: rows[0].boletas, filas: f.map(filaJson) };
}

r.get('/planilla', async (req, res) => {
  const Q = quincenas();
  const sel = Q.some((x) => x.id === req.query.q) ? req.query.q : Q[0].id;
  const { rows: gen } = await q('SELECT quincena FROM planillas');
  res.json({ quincenas: Q, q: sel, actual: Q[0].id, generadas: gen.map((x) => x.quincena), planilla: await planillaDe(DB, sel), sucursales: await sucursalesOp(DB) });
});

r.get('/planillas', async (req, res) => {
  const { rows } = await q('SELECT quincena FROM planillas ORDER BY quincena DESC');
  const out = [];
  for (const x of rows) out.push(await planillaDe(DB, x.quincena));
  res.json(out);
});

r.post('/planilla', async (req, res) => {
  const u = req.usuario;
  const quin = String(req.body?.q || '');
  si(!quincenas().some((x) => x.id === quin), 'Elige una quincena reciente');
  await tx(async (c) => {
    const { rows } = await c.query('SELECT 1 FROM planillas WHERE quincena = $1', [quin]);
    si(rows[0], 'Esta quincena ya fue generada');
    await generarPlanilla(c, quin);
    await bitacora(c, u, { accion: 'planilla.generar', elemento: qLabel(quin) });
  });
  res.status(201).json({ ok: true });
});

r.post('/planilla/:q/boletas', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM planillas WHERE quincena = $1 FOR UPDATE', [req.params.q]);
    si(!rows[0], 'Primero genera la quincena');
    si(rows[0].boletas, 'Las boletas ya fueron generadas');
    await c.query('INSERT INTO boletas (planilla_id, usuario_id, fecha) SELECT planilla_id, usuario_id, $2 FROM planilla_filas WHERE planilla_id = $1', [rows[0].id, ts(ahora())]);
    await c.query('UPDATE planillas SET boletas = TRUE WHERE id = $1', [rows[0].id]);
    await bitacora(c, u, { accion: 'planilla.boletas', elemento: qLabel(req.params.q) });
  });
  res.json({ ok: true });
});

/* ---------- 6.5 Reportes de pago ---------- */
export async function cargarReportes(c, where = 'TRUE', params = []) {
  const { rows } = await c.query(
    `SELECT r.*, p.quincena, s.nombre AS suc_nombre, d.nombre AS decidio_nombre FROM reportes_pago r JOIN planillas p ON p.id = r.planilla_id
       LEFT JOIN sucursales s ON s.id = r.sucursal_id LEFT JOIN usuarios d ON d.id = r.decidio_id WHERE ${where} ORDER BY p.quincena DESC, r.sucursal_id NULLS LAST`, params);
  return rows.map((x) => ({
    id: x.id, planilla: x.planilla_id, q: x.quincena, label: qLabel(x.quincena), suc: x.sucursal_id, sucNombre: x.suc_nombre || 'Gerencia central',
    personas: x.personas, total: x.total, estado: x.estado, fecha: x.fecha, enviado: x.enviado, decidido: x.decidido, decidioNombre: x.decidio_nombre, motivo: x.motivo,
  }));
}
export async function filasReporte(c, rep) {
  const { rows } = await c.query(
    'SELECT * FROM planilla_filas WHERE planilla_id = $1 AND sucursal_id IS NOT DISTINCT FROM $2 ORDER BY nombre', [rep.planilla, rep.suc]);
  return rows.map(filaJson);
}

r.get('/reportes', async (req, res) => { res.json(await cargarReportes(DB)); });
r.get('/reportes/:id', async (req, res) => {
  const [x] = await cargarReportes(DB, 'r.id = $1', [req.params.id]);
  if (!x) throw noEncontrado('No se encontró el reporte');
  res.json({ ...x, filas: await filasReporte(DB, x) });
});
r.post('/reportes/:id/enviar', async (req, res) => {
  const u = req.usuario;
  await tx(async (c) => {
    const { rows } = await c.query(`UPDATE reportes_pago SET estado = 'Enviado', enviado = $2, motivo = NULL WHERE id = $1 AND estado IN ('Sin enviar','Rechazado') RETURNING *`,
      [req.params.id, ts(ahora())]);
    si(!rows[0], 'Este reporte ya fue enviado');
    const [x] = await cargarReportes(c, 'r.id = $1', [rows[0].id]);
    await notificar(c, 'gg', null, 'Reporte de pago por aprobar', `${x.sucNombre} · $${x.total.toFixed(2)}`);
    await bitacora(c, u, { accion: 'reporte.enviar', elemento: `${x.sucNombre} · ${x.label}` });
  });
  res.json({ ok: true });
});

/* ---------- facturas de proveedores: RR. HH. las archiva ---------- */
r.get('/facturas', async (req, res) => {
  const arch = req.query.vista === 'arch';
  const { rows } = await q(
    `SELECT f.id, f.num, f.proveedor_id, v.nombre AS prov_nombre, v.foto_url AS prov_foto, s.nombre AS suc_nombre, f.emitida, f.monto, f.estado,
            f.archivada, u.nombre AS arch_nombre, u.rol_id AS arch_rol
       FROM facturas f JOIN proveedores v ON v.id = f.proveedor_id JOIN sucursales s ON s.id = f.sucursal_id LEFT JOIN usuarios u ON u.id = f.archivada_por
      WHERE (f.archivada IS NOT NULL) = $1 AND ($2::int IS NULL OR f.proveedor_id = $2) ORDER BY f.emitida DESC`, [arch, +req.query.prov || null]);
  const { rows: provs } = await q(`SELECT id, nombre FROM proveedores WHERE estado <> 'Eliminado' ORDER BY nombre`);
  res.json({
    proveedores: provs,
    facturas: rows.map((f) => ({
      id: f.id, num: f.num, prov: f.proveedor_id, provNombre: f.prov_nombre, provFoto: f.prov_foto, sucNombre: f.suc_nombre, emitida: f.emitida,
      monto: f.monto, estado: f.estado, archivo: f.archivada ? { fecha: f.archivada, por: f.arch_nombre ? `${f.arch_nombre} · ${ROLN[f.arch_rol]}` : '—' } : null,
    })),
  });
});

r.post('/facturas/archivar', async (req, res) => {
  const u = req.usuario;
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  si(!ids.length, 'Elige al menos una factura');
  const n = await tx(async (c) => {
    const { rows } = await c.query('UPDATE facturas SET archivada = $2, archivada_por = $3 WHERE id = ANY($1) AND archivada IS NULL RETURNING num', [ids, ts(ahora()), u.id]);
    si(!rows.length, 'Estas facturas ya estaban archivadas');
    await bitacora(c, u, { accion: 'factura.archivar', elemento: rows.length === 1 ? rows[0].num : `${rows.length} facturas` });
    return rows.length;
  });
  res.json({ ok: true, n });
});

export default r;
