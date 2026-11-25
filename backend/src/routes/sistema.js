import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { q, tx, pool } from '../db.js';
import { config } from '../config.js';
import { fallo, prohibido } from '../lib/errores.js';
import { ahora, adelantar, cargarReloj, fmt } from '../lib/reloj.js';
import { correrProcesos } from '../lib/procesos.js';
import { cfg, olvidarCfg, mesasOcupadas, revisarCajasPasadas } from '../lib/negocio.js';
import { autenticar } from '../middleware/auth.js';
import { migrar } from '../migraciones.js';
import { conMantenimiento } from '../lib/mantenimiento.js';
import { inventario } from './bodega.js';
import { pendientesGG } from './gg.js';

const r = Router();

/* ---------- reloj simulado ---------- */
r.get('/reloj', (req, res) => res.json({ ahora: ahora(), texto: fmt(ahora()) }));

const PASOS = { hora: 36e5, dia: 864e5, semana: 6048e5, mes: 2592e6 };

/** Adelanta el reloj (+1 hora, +1 día, +7 días, +30 días) y corre los procesos del negocio. */
r.post('/reloj/adelantar', async (req, res) => {
  if (!config.demo) throw prohibido('El reloj solo se puede adelantar en modo demo');
  const ms = PASOS[req.body?.paso];
  if (!ms) throw fallo('Paso de tiempo inválido');
  await adelantar(ms);
  await correrProcesos();
  res.json({ ahora: ahora(), texto: fmt(ahora()) });
});

/** «Restablecer datos»: vuelve a crear la BD con los datos iniciales (solo en modo demo). */
r.post('/sistema/restablecer', async (req, res) => {
  if (!config.demo) throw prohibido('Solo disponible en modo demo');
  const archivos = (await fs.readdir(config.sqlDir)).filter((f) => f.endsWith('.sql')).sort();
  if (!archivos.length) throw fallo('No se encontraron los archivos SQL de la base de datos');
  await conMantenimiento(async () => {
    const c = await pool.connect();
    try {
      await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      for (const f of archivos) await c.query(await fs.readFile(path.join(config.sqlDir, f), 'utf8'));
    } finally {
      c.release();
    }
    olvidarCfg();
    await migrar();
    await cargarReloj();
    await correrProcesos();
  });
  res.clearCookie('osv_sesion', { path: '/' });
  res.json({ ok: true });
});

/* ---------- pendientes (campana y contadores del menú) ---------- */
const contar = async (sql, params) => (await q(sql, params)).rows[0].n;

async function contadores(u) {
  const s = u.sucursal;
  const menu = {};
  const tabs = {};
  if (u.rol === 'mesero') {
    menu.pedidos = await contar(`SELECT count(*)::int n FROM pedidos WHERE mesero_id = $1 AND estado = 'Listo'`, [u.id]);
    menu.cobro = await contar(`SELECT count(*)::int n FROM pedidos WHERE mesero_id = $1 AND estado = 'Entregado' AND reposicion_de IS NULL AND (tipo <> 'Aquí' OR cuenta_pedida IS NOT NULL)`, [u.id]);
    const k = await cfg({ query: q });
    const oc = Object.values(await mesasOcupadas({ query: q }, s));
    menu.mesas = oc.filter((p) => p.mesero_id === u.id && p.entregado && ahora() - p.entregado >= k.minutos_mesa * 60e3).length;
    tabs['historial/solicitudes'] = await contar(
      `SELECT count(*)::int n FROM solicitudes WHERE solicitante_id = $1 AND tipo IN ('Cancelación','Reposición','Devolución') AND estado = 'Solicitada'`, [u.id]);
  } else if (u.rol === 'cocinero') {
    const prep = await contar(`SELECT count(*)::int n FROM pedidos WHERE cocinero_id = $1 AND estado = 'Preparando'`, [u.id]);
    const asig = await contar(`SELECT count(*)::int n FROM pedidos WHERE cocinero_id = $1 AND estado = 'Asignado'`, [u.id]);
    tabs['mipedido/actual'] = prep || (asig ? 1 : 0); // sin nada en preparación, el primero de la cola se muestra en «Mi pedido»
    tabs['mipedido/cola'] = asig;
  } else if (u.rol === 'jefe') {
    const { rows } = await q(`SELECT estado, count(*)::int n FROM pedidos WHERE sucursal_id = $1 AND estado IN ('Creado','Aceptado','Preparando','Asignado') GROUP BY estado`, [s]);
    const n = Object.fromEntries(rows.map((x) => [x.estado, x.n]));
    tabs['cola/nuevos'] = n.Creado || 0;
    tabs['cola/aceptados'] = n.Aceptado || 0;
    tabs['cola/prep'] = n.Preparando || 0;
    tabs['cola/encola'] = n.Asignado || 0;
    const { rows: sol } = await q(
      `SELECT tipo, count(*)::int n FROM solicitudes WHERE sucursal_id = $1 AND estado = 'Solicitada' AND tipo IN ('Reposición','Cancelación','Devolución') GROUP BY tipo`, [s]);
    const t = Object.fromEntries(sol.map((x) => [x.tipo, x.n]));
    tabs['reposiciones/reposiciones'] = t['Reposición'] || 0;
    tabs['reposiciones/cancelaciones'] = t['Cancelación'] || 0;
    tabs['reposiciones/devoluciones'] = t['Devolución'] || 0;
    tabs['recetas/propuestas'] = await contar(
      `SELECT count(*)::int n FROM solicitudes WHERE sucursal_id = $1 AND estado = 'Propuesto' AND tipo IN ('Producto nuevo','Extra nuevo','Categoría nueva')`, [s]);
  } else if (u.rol === 'bodega') {
    const k = await cfg({ query: q });
    const inv = await inventario({ query: q }, s);
    tabs['alertas/stock'] = inv.filter((m) => !m.inhabilitada && m.minimo > 0 && m.stock < m.minimo).length;
    tabs['alertas/vencer'] = await contar(
      `SELECT count(*)::int n FROM lotes WHERE sucursal_id = $1 AND cantidad > 0 AND vence > $2 AND vence - $2 <= $3 * interval '1 day'`, [s, new Date(ahora()), k.por_vencer_dias]);
    tabs['recepcion/camino'] = await contar(`SELECT count(*)::int n FROM compras WHERE sucursal_id = $1 AND estado = 'En camino'`, [s]);
    menu.alertas = tabs['alertas/stock'] + tabs['alertas/vencer'];
    menu.recepcion = tabs['recepcion/camino'];
  } else if (u.rol === 'gerente') {
    const n = (sql) => contar(sql, [s]);
    tabs['aprobaciones/productos'] = await n(`SELECT count(*)::int n FROM solicitudes WHERE sucursal_id = $1 AND estado = 'Aprobado por jefe de cocina' AND tipo IN ('Producto nuevo','Extra nuevo','Categoría nueva')`);
    tabs['aprobaciones/compras'] = await n(`SELECT count(*)::int n FROM compras WHERE sucursal_id = $1 AND estado = 'Preparada'`);
    tabs['aprobaciones/recepcion'] = await n(`SELECT count(*)::int n FROM compras WHERE sucursal_id = $1 AND estado = 'Recibida'`);
    tabs['aprobaciones/ofertas'] = await n(`SELECT count(*)::int n FROM ofertas WHERE sucursal_id = $1 AND estado = 'Pendiente'`);
    tabs['aprobaciones/caja'] = await n(`SELECT count(*)::int n FROM cajas WHERE sucursal_id = $1 AND estado = 'Pendiente de aprobación'`)
      + await n(`SELECT count(*)::int n FROM solicitudes WHERE sucursal_id = $1 AND tipo = 'Apertura de caja' AND estado = 'Solicitada'`);
    tabs['aprobaciones/conteos'] = await n(`SELECT count(*)::int n FROM conteos WHERE sucursal_id = $1 AND estado = 'Enviado'`);
    tabs['aprobaciones/solicitudes'] = await n(`SELECT count(*)::int n FROM solicitudes WHERE sucursal_id = $1 AND estado = 'Solicitada'
      AND tipo IN ('Inhabilitar materia prima','Unidad nueva','Categoría de materia prima')`);
    menu.aprobaciones = Object.entries(tabs).filter(([k]) => k.startsWith('aprobaciones/')).reduce((a, [, v]) => a + v, 0);
  } else if (['rrhh', 'gg', 'director'].includes(u.rol)) {
    const resets = await contar(`SELECT count(*)::int n FROM solicitudes WHERE tipo = 'Restablecer contraseña' AND estado = 'Solicitada' AND aprueba_rol = $1 AND usuario_id <> $2`, [u.rol, u.id]);
    if (u.rol === 'rrhh') {
      tabs['personal/vacantes'] = await contar(`SELECT count(*)::int n FROM vacantes WHERE estado = 'Abierta'`);
      tabs['personal/contrasenas'] = resets;
      tabs['personal/despidos'] = await contar(`SELECT count(*)::int n FROM solicitudes WHERE tipo = 'Renuncia' AND estado = 'Solicitada' AND datos->>'salio' IS NULL AND datos->'retiro'->>'estado' = 'Solicitado' AND aprueba_rol = 'rrhh'`)
        + await contar(`SELECT count(*)::int n FROM solicitudes WHERE tipo = 'Despido' AND estado = 'Solicitada' AND aprueba_rol = 'rrhh'`);
      tabs['roles/catalogos'] = await contar(`SELECT count(*)::int n FROM solicitudes WHERE tipo IN ('Unidad nueva','Categoría de materia prima') AND estado = 'Aprobada por gerente'`);
      tabs['pagos/reportes'] = await contar(`SELECT count(*)::int n FROM reportes_pago WHERE estado = 'Rechazado'`);
      tabs['proveedores/porarchivar'] = await contar('SELECT count(*)::int n FROM facturas WHERE archivada IS NULL');
    } else if (u.rol === 'gg') {
      const p = await pendientesGG({ query: q });
      tabs['aprobaciones/compras'] = p.Compras;
      tabs['aprobaciones/proveedores'] = p.Proveedores;
      tabs['aprobaciones/precios'] = p.Precios;
      tabs['aprobaciones/menus'] = p['Menús'];
      tabs['aprobaciones/contrasenas'] = resets;
      tabs['productos/propuestas'] = p.Productos;
      tabs['dinero/nomina'] = p['Nómina'];
      tabs['sucursales/sucursales'] = await contar(`SELECT count(*)::int n FROM propuestas_sucursal WHERE estado = 'Compra aprobada'`);
      tabs['sucursales/despidos'] = p.Despidos;
      tabs['sucursales/plantilla'] = p.Personal;
    } else {
      const n = (tipo) => contar(`SELECT count(*)::int n FROM propuestas_sucursal WHERE estado = 'Solicitada' AND tipo = $1`, [tipo]);
      tabs['aprobaciones/productos'] = await contar(`SELECT count(*)::int n FROM solicitudes WHERE estado = 'Aprobado por gerente general' AND tipo IN ('Producto nuevo','Extra nuevo','Categoría nueva')`);
      tabs['aprobaciones/compra'] = await n('Compra');
      tabs['aprobaciones/venta'] = await n('Venta');
      tabs['aprobaciones/contrasenas'] = resets;
    }
    for (const [k, v] of Object.entries(tabs)) {
      const m = k.split('/')[0];
      if (k !== 'personal/vacantes') menu[m] = (menu[m] || 0) + v;
    }
  }
  return { menu, tabs };
}

/** Alertas rojas vigentes: cajas abiertas tarde o pasadas del turno (gerente) y la propia caja pasada del turno (mesero). */
async function alertasRojas(u) {
  if (!['gerente', 'mesero'].includes(u.rol)) return [];
  const { rows } = await q(
    `SELECT k.id, k.tarde_min, k.turno_fin, k.fuera_turno, u.nombre FROM cajas k JOIN usuarios u ON u.id = k.mesero_id
      WHERE k.estado = 'Abierta' AND k.sucursal_id = $1 ${u.rol === 'mesero' ? 'AND k.mesero_id = $2' : ''}`, u.rol === 'mesero' ? [u.sucursal, u.id] : [u.sucursal]);
  const out = [];
  for (const k of rows) {
    const pas = k.turno_fin && ahora() > k.turno_fin ? Math.round((ahora() - k.turno_fin) / 60e3) : 0;
    if (u.rol === 'mesero') {
      if (pas) out.push({ id: `p${k.id}`, titulo: 'Tu turno ya terminó', detalle: `Llevas ${pas} min de más con la caja abierta: ciérrala` });
    } else {
      if (pas) out.push({ id: `p${k.id}`, titulo: 'Caja abierta fuera de turno', detalle: `${k.nombre} sigue con la caja abierta ${pas} min después de su turno` });
      if (k.tarde_min) out.push({ id: `t${k.id}`, titulo: 'Caja abierta tarde', detalle: `${k.nombre} abrió ${k.tarde_min} min después del inicio de su turno` });
    }
  }
  return out;
}

r.get('/pendientes', autenticar, async (req, res) => {
  const u = req.usuario;
  if (u.sucursal && ['gerente', 'mesero'].includes(u.rol)) await tx((c) => revisarCajasPasadas(c, u.sucursal));
  const { menu, tabs } = u.cambiar_pass || u.cambiar_pin || u.reubicacion_desde ? { menu: {}, tabs: {} } : await contadores(u);
  const { rows } = await q(
    `SELECT id, titulo, detalle, rojo FROM notificaciones WHERE rol_id = $1 AND (sucursal_id IS NULL OR sucursal_id = $2) ORDER BY id DESC LIMIT 1`,
    [u.rol, u.sucursal]);
  res.json({ menu, tabs, ultima: rows[0] || null, rojas: u.cambiar_pass || u.cambiar_pin || u.reubicacion_desde ? [] : await alertasRojas(u), ahora: ahora() });
});

export default r;
