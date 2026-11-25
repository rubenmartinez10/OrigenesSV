import { useState } from 'react';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fmt } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Avatar, Btn, Campo, Cargando, Chip, Err, Mut, Panel, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { AccionesPersonal, FichaPersona } from '../../components/Personal.jsx';

/* Gerente de sucursal · 5.9 Equipo y 5.11 Plantilla */
const ROLES = [['mesero', 'Mesero'], ['cocinero', 'Cocinero'], ['jefe', 'Jefe de cocina'], ['bodega', 'Encargado de bodega'], ['gerente', 'Gerente de sucursal']];
const F = { q: '', rol: '' };

function EquipoTab() {
  const { datos } = useDatos('/gerente/equipo');
  const [f, setFState] = useState(F);
  const [ver, setVer] = useState(null);
  const setF = (x) => { Object.assign(F, x); setFState({ ...F }); };
  if (!datos) return <Cargando />;
  const L = datos.personas.filter((x) => (!f.rol || x.rol === f.rol) && (!f.q || x.nombre.toLowerCase().includes(f.q.toLowerCase())));
  const p = ver && datos.personas.find((x) => x.id === ver);
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:gap-2">
        <Form.Control type="search" placeholder="Buscar" value={f.q} onChange={(e) => setF({ q: e.target.value })} className="tw:max-w-[260px]" aria-label="Buscar" />
        <Form.Select value={f.rol} onChange={(e) => setF({ rol: e.target.value })} className="tw:max-w-[240px]" aria-label="Rol">
          <option value="">Todos los roles</option>{ROLES.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </Form.Select>
      </div>
      {L.length ? <Tabla cols={['', 'Nombre', 'Rol', 'Turno', 'Salario', 'Estado']} filas={L.map((x) => ({
        onClick: () => setVer(x.id), celdas: [<Avatar u={x} size={34} />, x.nombre, x.rolNombre, x.sinTurno ? <Chip t="Sin turno" o="er" /> : x.turno || '—', $(x.salario),
          <Chip t={x.despidoSolicitado ? 'Despido solicitado' : 'Activo'} o={x.despidoSolicitado ? 'wa' : 'ok'} />],
      }))} /> : <Vacio ic="users">No hay personas con ese filtro</Vacio>}
      {p && (
        <FichaPersona p={p} onHide={() => setVer(null)}
          nota={p.puede ? 'Puedes cambiar su rol o despedirlo. Siempre debe quedar al menos una persona por rol. Para sumar personal, pídelo en la pestaña Plantilla.'
            : 'Solo puedes gestionar a quienes tienen un rol inferior al tuyo.'}
          pie={p.puede ? <AccionesPersonal p={p} base="/gerente/equipo" conClave salarios={datos.salarios} onListo={() => setVer(null)} /> : null} />
      )}
    </Stack>
  );
}

function SolicitarPersonal({ datos, inicial, onHide }) {
  const { accion } = useDialogos();
  const falta = (r) => Math.max(0, r.necesarios - r.actuales);
  const primero = inicial || datos.roles.find((r) => falta(r) > 0) || datos.roles[0];
  const [E, setE] = useState({ rol: primero.rol, cant: Math.max(1, inicial ? falta(inicial) : falta(primero)), motivo: '' });
  const [er, setEr] = useState('');
  const enviar = async () => {
    try {
      await api.post('/gerente/personal', E);
      accion(async () => {}, 'Enviada a gerencia general');
      onHide();
    } catch (e) { setEr(e.message); }
  };
  return (
    <Panel show onHide={onHide} titulo="Solicitar personal" pie={[<Btn key="c" v="t" onClick={onHide}>Cancelar</Btn>, <Btn key="e" v="p" disabled={!(E.cant > 0 && E.motivo.trim().length >= 10)} onClick={enviar}>Enviar a gerencia general</Btn>]}>
      <Campo l="Rol"><Form.Select value={E.rol} onChange={(e) => { const r = datos.roles.find((x) => x.rol === e.target.value); setE({ ...E, rol: r.rol, cant: Math.max(1, falta(r)) }); }}>
        {datos.roles.map((r) => <option key={r.rol} value={r.rol}>{r.nombre}</option>)}
      </Form.Select></Campo>
      <Campo l="Cantidad"><Form.Control type="number" min={1} step={1} value={E.cant} onChange={(e) => setE({ ...E, cant: +e.target.value })} /></Campo>
      <Campo l="Motivo (mín. 10 caracteres)"><Form.Control as="textarea" rows={3} value={E.motivo} onChange={(e) => setE({ ...E, motivo: e.target.value })} /></Campo>
      <Err>{er}</Err>
    </Panel>
  );
}

function PlantillaTab() {
  const { accion } = useDialogos();
  const { datos } = useDatos('/gerente/plantilla');
  const [d, setD] = useState(null);
  const [sol, setSol] = useState(null);
  if (!datos) return <Cargando />;
  const val = d || Object.fromEntries(datos.roles.map((r) => [r.rol, r.necesarios]));
  const cambia = datos.roles.some((r) => val[r.rol] !== r.necesarios);
  const falta = (r) => Math.max(0, val[r.rol] - r.actuales);
  const hayFalta = datos.roles.some((r) => falta(r) > 0);
  const guardar = async () => { if (await accion(() => api.put('/gerente/plantilla', val), 'Plantilla guardada')) setD(null); };
  const est = (x) => (x.estado === 'Rechazada' ? 'Rechazada' : x.estado === 'Solicitada' ? 'Solicitada' : x.vacante === 'Cubierta' ? 'Cubierta' : 'Aprobada (vacantes abiertas)');
  return (
    <Stack>
      <div className="tw:flex tw:items-center tw:gap-2"><h3 className="tw:text-[17px] tw:m-0">{datos.sucursal.nombre}</h3><Chip t={{ pequena: 'Pequeña', mediana: 'Mediana', grande: 'Grande' }[datos.sucursal.tamano]} o="in" sinSimbolo /></div>
      <Tabla cols={['Rol', 'Mínimo', 'Necesarios', 'Actuales', 'Faltan', '']} filas={datos.roles.map((r) => [
        r.nombre, r.minimo,
        <div className="tw:flex tw:items-center tw:gap-2">
          <Btn disabled={val[r.rol] <= r.minimo} title={val[r.rol] <= r.minimo ? 'No puede bajar del mínimo de la sucursal' : ''} onClick={() => setD({ ...val, [r.rol]: val[r.rol] - 1 })}>−</Btn>
          <b>{val[r.rol]}</b>
          <Btn onClick={() => setD({ ...val, [r.rol]: val[r.rol] + 1 })}>+</Btn>
        </div>,
        r.actuales, falta(r) > 0 ? <b className="tw:text-er">{falta(r)}</b> : '—',
        falta(r) > 0 ? <Btn v="t" onClick={() => setSol({ ...r, necesarios: val[r.rol] })}>Solicitar</Btn> : '',
      ])} />
      <Mut>Bajar la cifra no despide a nadie: solo deja de reportarse faltante.</Mut>
      <div className="tw:flex tw:flex-wrap tw:gap-2">
        <Btn v="p" disabled={!cambia} onClick={guardar}>Guardar plantilla</Btn>
        <Btn disabled={!hayFalta} onClick={() => setSol({})}>+ Solicitar personal</Btn>
      </div>
      <h4 className="tw:text-[15px] tw:m-0">Mis solicitudes de personal</h4>
      {datos.solicitudes.length ? <Tabla cols={['Rol', 'Cantidad', 'Fecha', 'Estado']} filas={datos.solicitudes.map((x) => [
        ROLES.find(([id]) => id === x.rol)?.[1], x.monto, fmt(x.fecha),
        <><Chip t={est(x)} o={est(x) === 'Rechazada' ? 'er' : est(x) === 'Solicitada' ? 'g' : 'ok'} />{x.rechazo && <div className="tw:text-er tw:text-xs">Motivo: {x.rechazo.motivo}</div>}</>,
      ])} /> : <Vacio ic="users">Aún no has enviado solicitudes de personal</Vacio>}
      {sol && <SolicitarPersonal datos={{ ...datos, roles: datos.roles.map((r) => ({ ...r, necesarios: val[r.rol] })) }} inicial={sol.rol ? sol : null} onHide={() => setSol(null)} />}
    </Stack>
  );
}

export default function Equipo({ tab = 'equipo' }) {
  return tab === 'plantilla' ? <PlantillaTab /> : <EquipoTab />;
}
