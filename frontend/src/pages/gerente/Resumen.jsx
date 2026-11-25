import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { $ } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { Barra, Btn, Card, Cargando, Chip, Fila, Kpi, Mut, Panel, Pildoras, Tabla, Vacio } from '../../components/ui.jsx';

/* Gerente de sucursal · 5.1 Resumen */
const F = { vista: 'prod', per: 'Hoy', mas: false };

export function RankingBarras({ rank, mas }) {
  const top = rank.slice(0, mas ? 10 : 5);
  const mx = top[0]?.[1] || 1;
  return top.map(([n, v]) => (
    <div key={n} className="tw:flex tw:items-center tw:gap-2.5">
      <span className="tw:min-w-[150px] tw:truncate">{n}</span>
      <div className="tw:flex-1"><Barra pct={(v / mx) * 100} tono="ok" /></div>
      <b>{$(v)}</b>
    </div>
  ));
}

export default function Resumen() {
  const navigate = useNavigate();
  const [f, setF] = useState(F);
  const set = (x) => { Object.assign(F, x); setF({ ...F }); };
  const { datos } = useDatos(`/gerente/resumen?per=${encodeURIComponent(f.per)}&vista=${f.vista}`, { cada: 30000 });
  const [panel, setPanel] = useState(null);
  if (!datos) return <Cargando />;
  const { hoy, ayer } = datos;
  const pct = ayer.total ? Math.round(((hoy.total - ayer.total) / ayer.total) * 100) : null;
  return (
    <div className="tw:flex tw:flex-col tw:gap-3.5">
      <div className="tw:grid tw:gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
        <Kpi t="Ventas de hoy" v={$(hoy.total)} s={pct == null ? 'Sin ventas ayer' : `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)} % a esta hora ayer`} ic="chart" tono={pct != null && pct < 0 ? 'er' : undefined} />
        <Kpi t="Órdenes" v={String(hoy.n)} s="Pedidos cobrados" ic="bag" />
        <Kpi t="Ticket promedio" v={$(hoy.n ? hoy.total / hoy.n : 0)} ic="receipt" />
      </div>
      <div className="tw:grid tw:gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))' }}>
        <Card className="tw:flex tw:flex-col tw:gap-3">
          <h4 className="tw:text-[15px] tw:m-0">Qué más ingresos genera</h4>
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Pildoras opciones={[['prod', 'Productos'], ['cat', 'Categorías']]} valor={f.vista} onChange={(v) => set({ vista: v })} />
            <Pildoras opciones={['Hoy', '7 días', '30 días']} valor={f.per} onChange={(v) => set({ per: v })} />
          </div>
          {datos.rank.length ? <RankingBarras rank={datos.rank} mas={f.mas} /> : <Vacio ic="dollar">Aún no hay ventas {f.per === 'Hoy' ? 'hoy' : 'en este periodo'}</Vacio>}
          {datos.rank.length > 5 && <div><Btn v="t" onClick={() => set({ mas: !f.mas })}>{f.mas ? 'Ver menos' : 'Ver más'}</Btn></div>}
        </Card>
        <Card className="tw:flex tw:flex-col tw:gap-2.5">
          <h4 className="tw:text-[15px] tw:m-0">Alertas</h4>
          {[['Stock bajo', datos.stockBajo.length, () => setPanel('stock')], ['Lotes por vencer', datos.porVencer, () => navigate('/gerente/aprobaciones/ofertas')],
            ['Precio por revisar', datos.revisar.length, () => setPanel('revisar')]].map(([t, n, fn]) => (
            <Fila key={t} ico={n ? 'bell' : 'check'} tono={n ? 'wa' : 'ok'} t={t} der={<Chip t={String(n)} o={n ? 'wa' : 'ok'} sinSimbolo />} onClick={fn} />
          ))}
        </Card>
      </div>
      <Panel show={panel === 'stock'} onHide={() => setPanel(null)} titulo="Stock bajo" ro>
        {datos.stockBajo.length ? <Tabla cols={['Materia prima', 'Stock', 'Mínimo']} filas={datos.stockBajo.map((x) => [x.nombre, `${x.stock.toFixed(1)} ${x.unidad}`, x.minimo.toFixed(1)])} /> : <Vacio ic="check">Todo en orden</Vacio>}
      </Panel>
      <Panel show={panel === 'revisar'} onHide={() => setPanel(null)} titulo="Precio por revisar" ro>
        {datos.revisar.length ? <>
          <Mut>Estos productos no se venden hasta corregir el precio: su costo alcanzó al precio sin IVA.</Mut>
          {datos.revisar.map((x) => (
            <Card key={x.id} className="tw:flex tw:flex-col tw:gap-1.5">
              <b>{x.nombre}</b><div className="tw:text-tx2">Precio {$(x.precio)} · costo {$(x.costo)}</div>
              <div><Btn v="p" onClick={() => navigate('/gerente/pedir', { state: { prod: x.id } })}>Solicitar cambio de precio</Btn></div>
            </Card>
          ))}
        </> : <Vacio ic="check">Nada por revisar</Vacio>}
      </Panel>
    </div>
  );
}
