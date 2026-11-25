import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fmt } from '../../lib/formato.js';
import { donde } from '../../lib/pedidos.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Card, Cargando, Chip, CirculoIcono, Fila, Panel, Stat, Stats, Stack, Kv } from '../../components/ui.jsx';

export default function MiCaja() {
  const { confirmar, accion } = useDialogos();
  const navigate = useNavigate();
  const { datos } = useDatos('/mesero/caja', { cada: 8000 });
  const [fondo, setFondo] = useState('0');
  const [cierre, setCierre] = useState(null); // { pendientes } o { contado }
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const c = datos.abierta;

  const historial = datos.cierres.length > 0 && (
    <Stack>
      <h3 className="tw:text-[15px] tw:mt-1.5 tw:mb-0">Cierres anteriores</h3>
      {datos.cierres.map((x) => {
        const df = x.declarado - (x.esp?.Efectivo ?? 0);
        const tono = /^Aprob/.test(x.estado) ? 'ok' : /Rechaz|Observ/.test(x.estado) ? 'er' : 'wa';
        return (
          <Fila key={x.id} ico={tono === 'ok' ? 'check' : tono === 'er' ? 'x' : 'clock'} tono={tono} t={fmt(x.cerrada)} chips={<Chip t={x.estado} o={tono} />}
            s={`Efectivo declarado ${$(x.declarado)}`} m={x.comentario ? `Gerente: ${x.comentario}` : ''}
            der={<span className={df === 0 ? '' : df < 0 ? 'tw:text-er' : 'tw:text-ok'}>{df > 0 ? '+' : ''}{$(df)}</span>}
            onClick={x.comentario ? () => setVer(x) : undefined} />
        );
      })}
    </Stack>
  );

  if (!c) {
    return (
      <Stack>
        <Card className="tw:flex tw:flex-wrap tw:items-center tw:gap-4">
          <CirculoIcono ic="lock" tono="g" className="tw:w-[52px] tw:h-[52px] tw:rounded-2xl" />
          <div className="tw:flex-1 tw:min-w-40 tw:flex tw:flex-col tw:gap-1">
            <b>No tienes caja abierta</b><small className="tw:text-tx2">Abre tu turno con un fondo inicial para empezar a cobrar</small>
          </div>
          <div className="tw:flex tw:items-center tw:gap-2.5">
            <Form.Control inputMode="decimal" placeholder="Fondo inicial" value={fondo} onChange={(e) => setFondo(e.target.value)} className="tw:w-[130px]" aria-label="Fondo inicial" />
            <Btn v="p" onClick={() => accion(() => api.post('/mesero/caja/abrir', { fondo: Number(fondo) }), 'Caja abierta')}>Abrir caja</Btn>
          </div>
        </Card>
        {historial}
        {ver && <DetalleCierre x={ver} onHide={() => setVer(null)} />}
      </Stack>
    );
  }

  const terminar = async () => {
    const pend = await api.get('/mesero/pedidos?abiertos=1').catch(() => []);
    setCierre(pend.length ? { pendientes: pend } : { contado: '' });
  };
  const declarar = async () => {
    if (cierre.contado === '') return;
    const contado = cierre.contado;
    setCierre(null);
    if (!(await confirmar({ titulo: '¿Cerrar el turno?', texto: 'El cierre se envía al gerente de sucursal.', verbo: 'Cerrar' }))) return;
    accion(() => api.post('/mesero/caja/cerrar', { declarado: Number(contado) }), 'Turno cerrado: el cierre se envió al gerente');
  };

  return (
    <Stack>
      <Card className="tw:flex tw:flex-wrap tw:items-center tw:gap-4">
        <CirculoIcono ic="dollar" tono="ok" className="tw:w-[52px] tw:h-[52px] tw:rounded-2xl" />
        <div className="tw:flex-1 tw:min-w-40 tw:flex tw:flex-col tw:gap-1">
          <div className="tw:flex tw:items-center tw:gap-2"><b>Caja</b><Chip t="Abierta" o="ok" /></div>
          <small className="tw:text-tx2">{c.ventas} {c.ventas === 1 ? 'venta' : 'ventas'} en el turno</small>
        </div>
        <Btn v="p" onClick={terminar}>Terminar turno</Btn>
      </Card>
      <Stats>
        <Stat l="Fondo inicial" v={$(c.fondo)} ic="dollar" tono="in" />
        <Stat l="Efectivo esperado" v={$(c.totales.Efectivo)} ic="bag" tono="ok" />
        <Stat l="Tarjeta acumulada" v={$(c.totales.Tarjeta)} ic="receipt" tono="wa" />
        <Stat l="Bitcoin acumulado" v={$(c.totales.Bitcoin)} ic="chart" tono="in" />
      </Stats>
      {historial}

      <Modal show={!!cierre} onHide={() => setCierre(null)} centered>
        {cierre?.pendientes && (
          <Modal.Body>
            <h3>No puedes terminar el turno</h3>
            <p className="tw:text-tx2 tw:m-0">Tienes {cierre.pendientes.length} pedido{cierre.pendientes.length === 1 ? '' : 's'} sin terminar: cóbralos o cancélalos antes de cerrar la caja</p>
            {cierre.pendientes.map((p) => <div key={p.id}>#{p.num} · {donde(p)} · {p.estado}</div>)}
            <div className="tw:flex tw:justify-end"><Btn v="p" onClick={() => { setCierre(null); navigate('/mesero/cobro'); }}>Ir a Cobro</Btn></div>
          </Modal.Body>
        )}
        {cierre && !cierre.pendientes && (
          <Modal.Body>
            <h3>Cierre de turno</h3>
            <Kv pares={[['Efectivo esperado', $(c.totales.Efectivo)], ['Tarjeta esperada', $(c.totales.Tarjeta)], ['Bitcoin esperado', $(c.totales.Bitcoin)]]} />
            <Form.Control inputMode="decimal" placeholder="Efectivo contado" value={cierre.contado} onChange={(e) => setCierre({ contado: e.target.value })} autoFocus aria-label="Efectivo contado" />
            <b>Diferencia contra lo esperado: {cierre.contado === '' ? '—' : $(+cierre.contado - c.totales.Efectivo)}</b>
            <div className="tw:flex tw:justify-end tw:gap-2">
              <Btn v="t" onClick={() => setCierre(null)}>Volver</Btn>
              <Btn v="p" disabled={cierre.contado === ''} onClick={declarar}>Declarar y cerrar turno</Btn>
            </div>
          </Modal.Body>
        )}
      </Modal>
      {ver && <DetalleCierre x={ver} onHide={() => setVer(null)} />}
    </Stack>
  );
}

function DetalleCierre({ x, onHide }) {
  const df = x.declarado - (x.esp?.Efectivo ?? 0);
  return (
    <Panel show onHide={onHide} titulo={`Cierre del ${fmt(x.cerrada)}`}>
      <Stat l="Efectivo declarado" v={$(x.declarado)} ic="dollar" />
      <Stat l="Diferencia" v={$(df)} ic="receipt" tono={df === 0 ? 'ok' : 'er'} />
      <Card><small className="tw:text-tx2">Comentario del gerente</small><div>{x.comentario}</div></Card>
    </Panel>
  );
}
