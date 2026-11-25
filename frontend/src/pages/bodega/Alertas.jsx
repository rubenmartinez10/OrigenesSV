import { useNavigate } from 'react-router-dom';
import { fFecha } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { Ban, Btn, Card, Cargando, Chip, Mut, Nivel, Stack, Vacio } from '../../components/ui.jsx';

/* Encargado de bodega · 4.2 Alertas: stock bajo y lotes por vencer */
export default function Alertas({ tab = 'stock' }) {
  const navigate = useNavigate();
  const { datos } = useDatos('/bodega/alertas', { cada: 15000 });
  if (!datos) return <Cargando />;

  if (tab === 'vencer') {
    return (
      <Stack>
        <Ban>El sistema genera la propuesta de oferta y se la envía al gerente de sucursal. No necesitas hacer nada aquí.</Ban>
        {datos.porVencer.length ? datos.porVencer.map((l) => (
          <Card key={l.id} className="tw:flex tw:flex-col tw:gap-1.5 tw:border-l-4 tw:border-l-er">
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
              <b>{l.sku} · {l.nombre}</b>
              <Chip t={`${l.dias} día${l.dias === 1 ? '' : 's'}`} o={l.dias <= 2 ? 'er' : 'wa'} />
              {l.oferta && <Chip t={`Oferta ${l.oferta === 'Pendiente' ? 'propuesta' : l.oferta.toLowerCase()}`} o={l.oferta === 'Activa' ? 'ok' : 'g'} />}
            </div>
            <div className="tw:text-tx2">Quedan {l.cant} {l.unidad} · vence {fFecha(l.vence)}</div>
            <div className="tw:flex tw:flex-wrap tw:gap-1.5">{l.productos.map((p) => <Chip key={p} t={p} o="g" sinSimbolo />)}</div>
          </Card>
        )) : <Vacio ic="check">Todo en orden</Vacio>}
      </Stack>
    );
  }

  return datos.stockBajo.length ? (
    <Stack>
      {datos.stockBajo.map((x) => {
        const critico = x.stock < x.minimo / 2;
        return (
          <Card key={x.id} className={`tw:flex tw:flex-col tw:gap-2 tw:border-l-4 ${critico ? 'tw:border-l-er' : 'tw:border-l-[#E0A42E]'}`}>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2"><b>{x.nombre}</b><Chip t={critico ? 'Crítico' : 'Bajo'} o={critico ? 'er' : 'wa'} /></div>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-3"><span>{x.stock.toFixed(1)} de {x.minimo.toFixed(1)} {x.unidad}</span><div className="tw:flex-1"><Nivel v={x.stock} min={x.minimo} /></div></div>
            <Mut>Usada en {x.usos} producto{x.usos === 1 ? '' : 's'}</Mut>
            <div className="tw:flex tw:justify-end"><Btn v="p" onClick={() => navigate('/bodega/compras', { state: { mp: x.id } })}>Crear solicitud de compra</Btn></div>
          </Card>
        );
      })}
    </Stack>
  ) : <Vacio ic="check">Todo en orden</Vacio>;
}
