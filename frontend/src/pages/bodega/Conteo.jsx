import { useState } from 'react';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { fmt, r2 } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Btn, Cargando, Chip, Err, Kv, Mut, Panel, Pildoras, Stack, Tabla, Vacio } from '../../components/ui.jsx';

/* Encargado de bodega · 4.5 Conteo físico (el gerente lo aprueba con su clave) */
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const tono = (e) => (e === 'Aprobado' ? 'ok' : e === 'Rechazado' ? 'er' : 'wa');

export function DetalleConteo({ k, pie, onHide, extra }) {
  return (
    <Panel show onHide={onHide} titulo={`Conteo · ${fmt(k.fecha)}`} estado={k.estado} ro={!pie} pie={pie}>
      <Kv pares={[['Contó', k.bodegaNombre], ['Motivo de las diferencias', k.motivo || 'Sin diferencias'], ...(extra || [])]} />
      {k.motivoDecision && <Err>Motivo del rechazo: {k.motivoDecision}</Err>}
      <Tabla cols={['Materia prima', 'Sistema', 'Contado', 'Diferencia']} filas={k.filas.map((f) => {
        const d = r2(f.contado - f.sistema);
        return [f.nombre, `${f.sistema} ${f.unidad}`, `${f.contado} ${f.unidad}`, <b className={d === 0 ? '' : d < 0 ? 'tw:text-er' : 'tw:text-ok'}>{d > 0 ? '+' : ''}{d}</b>];
      })} />
    </Panel>
  );
}

let vista = 'nuevo';
export default function Conteo() {
  const { confirmar, accion } = useDialogos();
  const { datos } = useDatos('/bodega/conteo');
  const [v, setV] = useState(vista);
  const [q, setQ] = useState('');
  const [cont, setCont] = useState({});
  const [mot, setMot] = useState('');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const mats = datos.materias.filter((m) => !q || norm(m.nombre).includes(norm(q)));
  const filas = datos.materias.filter((m) => cont[m.id] !== undefined && cont[m.id] !== '');
  const hay = filas.some((m) => r2(+cont[m.id] - m.sistema) !== 0);
  const ok = filas.length && (!hay || mot.trim().length >= 10);
  const enviar = async () => {
    if (!(await confirmar({ titulo: 'Enviar el conteo al gerente', texto: `Contaste ${filas.length} materias primas. El inventario no cambia hasta que el gerente apruebe los ajustes.`, verbo: 'Enviar' }))) return;
    if (await accion(() => api.post('/bodega/conteos', { filas: filas.map((m) => ({ mp: m.id, contado: +cont[m.id] })), motivo: mot }), 'Conteo enviado al gerente')) {
      setCont({}); setMot(''); vista = 'hist'; setV('hist');
    }
  };
  const k = ver && datos.conteos.find((x) => x.id === ver);
  return (
    <Stack>
      <Pildoras opciones={[['nuevo', 'Nuevo conteo'], ['hist', 'Historial']]} valor={v} onChange={(x) => { vista = x; setV(x); }} />
      {v === 'hist' ? (
        datos.conteos.length ? (
          <Tabla cols={['Fecha', 'Materias contadas', 'Con diferencia', 'Estado']} filas={datos.conteos.map((x) => ({
            onClick: () => setVer(x.id), celdas: [fmt(x.fecha), x.filas.length, x.filas.filter((f) => f.contado !== f.sistema).length, <Chip t={x.estado} o={tono(x.estado)} />],
          }))} />
        ) : <Vacio ic="list">Aún no has hecho conteos</Vacio>
      ) : datos.pendiente ? <Ban>Ya tienes un conteo esperando al gerente. No puedes enviar otro hasta que lo decida.</Ban> : (
        <>
          <Form.Control type="search" placeholder="Buscar materia prima" value={q} onChange={(e) => setQ(e.target.value)} className="tw:max-w-[320px]" />
          <Mut>Cuenta lo que hay en bodega y escribe la cantidad. Deja en blanco lo que no contaste. El sistema solo cuenta lotes vigentes.</Mut>
          <Tabla cols={['Materia prima', 'Sistema', 'Contado', 'Diferencia']} filas={mats.map((m) => {
            const val = cont[m.id];
            const d = val === undefined || val === '' ? null : r2(+val - m.sistema);
            return [m.nombre, `${m.sistema} ${m.unidad}`,
              <Form.Control type="number" min={0} step="any" value={val ?? ''} onChange={(e) => setCont({ ...cont, [m.id]: e.target.value })} className="tw:w-[110px]" aria-label={`Contado de ${m.nombre}`} />,
              d == null ? '—' : <b className={d === 0 ? '' : d < 0 ? 'tw:text-er' : 'tw:text-ok'}>{d > 0 ? '+' : ''}{d} {m.unidad}</b>];
          })} />
          <Form.Control as="textarea" rows={3} placeholder="Motivo de las diferencias (mín. 10 caracteres)" value={mot} onChange={(e) => setMot(e.target.value)} />
          <div className="tw:flex tw:justify-end"><Btn v="p" disabled={!ok} onClick={enviar}>Enviar al gerente</Btn></div>
        </>
      )}
      {k && <DetalleConteo k={k} onHide={() => setVer(null)} />}
    </Stack>
  );
}
