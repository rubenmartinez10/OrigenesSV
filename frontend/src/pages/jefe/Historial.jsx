import { useState } from 'react';
import { Form } from 'react-bootstrap';
import { fmt, periodo } from '../../lib/formato.js';
import { nom, donde, punt } from '../../lib/pedidos.js';
import { useDatos, useSesion, useAhora } from '../../context/Sesion.jsx';
import { Card, Cargando, Chip, Fila, Mut, Panel, Pildoras, Stat, Stats, Stack, Vacio } from '../../components/ui.jsx';
import { PanelPedido } from '../cocinero/Historial.jsx';

/* ---------- pedidos atendidos por la cocina ---------- */
const filtros = { per: 'Hoy', coc: '' };
function Pedidos() {
  const { config } = useSesion();
  const ahora = useAhora(60_000);
  const [per, setPer] = useState(filtros.per);
  const [coc, setCoc] = useState(filtros.coc);
  const [ver, setVer] = useState(null);
  const [desde, hasta] = periodo(per, ahora);
  const { datos } = useDatos(`/jefe/historial?desde=${Math.floor(desde / 60000) * 60000}&hasta=${hasta}`);
  const { datos: cat } = useDatos('/catalogo');
  if (!datos) return <Cargando />;
  const fe = (p) => p.fin || p.rechazo?.fecha || p.creado;
  const L = datos.pedidos.filter((p) => !coc || (coc === '__r' ? p.estado === 'Rechazado' : p.cocinero === +coc));
  const hechos = L.filter((p) => p.fin);
  const ok = hechos.filter((p) => punt(p, ahora, config)[1] === 'ok').length;
  return (
    <Stack>
      <Mut>Solo lectura</Mut>
      <Pildoras opciones={['Hoy', 'Ayer', '7 días', 'Todos']} valor={per} onChange={(k) => { filtros.per = k; setPer(k); }} />
      <Form.Select value={coc} onChange={(e) => { filtros.coc = e.target.value; setCoc(e.target.value); }} className="tw:max-w-[280px]" aria-label="Filtrar por cocinero">
        <option value="">Todos los cocineros</option>
        {datos.cocineros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        <option value="__r">Pedidos que rechacé</option>
      </Form.Select>
      <Stats>
        <Stat l="Pedidos" v={L.length} ic="list" tono="in" />
        <Stat l="Terminados a tiempo" v={hechos.length ? `${ok} de ${hechos.length}` : '—'} ic="check" tono="ok" />
      </Stats>
      {L.length ? L.map((p) => {
        const pt = p.fin ? punt(p, ahora, config) : null;
        const t = ['Rechazado', 'Cancelado'].includes(p.estado) ? 'er' : pt?.[1] || 'ok';
        return (
          <Fila key={p.id} ico={t === 'er' ? 'x' : t === 'wa' ? 'clock' : 'check'} tono={t} t={`${nom(p)} · ${donde(p)}`}
            chips={<><Chip t={p.estado} />{p.rep && <Chip t="Reposición" o="wa" />}{pt && <Chip t={pt[0]} o={pt[1]} />}</>}
            s={`${fmt(fe(p))}${p.cocineroNombre ? ` · Cocinero: ${p.cocineroNombre}` : ''}`}
            m={p.rechazo ? `Motivo del rechazo: ${p.rechazo.motivo}` : p.lineas.map((l) => `${l.cant}× ${l.nombre}`).join(', ')} onClick={() => setVer(p)} />
        );
      }) : <Vacio ic="clock">Sin pedidos atendidos en este periodo</Vacio>}
      {ver && <PanelPedido p={ver} cat={cat} onHide={() => setVer(null)} />}
    </Stack>
  );
}

/* ---------- propuestas decididas por el jefe ---------- */
let hd = 'Todas';
function Decisiones() {
  const { datos } = useDatos('/propuestas/decididas');
  const [f, setF] = useState(hd);
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const L = datos.filter((x) => f === 'Todas' || x.jefeDec.res === (f === 'Aceptadas' ? 'Aceptada' : 'Rechazada'));
  return (
    <Stack>
      <Mut>Solo lectura</Mut>
      <Pildoras opciones={['Todas', 'Aceptadas', 'Rechazadas']} valor={f} onChange={(k) => { hd = k; setF(k); }} />
      {L.length ? L.map((x) => {
        const a = x.jefeDec.res === 'Aceptada';
        const det = `${x.deJefe ? 'Propuesta propia' : `Cocinero: ${x.solicitanteNombre}`} · decidida ${fmt(x.jefeDec.fecha)}`;
        const mo = a ? (x.motivo && !x.deJefe ? `Motivo de la propuesta: ${x.motivo}` : '') : `Motivo: ${x.jefeDec.motivo}`;
        return (
          <Fila key={x.id} ico={a ? 'check' : 'x'} tono={a ? 'ok' : 'er'} t={x.nombre} chips={<><Chip t={x.tipo} o="in" /><Chip t={x.jefeDec.res} o={a ? 'ok' : 'er'} /></>}
            s={det} m={mo} onClick={mo.length > 60 ? () => setVer({ x, det, mo }) : undefined} />
        );
      }) : <Vacio ic="list">Aún no has decidido propuestas</Vacio>}
      {ver && (
        <Panel show onHide={() => setVer(null)} titulo={ver.x.nombre}>
          <div className="tw:text-tx2">{ver.det}</div>
          <Card>{ver.mo || 'Aceptada'}</Card>
        </Panel>
      )}
    </Stack>
  );
}

export default function Historial({ tab }) {
  return tab === 'decisiones' ? <Decisiones /> : <Pedidos />;
}
