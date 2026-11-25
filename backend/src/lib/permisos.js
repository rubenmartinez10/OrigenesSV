import { prohibido } from './errores.js';

/*
 * Tabla de permisos (la misma del borrador): quién pide y quién decide cada acción.
 * alcance 's' = solo en su sucursal · 'f' = toda la franquicia.
 */
export const PERMISOS = {
  pedido:            { pide: ['mesero'], alc: 's' },
  cancelarDemora:    { pide: ['mesero'], decide: ['mesero'], alc: 's' },
  reposicion:        { pide: ['mesero'], decide: ['jefe'], alc: 's' },
  cancelarIniciado:  { pide: ['mesero'], decide: ['jefe'], alc: 's' },
  devolucionDinero:  { pide: ['mesero'], decide: ['jefe'], alc: 's' },
  cierreCaja:        { pide: ['mesero'], decide: ['gerente'], alc: 's' },
  cocina:            { pide: ['jefe'], decide: ['jefe'], alc: 's' },
  preparar:          { pide: ['cocinero'], decide: ['cocinero'], alc: 's' },
  productoNuevo:     { pide: ['cocinero', 'jefe'], decide: ['jefe', 'gerente', 'gg', 'director'], alc: 'f' },
  extra:             { pide: ['cocinero'], decide: ['jefe'], alc: 'f' },
  categoria:         { pide: ['cocinero'], decide: ['jefe'], alc: 'f' },
  oferta:            { decide: ['gerente'], alc: 's' },
  inhabMP:           { pide: ['bodega'], decide: ['gerente'], alc: 's' },
  inhabProducto:     { pide: ['gerente'], decide: ['gerente'], alc: 's' },
  merma:             { pide: ['gerente'], decide: ['gerente'], alc: 's' },
  compra:            { pide: ['bodega', 'gerente'], decide: ['gerente', 'gg'], alc: 's' },
  despido:           { pide: ['rrhh'], decide: ['gerente', 'gg'], alc: 's' },
  plantilla:         { pide: ['gerente'], decide: ['gg'], alc: 's' },
  precio:            { pide: ['gerente'], decide: ['gg'], alc: 'f' },
  proveedor:         { pide: ['rrhh', 'gg', 'director'], decide: ['rrhh', 'gg', 'director'], alc: 'f' },
  salario:           { pide: ['rrhh'], decide: ['gg'], alc: 'f' },
  sucursal:          { pide: ['gg'], decide: ['director'], alc: 'f' },
  directores:        { pide: ['director'], decide: ['director'], alc: 'f' },
  resetRRHH:         { decide: ['rrhh'], alc: 'f' },
  resetGG:           { decide: ['gg'], alc: 'f' },
  resetDir:          { decide: ['director'], alc: 'f' },
};

export function puede(usuario, accion, modo, sucursal) {
  const a = PERMISOS[accion];
  if (!usuario || !a || !(a[modo] || []).includes(usuario.rol)) return false;
  return a.alc === 'f' || !usuario.sucursal || !sucursal || usuario.sucursal === sucursal;
}

/** Lanza 403 si no puede; el rechazo queda en la bitácora desde la ruta que llama. */
export function exigir(usuario, accion, modo, sucursal) {
  if (!puede(usuario, accion, modo, sucursal)) throw prohibido();
}
