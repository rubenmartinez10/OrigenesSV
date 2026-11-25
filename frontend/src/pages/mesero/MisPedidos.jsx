import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { fmt } from '../../lib/formato.js';
import { nom, donde, resumen, demora } from '../../lib/pedidos.js';
import { useDatos, useSesion, useAhora } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Btn, Card, Cargando, Chip, Err, Mut, Stack, Vacio } from '../../components/ui.jsx';
import { Espera } from '../../components/Pedido.jsx';
import { DetallePedido, useCancelarDemora } from './comun.jsx';

export default function MisPedidos() {
  const { config } = useSesion();
  const { confirmar, accion } = useDialogos();
  const ahora = useAhora();
  const navigate = useNavigate();
  const cancelarDemora = useCancelarDemora();
  const { datos: pedidos } = useDatos('/mesero/pedidos?activos=1', { cada: 4000 });
  const { datos: sols } = useDatos('/mesero/solicitudes');
  const [ver, setVer] = useState(null);
  if (!pedidos) return <Cargando />;

  const rechazados = pedidos.filter((p) => p.estado === 'Rechazado');
  const enCurso = pedidos.filter((p) => p.estado !== 'Rechazado').sort((a, b) => (b.estado === 'Listo') - (a.estado === 'Listo') || a.creado - b.creado);
  const cancSolicitada = (p) => (sols || []).some((x) => x.pedido === p.id && x.tipo === 'Cancelación' && x.estado === 'Solicitada');
  const entregar = async (p) => {
    if (await confirmar({ titulo: '¿El platillo llegó al cliente?', texto: `Pedido #${p.num}`, verbo: 'Sí, entregado' })) {
      accion(() => api.post(`/mesero/pedidos/${p.id}/entregar`), 'Pedido entregado');
    }
  };
  const actual = ver && pedidos.find((p) => p.id === ver);

  return (
    <Stack>
      {rechazados.map((p) => (
        <Ban key={p.id} className="tw:flex tw:flex-col tw:gap-1">
          <b>Cocina rechazó el pedido #{p.num}</b>
          <div>Motivo: {p.rechazo?.motivo}</div>
          <div><Btn v="p" onClick={() => accion(() => api.post(`/mesero/pedidos/${p.id}/visto`))}>Entendido</Btn></div>
        </Ban>
      ))}
      {enCurso.length ? enCurso.map((p) => {
        const dem = demora(p, ahora, config);
        const tono = p.estado === 'Listo' ? 'tw:border-l-ok' : dem ? 'tw:border-l-er' : 'tw:border-l-[#E0A42E]';
        return (
          <Card key={p.id} className={`tw:flex tw:flex-col tw:gap-1.5 tw:border-l-4 ${tono}`}>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
              <b className="tw:text-[14.5px]">{nom(p)} · {donde(p)}</b>
              <Chip t={p.estado} />
              {dem && <Chip t="Demorado" o="er" />}
              {p.rep && <Chip t="Reposición" o="wa" />}
              {p.estado === 'Listo' && <b className="tw:text-ok">Listo para entregar</b>}
              {cancSolicitada(p) && <Chip t="Cancelación solicitada" o="wa" />}
            </div>
            <div className="tw:text-tx2">{resumen(p)} · {fmt(p.creado)}</div>
            {p.rep && <div className="tw:text-tx2">Repone el pedido #{p.repNum} · sin cobro adicional</div>}
            <Espera p={p} />
            {p.rechazo && <Err>Rechazado por cocina: {p.rechazo.motivo}</Err>}
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:mt-2 tw:pt-2.5 tw:border-t tw:border-[#EAF0F9]">
              <Btn v="t" onClick={() => setVer(p.id)}>Ver detalle</Btn>
              {dem && <Btn v="red" onClick={() => cancelarDemora(p)}>Cancelar por demora</Btn>}
              {p.estado === 'Entregado' && !p.rep
                ? <Btn v="p" onClick={() => navigate('/mesero/cobro', { state: { pedido: p.id } })}>Cobrar</Btn>
                : <Btn v="p" disabled={p.estado !== 'Listo'} onClick={() => entregar(p)}>Entregar</Btn>}
              {p.estado !== 'Listo' && p.estado !== 'Entregado' && <Mut>Aún no está listo</Mut>}
            </div>
          </Card>
        );
      }) : <Vacio ic="list">No tienes pedidos en curso</Vacio>}
      {actual && <DetallePedido p={actual} solicitudes={sols} onHide={() => setVer(null)} />}
    </Stack>
  );
}
