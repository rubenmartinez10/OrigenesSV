import { useState } from 'react';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { D, fFecha, fmt, inicioDia } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Btn, Campo, Cargando, Mut, Panel, Pildoras, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { Icono } from '../../components/Icono.jsx';

/* Gerente de sucursal · 5.4 Mermas: la única forma manual de bajar stock (con clave) */
const MOTIVOS = ['Se cayó o derramó', 'Se dañó en el almacenamiento', 'Contaminación', 'Error de preparación', 'Empaque roto', 'Otro'];
let per = 'Todas';

function NuevaMerma({ lotes, onHide }) {
  const { clave } = useDialogos();
  const [E, setE] = useState({ mp: '', lote: '', cant: '', motivo: '', otro: '' });
  const mats = [...new Map(lotes.map((l) => [l.mp_id, { id: l.mp_id, nombre: l.nombre, unidad: l.unidad, stock: 0 }])).values()];
  for (const m of mats) m.stock = lotes.filter((l) => l.mp_id === m.id).reduce((a, l) => a + l.cant, 0);
  const mp = mats.find((m) => m.id === +E.mp);
  const ls = lotes.filter((l) => l.mp_id === +E.mp);
  const lt = ls.find((l) => l.id === +E.lote);
  const mt = E.motivo === 'Otro' ? E.otro.trim() : E.motivo;
  const valido = mp && lt && +E.cant > 0 && +E.cant <= lt.cant && mt.length >= 3;
  const registrar = async () => {
    const ok = await clave({
      resumen: `Registrar merma de ${E.cant} ${mp.unidad} de ${mp.nombre} (lote ${lt.sku}). Baja el stock y no se puede deshacer.`,
      accion: (k) => api.post('/gerente/mermas', { ...k, lote: lt.id, cant: +E.cant, motivo: mt }), ok: 'Merma registrada',
    });
    if (ok) onHide();
  };
  return (
    <Panel show onHide={onHide} titulo="Nueva merma" pie={[<Btn key="c" v="t" onClick={onHide}>Cancelar</Btn>, <Btn key="r" v="p" disabled={!valido} onClick={registrar}>Registrar merma</Btn>]}>
      <Campo l="Materia prima">
        <Form.Select value={E.mp} onChange={(e) => setE({ ...E, mp: e.target.value, lote: '' })}>
          <option value="">Elige</option>{mats.map((m) => <option key={m.id} value={m.id}>{m.nombre} · stock {m.stock.toFixed(1)} {m.unidad}</option>)}
        </Form.Select>
      </Campo>
      <Campo l="Lote">
        <Form.Select value={E.lote} disabled={!mp} onChange={(e) => setE({ ...E, lote: e.target.value })}>
          <option value="">Elige</option>{ls.map((l) => <option key={l.id} value={l.id}>{l.sku} · vence {fFecha(l.vence)} · quedan {l.cant}</option>)}
        </Form.Select>
      </Campo>
      <Campo l={`Cantidad${mp ? ` (${mp.unidad})` : ''}${lt ? ` · máx. ${lt.cant}` : ''}`}>
        <Form.Control type="number" min={0} step="any" value={E.cant} disabled={!lt} onChange={(e) => setE({ ...E, cant: e.target.value })} />
      </Campo>
      <Campo l="Motivo">
        <Form.Select value={E.motivo} onChange={(e) => setE({ ...E, motivo: e.target.value })}><option value="">Elige</option>{MOTIVOS.map((m) => <option key={m}>{m}</option>)}</Form.Select>
      </Campo>
      {E.motivo === 'Otro' && <Campo l="Describe el motivo"><Form.Control value={E.otro} onChange={(e) => setE({ ...E, otro: e.target.value })} /></Campo>}
      <Mut>Se descuenta del lote elegido y queda en la bitácora.</Mut>
    </Panel>
  );
}

export default function Mermas() {
  const { datos } = useDatos('/gerente/mermas');
  const [p, setP] = useState(per);
  const [nueva, setNueva] = useState(false);
  if (!datos) return <Cargando />;
  const h = inicioDia(datos.ahora);
  const lim = { Todas: 0, Hoy: h, '7 días': h - 6 * D, '30 días': h - 29 * D }[p];
  const L = datos.mermas.filter((m) => m.fecha >= lim);
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Pildoras opciones={['Todas', 'Hoy', '7 días', '30 días']} valor={p} onChange={(x) => { per = x; setP(x); }} />
        <span className="tw:flex-1" />
        <Btn v="p" onClick={() => setNueva(true)}><Icono n="plus" />Nueva merma</Btn>
      </div>
      <Ban>La merma es la única forma manual de bajar stock.</Ban>
      {L.length ? <Tabla cols={['Fecha', 'Materia prima', 'Lote', 'Cantidad', 'Tipo', 'Motivo', 'Registró']}
        filas={L.map((m) => [fmt(m.fecha), m.mp, m.lote || '—', `${m.cant} ${m.unidad}`, m.tipo, m.motivo, m.por || 'Sistema'])} /> : <Vacio>No hay mermas registradas</Vacio>}
      {nueva && <NuevaMerma lotes={datos.lotes} onHide={() => setNueva(false)} />}
    </Stack>
  );
}
