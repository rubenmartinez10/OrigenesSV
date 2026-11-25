/* Cargadores que arman los objetos que consume el frontend. */

/** Pedidos con sus líneas, extras y lo reservado. `where` usa el alias p. */
export async function cargarPedidos(c, where, params = [], orden = 'p.creado') {
  const { rows } = await c.query(
    `SELECT p.*, me.nombre AS mesero_nombre, co.nombre AS cocinero_nombre, rp.num AS rep_num
       FROM pedidos p
       JOIN usuarios me ON me.id = p.mesero_id
       LEFT JOIN usuarios co ON co.id = p.cocinero_id
       LEFT JOIN pedidos rp ON rp.id = p.reposicion_de
      WHERE ${where} ORDER BY ${orden}`, params);
  if (!rows.length) return [];
  const ids = rows.map((p) => p.id);
  const { rows: lineas } = await c.query(
    'SELECT id, pedido_id, orden, producto_id, nombre, cantidad, precio_unit FROM pedido_lineas WHERE pedido_id = ANY($1) ORDER BY pedido_id, orden', [ids]);
  const { rows: extras } = await c.query(
    'SELECT linea_id, extra_id, nombre, precio FROM pedido_linea_extras WHERE linea_id = ANY($1)', [lineas.map((l) => l.id)]);
  const { rows: res } = await c.query('SELECT pedido_id, mp_id, cantidad FROM pedido_reservas WHERE pedido_id = ANY($1)', [ids]);
  const exPorLinea = {};
  for (const e of extras) (exPorLinea[e.linea_id] ||= []).push({ pr: e.extra_id, nombre: e.nombre, unit: e.precio });
  const lnPorPedido = {};
  for (const l of lineas) {
    (lnPorPedido[l.pedido_id] ||= []).push({ orden: l.orden, pr: l.producto_id, nombre: l.nombre, cant: l.cantidad, unit: l.precio_unit, extras: exPorLinea[l.id] || [] });
  }
  const resPorPedido = {};
  for (const r of res) (resPorPedido[r.pedido_id] ||= {})[r.mp_id] = r.cantidad;
  return rows.map((p) => pedidoJson(p, lnPorPedido[p.id] || [], resPorPedido[p.id] || {}));
}

export const pedidoJson = (p, lineas, res) => ({
  id: p.id, num: p.num, suc: p.sucursal_id, mesero: p.mesero_id, meseroNombre: p.mesero_nombre,
  cocinero: p.cocinero_id, cocineroNombre: p.cocinero_nombre, tipo: p.tipo, mesa: p.mesa, ref: p.cliente,
  estado: p.estado, total: p.total, estSeg: p.est_seg, rep: p.reposicion_de, repNum: p.rep_num, consumido: p.consumido,
  creado: p.creado, aceptado: p.aceptado, asignado: p.asignado, ini: p.iniciado, fin: p.terminado, entregado: p.entregado,
  canc: p.cancelado, motivo: p.motivo_cancel, porDemora: p.por_demora,
  rechazo: p.rechazo_motivo ? { motivo: p.rechazo_motivo, fecha: p.rechazo_fecha, por: p.rechazo_por } : null,
  vistoMes: p.visto_mesero, vistoCoc: p.visto_cocinero, salidaPedida: p.salida_pedida, mesaLibre: p.mesa_liberada,
  lineas, res,
});

export async function cargarPedido(c, id) {
  return (await cargarPedidos(c, 'p.id = $1', [id]))[0] || null;
}

/** Solicitudes con nombres de quién pide y datos del pedido. */
export async function cargarSolicitudes(c, where, params = [], orden = 's.fecha DESC') {
  const { rows } = await c.query(
    `SELECT s.*, so.nombre AS solicitante_nombre, us.nombre AS usuario_nombre, us.usuario AS usuario_login,
            pe.num AS pedido_num, jd.nombre AS jefe_nombre
       FROM solicitudes s
       LEFT JOIN usuarios so ON so.id = s.solicitante_id
       LEFT JOIN usuarios us ON us.id = s.usuario_id
       LEFT JOIN pedidos pe ON pe.id = s.pedido_id
       LEFT JOIN usuarios jd ON jd.id = (s.jefe_decision->>'por')::int
      WHERE ${where} ORDER BY ${orden}`, params);
  return rows.map(solicitudJson);
}

export const solicitudJson = (s) => ({
  id: s.id, tipo: s.tipo, estado: s.estado, suc: s.sucursal_id, solicitante: s.solicitante_id, solicitanteNombre: s.solicitante_nombre,
  usuario: s.usuario_id, usuarioNombre: s.usuario_nombre, usuarioLogin: s.usuario_login, pedido: s.pedido_id, num: s.pedido_num,
  linea: s.linea_orden, venta: s.venta_id, producto: s.producto_id, mp: s.mp_id, rol: s.rol_id, aprueba: s.aprueba_rol,
  nombre: s.nombre, motivo: s.motivo, monto: s.monto, datos: s.datos, deJefe: s.de_jefe, rechazo: s.rechazo,
  jefeDec: s.jefe_decision ? { ...s.jefe_decision, porNombre: s.jefe_nombre } : null, fecha: s.fecha, cierre: s.cierre,
});

/** Ventas con su pedido (líneas), ajustes y datos del documento. */
export async function cargarVentas(c, where, params = []) {
  const { rows } = await c.query(
    `SELECT v.*, p.num, p.tipo AS ped_tipo, p.mesa, p.cliente, p.reposicion_de, s.nombre AS sucursal_nombre,
            co.nombre AS cocinero_nombre, me.nombre AS mesero_nombre,
            COALESCE((SELECT sum(a.monto) FROM venta_ajustes a WHERE a.venta_id = v.id), 0) AS devuelto
       FROM ventas v JOIN pedidos p ON p.id = v.pedido_id JOIN sucursales s ON s.id = v.sucursal_id
       JOIN usuarios me ON me.id = v.mesero_id LEFT JOIN usuarios co ON co.id = p.cocinero_id
      WHERE ${where} ORDER BY v.fecha DESC`, params);
  if (!rows.length) return [];
  const pedidos = await cargarPedidos(c, 'p.id = ANY($1)', [rows.map((v) => v.pedido_id)]);
  const porId = Object.fromEntries(pedidos.map((p) => [p.id, p]));
  return rows.map((v) => ({
    id: v.id, suc: v.sucursal_id, sucNombre: v.sucursal_nombre, pedido: v.pedido_id, num: v.num, mesero: v.mesero_id,
    meseroNombre: v.mesero_nombre, cocineroNombre: v.cocinero_nombre, caja: v.caja_id, fecha: v.fecha, metodo: v.metodo,
    ref: v.referencia, pago: v.pago, propina: v.propina, tipo: v.tipo_doc, corr: v.correlativo,
    fis: v.fis_nombre ? { nombre: v.fis_nombre, nit: v.fis_nit, nrc: v.fis_nrc } : null,
    total: v.total, sub: v.subtotal, iva: v.iva, devuelto: v.devuelto,
    lineas: porId[v.pedido_id]?.lineas || [], ped: porId[v.pedido_id] || null,
  }));
}
