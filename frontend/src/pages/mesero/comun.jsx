import { useState } from 'react';
import { Modal, Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { imprimirTicket } from '../../lib/ticket.js';
import { ETAPAS, nom, donde, txt, demora, margen } from '../../lib/pedidos.js';
import { useSesion, useAhora } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Etapas, Err, Mut, Panel } from '../../components/ui.jsx';
import { TicketPedido, Espera } from '../../components/Pedido.jsx';

/** Elegir el platillo y escribir la razón (reposición o devolución de dinero). */
export function HojaSolicitud({ show, onHide, titulo, pedido, bloqueadas = {}, verbo, nota, onEnviar }) {
  const [linea, setLinea] = useState('');
  const [razon, setRazon] = useState('');
  const ok = linea !== '' && razon.trim().length >= 10;
  const cerrar = () => { setLinea(''); setRazon(''); onHide(); };
  return (
    <Modal show={show} onHide={cerrar} centered>
      <Modal.Body>
        <h3>{titulo}</h3>
        {nota && <Mut>{nota}</Mut>}
        <Form.Select value={linea} onChange={(e) => setLinea(e.target.value)} aria-label="Platillo">
          <option value="">Elige el platillo</option>
          {pedido?.lineas.map((l) => (
            <option key={l.orden} value={l.orden} disabled={!!bloqueadas[l.orden]}>{txt(l)}{bloqueadas[l.orden] ? ` — ${bloqueadas[l.orden]}` : ''}</option>
          ))}
        </Form.Select>
        <Form.Control as="textarea" rows={3} placeholder="Razón (mín. 10 caracteres)" value={razon} onChange={(e) => setRazon(e.target.value)} />
        <div className="tw:flex tw:justify-end tw:gap-2">
          <Btn v="t" onClick={cerrar}>Cancelar</Btn>
          <Btn v="p" disabled={!ok} onClick={async () => { if (await onEnviar(+linea, razon.trim())) cerrar(); }}>{verbo}</Btn>
        </div>
      </Modal.Body>
    </Modal>
  );
}

/** Líneas que ya tienen una solicitud de cierto tipo (no se puede pedir otra encima). */
export function bloqueos(solicitudes, pedidoId, tipos) {
  const out = {};
  for (const s of solicitudes || []) {
    if (s.pedido === pedidoId && tipos.includes(s.tipo) && s.estado !== 'Rechazada' && s.linea != null) {
      out[s.linea] = s.tipo === 'Devolución' ? 'Ya tiene una devolución' : 'Ya tiene una reposición';
    }
  }
  return out;
}

/** Cancelar por demora: superó el tiempo estimado más el margen. */
export function useCancelarDemora() {
  const { config } = useSesion();
  const { confirmar, accion } = useDialogos();
  return async (p, alTerminar) => {
    const ok = await confirmar({
      titulo: '¿Cancelar el pedido por demora?',
      texto: `Superó el tiempo estimado más ${margen(config) / 60} min de margen. ${p.consumido ? 'Los insumos ya se usaron y se registrarán como pérdida.' : 'No se cobrará.'}`,
      verbo: 'Cancelar pedido', rojo: true,
    });
    if (ok && await accion(() => api.post(`/mesero/pedidos/${p.id}/cancelar-demora`), 'Pedido cancelado por demora')) alTerminar?.();
  };
}

/** Detalle de un pedido con sus acciones según el estado. */
export function DetallePedido({ p, solicitudes, onHide }) {
  const { config, usuario } = useSesion();
  const { motivo, accion } = useDialogos();
  const ahora = useAhora();
  const cancelarDemora = useCancelarDemora();
  const [hoja, setHoja] = useState(false);
  if (!p) return <Panel show={false} onHide={onHide} />;
  const pendCanc = (solicitudes || []).some((x) => x.pedido === p.id && x.tipo === 'Cancelación' && !['Rechazada', 'Autorizada'].includes(x.estado));
  const i = ETAPAS.indexOf(p.estado);
  const pie = [];
  if (['Creado', 'Aceptado', 'Asignado'].includes(p.estado)) {
    pie.push(<Btn key="c" onClick={async () => {
      const m = await motivo({ titulo: 'Motivo de la cancelación' });
      if (m && await accion(() => api.post(`/mesero/pedidos/${p.id}/cancelar`, { motivo: m }), 'Pedido cancelado')) onHide();
    }}>Cancelar pedido</Btn>);
  }
  if (['Preparando', 'Listo'].includes(p.estado) && !pendCanc) {
    pie.push(<Btn key="sc" onClick={async () => {
      const m = await motivo({ titulo: 'Motivo de la cancelación (la decide el jefe de cocina)' });
      if (m && await accion(() => api.post(`/mesero/pedidos/${p.id}/solicitudes`, { tipo: 'Cancelación', motivo: m }), 'Cancelación enviada al jefe de cocina')) onHide();
    }}>Solicitar cancelación</Btn>);
  }
  if (['Entregado', 'Cobrado'].includes(p.estado) && !p.rep) pie.push(<Btn key="r" onClick={() => setHoja(true)}>Solicitar reposición</Btn>);
  if (demora(p, ahora, config)) pie.push(<Btn key="d" v="red" onClick={() => cancelarDemora(p, onHide)}>Cancelar por demora</Btn>);
  if (['Entregado', 'Cobrado'].includes(p.estado)) pie.push(<Btn key="t" v="t" onClick={() => imprimirTicket(p, null, usuario.sucursalNombre, config?.iva)}>Imprimir ticket</Btn>);

  return (
    <>
      <Panel show onHide={onHide} titulo={`${nom(p)} · ${donde(p)}`} estado={p.estado} pie={pie.length ? pie : null}>
        {!['Cancelado', 'Rechazado'].includes(p.estado) && <Etapas l={ETAPAS} a={i < 0 ? 5 : i} />}
        <TicketPedido p={p} />
        <Espera p={p} />
        {p.estado === 'Cancelado' && p.motivo && <Err>Cancelado: {p.motivo}</Err>}
        {p.rechazo && <Err>Rechazado por cocina: {p.rechazo.motivo}</Err>}
      </Panel>
      <HojaSolicitud show={hoja} onHide={() => setHoja(false)} titulo="Solicitar reposición" verbo="Enviar a cocina" pedido={p}
        bloqueadas={bloqueos(solicitudes, p.id, ['Devolución', 'Reposición'])}
        onEnviar={async (linea, m) => {
          const ok = await accion(() => api.post(`/mesero/pedidos/${p.id}/solicitudes`, { tipo: 'Reposición', linea, motivo: m }), 'Reposición enviada a cocina');
          if (ok) onHide();
          return ok;
        }} />
    </>
  );
}
