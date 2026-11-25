import { useState } from 'react';
import { api } from '../../lib/api.js';
import { $, fmt, periodo } from '../../lib/formato.js';
import { nom, donde, resumen, corr } from '../../lib/pedidos.js';
import { imprimirTicket } from '../../lib/ticket.js';
import { useDatos, useSesion, useAhora } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Card, Cargando, Chip, Err, Etapas, Fila, Panel, Pildoras, Stat, Stats, Stack, Vacio } from '../../components/ui.jsx';
import { Documento } from '../../components/Pedido.jsx';
import { DetallePedido, HojaSolicitud, bloqueos } from './comun.jsx';

const ESTADOS = {
  Todos: () => true,
  'En curso': (p) => ['Creado', 'Aceptado', 'Asignado', 'Preparando', 'Listo'].includes(p.estado),
  Entregados: (p) => ['Entregado', 'Cobrado'].includes(p.estado),
  Cancelados: (p) => p.estado === 'Cancelado',
  Rechazados: (p) => p.estado === 'Rechazado',
};
const tonoSol = (e) => (/^Aprob|Autoriz|Acept/.test(e) ? 'ok' : /Rechaz/.test(e) ? 'er' : 'wa');

/* ---------- pedidos hechos ---------- */
let hp = 'Hoy';
let he = 'Todos';
function Pedidos() {
  const ahora = useAhora(60_000);
  const [per, setPer] = useState(hp);
  const [est, setEst] = useState(he);
  const [ver, setVer] = useState(null);
  const [desde, hasta] = periodo(per, ahora);
  const { datos } = useDatos(`/mesero/pedidos?desde=${Math.floor(desde / 60000) * 60000}&hasta=${hasta}`);
  const { datos: sols } = useDatos('/mesero/solicitudes');
  if (!datos) return <Cargando />;
  const ps = datos.filter(ESTADOS[est]);
  const tv = ps.filter((p) => ['Entregado', 'Cobrado'].includes(p.estado) && !p.rep).reduce((a, p) => a + p.total, 0);
  const actual = ver && datos.find((p) => p.id === ver);
  return (
    <Stack>
      <Pildoras opciones={['Hoy', 'Ayer', '7 días', 'Todos']} valor={per} onChange={(k) => { hp = k; setPer(k); }} />
      <Pildoras opciones={Object.keys(ESTADOS)} valor={est} onChange={(k) => { he = k; setEst(k); }} />
      <Stats><Stat l="Pedidos" v={ps.length} ic="list" tono="in" /><Stat l="Entregados o cobrados" v={$(tv)} ic="dollar" tono="ok" /></Stats>
      {ps.length ? ps.map((p) => {
        const tn = ['Entregado', 'Cobrado'].includes(p.estado) ? 'ok' : ['Cancelado', 'Rechazado'].includes(p.estado) ? 'er' : 'wa';
        return (
          <Fila key={p.id} ico={tn === 'ok' ? 'check' : tn === 'er' ? 'x' : 'clock'} tono={tn} t={`${nom(p)} · ${donde(p)}`}
            chips={<><Chip t={p.estado} o={tn} />{p.rep && <Chip t="Reposición" o="wa" />}</>} s={fmt(p.creado)}
            m={p.rechazo ? `Motivo: ${p.rechazo.motivo}` : p.estado === 'Cancelado' && p.motivo ? p.motivo : resumen(p)} der={$(p.total)} onClick={() => setVer(p.id)} />
        );
      }) : <Vacio ic="receipt">No hiciste pedidos en este periodo</Vacio>}
      {actual && <DetallePedido p={actual} solicitudes={sols} onHide={() => setVer(null)} />}
    </Stack>
  );
}

/* ---------- ventas ---------- */
let rg = 'turno';
function Ventas() {
  const { config, usuario } = useSesion();
  const { accion } = useDialogos();
  const [rango, setRango] = useState(rg);
  const [ver, setVer] = useState(null);
  const [hoja, setHoja] = useState(false);
  const { datos } = useDatos(`/mesero/ventas?rango=${rango}`);
  const { datos: sols } = useDatos('/mesero/solicitudes');
  if (!datos) return <Cargando />;
  const tv = datos.reduce((a, v) => a + v.total, 0);
  const td = datos.reduce((a, v) => a + v.devuelto, 0);
  const v = ver && datos.find((x) => x.id === ver);
  const devDe = (id) => (sols || []).filter((x) => x.tipo === 'Devolución' && x.venta === id);
  return (
    <Stack>
      <Pildoras opciones={[['turno', 'Mi turno'], ['ayer', 'Ayer'], ['7d', '7 días']]} valor={rango} onChange={(k) => { rg = k; setRango(k); }} />
      <Stats>
        <Stat l="Ventas" v={$(tv)} ic="bag" tono="ok" />
        <Stat l="Devoluciones" v={$(td)} ic="receipt" tono="er" />
        <Stat l="Venta neta" v={$(tv - td)} ic="chart" tono="in" />
      </Stats>
      {datos.length ? datos.map((x) => {
        const so = devDe(x.id)[0];
        return <Fila key={x.id} ico="receipt" tono={so ? 'wa' : 'ok'} t={`Ticket #${x.num}`} chips={so && <Chip t={so.estado} o={tonoSol(so.estado)} />}
          s={fmt(x.fecha)} m={`${corr(x)} · ${x.metodo}`} der={$(x.total)} onClick={() => setVer(x.id)} />;
      }) : <Vacio ic="receipt">No hay ventas en este periodo</Vacio>}
      {v && (
        <Panel show onHide={() => setVer(null)} titulo={`Venta #${v.num}`}
          pie={[<Btn key="t" v="t" onClick={() => imprimirTicket(v.ped, v, usuario.sucursalNombre, config?.iva)}>Imprimir ticket</Btn>,
            <Btn key="d" onClick={() => setHoja(true)}>Solicitar devolución de dinero</Btn>]}>
          <Documento v={v} iva={config?.iva} />
          {devDe(v.id).map((s) => (
            <Card key={s.id} className="tw:flex tw:flex-col tw:gap-1">
              <div><Chip t={s.estado} o={tonoSol(s.estado)} /></div>
              <div>{s.motivo}</div>
              {s.estado === 'Rechazada' && s.rechazo && <Err>{s.rechazo.motivo}</Err>}
            </Card>
          ))}
        </Panel>
      )}
      {v && (
        <HojaSolicitud show={hoja} onHide={() => setHoja(false)} titulo="Devolución de dinero" verbo="Enviar al jefe de cocina" pedido={v.ped}
          nota="El jefe de cocina decide si devuelve el 50 % o el 100 %" bloqueadas={bloqueos(sols, v.pedido, ['Reposición', 'Devolución'])}
          onEnviar={async (linea, m) => {
            const ok = await accion(() => api.post(`/mesero/pedidos/${v.pedido}/solicitudes`, { tipo: 'Devolución', linea, motivo: m }), 'Devolución enviada al jefe de cocina');
            if (ok) setVer(null);
            return ok;
          }} />
      )}
    </Stack>
  );
}

/* ---------- solicitudes al jefe de cocina ---------- */
function Solicitudes() {
  const { datos } = useDatos('/mesero/solicitudes');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const x = ver && datos.find((s) => s.id === ver);
  const etapas = (s) => (s.tipo === 'Cancelación' ? ['Solicitada', 'Autorizada'] : s.tipo === 'Devolución' ? ['Solicitada', 'Aprobada'] : ['Solicitada', 'Aceptada']);
  const idx = (s) => { const et = etapas(s); const i = Math.max(0, et.indexOf(/^Aprobada/.test(s.estado) ? 'Aprobada' : s.estado)); return i + (i === et.length - 1 ? 1 : 0); };
  return (
    <Stack>
      {datos.length ? datos.map((s) => (
        <Fila key={s.id} ico={s.tipo === 'Devolución' ? 'dollar' : s.tipo === 'Cancelación' ? 'x' : 'sync'} tono={tonoSol(s.estado)} t={`${s.tipo} · #${s.num}`}
          chips={<Chip t={s.estado} o={tonoSol(s.estado)} />} s={s.motivo} onClick={() => setVer(s.id)} />
      )) : <Vacio ic="list">Aún no has hecho solicitudes</Vacio>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={`${x.tipo} · #${x.num}`}>
          <div><Chip t={x.estado} o={tonoSol(x.estado)} /></div>
          {x.motivo && <Card><small className="tw:text-tx2">Motivo</small><div>{x.motivo}</div></Card>}
          <Etapas l={etapas(x)} a={x.estado === 'Rechazada' ? 0 : idx(x)} rech={x.estado === 'Rechazada' ? 1 : undefined} />
          {x.estado === 'Rechazada' && x.rechazo && <Err>Rechazada por {x.rechazo.por}: {x.rechazo.motivo}</Err>}
          {x.monto != null && <div>Monto devuelto: <b>{$(x.monto)}</b></div>}
        </Panel>
      )}
    </Stack>
  );
}

export default function Historial({ tab }) {
  return tab === 'ventas' ? <Ventas /> : tab === 'solicitudes' ? <Solicitudes /> : <Pedidos />;
}
