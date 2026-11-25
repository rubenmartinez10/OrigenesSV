import { useState } from 'react';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { fmt } from '../../lib/formato.js';
import { nom, donde, txt, est, margen, minutos, punt } from '../../lib/pedidos.js';
import { useDatos, useSesion, useAhora } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Card, Cargando, Chip, Grid, Mut, Ban, Stack, Vacio } from '../../components/ui.jsx';
import { Espera } from '../../components/Pedido.jsx';
import { PanelPedido } from '../cocinero/Historial.jsx';

/** Tarjeta de pedido para el jefe de cocina. */
export function TarjetaCocina({ p, cocina, onVer, children }) {
  const { config } = useSesion();
  const ahora = useAhora();
  const pt = punt(p, ahora, config);
  const borde = { ok: 'tw:border-l-ok', wa: 'tw:border-l-[#E0A42E]', er: 'tw:border-l-er' }[pt[1]];
  return (
    <Card className={`tw:flex tw:flex-col tw:gap-1.5 tw:border-l-4 ${borde}`}>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <b className="tw:text-[14.5px]">{nom(p)} · {donde(p)}</b>
        <Chip t={p.estado} />{p.rep && <Chip t="Reposición" o="wa" />}
        {cocina && pt[1] !== 'ok' && <Chip t={pt[0]} o={pt[1]} />}
      </div>
      {cocina
        ? <div className="tw:text-tx2">Cocinero: {p.cocineroNombre}{p.ini ? ` · inició ${fmt(p.ini)}` : ' · en cola, aún no inicia'}</div>
        : <div className="tw:text-tx2">Mesero: {p.meseroNombre} · {fmt(p.creado)} · Estimado {minutos(est(p))} min (+{minutos(margen(config))} de margen)</div>}
      {p.rep && <Mut>Sin cobro adicional · repone el pedido #{p.repNum}</Mut>}
      {p.lineas.map((l) => <div key={l.orden}>{txt(l)}</div>)}
      <Espera p={p} />
      <div className="tw:flex tw:flex-wrap tw:gap-2 tw:mt-2 tw:pt-2.5 tw:border-t tw:border-[#EAF0F9]">
        <Btn v="t" onClick={onVer}>Ver ticket</Btn>
        {children}
      </div>
    </Card>
  );
}

export default function ColaPedidos({ tab = 'nuevos' }) {
  const { motivo, accion, toast } = useDialogos();
  const { datos } = useDatos('/jefe/cola', { cada: 4000 });
  const { datos: cat } = useDatos('/catalogo');
  const [ver, setVer] = useState(null);
  const [asignar, setAsignar] = useState(null);
  const [cocinero, setCocinero] = useState('');
  if (!datos) return <Cargando />;
  const { pedidos, cocineros } = datos;
  const de = (e) => pedidos.filter((p) => p.estado === e).sort((a, b) => a.creado - b.creado);
  const libres = cocineros.filter((c) => !c.ocupado && !c.cola.length);

  const rechazar = async (p) => {
    const m = await motivo({ titulo: `Motivo por el que se rechaza el pedido #${p.num}` });
    if (m && await accion(() => api.post(`/jefe/pedidos/${p.id}/rechazar`, { motivo: m }))) toast('Pedido rechazado. El mesero verá el motivo');
  };
  const aceptar = (p) => accion(() => api.post(`/jefe/pedidos/${p.id}/aceptar`));
  const confirmarAsignacion = async () => {
    const p = asignar;
    setAsignar(null);
    await accion(() => api.post(`/jefe/pedidos/${p.id}/asignar`, { cocinero: Number(cocinero) }), `Pedido #${p.num} asignado`);
  };

  const tarjetas = (lista, acciones, cocina) => (
    <Grid min={300}>
      {lista.map((p) => <TarjetaCocina key={p.id} p={p} cocina={cocina} onVer={() => setVer(p)}>{acciones?.(p)}</TarjetaCocina>)}
    </Grid>
  );

  let cuerpo;
  if (tab === 'nuevos') {
    const l = de('Creado');
    cuerpo = l.length ? tarjetas(l, (p) => <><Btn onClick={() => rechazar(p)}>Rechazar</Btn><Btn v="p" onClick={() => aceptar(p)}>Aceptar</Btn></>) : <Vacio ic="check">No hay pedidos nuevos</Vacio>;
  } else if (tab === 'aceptados') {
    const l = de('Aceptado');
    cuerpo = (
      <Stack>
        {!cocineros.length && l.length > 0 && <Ban>No hay cocineros en turno en esta sucursal</Ban>}
        {l.length ? tarjetas(l, (p) => <><Btn onClick={() => rechazar(p)}>Rechazar</Btn><Btn v="p" disabled={!cocineros.length} onClick={() => { setCocinero(''); setAsignar(p); }}>Asignar a cocinero</Btn></>)
          : <Vacio ic="check">No hay pedidos por asignar</Vacio>}
      </Stack>
    );
  } else if (tab === 'prep') {
    const l = de('Preparando');
    cuerpo = (
      <Stack>
        <Mut>El tiempo corre desde que se hizo el pedido (incluye la espera y la preparación), con margen extra.</Mut>
        {l.length ? tarjetas(l, null, true) : <Vacio ic="users">Nada en preparación</Vacio>}
      </Stack>
    );
  } else {
    const l = de('Asignado');
    cuerpo = l.length ? tarjetas(l, null, true) : <Vacio ic="check">No hay pedidos en cola de los cocineros</Vacio>;
  }

  return (
    <Stack>
      <div className="osv-strip tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1.5 tw:px-5 tw:py-3.5 tw:rounded-[20px] tw:border tw:border-bd">
        <span>Cocineros libres <b>{libres.length} de {cocineros.length}</b></span>
        <small className="tw:text-tx2">{libres.map((c) => c.nombre).join(', ') || 'Todos ocupados'}</small>
      </div>
      {cuerpo}
      {ver && <PanelPedido p={ver} cat={cat} onHide={() => setVer(null)} />}
      <Modal show={!!asignar} onHide={() => setAsignar(null)} centered>
        {asignar && (
          <Modal.Body>
            <h3>Asignar pedido #{asignar.num}</h3>
            <Mut>Puedes asignarlo a cualquier cocinero en turno, aunque esté ocupado: queda en su cola.</Mut>
            <Form.Select value={cocinero} onChange={(e) => setCocinero(e.target.value)} aria-label="Cocinero">
              <option value="">Elige un cocinero</option>
              {cocineros.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre} · {c.ocupado ? `Preparando #${c.ocupado.num}` : 'Libre'}{c.cola.length ? ` · ${c.cola.length} en cola` : ''}</option>
              ))}
            </Form.Select>
            <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={() => setAsignar(null)}>Cancelar</Btn><Btn v="p" disabled={!cocinero} onClick={confirmarAsignacion}>Asignar</Btn></div>
          </Modal.Body>
        )}
      </Modal>
    </Stack>
  );
}
