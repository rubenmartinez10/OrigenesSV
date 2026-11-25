import { useMemo } from 'react';
import { api } from '../../lib/api.js';
import { nom, donde, txt, est, minutos, uso } from '../../lib/pedidos.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Btn, Card, Cargando, Chip, Mut, Stack, Vacio } from '../../components/ui.jsx';
import { TiempoPedido } from '../../components/Pedido.jsx';

/** El cocinero prepara varios pedidos a la vez (hasta el máximo configurado); los demás esperan en su cola por orden de llegada. */
export default function MiPedido({ tab }) {
  const { confirmar, accion } = useDialogos();
  const { datos } = useDatos('/cocinero/mi-pedido', { cada: 4000 });
  const { datos: cat } = useDatos('/catalogo');
  const P = useMemo(() => cat && Object.fromEntries(cat.productos.map((x) => [x.id, x])), [cat]);
  const M = useMemo(() => cat && Object.fromEntries(cat.materias.map((m) => [m.id, m])), [cat]);
  if (!datos) return <Cargando />;
  const { haciendo, cola, cancelado, max } = datos;
  const lleno = haciendo.length >= max;

  const iniciar = async (p) => {
    if (await confirmar({ titulo: '¿Iniciar la preparación?', texto: 'Se descontarán los insumos del inventario y ya no regresan.', verbo: 'Iniciar' })) {
      accion(() => api.post(`/cocinero/pedidos/${p.id}/iniciar`));
    }
  };
  const terminar = async (p) => {
    if (await confirmar({ titulo: '¿El pedido está terminado?', texto: 'El mesero recibe el aviso de que está listo.', verbo: 'Sí, terminado' })) {
      accion(() => api.post(`/cocinero/pedidos/${p.id}/terminar`), '✓ Listo. El mesero ya lo ve');
    }
  };

  const tarjeta = (p, i) => (
    <Card key={p.id} className="tw:flex tw:flex-col tw:gap-2">
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <h3 className="tw:text-[17px] tw:m-0">{i != null ? `${i + 1}. ` : ''}{nom(p)} · {donde(p)}</h3>
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
      <div>
        {p.estado === 'Asignado'
          ? <Btn v="p" disabled={lleno} onClick={() => iniciar(p)}>{lleno ? `Ya preparas ${max}` : 'Iniciar preparación'}</Btn>
          : <Btn v="p" onClick={() => terminar(p)}>Marcar como hecho</Btn>}
      </div>
    </Card>
  );

  if (tab === 'cola') {
    return cola.length ? (
      <Stack>
        <Mut>Por orden de llegada. Puedes preparar hasta {max} a la vez; inicia el siguiente cuando tengas lugar.</Mut>
        {cola.map(tarjeta)}
      </Stack>
    ) : <Vacio ic="check">No tienes pedidos en cola</Vacio>;
  }

  const libre = !haciendo.length && !cola.length;
  return (
    <Stack>
      <div className="tw:flex tw:items-center tw:gap-2.5 tw:px-5 tw:py-2.5 tw:rounded-full tw:border tw:border-bd tw:bg-sf tw:w-max tw:max-w-full tw:shadow-osv">
        <i className={`osv-ping tw:w-2.5 tw:h-2.5 tw:rounded-full ${libre ? 'tw:bg-ok tw:text-ok' : 'tw:bg-wa tw:text-wa'}`} />
        <b>{libre ? 'Libre' : `Preparando ${haciendo.length} de ${max}`}</b>
        <small className="tw:text-tx2">{libre ? 'Esperando un pedido del jefe de cocina' : cola.length ? `${cola.length} en cola` : ''}</small>
      </div>
      {cancelado && (
        <Ban className="tw:flex tw:flex-col tw:gap-1">
          <b>El pedido #{cancelado.num} fue cancelado</b>
          <div><Btn v="p" onClick={() => accion(() => api.post(`/cocinero/pedidos/${cancelado.id}/visto`))}>Entendido</Btn></div>
        </Ban>
      )}
      {haciendo.map(tarjeta)}
      {!haciendo.length && cola.length > 0 && <Mut>Nada en preparación. Los pedidos esperan en «Cola».</Mut>}
      {!haciendo.length && cola[0] && tarjeta(cola[0])}
      {libre && !cancelado && <Vacio ic="users">Sin pedido asignado · Esperando al jefe de cocina</Vacio>}
    </Stack>
  );
}
