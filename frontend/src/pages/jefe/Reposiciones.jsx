import { api } from '../../lib/api.js';
import { $, fmt } from '../../lib/formato.js';
import { nom, donde, corr } from '../../lib/pedidos.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Card, Cargando, Chip, Fila, Mut, Stack, Vacio } from '../../components/ui.jsx';
import { TiempoPedido } from '../../components/Pedido.jsx';

/** Reposiciones, cancelaciones y devoluciones de dinero: las decide el jefe de cocina (ADENDA v6). */
export default function Reposiciones({ tab = 'reposiciones' }) {
  const { confirmar, motivo, accion } = useDialogos();
  const { datos } = useDatos(tab === 'perdidas' ? null : '/jefe/solicitudes', { cada: 6000 });
  const { datos: perdidas } = useDatos(tab === 'perdidas' ? '/jefe/perdidas' : null);

  if (tab === 'perdidas') {
    if (!perdidas) return <Cargando />;
    return (
      <Stack>
        <Mut>Solo lectura</Mut>
        <h3 className="tw:text-[15px] tw:m-0">Registros: {perdidas.length}</h3>
        {perdidas.length ? perdidas.map((m) => (
          <Fila key={m.id} ico="box" tono="er" t={`${fmt(m.fecha)} · ${m.tipo}${m.pedido ? ` · #${m.pedido}` : ''}`} s={m.motivo} der={$(m.costo)} />
        )) : <Vacio>No hay pérdidas registradas</Vacio>}
      </Stack>
    );
  }
  if (!datos) return <Cargando />;
  const ped = Object.fromEntries(datos.pedidos.map((p) => [p.id, p]));
  const ventas = Object.fromEntries(datos.ventas.map((v) => [v.id, v]));
  const tipo = { reposiciones: 'Reposición', cancelaciones: 'Cancelación', devoluciones: 'Devolución' }[tab];
  const L = datos.solicitudes.filter((x) => x.tipo === tipo);

  const rechazar = async (x) => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m) accion(() => api.post(`/jefe/solicitudes/${x.id}/rechazar`, { motivo: m }), 'Solicitud rechazada');
  };
  const aceptarRepo = async (x) => {
    if (await confirmar({ titulo: '¿Aceptar la reposición?', texto: 'Se creará un pedido repuesto. Consumirá insumos otra vez, no se cobra de nuevo y se registrará como pérdida de la sucursal.', verbo: 'Aceptar' })) {
      accion(() => api.post(`/jefe/solicitudes/${x.id}/aceptar-reposicion`), 'Reposición creada: aparece en «Nuevos»');
    }
  };
  const autorizar = async (x) => {
    if (await confirmar({ titulo: '¿Autorizar la cancelación?', texto: 'El pedido se cancela de inmediato. Si ya se usaron insumos, se registran como pérdida. No pasa por el gerente.', verbo: 'Autorizar' })) {
      accion(() => api.post(`/jefe/solicitudes/${x.id}/autorizar-cancelacion`), 'Cancelación autorizada');
    }
  };
  const devolver = async (x, monto, pct) => {
    if (await confirmar({ titulo: `¿Devolver el ${pct} % (${$(monto)})?`, texto: 'Se descuenta de la venta y de la caja del mesero. No pasa por el gerente.', verbo: 'Devolver' })) {
      accion(() => api.post(`/jefe/solicitudes/${x.id}/devolver`, { pct }), 'Devolución aprobada');
    }
  };

  if (!L.length) return <Vacio ic="check">{{ reposiciones: 'No hay reposiciones pendientes', cancelaciones: 'No hay cancelaciones pendientes', devoluciones: 'No hay devoluciones pendientes' }[tab]}</Vacio>;
  return (
    <Stack>
      {L.map((x) => {
        const p = ped[x.pedido];
        const l = p?.lineas.find((z) => z.orden === x.linea);
        if (tab === 'reposiciones') {
          return (
            <Card key={x.id} className="tw:flex tw:flex-col tw:gap-1.5 tw:border-l-4 tw:border-l-[#E0A42E]">
              <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2"><b>#{p.num} · {l?.nombre}</b><Chip t="El plato ya llegó" o="in" /></div>
              <div className="tw:text-tx2">Mesero: {x.solicitanteNombre} · {fmt(x.fecha)}</div>
              <div>Motivo: {x.motivo}</div>
              <div className="tw:flex tw:gap-2 tw:mt-2 tw:pt-2.5 tw:border-t tw:border-[#EAF0F9]"><Btn onClick={() => rechazar(x)}>Rechazar</Btn><Btn v="p" onClick={() => aceptarRepo(x)}>Aceptar reposición</Btn></div>
            </Card>
          );
        }
        if (tab === 'cancelaciones') {
          return (
            <Card key={x.id} className="tw:flex tw:flex-col tw:gap-1.5 tw:border-l-4 tw:border-l-er">
              <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2"><b>{nom(p)} · {donde(p)}</b><Chip t="Decide el jefe de cocina" o="in" /></div>
              <div>Motivo del mesero: {x.motivo}</div>
              <div className="tw:text-tx2">Cocinero: {p.cocineroNombre || '—'}</div>
              <TiempoPedido p={p} />
              <div className="tw:flex tw:gap-2 tw:mt-2 tw:pt-2.5 tw:border-t tw:border-[#EAF0F9]"><Btn onClick={() => rechazar(x)}>Rechazar</Btn><Btn v="p" onClick={() => autorizar(x)}>Autorizar cancelación</Btn></div>
            </Card>
          );
        }
        const v = ventas[x.venta];
        const m = l ? l.unit * l.cant : 0;
        return (
          <Card key={x.id} className="tw:flex tw:flex-col tw:gap-1.5 tw:border-l-4 tw:border-l-br">
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2"><b>#{p.num} · {l?.nombre}</b><Chip t="Devolución de dinero" o="in" /></div>
            <div className="tw:text-tx2">Mesero: {x.solicitanteNombre} · {fmt(x.fecha)}{v ? ` · ${corr({ tipo: v.tipo_doc, corr: v.correlativo })} · ${v.metodo}` : ''}</div>
            <div>Motivo: {x.motivo}</div>
            <div>Valor del plato: {$(m)}</div>
            <div className="tw:flex tw:flex-wrap tw:gap-2 tw:mt-2 tw:pt-2.5 tw:border-t tw:border-[#EAF0F9]">
              <Btn onClick={() => rechazar(x)}>Rechazar</Btn>
              <Btn onClick={() => devolver(x, m * 0.5, 50)}>Devolver 50 % ({$(m * 0.5)})</Btn>
              <Btn v="p" onClick={() => devolver(x, m, 100)}>Devolver 100 % ({$(m)})</Btn>
            </div>
          </Card>
        );
      })}
    </Stack>
  );
}
