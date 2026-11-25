import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { $, fm, fmt, periodo } from '../../lib/formato.js';
import { nom, donde, txt, seg, est, punt } from '../../lib/pedidos.js';
import { useDatos, useSesion, useAhora } from '../../context/Sesion.jsx';
import { Btn, Card, Cargando, Chip, Err, Etapas, Fila, Mut, Panel, Pildoras, Stat, Stats, Stack, Vacio } from '../../components/ui.jsx';
import { TicketPedido, TiempoPedido } from '../../components/Pedido.jsx';
import { formularios, productoVacio } from './Proponer.jsx';
import { extraDesde } from '../../components/Selectores.jsx';

/* ---------- lo que este cocinero ha preparado ---------- */
let hc = '7 días';
export function PanelPedido({ p, cat, onHide }) {
  return (
    <Panel show onHide={onHide} titulo={`${nom(p)} · ${donde(p)}`} estado={p.estado} ro>
      <TicketPedido p={p} catalogo={cat} receta />
      <TiempoPedido p={p} />
      {p.estado === 'Cancelado' && p.motivo && <Err>{p.motivo}</Err>}
      {p.rechazo && <Err>Rechazado: {p.rechazo.motivo}</Err>}
    </Panel>
  );
}

function Pedidos() {
  const { config } = useSesion();
  const ahora = useAhora(60_000);
  const [per, setPer] = useState(hc);
  const [ver, setVer] = useState(null);
  const [desde, hasta] = periodo(per, ahora);
  const { datos } = useDatos(`/cocinero/historial?desde=${Math.floor(desde / 60000) * 60000}&hasta=${hasta}`);
  const { datos: cat } = useDatos('/catalogo');
  if (!datos) return <Cargando />;
  const hechos = datos.filter((p) => p.fin);
  const ok = hechos.filter((p) => punt(p, ahora, config)[1] === 'ok').length;
  return (
    <Stack>
      <Mut>Solo lectura · lo que tú has preparado</Mut>
      <Pildoras opciones={['Hoy', 'Ayer', '7 días', 'Todos']} valor={per} onChange={(k) => { hc = k; setPer(k); }} />
      <Stats>
        <Stat l="Pedidos preparados" v={hechos.length} ic="list" tono="in" />
        <Stat l="Terminados a tiempo" v={hechos.length ? `${ok} de ${hechos.length}` : '—'} ic="check" tono="ok" />
      </Stats>
      {datos.length ? datos.map((p) => {
        const pt = p.fin ? punt(p, ahora, config) : null;
        const t = p.estado === 'Cancelado' ? 'er' : pt?.[1] || 'ok';
        return (
          <Fila key={p.id} ico={t === 'er' ? 'x' : t === 'wa' ? 'clock' : 'check'} tono={t} t={`${nom(p)} · ${donde(p)}`}
            chips={<><Chip t={p.estado} />{p.rep && <Chip t="Reposición" o="wa" />}{pt && <Chip t={pt[0]} o={pt[1]} />}</>}
            s={`${fmt(p.fin || p.creado)} · ${p.lineas.map(txt).join(', ')}`}
            m={p.estado === 'Cancelado' && p.motivo ? p.motivo : `Tiempo real ${fm(seg(p, ahora))} / estimado ${fm(est(p))}`}
            onClick={() => setVer(p)} />
        );
      }) : <Vacio ic="clock">Aún no hay pedidos en este periodo</Vacio>}
      {ver && <PanelPedido p={ver} cat={cat} onHide={() => setVer(null)} />}
    </Stack>
  );
}

/* ---------- mis propuestas ---------- */
const ET = ['Jefe de cocina', 'Gerente de sucursal', 'Gerente general', 'Director', 'Catálogo'];
const IX = { Propuesto: 0, 'Aprobado por jefe de cocina': 1, 'Aprobado por gerente de sucursal': 2, 'Aprobado por gerente general': 3, 'Aprobado por director': 4, 'En catálogo': 5 };
const FIN = ['En catálogo', 'Aplicada', 'Creada'];
const tono = (e) => (/^Rechaz/.test(e) ? 'er' : FIN.includes(e) ? 'ok' : /^Aprob/.test(e) ? 'in' : 'wa');

export function DetallePropuesta({ x, cat, pie, onHide }) {
  const d = x.datos || {};
  const M = Object.fromEntries((cat?.materias || []).map((m) => [m.id, m]));
  const P = Object.fromEntries((cat?.productos || []).map((p) => [p.id, p]));
  const mn = (mp) => (String(mp).startsWith('new:') ? `${String(mp).slice(4)} (nueva)` : M[mp]?.nombre || mp);
  const r = x.rechazo;
  const ix = IX[x.estado] ?? 0;
  const rech = r ? (ET.indexOf(r.etapa) < 0 ? undefined : ET.indexOf(r.etapa)) : undefined;
  return (
    <Panel show onHide={onHide} titulo={`${x.tipo} · ${x.nombre}`} estado={x.estado} pie={pie}>
      {x.estado !== 'Borrador' && <Etapas l={ET} a={ix} rech={rech} />}
      {r && <Err>Rechazado por {r.por}{r.etapa ? ` en la etapa ${r.etapa}` : ''}: {r.motivo}</Err>}
      <Card className="tw:flex tw:flex-col tw:gap-1">
        {x.tipo === 'Producto nuevo' && <>
          <div>Categorías: {(d.cats || []).join(', ') || '—'}</div>
          <div>Tiempo: {d.tiempo} min</div>
          {d.desc && <div className="tw:text-tx2">{d.desc}</div>}
          {(d.ings || []).map((i) => <div key={i.mp}>{mn(i.mp)} {i.cant}</div>)}
        </>}
        {x.tipo === 'Extra nuevo' && <>
          <div>Precio {$(d.precio)} · +{d.tiempo} min</div>
          <div>Aparece en: {(d.prods || []).map((i) => P[i]?.nombre).join(', ') || '—'}</div>
          <div className="tw:text-tx2">Ingredientes: {(d.ings || []).map((i) => `${mn(i.mp)} ${i.cant}`).join(', ')}</div>
        </>}
        {x.tipo === 'Categoría nueva' && <>
          <div>Categoría: {x.nombre}</div>
          <div className="tw:text-tx2">Motivo: {x.motivo}</div>
        </>}
      </Card>
    </Panel>
  );
}

function Propuestas() {
  const navigate = useNavigate();
  const { datos } = useDatos('/propuestas/mias');
  const { datos: cat } = useDatos('/catalogo');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  if (!datos.length) {
    return <Stack><Vacio ic="file">Aún no has hecho propuestas</Vacio><div><Btn v="p" onClick={() => navigate('/cocinero/proponer')}>Proponer producto</Btn></div></Stack>;
  }
  const pie = (x) => {
    const d = x.datos || {};
    if (x.estado === 'Rechazado') {
      return <Btn v="p" onClick={() => {
        if (x.tipo === 'Producto nuevo') { formularios.producto = { ...productoVacio(), ...d, ings: (d.ings || []).map((i) => ({ mp: i.mp, cant: String(i.cant) })), tiempo: String(d.tiempo || ''), id: null }; navigate('/cocinero/proponer/producto'); }
        else if (x.tipo === 'Extra nuevo') { formularios.extra = extraDesde(d); navigate('/cocinero/proponer/extra'); }
        else { formularios.categoria = { nombre: x.nombre, motivo: x.motivo }; navigate('/cocinero/proponer/categoria'); }
      }}>Corregir y reenviar</Btn>;
    }
    if (x.estado === 'Borrador') {
      return <Btn v="p" onClick={() => {
        formularios.producto = { ...productoVacio(), ...d, ings: (d.ings || []).length ? d.ings.map((i) => ({ mp: i.mp, cant: String(i.cant) })) : [{ mp: '', cant: '' }], tiempo: String(d.tiempo || ''), id: x.id };
        navigate('/cocinero/proponer/producto');
      }}>Continuar editando</Btn>;
    }
    return null;
  };
  return (
    <Stack>
      {datos.map((x) => {
        const t = tono(x.estado);
        return <Fila key={x.id} ico={t === 'ok' ? 'check' : t === 'er' ? 'x' : 'file'} tono={t} t={x.nombre} chips={<Chip t={x.estado} o={t} />} s={x.tipo} m={fmt(x.fecha)} onClick={() => setVer(x)} />;
      })}
      {ver && <DetallePropuesta x={ver} cat={cat} pie={pie(ver)} onHide={() => setVer(null)} />}
    </Stack>
  );
}

export default function Historial({ tab }) {
  return tab === 'propuestas' ? <Propuestas /> : <Pedidos />;
}
