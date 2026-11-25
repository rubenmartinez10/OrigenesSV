import { useState } from 'react';
import { nom, donde } from '../../lib/pedidos.js';
import { useDatos } from '../../context/Sesion.jsx';
import { Btn, Card, Cargando, Chip, Kpi, Stack, Vacio, Avatar } from '../../components/ui.jsx';
import { TiempoPedido } from '../../components/Pedido.jsx';
import { PanelPedido } from '../cocinero/Historial.jsx';

/** Cocina en vivo: quién está libre, quién prepara qué y cuánto lleva. */
export default function CocinaEnVivo() {
  const { datos } = useDatos('/jefe/cola', { cada: 4000 });
  const { datos: cat } = useDatos('/catalogo');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const { pedidos, cocineros } = datos;
  const porId = Object.fromEntries(pedidos.map((p) => [p.id, p]));
  const libres = cocineros.filter((c) => !c.ocupado && !c.cola.length).length;
  const preparando = cocineros.filter((c) => c.ocupado).length;
  const porAsignar = pedidos.filter((p) => ['Creado', 'Aceptado'].includes(p.estado)).length;
  return (
    <Stack>
      <div className="tw:grid tw:gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
        <Kpi t="Libres" v={libres} ic="users" tono="ok" />
        <Kpi t="Preparando" v={preparando} ic="clock" tono="wa" />
        <Kpi t="Pedidos por asignar" v={porAsignar} ic="bag" tono={porAsignar ? 'er' : 'in'} />
      </div>
      {cocineros.length ? (
        <div className="tw:grid tw:gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))' }}>
          {cocineros.map((c) => {
            const p = c.ocupado && porId[c.ocupado.id];
            return (
              <Card key={c.id} className="tw:flex tw:flex-col tw:gap-2">
                <div className="tw:flex tw:items-center tw:gap-2.5"><Avatar u={c} size={36} /><b className="tw:flex-1">{c.nombre}</b><Chip t={p ? 'Ocupado' : 'Libre'} o={p ? 'wa' : 'ok'} /></div>
                {p ? (
                  <>
                    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">{nom(p)} · {donde(p)} <Chip t={p.estado} /></div>
                    <TiempoPedido p={p} />
                    <div><Btn v="t" onClick={() => setVer(p)}>Ver detalle</Btn></div>
                  </>
                ) : <div className="tw:text-tx2">{c.cola.length ? 'Sin iniciar el siguiente' : 'Esperando pedido'}</div>}
                {c.cola.length > 0 && <div className="tw:text-tx2">En cola: {c.cola.map((q) => `#${q.num}`).join(', ')}</div>}
              </Card>
            );
          })}
        </div>
      ) : <Vacio ic="users">No hay cocineros en turno</Vacio>}
      {ver && <PanelPedido p={ver} cat={cat} onHide={() => setVer(null)} />}
    </Stack>
  );
}
