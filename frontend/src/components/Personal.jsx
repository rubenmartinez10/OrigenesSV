import { useState } from 'react';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../lib/api.js';
import { $, fFecha } from '../lib/formato.js';
import { useDialogos } from '../context/Dialogos.jsx';
import { Avatar, Btn, Campo, Kv, Mut, Panel } from './ui.jsx';

/**
 * Cambiar rol o despedir a alguien de nivel inferior.
 * El gerente confirma con su clave y motivo; el director, con motivo.
 */
export function AccionesPersonal({ p, base, conClave, salarios, onListo }) {
  const { motivo, clave, accion, toast } = useDialogos();
  const [cambio, setCambio] = useState(null);
  const [nuevaClave, setNuevaClave] = useState(null);
  const pedir = async (resumen, fn, ok) => {
    if (conClave) return clave({ resumen, pideMotivo: true, accion: fn, ok });
    const m = await motivo({ titulo: resumen });
    return m ? accion(() => fn({ motivo: m }), ok) : null;
  };
  const cambiar = async () => {
    const rol = cambio;
    setCambio(null);
    const r = await pedir(`Cambiar a ${p.nombre} de ${p.rolNombre} a ${p.rolesDestino.find((x) => x.id === rol).nombre}`,
      (k) => api.post(`${base}/${p.id}/rol`, { ...k, rol }), 'Rol actualizado');
    if (r) { if (r.clave) setNuevaClave(r.clave); else onListo?.(); }
  };
  const despedir = async () => {
    const r = await pedir(`Despedir a ${p.nombre}. Se aplica de inmediato con su indemnización y se avisa a Recursos Humanos y a gerencia general.`,
      (k) => api.post(`${base}/${p.id}/despedir`, k), 'Despido aplicado');
    if (r) onListo?.();
  };
  return (
    <>
      <Btn onClick={() => (p.rolesDestino.length ? setCambio(p.rolesDestino[0].id) : toast('No hay roles a tu alcance para esta persona'))}>Cambiar rol</Btn>
      <Btn v="red" onClick={despedir}>Despedir</Btn>
      <Modal show={!!cambio} onHide={() => setCambio(null)} centered>
        <Modal.Body>
          <h3>Cambiar el rol de {p.nombre}</h3>
          <p className="tw:text-tx2 tw:m-0">Rol actual: {p.rolNombre} · {$(p.salario)} al mes</p>
          <Campo l="Nuevo rol"><Form.Select value={cambio || ''} onChange={(e) => setCambio(e.target.value)}>
            {p.rolesDestino.map((r) => <option key={r.id} value={r.id}>{r.nombre} · {$(salarios?.[r.id] || 0)} al mes</option>)}
          </Form.Select></Campo>
          <Mut>El salario pasa al del nuevo rol; la antigüedad se conserva. Siempre debe quedar una persona por rol.</Mut>
          <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={() => setCambio(null)}>Cancelar</Btn><Btn v="p" onClick={cambiar}>Continuar</Btn></div>
        </Modal.Body>
      </Modal>
      <Modal show={!!nuevaClave} onHide={() => { setNuevaClave(null); onListo?.(); }} centered>
        <Modal.Body>
          <h3>Clave de aprobaciones</h3>
          <p className="tw:m-0">{p.nombre} ahora aprueba con clave. Su clave es <b className="tw:text-lg">{nuevaClave}</b>. Se muestra una sola vez.</p>
          <div className="tw:flex tw:justify-end"><Btn v="p" onClick={() => { setNuevaClave(null); onListo?.(); }}>Cerrar</Btn></div>
        </Modal.Body>
      </Modal>
    </>
  );
}

/** Ficha de una persona del equipo. */
export function FichaPersona({ p, pie, nota, onHide }) {
  return (
    <Panel show onHide={onHide} titulo={p.nombre} estado={p.despidoSolicitado ? 'Despido solicitado' : p.estado} ro={!pie} pie={pie}>
      <div className="tw:flex tw:items-center tw:gap-4"><Avatar u={p} size={88} /><b>{p.nombre}</b></div>
      <Kv pares={[
        ['Rol', p.rolNombre], ['Turno de hoy', p.sinTurno ? 'Sin turno asignado' : p.turno || '—'], ['Salario mensual', $(p.salario)],
        ['Salario base del rol', $(p.salarioRol)], ['Aumento por antigüedad', $(p.extraAnt || 0)], ['Ingreso', fFecha(p.ingreso)],
        ...(p.telefono ? [['Teléfono', p.telefono]] : []), ...(p.correo ? [['Correo', p.correo]] : []),
      ]} />
      {nota && <Mut>{nota}</Mut>}
    </Panel>
  );
}
