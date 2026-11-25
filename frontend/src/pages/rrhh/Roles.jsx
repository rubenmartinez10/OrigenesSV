import { useState } from 'react';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fFecha, fmt } from '../../lib/formato.js';
import { useAhora, useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Campo, Cargando, Chip, Err, Kv, Mut, Panel, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { antig } from './Personal.jsx';

/* Recursos Humanos · 6.2 Roles y salarios, aumentos por antigüedad, salarios por empleado y catálogos de materia prima */
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const est = (x) => (x.estado === 'Aplicada' ? 'Aprobada' : x.estado);

function CambioSalario({ rol, minimo, onHide }) {
  const { accion } = useDialogos();
  const [E, setE] = useState({ sal: '', mot: '' });
  const bajo = E.sal !== '' && +E.sal < minimo;
  const ok = E.sal !== '' && +E.sal >= minimo && +E.sal !== rol.salario && E.mot.trim().length >= 10;
  const enviar = async () => { if (await accion(() => api.post(`/rrhh/roles/${rol.id}/salario`, { salario: +E.sal, motivo: E.mot }), 'Enviada al gerente general')) onHide(); };
  return (
    <Panel show onHide={onHide} titulo="Cambio de salario" pie={[<Btn key="c" v="t" onClick={onHide}>Cancelar</Btn>, <Btn key="e" v="p" disabled={!ok} onClick={enviar}>Enviar</Btn>]}>
      <Kv pares={[['Rol', rol.nombre], ['Salario actual', $(rol.salario)], ['Mínimo legal', $(minimo)]]} />
      <Campo l="Salario nuevo"><Form.Control type="number" min={0} step="0.01" isInvalid={bajo} value={E.sal} onChange={(e) => setE({ ...E, sal: e.target.value })} /></Campo>
      {bajo && <Err>No puede ser menor al mínimo legal ({$(minimo)})</Err>}
      <Campo l="Motivo (mín. 10 caracteres)"><Form.Control as="textarea" rows={3} value={E.mot} onChange={(e) => setE({ ...E, mot: e.target.value })} /></Campo>
      <Mut>El salario cambia hasta que lo apruebe el gerente general.</Mut>
    </Panel>
  );
}

function Roles() {
  const { datos } = useDatos('/rrhh/roles');
  const [cambio, setCambio] = useState(null);
  if (!datos) return <Cargando />;
  return (
    <Stack>
      <Tabla cols={['Rol', 'Salario actual', 'Mínimo legal', 'Último cambio', '']} filas={datos.roles.map((r) => [
        r.nombre, $(r.salario), $(datos.minimo), fFecha(r.salario_desde),
        r.pendiente ? <Chip t="Cambio solicitado" o="wa" /> : <Btn v="t" onClick={() => setCambio(r)}>Solicitar cambio</Btn>,
      ])} />
      <h4 className="tw:text-[15px] tw:m-0">Mis solicitudes</h4>
      {datos.solicitudes.length ? <Tabla cols={['Rol', 'Salario propuesto', 'Fecha', 'Estado']} filas={datos.solicitudes.map((x) => [
        x.rolNombre, $(x.monto), fmt(x.fecha),
        <><Chip t={est(x)} o={x.estado === 'Solicitada' ? 'g' : x.estado === 'Rechazada' ? 'er' : 'ok'} />{x.rechazo && <div className="tw:text-er tw:text-xs">Motivo: {x.rechazo.motivo}</div>}</>,
      ])} /> : <Vacio ic="list">Aún no has solicitado cambios</Vacio>}
      {cambio && <CambioSalario rol={cambio} minimo={datos.minimo} onHide={() => setCambio(null)} />}
    </Stack>
  );
}

function Aumentos() {
  const { datos } = useDatos('/rrhh/aumentos');
  if (!datos) return <Cargando />;
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2"><Chip t="Solo lectura" o="g" /><Mut>Son automáticos y ya están registrados en la gerencia general.</Mut></div>
      {datos.length ? <Tabla cols={['Empleado', 'Fecha', 'Años cumplidos', 'Salario anterior', 'Salario nuevo']} filas={datos.map((a) => [a.nombre, fFecha(a.fecha), a.anios, $(a.antes), $(a.despues)])} />
        : <Vacio ic="list">Aún no hay aumentos automáticos</Vacio>}
    </Stack>
  );
}

function PorEmpleado() {
  const ahora = useAhora(60000);
  const { datos } = useDatos('/rrhh/salarios');
  const [q, setQ] = useState('');
  const [rol, setRol] = useState('');
  if (!datos) return <Cargando />;
  const roles = [...new Map(datos.map((u) => [u.rol, u.rolNombre])).entries()];
  const L = datos.filter((u) => (!rol || u.rol === rol) && (!q || norm(u.nombre).includes(norm(q))));
  const tot = L.reduce((a, u) => a + u.salario, 0);
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Form.Control type="search" placeholder="Buscar empleado" value={q} onChange={(e) => setQ(e.target.value)} className="tw:max-w-[240px]" aria-label="Buscar empleado" />
        <Form.Select value={rol} onChange={(e) => setRol(e.target.value)} className="tw:max-w-[220px]" aria-label="Rol">
          <option value="">Todos los roles</option>{roles.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </Form.Select>
        <span className="tw:flex-1" /><Chip t={`Planilla mensual: ${$(tot)}`} o="in" sinSimbolo />
      </div>
      {L.length ? <Tabla cols={['Empleado', 'Rol', 'Sucursal', 'Antigüedad', 'Base del rol', 'Por antigüedad', 'Salario mensual']} filas={[
        ...L.map((u) => [u.nombre, u.rolNombre, u.sucNombre, antig(u.ingreso, ahora), $(u.salarioRol), `+${$(u.extraAnt)}`, <b>{$(u.salario)}</b>]),
        [<b>Total</b>, '', '', '', '', '', <b>{$(tot)}</b>],
      ]} /> : <Vacio ic="users">No hay empleados con ese filtro</Vacio>}
    </Stack>
  );
}

function Catalogos() {
  const { motivo, confirmar, accion } = useDialogos();
  const { datos } = useDatos('/rrhh/catalogos');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const x = ver && datos.pendientes.find((s) => s.id === ver);
  const aprobar = async () => {
    if (!(await confirmar({ titulo: `Aprobar «${x.nombre}»`, texto: `Se agrega como ${x.tipo === 'Unidad nueva' ? 'unidad' : 'categoría'} de materia prima para todas las sucursales.`, verbo: 'Aprobar' }))) return;
    if (await accion(() => api.post(`/rrhh/catalogos/${x.id}/aprobar`), 'Catálogo aprobado')) setVer(null);
  };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/rrhh/catalogos/${x.id}/rechazar`, { motivo: m }), 'Solicitud rechazada')) setVer(null);
  };
  return (
    <Stack>
      <Mut>Unidades: {datos.unidades.join(', ')}</Mut>
      <Mut>Categorías: {datos.categorias.join(', ')}</Mut>
      <h4 className="tw:text-[15px] tw:m-0">Por aprobar</h4>
      {datos.pendientes.length ? <Tabla cols={['Tipo', 'Nombre', 'Sucursal', 'Pide', 'Fecha']} filas={datos.pendientes.map((s) => ({
        onClick: () => setVer(s.id), celdas: [<Chip t={s.tipo} o="in" sinSimbolo />, s.nombre, s.sucNombre, s.solicitanteNombre, fmt(s.fecha)],
      }))} /> : <Vacio ic="check">No hay solicitudes de catálogo</Vacio>}
      {datos.historial.length > 0 && <>
        <h4 className="tw:text-[15px] tw:m-0">Historial</h4>
        <Tabla cols={['Tipo', 'Nombre', 'Estado']} filas={datos.historial.map((s) => [s.tipo, s.nombre, <Chip t={s.estado} />])} />
      </>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={x.tipo} estado="Aprobada por gerente" pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" onClick={aprobar}>Aprobar</Btn>]}>
          <Kv pares={[['Nombre', x.nombre], ['Sucursal', x.sucNombre], ['Pide', x.solicitanteNombre], ['Aprobó el gerente', x.gerenteNombre], ['Motivo', x.motivo]]} />
        </Panel>
      )}
    </Stack>
  );
}

const TABS = { roles: Roles, aumentos: Aumentos, empleados: PorEmpleado, catalogos: Catalogos };
export default function RolesSalarios({ tab = 'roles' }) {
  const T = TABS[tab] || Roles;
  return <T />;
}
