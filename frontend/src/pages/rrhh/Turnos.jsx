import { useState } from 'react';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { D } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Icono } from '../../components/Icono.jsx';
import { Btn, Campo, Cargando, Err, Mut, Stack, Tabla, Vacio } from '../../components/ui.jsx';

/* Recursos Humanos · 6.3 Turnos semanales por sucursal */
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ROLES = [['cocinero', 'Cocinero'], ['mesero', 'Mesero'], ['jefe', 'Jefe de cocina'], ['bodega', 'Encargado de bodega'], ['gerente', 'Gerente de sucursal']];
const loc = (t) => new Date(t - 6 * 36e5);
const S = { suc: '', sem: 0, rol: 'cocinero' };

function Celda({ v, T }) {
  if (!v) return <span className="tw:text-tx2">+ Libre</span>;
  if (T[v]) return <span>{v} <small className="tw:text-tx2">{T[v][0]}–{T[v][1]}</small></span>;
  return <span>{v.replace('-', '–')} h</span>;
}

function ElegirTurno({ quien, dia, T, onElegir, onHide }) {
  const [a, setA] = useState(7);
  const [b, setB] = useState(15);
  const ok = a >= 0 && a <= 23 && b >= 0 && b <= 23 && +a !== +b;
  return (
    <Modal show onHide={onHide} centered size="sm">
      <Modal.Body>
        <h3>{quien} · {dia}</h3>
        <div className="tw:flex tw:flex-col tw:gap-2">
          {Object.entries(T).map(([k, [x, y]]) => <Btn key={k} onClick={() => onElegir(k)}>{k} · {x}–{y} h</Btn>)}
          <Btn v="t" onClick={() => onElegir('')}>Libre</Btn>
        </div>
        <h4 className="tw:text-sm tw:m-0 tw:mt-1">Horario personalizado</h4>
        <div className="tw:flex tw:gap-2">
          <Campo l="Entra (0–23)" className="tw:flex-1"><Form.Control type="number" min={0} max={23} value={a} onChange={(e) => setA(+e.target.value)} /></Campo>
          <Campo l="Sale (0–23)" className="tw:flex-1"><Form.Control type="number" min={0} max={23} value={b} onChange={(e) => setB(+e.target.value)} /></Campo>
        </div>
        {!ok && <Err>Revisa las horas</Err>}
        <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={onHide}>Cancelar</Btn><Btn v="p" disabled={!ok} onClick={() => onElegir(`${a}-${b}`)}>Aplicar</Btn></div>
      </Modal.Body>
    </Modal>
  );
}

export default function Turnos() {
  const { confirmar, accion, toast } = useDialogos();
  const [f, setFS] = useState(S);
  const setF = (x) => { Object.assign(S, x); setFS({ ...S }); };
  const { datos } = useDatos(`/rrhh/turnos?suc=${f.suc}&sem=${f.sem}`);
  const [draft, setDraft] = useState({});
  const [celda, setCelda] = useState(null);
  const [asignar, setAsignar] = useState(null);
  if (!datos) return <Cargando />;
  const T = datos.turnos;
  const ini = datos.ini;
  const lab = (() => { const a = loc(ini); const b = loc(ini + 6 * D); return `${a.getUTCDate()}–${b.getUTCDate()} ${MES[b.getUTCMonth()]}`; })();
  const celdas = (p) => draft[p.id] || p.celdas || Array(7).fill('');
  const L = datos.personas.filter((p) => !f.rol || p.rol === f.rol);
  const cocs = datos.personas.filter((p) => p.rol === 'cocinero');
  const cobertura = DIAS.map((_, i) => cocs.filter((p) => !!celdas(p)[i]).length);
  const dirty = Object.keys(draft).length > 0;
  const cambiar = async (nuevo) => {
    if (dirty && !(await confirmar({ titulo: 'Descartar cambios', texto: 'Hay turnos sin guardar en esta semana.', verbo: 'Descartar', rojo: true }))) return;
    setDraft({});
    setF(nuevo);
  };
  const poner = (v) => { const p = celda.p; const c = [...celdas(p)]; c[celda.i] = v; setDraft({ ...draft, [p.id]: c }); setCelda(null); };
  const copiar = async () => {
    const hay = L.some((p) => celdas(p).some(Boolean));
    if (hay && !(await confirmar({ titulo: 'Copiar la semana anterior', texto: 'Ya hay turnos escritos en esta semana y se reemplazarán.', verbo: 'Copiar' }))) return;
    const n = { ...draft };
    for (const p of L) n[p.id] = [...(p.prev || Array(7).fill(''))];
    setDraft(n);
  };
  const guardar = async () => { if (await accion(() => api.put('/rrhh/turnos', { semana: datos.semana, celdas: draft }), 'Turnos guardados')) setDraft({}); };
  const asignarCoc = async () => {
    if (await accion(() => api.post('/rrhh/turnos/asignar', { usuario: asignar, suc: datos.suc }), 'Cocinero asignado')) setAsignar(null);
  };
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Form.Select value={datos.suc} onChange={(e) => cambiar({ suc: e.target.value })} className="tw:max-w-[200px]" aria-label="Sucursal">
          {datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Form.Select>
        <Btn onClick={() => (datos.libres.length ? setAsignar(datos.libres[0].id) : toast('No hay cocineros sin sucursal asignada'))}><Icono n="plus" />Asignar cocinero</Btn>
        <span className="tw:flex-1" />
        <Btn v="t" aria-label="Semana anterior" onClick={() => cambiar({ sem: f.sem - 1 })}>‹</Btn>
        <b className="tw:min-w-[110px] tw:text-center">{lab}</b>
        <Btn v="t" aria-label="Semana siguiente" onClick={() => cambiar({ sem: f.sem + 1 })}>›</Btn>
        <Form.Select value={f.rol} onChange={(e) => setF({ rol: e.target.value })} className="tw:max-w-[200px]" aria-label="Rol">
          {ROLES.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </Form.Select>
        <Btn onClick={copiar}>Copiar semana anterior</Btn>
      </div>
      {datos.sinTurno.length > 0 && <Err>Sin turno asignado (obligatorio): {datos.sinTurno.map((u) => u.nombre).join(', ')}</Err>}
      {f.rol === 'cocinero' && !cocs.length ? <Vacio ic="users">Esta sucursal no tiene cocineros asignados</Vacio>
        : L.length ? <Tabla cols={['Empleado', ...DIAS.map((d, i) => `${d} ${loc(ini + i * D).getUTCDate()}`)]} filas={[
          ...L.map((p) => ({
            tono: draft[p.id] ? 'az' : undefined,
            celdas: [<span>{p.nombre}{!p.propia && !draft[p.id] && <small className="tw:block tw:text-tx2">Turno base</small>}</span>,
              ...celdas(p).map((v, i) => (
                <button key={i} type="button" onClick={() => setCelda({ p, i })}
                  className={`tw:w-full tw:min-w-[86px] tw:rounded-xl tw:border tw:px-2 tw:py-1.5 tw:text-[12.5px] tw:text-left ${v ? 'tw:border-br tw:bg-brs tw:text-tx' : 'tw:border-dashed tw:border-bd tw:bg-transparent'}`}>
                  <Celda v={v} T={T} />
                </button>
              ))],
          })),
          ...(f.rol === 'cocinero' ? [{ celdas: [<b>Cobertura de cocineros</b>, ...cobertura.map((n, i) => <b key={i} className={n ? '' : 'tw:text-er'}>{n}</b>)] }] : []),
        ]} /> : <Vacio ic="users">No hay personas con este rol en la sucursal</Vacio>}
      <Mut>El sistema usa estos turnos para saber qué cocineros están disponibles. Un cocinero fuera de turno no aparece como libre para el jefe de cocina.</Mut>
      {dirty && <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={() => setDraft({})}>Descartar</Btn><Btn v="p" onClick={guardar}>Guardar turnos</Btn></div>}
      {celda && <ElegirTurno quien={celda.p.nombre} dia={`${DIAS[celda.i]} ${loc(ini + celda.i * D).getUTCDate()}`} T={T} onElegir={poner} onHide={() => setCelda(null)} />}
      <Modal show={asignar != null} onHide={() => setAsignar(null)} centered>
        <Modal.Body>
          <h3>Asignar cocinero a {datos.sucursales.find((s) => s.id === datos.suc)?.nombre}</h3>
          <Form.Select value={asignar || ''} onChange={(e) => setAsignar(+e.target.value)}>{datos.libres.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</Form.Select>
          <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={() => setAsignar(null)}>Cancelar</Btn><Btn v="p" onClick={asignarCoc}>Asignar</Btn></div>
        </Modal.Body>
      </Modal>
    </Stack>
  );
}
