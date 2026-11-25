import { useState } from 'react';
import { $ } from '../lib/formato.js';
import { useDatos } from '../context/Sesion.jsx';
import { Barra, Btn, Card, Chip, Cargando, Foto, Kv, Mut, Panel, Pildoras, Tabla, Vacio } from './ui.jsx';

/** Productos en tendencia: los más vendidos (por unidades) del periodo, con el cambio de puesto frente al periodo anterior.
 *  Si `per` viene de afuera (panel del gerente general) usa ese filtro; si no, muestra sus propios botones de periodo. */
let PER = 'Hoy';
const cambio = (x) => (x.cambio == null ? <Chip t="Nuevo" o="in" sinSimbolo /> : x.cambio > 0 ? <Chip t={`▲ ${x.cambio}`} o="ok" sinSimbolo /> : x.cambio < 0 ? <Chip t={`▼ ${-x.cambio}`} o="er" sinSimbolo /> : <Chip t="=" o="g" sinSimbolo />);

export default function Tendencia({ endpoint, per: perExt, suc = '', titulo = 'Productos en tendencia' }) {
  const [perInt, setPerInt] = useState(PER);
  const per = perExt || perInt;
  const [mas, setMas] = useState(false);
  const [ver, setVer] = useState(null);
  const { datos } = useDatos(`${endpoint}?per=${encodeURIComponent(per)}${suc ? `&suc=${suc}` : ''}`, { cada: 30000 });
  const L = datos?.items || [];
  const top = L.slice(0, mas ? 10 : 5);
  const mx = L[0]?.unidades || 1;
  const x = ver != null && L.find((p) => p.id === ver);
  const vs = per === 'Hoy' ? 'a esta hora ayer' : 'el periodo anterior';
  return (
    <Card className="tw:flex tw:flex-col tw:gap-3">
      <h4 className="tw:text-[15px] tw:m-0">{titulo}</h4>
      {!perExt && <div><Pildoras opciones={['Hoy', '7 días', '30 días']} valor={per} onChange={(v) => { PER = v; setPerInt(v); }} /></div>}
      {!datos ? <Cargando /> : L.length ? <>
        <Mut>Por unidades vendidas. {datos.hayAnt ? `El cambio de puesto se compara con ${vs}.` : 'Todavía no hay ventas en el periodo anterior para comparar.'}</Mut>
        {top.map((p) => (
          <button key={p.id} type="button" onClick={() => setVer(p.id)} className="tw:flex tw:items-center tw:gap-3 tw:w-full tw:text-left tw:bg-transparent tw:border-0 tw:p-0 tw:cursor-pointer">
            <span className="tw:w-6 tw:text-center tw:font-extrabold tw:text-tx2">{p.puesto}</span>
            <Foto x={p} className="tw:w-11 tw:h-11 tw:rounded-xl tw:shrink-0" icono="tw:text-xl" />
            <div className="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-1">
              <div className="tw:flex tw:items-center tw:flex-wrap tw:gap-x-2 tw:gap-y-1"><b className="tw:truncate">{p.nombre}</b>{datos.hayAnt && cambio(p)}{p.retirado && <Chip t="Ya no está en el menú" o="g" sinSimbolo />}</div>
              <Barra pct={(p.unidades / mx) * 100} tono="ok" sinSimbolo />
              {p.sucursales.length > 0 && <small className="tw:text-tx2 tw:truncate">{p.sucursales.slice(0, 3).map((s) => `${s.nombre} #${s.puesto}`).join(' · ')}{p.sucursales.length > 3 ? ` · +${p.sucursales.length - 3}` : ''}</small>}
            </div>
            <div className="tw:text-right tw:shrink-0"><b>{p.unidades} uds</b><div><Mut>{$(p.ingresos)}</Mut></div></div>
          </button>
        ))}
        {L.length > 5 && <div><Btn v="t" onClick={() => setMas(!mas)}>{mas ? 'Ver menos' : 'Ver los 10 primeros'}</Btn></div>}
      </> : <Vacio ic="chart">Aún no hay ventas {per === 'Hoy' ? 'hoy' : 'en este periodo'}</Vacio>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={x.nombre} ro>
          <Foto x={x} ampliar className="tw:w-full tw:h-44 tw:rounded-2xl" icono="tw:text-6xl" />
          {x.retirado && <Mut>Este producto ya no está en el menú (inhabilitado o eliminado). Sus ventas anteriores se conservan en los historiales.</Mut>}
          <Kv pares={[['Puesto', `${x.puesto}.º de ${datos.total}`], ['Unidades vendidas', x.unidades], ['Ingresos', $(x.ingresos)],
            ...(datos.hayAnt ? [[per === 'Hoy' ? 'A esta hora ayer' : 'Periodo anterior', `${x.antUnidades} uds`],
            ['Cambio de puesto', x.cambio == null ? 'No se vendió en el periodo anterior' : x.cambio === 0 ? 'Sin cambio' : `${x.cambio > 0 ? 'Subió' : 'Bajó'} ${Math.abs(x.cambio)}`]] : [])]} />
          {x.sucursales.length > 0 && <>
            <h4 className="tw:text-sm tw:m-0">Por sucursal</h4>
            <Tabla cols={['Sucursal', 'Puesto', 'Unidades']} filas={x.sucursales.map((s) => [s.nombre, `${s.puesto}.º`, s.u])} />
          </>}
        </Panel>
      )}
    </Card>
  );
}
