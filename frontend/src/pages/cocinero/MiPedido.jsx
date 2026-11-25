import { useMemo } from 'react';
import { api } from '../../lib/api.js';
import { nom, donde, txt, est, minutos, uso } from '../../lib/pedidos.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Btn, Card, Cargando, Chip, Mut, Stack, Vacio } from '../../components/ui.jsx';
import { TiempoPedido } from '../../components/Pedido.jsx';

/** El cocinero prepara un pedido a la vez; el siguiente de su cola pasa a «Mi pedido» al terminar. */
export default function MiPedido({ tab }) {
  const { confirmar, accion } = useDialogos();
  const { datos } = useDatos('/cocinero/mi-pedido', { cada: 4000 });
  const { datos: cat } = useDatos('/catalogo');
  const P = useMemo(() => cat && Object.fromEntries(cat.productos.map((x) => [x.id, x])), [cat]);
  const M = useMemo(() => cat && Object.fromEntries(cat.materias.map((m) => [m.id, m])), [cat]);
  if (!datos) return <Cargando />;
  const { actual: p, cola, cancelado } = datos;

  if (tab === 'cola') {
    return cola.length ? (
      <Stack>
        <Mut>Solo preparas uno a la vez. El siguiente pasa a «Mi pedido» cuando termines.</Mut>
        {cola.map((q, i) => (
          <Card key={q.id} className="tw:flex tw:flex-col tw:gap-1 tw:border-l-4 tw:border-l-br">
            <div className="tw:flex tw:items-center tw:gap-2"><b>{i + 1}. {nom(q)} · {donde(q)}</b>{q.rep && <Chip t="Reposición" o="wa" />}<span className="tw:flex-1" /><b>{minutos(est(q))} min</b></div>
            {q.lineas.map((l) => <div key={l.orden}>{txt(l)}</div>)}
          </Card>
        ))}
      </Stack>
    ) : <Vacio ic="check">No tienes pedidos en cola</Vacio>;
  }

  const iniciar = async () => {
    if (await confirmar({ titulo: '¿Iniciar la preparación?', texto: 'Se descontarán los insumos del inventario y ya no regresan.', verbo: 'Iniciar' })) {
      accion(() => api.post(`/cocinero/pedidos/${p.id}/iniciar`));
    }
  };
  const terminar = async () => {
    if (await confirmar({ titulo: '¿El pedido está terminado?', texto: 'El mesero lo verá marcado como listo.', verbo: 'Sí, terminado' })) {
      accion(() => api.post(`/cocinero/pedidos/${p.id}/terminar`), '✓ Listo. El mesero ya lo ve');
    }
  };
  const estado = p ? (p.estado === 'Preparando' ? 'Ocupado · preparando' : 'Pedido por iniciar') : 'Libre';
  return (
    <Stack>
      <div className="tw:flex tw:items-center tw:gap-2.5 tw:px-5 tw:py-2.5 tw:rounded-full tw:border tw:border-bd tw:bg-sf tw:w-max tw:max-w-full tw:shadow-osv">
        <i className={`osv-ping tw:w-2.5 tw:h-2.5 tw:rounded-full ${p ? 'tw:bg-wa tw:text-wa' : 'tw:bg-ok tw:text-ok'}`} />
        <b>{estado}</b>
        <small className="tw:text-tx2">{p ? (cola.length ? `${cola.length} en cola detrás de este` : '') : 'Esperando un pedido del jefe de cocina'}</small>
      </div>
      {cancelado && (
        <Ban className="tw:flex tw:flex-col tw:gap-1">
          <b>El pedido #{cancelado.num} fue cancelado</b>
          <div><Btn v="p" onClick={() => accion(() => api.post(`/cocinero/pedidos/${cancelado.id}/visto`))}>Entendido</Btn></div>
        </Ban>
      )}
      {p ? (
        <Card className="tw:flex tw:flex-col tw:gap-2">
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <h3 className="tw:text-[17px] tw:m-0">{nom(p)} · {donde(p)}</h3>
            <Chip t={p.estado} />{p.rep && <Chip t="Reposición" o="wa" />}
            <span className="tw:flex-1" /><b>{minutos(est(p))} min</b>
          </div>
          {p.rep && <Mut>Plato repuesto por mala preparación · repone el pedido #{p.repNum}</Mut>}
          {p.lineas.map((l) => (
            <div key={l.orden}>
              <b>{txt(l)}</b>
              {P && (
                <details>
                  <summary>Receta</summary>
                  {Object.entries(uso([{ pr: l.pr, cant: l.cant, extras: l.extras.map((e) => e.pr) }], P)).map(([m, c]) => (
                    <div key={m}>{M[m]?.nombre} {c.toFixed(2)} {M[m]?.unidad}</div>
                  ))}
                </details>
              )}
            </div>
          ))}
          <TiempoPedido p={p} />
          <div>{p.estado === 'Asignado' ? <Btn v="p" onClick={iniciar}>Iniciar preparación</Btn> : <Btn v="p" onClick={terminar}>Marcar como hecho</Btn>}</div>
        </Card>
      ) : !cancelado && <Vacio ic="users">Sin pedido asignado · Esperando al jefe de cocina</Vacio>}
    </Stack>
  );
}
