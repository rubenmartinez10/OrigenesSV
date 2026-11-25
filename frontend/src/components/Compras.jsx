import { $, fFecha, fmt } from '../lib/formato.js';
import { Ban, Chip, Err, Etapas, Kv, Tabla } from './ui.jsx';

/* Piezas para mostrar compras a proveedores (bodega, gerente y gerente general). */
const TONO = {
  Preparada: 'g', 'Aceptada por gerente': 'in', 'En camino': 'wa', Recibida: 'in', Aceptada: 'ok', Devuelta: 'er', Rechazada: 'er', Cancelada: 'g',
  'Cancelación en revisión': 'wa', 'Devolución en revisión': 'wa', 'Descuento en revisión': 'wa',
};
export const ChipCompra = ({ e }) => <Chip t={e} o={TONO[e] || 'g'} />;
export const ETAPAS_COMPRA = ['Preparada', 'Aceptada por gerente', 'Aceptada por gerente general', 'En camino'];
export const etapaCompra = (c) => (c.estado === 'Preparada' ? 0 : c.estado === 'Aceptada por gerente' ? 1 : ['En camino', 'Cancelación en revisión'].includes(c.estado) ? 3
  : ['Recibida', 'Aceptada', 'Devuelta', 'Devolución en revisión', 'Descuento en revisión'].includes(c.estado) ? 4 : 0);
export const fH = (h) => (h < 48 ? `${h} h` : `${h / 24} días`);
export const lineasTxt = (c) => c.lineas.map((l) => `${l.nombre} ×${l.cant} ${l.unidad}`).join(', ');

/** Texto de la política de atrasos del proveedor. */
export function politicaTxt(p) {
  if (p.tipo === 'Descuento') return `Descuento de ${p.escala} % por cada día de atraso, después de ${p.tolH} h de tolerancia, hasta ${p.tope} %. Baja el precio de la factura y se conserva el anterior.`;
  if (p.tipo === 'Indemnización') return `Indemnización de $${p.escala} por cada día de atraso, después de ${p.tolH} h de tolerancia, hasta $${p.tope}. Queda como crédito en Cuentas por pagar.`;
  return `Reembolso de ${p.escala} % del subtotal por cada día de atraso, después de ${p.tolH} h de tolerancia, hasta ${p.tope} %. Queda como crédito en Cuentas por pagar.`;
}
export function atrasoTxt(c) {
  const k = c.atraso;
  if (!k) return '';
  const l = c.lineas[0];
  return k.tipo === 'Descuento' ? `Descuento por retraso: −${k.pct} %. Precio nuevo ${$(l.precio)} (antes ${$(l.precioAnt)})` : `Crédito a favor ${$(k.monto)} · se registra en Cuentas por pagar`;
}

/** Etapas, datos, líneas y totales de una compra. */
export function CompraResumen({ c, conSucursal }) {
  const d = c.detalle || {};
  return (
    <>
      <Etapas l={ETAPAS_COMPRA} a={etapaCompra(c)} rech={c.estado === 'Rechazada' ? d.rechazo?.etapa || 1 : undefined} />
      {d.rechazo && <Err>Rechazada por {d.rechazo.por}: {d.rechazo.motivo}</Err>}
      {d.cancelacion && c.estado === 'Cancelación en revisión' && <Ban>Cancelación en revisión del gerente general. Motivo: {d.cancelacion.motivo}</Ban>}
      {d.devolucion && c.estado === 'Devolución en revisión' && <Ban>Devolución en revisión del gerente general. Motivo: {d.devolucion.motivo}</Ban>}
      {d.solDescuento && c.estado === 'Descuento en revisión' && <Ban>{d.solDescuento.tipo} de {$(d.solDescuento.monto)} en revisión del gerente general. Motivo: {d.solDescuento.motivo}</Ban>}
      {d.cancelada && <Err>Cancelada{d.cancelada.motivo ? `: ${d.cancelada.motivo}` : ''}</Err>}
      <Kv pares={[
        ['Proveedor', c.provNombre], ...(conSucursal ? [['Sucursal', c.sucNombre]] : []), ['Pago', c.pago], ['Entrega prometida', fH(c.entregaH)],
        ['Cotización vigente hasta', fmt(c.cot.vence)], ['Factura', c.facturaNum || '—'],
        ...(c.pendienteDe ? [['Pendiente de la compra', `#${c.pendienteDe} (−${c.descPend} %)`]] : []),
      ]} />
      <Tabla cols={['Materia prima', 'Cantidad', 'Precio', 'Subtotal']} filas={c.lineas.map((l) => [
        l.nombre, `${l.cant} ${l.unidad}`, <>{$(l.precio)}{l.precioAnt ? <small className="tw:text-tx2"> (antes {$(l.precioAnt)})</small> : ''}</>, $(l.cant * l.precio),
      ])} />
      <Kv pares={[['Transporte (una sola vez)', $(c.transporte || 0)], ['Total', $(c.total)]]} />
    </>
  );
}

/** Lotes que registró bodega al recibir. */
export const LotesRecibidos = ({ c }) => (
  <Tabla cols={['SKU', 'Materia prima', 'Cantidad', 'Vence']} filas={c.recepcion.lotes.map((x) => [x.sku, x.nombre, x.cant, fFecha(x.vence)])} />
);

/** ¿Lo recibido no coincide con lo pedido? */
export const recepcionDistinta = (c) => !!c.recepcion && c.lineas.some((l) => Math.abs(c.recepcion.lotes.filter((x) => x.mp === l.mp).reduce((a, x) => a + x.cant, 0) - l.cant) > 1e-9);
export const recepcionParcial = (c) => !!c.recepcion && c.lineas.some((l) => c.recepcion.lotes.filter((x) => x.mp === l.mp).reduce((a, x) => a + x.cant, 0) < l.cant - 1e-9);
