import { useEffect, useState } from 'react';
import { Dropdown, Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, D, fFecha, fmt, fTel, valCorreo, valTel } from '../../lib/formato.js';
import { useAhora, useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Icono } from '../../components/Icono.jsx';
import { Avatar, Ban, Btn, Campo, Cargando, Chip, Err, Etapas, Kv, Mut, Panel, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { Contrasenas, Credenciales } from '../../components/Franquicia.jsx';

/* Recursos Humanos · 6.1 Personal: empleados, vacantes, despidos y contraseñas */
const TONO = { Activo: 'ok', 'Despido solicitado': 'wa', 'Renuncia presentada': 'wa', Despedido: 'er', Renunció: 'g', 'Pendiente de reubicación': 'wa' };
const F = { q: '', suc: '', rol: '', est: 'Activo' };
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fDui = (v) => { const d = String(v).replace(/\D/g, '').slice(0, 9); return d.length > 8 ? `${d.slice(0, 8)}-${d.slice(8)}` : d; };
export function antig(ingreso, t) {
  const a = (t - ingreso) / (365.25 * D);
  return a < 1 ? `${Math.max(0, Math.floor(a * 12))} mes(es)` : `${Math.floor(a)} año(s)`;
}
const hoyIso = (t) => new Date(t - 6 * 36e5).toISOString().slice(0, 10);

/* ---------- contratar o cubrir una vacante ---------- */
function Contratar({ datos, vac, onHide, onCred }) {
  const ahora = useAhora(60000);
  const { accion } = useDialogos();
  const [E, setE] = useState({ nombre: '', doc: '', tel: '', mail: '', turno: 'Mañana', rol: vac?.rol || 'mesero', suc: vac?.suc || datos.sucursales[0]?.id, ingreso: hoyIso(ahora) });
  const [er, setEr] = useState('');
  const [prev, setPrev] = useState(null);
  const set = (x) => setE({ ...E, ...x });
  // si el DUI ya perteneció a alguien, se avisa: es una recontratación (misma persona, mismo historial)
  useEffect(() => {
    if (!/^\d{8}-\d$/.test(E.doc)) { setPrev(null); return undefined; }
    let vivo = true;
    api.get(`/rrhh/empleados/dui/${E.doc}`).then((r) => { if (vivo) setPrev(r.existe ? r : null); }).catch(() => {});
    return () => { vivo = false; };
  }, [E.doc]);
  const errores = [
    E.nombre.trim().split(/\s+/).length < 2 && 'Escribe el nombre completo (nombre y apellido)',
    !/^\d{8}-\d$/.test(E.doc) && 'El DUI debe tener el formato 00000000-0',
    valTel(E.tel), E.mail.trim() && valCorreo(E.mail),
  ].filter(Boolean);
  const sal = datos.roles.find((r) => r.id === E.rol)?.salario || 0;
  const contratar = async () => {
    try {
      const r = await api.post('/rrhh/empleados', { ...E, vacante: vac?.id });
      await accion(async () => {}, vac ? 'Vacante cubierta' : 'Empleado contratado');
      onCred([...(r.recontratado ? [['Recontratación', 'Se reactivó la cuenta anterior y se conservó su historial']] : []), ['Nombre', r.nombre], ['Usuario', r.usuario], ['Contraseña temporal', r.pass], ...(r.clave ? [['Clave de aprobaciones', r.clave]] : [])]);
      onHide();
    } catch (x) { setEr(x.message); }
  };
  return (
    <Panel show onHide={onHide} titulo={vac ? 'Cubrir vacante' : 'Contratar'} pie={[<Btn key="c" v="t" onClick={onHide}>Cancelar</Btn>, <Btn key="k" v="p" disabled={errores.length > 0 || prev?.estado === 'Activo'} onClick={contratar}>{prev && prev.estado !== 'Activo' ? 'Recontratar' : 'Contratar'}</Btn>]}>
      <Campo l="Nombre completo"><Form.Control value={E.nombre} onChange={(e) => set({ nombre: e.target.value })} /></Campo>
      <Campo l="DUI"><Form.Control inputMode="numeric" placeholder="00000000-0" value={E.doc} onChange={(e) => set({ doc: fDui(e.target.value) })} /></Campo>
      {prev && (prev.estado === 'Activo'
        ? <Err>Ya hay una persona activa con ese DUI: {prev.nombre}.</Err>
        : <Ban><b>{prev.nombre} ya trabajó aquí</b> como {prev.rol}{prev.fechaBaja ? ` (baja el ${fFecha(prev.fechaBaja)})` : ''}. Se reactivará su misma cuenta y se conservará su historial; la antigüedad empieza de nuevo. Escribe su nombre tal como está registrado.</Ban>)}
      <Campo l="Teléfono"><Form.Control inputMode="numeric" placeholder="0000-0000" value={E.tel} onChange={(e) => set({ tel: fTel(e.target.value) })} /></Campo>
      <Campo l="Correo electrónico (opcional)"><Form.Control type="email" placeholder="nombre@correo.com" value={E.mail} onChange={(e) => set({ mail: e.target.value })} /></Campo>
      <Campo l="Rol"><Form.Select disabled={!!vac} value={E.rol} onChange={(e) => set({ rol: e.target.value })}>
        {datos.bajos.map((r) => <option key={r} value={r}>{datos.roles.find((x) => x.id === r)?.nombre}</option>)}
      </Form.Select></Campo>
      <Campo l="Sucursal"><Form.Select disabled={!!vac} value={E.suc} onChange={(e) => set({ suc: +e.target.value })}>
        {datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </Form.Select></Campo>
      <Campo l="Turno asignado"><Form.Select value={E.turno} onChange={(e) => set({ turno: e.target.value })}>
        {datos.turnos.map((t) => <option key={t}>{t}</option>)}
      </Form.Select></Campo>
      <Campo l="Fecha de ingreso"><Form.Control type="date" value={E.ingreso} onChange={(e) => set({ ingreso: e.target.value })} /></Campo>
      <Ban>Salario del rol: {$(sal)} al mes</Ban>
      {E.nombre && errores.length > 0 && <Mut>{errores[0]}</Mut>}
      <Err>{er}</Err>
    </Panel>
  );
}

/* ---------- ficha de un empleado ---------- */
function Ficha({ id, onHide }) {
  const ahora = useAhora(60000);
  const { datos: u } = useDatos(`/rrhh/empleados/${id}`);
  if (!u) return <Panel show onHide={onHide} titulo="Empleado"><Cargando /></Panel>;
  return (
    <Panel show onHide={onHide} titulo={u.nombre} estado={u.estado} ro>
      <div className="tw:flex tw:items-center tw:gap-4"><Avatar u={u} size={88} /><div className="tw:flex tw:flex-col"><b>{u.nombre}</b><Mut>@{u.usuario}</Mut></div></div>
      <Kv pares={[
        ['Rol', u.rolNombre], ['Sucursal', u.sucNombre], ['Salario mensual', $(u.salario)], ['Salario base del rol', $(u.salarioRol)],
        ['Aumento por antigüedad', $(u.extraAnt)], ['Turno de hoy', u.sinTurno ? 'Sin turno asignado' : u.turno || '—'], ['Ingreso', fFecha(u.ingreso)],
        ['Antigüedad', antig(u.ingreso, ahora)], ['Documento', u.documento || '—'], ['Contacto', u.telefono || u.correo || '—'],
      ]} />
      {u.estado === 'Renunció' && <Ban>Renunció el {fFecha(u.fechaBaja)}: terminó su última jornada y ya no tiene acceso. Su historial se conserva; si vuelve a contratarse con el mismo DUI se reactiva esta misma cuenta.</Ban>}
      {u.estado === 'Renuncia presentada' && <Ban>Presentó su renuncia: hoy es su último día y su vacante ya está abierta. Al terminar su jornada (o al acabar el día) pierde el acceso.</Ban>}
      {u.indemn && <Ban>Despedido. Indemnización calculada: {$(u.indemn.monto)}</Ban>}
      {u.estado === 'Pendiente de reubicación' && <Ban>Su sucursal cerró. No puede trabajar hasta que Recursos Humanos la reubique en una vacante de su mismo rol o se apruebe su despido.</Ban>}
      <h4 className="tw:text-sm tw:m-0">Historial</h4>
      {u.historial.length ? <Tabla cols={['Fecha', 'Evento', 'Detalle']} filas={u.historial.map((h) => [fFecha(h.fecha), h.tipo, h.detalle])} /> : <Vacio ic="list">Sin movimientos</Vacio>}
    </Panel>
  );
}

/* ---------- reubicar a quien trabajaba en una sucursal que cerró ---------- */
function Reubicar({ u, onHide, onDespido }) {
  const { accion } = useDialogos();
  const { datos } = useDatos('/rrhh/vacantes');
  const [v, setV] = useState('');
  const L = (datos || []).filter((x) => x.rol === u.rol);
  return (
    <Panel show onHide={onHide} titulo={`Reubicar a ${u.nombre}`}
      pie={[<Btn key="c" v="t" onClick={onHide}>Cancelar</Btn>,
        <Btn key="d" v="red" onClick={() => { onHide(); onDespido(u); }}>Solicitar despido</Btn>,
        <Btn key="k" v="p" disabled={!v} onClick={async () => { if (await accion(() => api.post(`/rrhh/empleados/${u.id}/reubicar`, { vacante: +v }), 'Persona reubicada')) onHide(); }}>Reubicar</Btn>]}>
      <Mut>{u.rolNombre} de {u.sucNombre} (cerrada). Conserva su antigüedad y su salario.</Mut>
      {!datos ? <Cargando /> : L.length ? (
        <Campo l="Vacante de su mismo rol"><Form.Select value={v} onChange={(e) => setV(e.target.value)}>
          <option value="">Elige una vacante</option>
          {L.map((x) => <option key={x.id} value={x.id}>{x.sucNombre} · prioridad {x.prioridad.toLowerCase()}</option>)}
        </Form.Select></Campo>
      ) : <Ban>No hay vacantes abiertas de {u.rolNombre}. Si no hay dónde ubicarla, usa «Solicitar despido»: lo aprueba el gerente general y se calcula su indemnización. La persona también puede renunciar desde su perfil.</Ban>}
    </Panel>
  );
}

function Empleados() {
  const ahora = useAhora(60000);
  const { motivo, accion } = useDialogos();
  const { datos } = useDatos('/rrhh/empleados');
  const [f, setFS] = useState(F);
  const [ver, setVer] = useState(null);
  const [alta, setAlta] = useState(false);
  const [asc, setAsc] = useState(null);
  const [reub, setReub] = useState(null);
  const [cred, setCred] = useState(null);
  const setF = (x) => { Object.assign(F, x); setFS({ ...F }); };
  if (!datos) return <Cargando />;
  const L = datos.personas.filter((u) => (!f.suc || u.suc === +f.suc) && (!f.rol || u.rol === f.rol) && (!f.est || u.estado === f.est) && (!f.q || norm(u.nombre).includes(norm(f.q))));
  const despido = async (u) => {
    const m = await motivo({ titulo: `Razón del despido de ${u.nombre}`, nota: 'Lo aprobará el gerente general, con la indemnización del art. 58. Sigue activo hasta que se apruebe.' });
    if (m) await accion(() => api.post(`/rrhh/empleados/${u.id}/despido`, { motivo: m }), 'Solicitud enviada. Sigue activo hasta que se apruebe');
  };
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Form.Control type="search" placeholder="Buscar empleado" value={f.q} onChange={(e) => setF({ q: e.target.value })} className="tw:max-w-[240px]" aria-label="Buscar empleado" />
        <Form.Select value={f.suc} onChange={(e) => setF({ suc: e.target.value })} className="tw:max-w-[190px]" aria-label="Sucursal">
          <option value="">Todas las sucursales</option>{datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Form.Select>
        <Form.Select value={f.rol} onChange={(e) => setF({ rol: e.target.value })} className="tw:max-w-[200px]" aria-label="Rol">
          <option value="">Todos los roles</option>{datos.roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </Form.Select>
        <Form.Select value={f.est} onChange={(e) => setF({ est: e.target.value })} className="tw:max-w-[190px]" aria-label="Estado">
          {[['', 'Todos'], ['Activo', 'Activos'], ['Pendiente de reubicación', 'Por reubicar'], ['Despido solicitado', 'Despido solicitado'], ['Renuncia presentada', 'Renuncia presentada'], ['Despedido', 'Despedidos'], ['Renunció', 'Renunciaron']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Form.Select>
        <span className="tw:flex-1" />
        <Btn v="p" onClick={() => setAlta(true)}><Icono n="plus" />Contratar</Btn>
      </div>
      {L.length ? <Tabla cols={['Nombre', 'Rol', 'Sucursal', 'Antigüedad', 'Salario', 'Estado', '']} filas={L.map((u) => ({
        onClick: () => setVer(u.id),
        celdas: [<span className="tw:flex tw:items-center tw:gap-2"><Avatar u={u} size={30} />{u.nombre}</span>, u.rolNombre, u.sucNombre, antig(u.ingreso, ahora), $(u.salario),
          <Chip t={u.estado} o={TONO[u.estado]} />,
          u.puede ? (
            <span onClick={(e) => e.stopPropagation()} role="presentation">
              <Dropdown align="end">
                <Dropdown.Toggle variant="osv-t" size="sm" aria-label={`Acciones para ${u.nombre}`}>⋯</Dropdown.Toggle>
                <Dropdown.Menu>
                  {u.reubicar && <Dropdown.Item onClick={() => setReub(u)}>Reubicar en otra sucursal</Dropdown.Item>}
                  <Dropdown.Item disabled={!u.ascensos.length || u.reubicar} onClick={() => setAsc(u)}>Ascender</Dropdown.Item>
                  <Dropdown.Item className="tw:text-er" onClick={() => despido(u)}>Solicitar despido</Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </span>
          ) : ''],
      }))} /> : <Vacio ic="users">No hay empleados con ese filtro</Vacio>}
      {ver && <Ficha id={ver} onHide={() => setVer(null)} />}
      {reub && <Reubicar u={reub} onHide={() => setReub(null)} onDespido={despido} />}
      {alta && <Contratar datos={datos} onHide={() => setAlta(false)} onCred={setCred} />}
      {asc && <Ascender u={asc} datos={datos} onHide={() => setAsc(null)} onCred={setCred} />}
      <Credenciales titulo={cred?.some(([k]) => k === 'Usuario') ? 'Empleado contratado' : 'Nueva clave de aprobaciones'} filas={cred} onHide={() => setCred(null)} />
    </Stack>
  );
}

function Ascender({ u, datos, onHide, onCred }) {
  const { accion } = useDialogos();
  const [rol, setRol] = useState(u.ascensos[0]?.id);
  const ok = async () => {
    const r = await accion(() => api.post(`/rrhh/empleados/${u.id}/ascender`, { rol }), 'Ascenso registrado');
    if (r) { onHide(); if (r.clave) onCred([['Empleado', u.nombre], ['Clave de aprobaciones', r.clave]]); }
  };
  return (
    <Modal show onHide={onHide} centered>
      <Modal.Body>
        <h3>Ascender a {u.nombre}</h3>
        <p className="tw:text-tx2 tw:m-0">Rol actual: {u.rolNombre}</p>
        <Campo l="Nuevo rol"><Form.Select value={rol} onChange={(e) => setRol(e.target.value)}>
          {u.ascensos.map((r) => <option key={r.id} value={r.id}>{r.nombre} · {$(datos.roles.find((x) => x.id === r.id)?.salario || 0)} al mes</option>)}
        </Form.Select></Campo>
        <Mut>El salario pasa al del nuevo rol. Si queda faltando alguien en su puesto anterior, se abre una vacante.</Mut>
        <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={onHide}>Cancelar</Btn><Btn v="p" onClick={ok}>Ascender</Btn></div>
      </Modal.Body>
    </Modal>
  );
}

function Vacantes() {
  const { datos } = useDatos('/rrhh/vacantes');
  const { datos: emp } = useDatos('/rrhh/empleados');
  const [ver, setVer] = useState(null);
  const [cubrir, setCubrir] = useState(null);
  const [cred, setCred] = useState(null);
  if (!datos || !emp) return <Cargando />;
  const v = ver && datos.find((x) => x.id === ver);
  return (
    <Stack>
      {datos.length ? <Tabla cols={['Sucursal', 'Rol', 'Faltan', 'Origen', 'Prioridad', 'Fecha']} filas={datos.map((x) => ({
        onClick: () => setVer(x.id),
        celdas: [x.sucNombre, x.rolNombre, `${x.cant - x.cubiertas} de ${x.cant}`, <Chip t={x.origen} o="in" sinSimbolo />,
          <Chip t={x.prioridad} o={x.prioridad === 'Máxima' ? 'er' : x.prioridad === 'Alta' ? 'wa' : 'g'} />, fmt(x.fecha)],
      }))} /> : <Vacio ic="users">No hay vacantes abiertas</Vacio>}
      {v && (
        <Panel show onHide={() => setVer(null)} titulo={`${v.rolNombre} · ${v.sucNombre}`} estado="Abierta"
          pie={[<Btn key="c" v="p" onClick={() => { setCubrir(v); setVer(null); }}>Cubrir vacante</Btn>]}>
          <Kv pares={[['Sucursal', v.sucNombre], ['Rol', v.rolNombre], ['Faltan', `${v.cant - v.cubiertas} de ${v.cant}`], ['Origen', v.origen], ['Prioridad', v.prioridad], ['Abierta', fmt(v.fecha)]]} />
        </Panel>
      )}
      {cubrir && <Contratar datos={emp} vac={cubrir} onHide={() => setCubrir(null)} onCred={setCred} />}
      <Credenciales titulo="Empleado contratado" filas={cred} onHide={() => setCred(null)} />
    </Stack>
  );
}

function Despidos() {
  const { accion, motivo } = useDialogos();
  const { datos } = useDatos('/rrhh/despidos');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const est = (x) => (x.estado === 'Aplicada' ? (x.tipo === 'Renuncia' ? 'Terminada' : 'Aprobado') : x.estado === 'Solicitada' ? (x.tipo === 'Renuncia' ? 'Último día' : 'Solicitado') : x.estado === 'Cancelada' ? (x.datos?.retiro?.estado === 'Aceptado' ? 'Retirada' : 'Cancelado') : 'Rechazado');
  const x = ver && datos.find((s) => s.id === ver);
  const ind = x?.datos?.indemn;
  const retiroPend = x?.tipo === 'Renuncia' && x.datos?.retiro?.estado === 'Solicitado' && x.rolNombre !== 'Recursos Humanos' && !x.datos?.salio;
  const decidir = async (aceptar) => {
    const m = aceptar ? null : await motivo({ titulo: 'Motivo para no aceptar el retiro' });
    if (!aceptar && !m) return;
    if (await accion(() => api.post(`/rrhh/renuncias/${x.id}/retiro`, { aceptar, motivo: m }), aceptar ? 'Renuncia retirada: se queda en su puesto' : 'Retiro rechazado: hoy sigue siendo su último día')) setVer(null);
  };
  const revisar = x?.tipo === 'Despido' && x.estado === 'Solicitada' && x.aprueba === 'rrhh';
  const decidirDespido = async (aceptar) => {
    const m = aceptar ? null : await motivo({ titulo: 'Motivo para rechazar el despido' });
    if (!aceptar && !m) return;
    if (await accion(() => api.post(`/rrhh/despidos/${x.id}/${aceptar ? 'aceptar' : 'rechazar'}`, aceptar ? {} : { motivo: m }),
      aceptar ? 'Aceptado: pasa al gerente general' : 'Despido rechazado: se avisó al gerente')) setVer(null);
  };
  const pie = [
    ...(retiroPend ? [<Btn key="rr" onClick={() => decidir(false)}>Rechazar retiro</Btn>, <Btn key="ra" v="p" onClick={() => decidir(true)}>Aceptar retiro</Btn>] : []),
    ...(revisar ? [<Btn key="dr" onClick={() => decidirDespido(false)}>Rechazar</Btn>, <Btn key="da" v="p" onClick={() => decidirDespido(true)}>Aceptar y pasar al gerente general</Btn>] : []),
  ];
  const etapa = (s) => (s.estado === 'Aplicada' ? 4 : s.aprueba === 'gg' ? 2 : 1); // pasos ya cumplidos
  return (
    <Stack>
      {datos.length ? <Tabla cols={['Empleado', 'Rol', 'Salida', 'Fecha', 'Estado']} filas={datos.map((s) => ({
        onClick: () => setVer(s.id),
        celdas: [s.usuarioNombre, s.rolNombre || '—', s.tipo === 'Renuncia' ? 'Renuncia' : 'Despido', fmt(s.fecha), <><Chip t={est(s)} o={['Aprobado', 'Terminada'].includes(est(s)) ? 'ok' : ['Solicitado', 'Último día', 'Retirada'].includes(est(s)) ? 'g' : 'er'} />{s.rechazo && <div className="tw:text-er tw:text-xs">Motivo: {s.rechazo.motivo}</div>}</>],
      }))} /> : <Vacio ic="list">Aún no hay despidos ni renuncias</Vacio>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={`${x.tipo === 'Renuncia' ? 'Renuncia' : 'Despido'} · ${x.usuarioNombre}`} estado={est(x)} ro={!pie.length} pie={pie.length ? pie : undefined}>
          {x.tipo === 'Renuncia'
            ? <Etapas l={['Presentada', 'Terminó su jornada']} a={x.estado === 'Aplicada' ? 2 : 1} rech={['Rechazada', 'Cancelada'].includes(x.estado) ? 1 : undefined} />
            : <Etapas l={['Solicitado', 'Recursos Humanos', 'Gerente general', 'Aplicado']} a={etapa(x)} rech={['Rechazada', 'Cancelada'].includes(x.estado) ? etapa(x) : undefined} />}
          <Kv pares={[['Empleado', x.usuarioNombre], ['Rol', x.rolNombre || '—'], [x.tipo === 'Renuncia' ? 'Motivo' : 'Razón', x.motivo], [x.tipo === 'Renuncia' ? 'La presentó' : 'Lo pidió', x.solicitanteNombre],
            x.tipo === 'Renuncia' ? ['Aprobación', 'No requiere: la decisión es de la persona'] : ['Falta', x.estado !== 'Solicitada' ? '—' : x.aprueba === 'rrhh' ? 'Revisión de Recursos Humanos' : 'Aprobación del gerente general']]} />
          {x.tipo === 'Despido' && x.estado === 'Solicitada' && x.datos?.indemnEstimada && (
            <Kv pares={[['Indemnización estimada', $(x.datos.indemnEstimada.monto)], ['Días', x.datos.indemnEstimada.dias], ['Salario diario base', $(x.datos.indemnEstimada.base)]]} />
          )}
          {x.tipo === 'Renuncia' && x.datos?.retiro && <Ban>Retiro: {x.datos.retiro.estado === 'Solicitado' ? `la persona pidió retirarla («${x.datos.retiro.motivo}»)` : x.datos.retiro.estado === 'Aceptado' ? `aceptado por ${x.datos.retiro.decidio}` : `rechazado por ${x.datos.retiro.decidio}: ${x.datos.retiro.motivoRechazo}`}.</Ban>}
          {ind && <>
            <h4 className="tw:text-sm tw:m-0">Indemnización (art. 58 del Código de Trabajo)</h4>
            <Kv pares={[['Años de servicio', ind.anios], ['Días indemnizados', ind.dias], ['Salario diario base', $(ind.base)], ['Total', $(ind.monto)], ['Aprobó', x.decidioNombre || '—']]} />
          </>}
          {x.rechazo && <Err>Rechazado: {x.rechazo.motivo}</Err>}
        </Panel>
      )}
    </Stack>
  );
}

const TABS = { empleados: Empleados, vacantes: Vacantes, despidos: Despidos, contrasenas: Contrasenas };
export default function Personal({ tab = 'empleados' }) {
  const T = TABS[tab] || Empleados;
  return <T />;
}
