import { Dropdown } from 'react-bootstrap';
import { forwardRef } from 'react';
import { useSesion, useAhora } from '../context/Sesion.jsx';
import { useDialogos } from '../context/Dialogos.jsx';
import { api } from '../lib/api.js';
import { fmt } from '../lib/formato.js';
import { Icono } from './Icono.jsx';

const PASOS = [['hora', '+1 hora'], ['dia', '+1 día'], ['semana', '+7 días'], ['mes', '+30 días']];

const Boton = forwardRef(({ onClick, claro, texto }, ref) => (
  <button ref={ref} type="button" onClick={onClick} aria-label={`Reloj simulado: ${texto}. Adelantar el tiempo`}
    className={`tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:px-3.5 tw:py-1.5 tw:text-[12.5px] tw:font-bold tw:whitespace-nowrap ${claro
      ? 'tw:bg-white tw:border-[1.5px] tw:border-line tw:text-tx2'
      : 'tw:bg-white/15 tw:border-[1.5px] tw:border-white/65 tw:text-white'}`}>
    <Icono n="clock" size={16} />{texto}
  </button>
));

/** Reloj simulado: se puede adelantar (+1 hora, +1 día, +7 días, +30 días); el servidor corre los procesos. */
export function RelojChip({ claro }) {
  const { sincronizar, recargar } = useSesion();
  const { toast, accion } = useDialogos();
  const ahora = useAhora(15_000);
  const adelantar = (paso) => accion(async () => {
    const r = await api.post('/reloj/adelantar', { paso });
    sincronizar(r.ahora);
    recargar();
    toast(`Se avanzó el tiempo a ${r.texto}`);
  });
  return (
    <Dropdown align="end">
      <Dropdown.Toggle as={Boton} claro={claro} texto={fmt(ahora)} />
      <Dropdown.Menu>
        <Dropdown.Header>Adelantar el reloj simulado</Dropdown.Header>
        {PASOS.map(([k, l]) => <Dropdown.Item key={k} onClick={() => adelantar(k)}>{l}</Dropdown.Item>)}
      </Dropdown.Menu>
    </Dropdown>
  );
}
