import { useSesion, useAhora } from '../context/Sesion.jsx';
import { $, fm, fmt } from '../lib/formato.js';
import { nom, donde, txt, est, lim, margen, minutos, seg, uso, corr } from '../lib/pedidos.js';
import { Barra, Card } from './ui.jsx';

/** Barra de tiempo: transcurrido, estimado y margen. */
export function TiempoPedido({ p }) {
  const { config } = useSesion();
  const ahora = useAhora();
  const t = seg(p, ahora);
  const e = est(p);
  const m = margen(config);
  const L = e + m;
  const tono = t === 0 ? 'g' : t <= e ? 'ok' : t <= L ? 'wa' : 'er';
  const extra = t > L ? ` · Retrasado ${fm(t - L)}` : t > e ? ` · En margen, quedan ${fm(L - t)}` : t > 0 ? ` · Faltan ${fm(e - t)}` : '';
  return <Barra pct={(t / L) * 100} tono={tono} texto={`${t === 0 ? 'Sin iniciar' : `Transcurrido ${fm(t)}`} · Estimado ${minutos(e)} min + ${minutos(m)} min de margen${extra}`} />;
}

/** Tiempo de espera: una sola línea desde que se hizo el pedido (ADENDA v6). */
export function Espera({ p }) {
  const { config } = useSesion();
  if (!['Creado', 'Aceptado', 'Asignado', 'Preparando', 'Listo'].includes(p.estado)) return null;
  return (
    <div className="tw:flex tw:flex-col tw:gap-1.5">
      <b className="tw:text-[13.5px]">Tiempo de espera: ~{minutos(est(p))} min · cuenta desde que se hizo el pedido</b>
      <div className="tw:text-tx2 tw:text-[13px]">Entrega estimada {fmt(p.creado + est(p) * 1000)} · máximo {fmt(p.creado + lim(p, config) * 1000)}</div>
      <TiempoPedido p={p} />
    </div>
  );
}

/** Ticket del pedido (con receta usada por línea si «receta» y se pasa el catálogo). */
export function TicketPedido({ p, catalogo, receta }) {
  const prods = catalogo ? Object.fromEntries(catalogo.productos.map((x) => [x.id, x])) : {};
  const mats = catalogo ? Object.fromEntries(catalogo.materias.map((m) => [m.id, m])) : {};
  return (
    <Card className="tw:flex tw:flex-col tw:gap-1">
      <b>{nom(p)} · {donde(p)}</b>
      {p.rep && <div className="tw:text-tx2">Repone el pedido #{p.repNum} · sin cobro adicional</div>}
      <div className="tw:text-tx2">{fmt(p.creado)}</div>
      {p.lineas.map((l) => (
        <div key={l.orden}>
          {txt(l)}
          {receta && catalogo && (
            <small className="tw:text-tx2"> — {Object.entries(uso([{ pr: l.pr, cant: l.cant, extras: l.extras.map((e) => e.pr) }], prods))
              .map(([m, c]) => `${mats[m]?.nombre} ${c.toFixed(2)} ${mats[m]?.unidad}`).join(', ')}</small>
          )}
        </div>
      ))}
    </Card>
  );
}

/** Documento emitido (ticket, factura o CCF) con sucursal y cocinero. */
export function Documento({ v, iva = 13 }) {
  return (
    <Card className="tw:flex tw:flex-col tw:gap-1">
      <img src="/assets/logo-azul.png" alt="Orígenes SV" className="tw:h-11 tw:w-auto tw:mx-auto tw:mb-1.5" />
      <b>{v.tipo} {corr(v)}</b>
      <div className="tw:text-tx2">{fmt(v.fecha)}</div>
      <div className="tw:text-tx2">Sucursal: {v.sucNombre} · Cocinero: {v.cocineroNombre || '—'}</div>
      {v.fis && <div>{v.fis.nombre} · NIT {v.fis.nit} · NRC {v.fis.nrc}</div>}
      {v.lineas.map((l) => <div key={l.orden}>{txt(l)} — {$(l.unit * l.cant)}</div>)}
      <div>Subtotal sin IVA {$(v.sub)}</div>
      <div>IVA {iva} % {$(v.iva)}</div>
      <b>Total {$(v.total)}</b>
      {v.propina > 0 && <div>Propina {$(v.propina)} · Total pagado {$(v.total + v.propina)}</div>}
      <div className="tw:text-tx2">{v.metodo}{v.ref ? ` · ${v.ref}` : ''}</div>
      {v.pago?.recibido != null && <div className="tw:text-tx2">Recibido {$(v.pago.recibido)} · Cambio {$(v.pago.cambio)}</div>}
    </Card>
  );
}
