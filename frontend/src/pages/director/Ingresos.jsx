import { useState } from 'react';
import { Form } from 'react-bootstrap';
import { $ } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { Btn, Card, Cargando, Kpi, Kv, Panel, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { Barras, Tablero } from '../../components/Graficas.jsx';

/* Director · 8.1 Ingresos (sin gastos ni utilidades: eso solo lo ven los gerentes) */
const S = { v: '7', ord: 'ing', q: '', n: 10, abierta: true };
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Detalle de una sucursal: ingresos, productos y categorías que más venden. */
export function DetalleSucursal({ s, onHide }) {
  return (
    <Panel show onHide={onHide} titulo={s.nombre} ro>
      <Kv pares={[['Zona', s.zona], ['Tamaño', s.tamanoNombre || s.tamano], ['Estado', s.estado], ['Ingresos', $(s.ingresos)], ['Personal activo', s.personal]]} />
      <h4 className="tw:text-sm tw:m-0">Productos con más ingresos</h4>
      <Barras items={s.top} />
      <h4 className="tw:text-sm tw:m-0">Categorías</h4>
      <Barras items={s.cats} />
    </Panel>
  );
}

export default function Ingresos() {
  const [f, setFS] = useState(S);
  const setF = (x) => { Object.assign(S, x); setFS({ ...S }); };
  const { datos: d } = useDatos(`/director/ingresos?v=${f.v}`, { cada: 30000 });
  const [ver, setVer] = useState(null);
  if (!d) return <Cargando />;
  const filas = d.filas.filter((x) => !f.q || norm(x.nombre).includes(norm(f.q)))
    .sort((a, b) => (f.ord === 'nom' ? a.nombre.localeCompare(b.nombre) : b.ingresos - a.ingresos));
  const tot = filas.reduce((a, x) => a + x.ingresos, 0);
  const s = ver && d.filas.find((x) => x.id === ver);
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Form.Select value={f.v} onChange={(e) => setF({ v: e.target.value, n: 10 })} className="tw:max-w-[150px]" aria-label="Periodo">
          {[['1', 'Hoy'], ['7', '7 días'], ['30', '30 días']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Form.Select>
        <Form.Select value={f.ord} onChange={(e) => setF({ ord: e.target.value })} className="tw:max-w-[180px]" aria-label="Orden">
          <option value="ing">Más ingresos</option><option value="nom">Nombre</option>
        </Form.Select>
        <Form.Control type="search" placeholder="Buscar sucursal" value={f.q} onChange={(e) => setF({ q: e.target.value, n: 10 })} className="tw:max-w-[240px]" aria-label="Buscar sucursal" />
      </div>
      <div className="tw:grid tw:gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))' }}>
        <Kpi t="Ingresos de la franquicia" v={$(d.total)} ic="chart" />
        <Kpi t="Pedidos cobrados" v={String(d.pedidos)} ic="bag" />
        <Kpi t="Ticket promedio" v={d.ticket != null ? $(d.ticket) : '—'} ic="receipt" />
        <Kpi t="Sucursales operando" v={String(d.operando)} ic="home" />
      </div>
      <Tablero d={{ ...d, porSucursal: filas.map((x) => [x.nombre, x.ingresos]) }} n={f.v === '1' ? 7 : +f.v} />
      <Card className="tw:flex tw:flex-col tw:gap-3">
        <div className="tw:flex tw:items-center tw:gap-2"><b>Franquicia</b><span className="tw:flex-1" /><Btn v="t" onClick={() => setF({ abierta: !f.abierta })}>{f.abierta ? 'Contraer' : 'Expandir'}</Btn></div>
        <div className="tw:text-2xl tw:font-extrabold">{$(tot)}</div>
        {f.abierta && (filas.length ? <Tabla cols={['Sucursal', 'Ingresos']} filas={filas.slice(0, f.n).map((x) => ({ onClick: () => setVer(x.id), celdas: [x.nombre, $(x.ingresos)] }))} />
          : <Vacio ic="list">Sin resultados</Vacio>)}
        {f.abierta && filas.length > f.n && <div><Btn onClick={() => setF({ n: f.n + 10 })}>Mostrar 10 más</Btn></div>}
      </Card>
      {s && <DetalleSucursal s={s} onHide={() => setVer(null)} />}
    </Stack>
  );
}
