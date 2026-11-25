import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form } from 'react-bootstrap';
import { $ } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { Btn, Card, Cargando, Kpi, Kv, Panel as Lateral, Pildoras, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { Barras, Tablero } from '../../components/Graficas.jsx';

/* Gerente general · 7.1 Panel de franquicia */
const S = { per: 'Hoy', suc: '' };
const TABDE = {
  Compras: 'aprobaciones/compras', Proveedores: 'aprobaciones/proveedores', Precios: 'aprobaciones/precios', Menús: 'aprobaciones/menus',
  Productos: 'productos/propuestas', Nómina: 'dinero/nomina', Despidos: 'sucursales/despidos', Personal: 'sucursales/plantilla',
};
const flecha = (a, b) => (b ? `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round(((a - b) / b) * 100))} % contra el periodo anterior` : 'Sin periodo anterior');

export default function PanelGG() {
  const navigate = useNavigate();
  const [f, setFS] = useState(S);
  const setF = (x) => { Object.assign(S, x); setFS({ ...S }); };
  const { datos: d } = useDatos(`/gg/panel?per=${encodeURIComponent(f.per)}&suc=${f.suc}`, { cada: 30000 });
  const [ver, setVer] = useState(null);
  if (!d) return <Cargando />;
  const tot = Object.values(d.pendientes).reduce((a, b) => a + b, 0);
  const s = ver && d.filas.find((x) => x.id === ver);
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Pildoras opciones={['Hoy', '7 días', '30 días']} valor={f.per} onChange={(per) => setF({ per })} />
        <Form.Select value={f.suc} onChange={(e) => setF({ suc: e.target.value })} className="tw:max-w-[220px]" aria-label="Sucursal">
          <option value="">Todas las sucursales</option>{d.sucursales.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </Form.Select>
      </div>
      <div className="tw:grid tw:gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))' }}>
        <Kpi t="Ventas" v={$(d.ventas)} s={flecha(d.ventas, d.ventasAnt)} ic="chart" tono={d.ventasAnt && d.ventas < d.ventasAnt ? 'er' : undefined} />
        <Kpi t="Gastos" v={$(d.gastos)} s={flecha(d.gastos, d.gastosAnt)} ic="receipt" />
        <Card className="tw:flex tw:flex-col tw:gap-2">
          <small className="tw:uppercase tw:font-bold tw:tracking-wide tw:text-[11.5px] tw:text-tx2">Solicitudes pendientes</small>
          <div className="tw:text-3xl tw:font-extrabold">{tot}</div>
          <div className="tw:flex tw:flex-wrap tw:gap-1.5">
            {Object.entries(d.pendientes).filter(([, n]) => n).map(([k, n]) => <Btn key={k} onClick={() => navigate(`/gg/${TABDE[k]}`)}>{k} {n}</Btn>)}
            {!tot && <small className="tw:text-tx2">Todo al día</small>}
          </div>
        </Card>
      </div>
      <Tablero d={d} n={f.per === '30 días' ? 30 : 7} />
      {d.filas.length ? <Tabla cols={['Sucursal', 'Ventas', 'Gastos', 'Pendientes']} filas={d.filas.map((x) => ({
        onClick: () => setVer(x.id), celdas: [x.nombre, $(x.ventas), $(x.gastos), x.pendientes],
      }))} /> : <Vacio ic="box">Sin movimientos en este periodo</Vacio>}
      {s && (
        <Lateral show onHide={() => setVer(null)} titulo={s.nombre} ro>
          <Kv pares={[['Zona', s.zona], ['Tamaño', s.tamano], ['Estado', s.estado], ['Ventas del periodo', $(s.ventas)], ['Gastos del periodo', $(s.gastos)], ['Personal activo', s.personal]]} />
          <h4 className="tw:text-sm tw:m-0">Más ingresos</h4>
          <Barras items={s.top} />
        </Lateral>
      )}
    </Stack>
  );
}
