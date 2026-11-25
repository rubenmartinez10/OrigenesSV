import { useEffect, useState } from 'react';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fFecha, fmt } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Btn, Campo, Card, Cargando, Chip, Err, Grid, Kv, Mut, Panel, Pildoras, Seg, Stack, Tabla, Vacio } from '../../components/ui.jsx';

/* Gerente general · 7.8 Sucursales, 7.9 Despidos, 7.10 Plantilla */
const ESTS = { Operando: 'ok', 'Cierre ordenado': 'er', Cerrada: 'g' };
const TONO_P = { 'Compra aprobada': 'ok', 'Venta aprobada': 'ok', Abierta: 'ok', Rechazada: 'er', Solicitada: 'g' };

/** Proponer compra o venta de una sucursal (el costo lo calcula el sistema según la zona y el tamaño). */
export function Proponer({ datos, url = '/gg/sucursales/propuestas', costoUrl = '/gg/sucursales/costo', directo, onHide }) {
  const { accion } = useDialogos();
  const operando = datos.sucursales.filter((s) => s.estado === 'Operando');
  const [E, setE] = useState({ modo: 'Comprar', zona: datos.zonas[0], tam: 'mediana', motivo: '', suc: operando[0]?.id, costo: null });
  const [bl, setBl] = useState('');
  const set = (x) => setE({ ...E, ...x });
  useEffect(() => {
    if (E.modo !== 'Vender' || !E.suc) { setBl(''); return; }
    api.get(`/gg/sucursales/${E.suc}/abiertos`).then((a) => setBl(a.p || a.c ? `Hay ${a.p} pedido${a.p === 1 ? '' : 's'} abierto${a.p === 1 ? '' : 's'} y ${a.c} caja${a.c === 1 ? '' : 's'} abierta${a.c === 1 ? '' : 's'}` : '')).catch(() => setBl(''));
  }, [E.modo, E.suc]);
  const calcular = () => accion(async () => { const r = await api.get(`${costoUrl}?zona=${encodeURIComponent(E.zona)}&tam=${E.tam}`); set({ costo: r.costo }); });
  const comprar = E.modo === 'Comprar';
  const ok = (directo || E.motivo.trim().length >= 10) && (comprar ? E.costo != null : !bl);
  const enviar = async () => {
    const cuerpo = directo ? { zona: E.zona, tamano: E.tam, costo: E.costo }
      : comprar ? { tipo: 'Compra', zona: E.zona, tamano: E.tam, costo: E.costo, motivo: E.motivo } : { tipo: 'Venta', suc: E.suc, motivo: E.motivo };
    if (await accion(() => api.post(url, cuerpo), directo ? 'Sucursal creada' : 'Enviada al director')) onHide();
  };
  return (
    <Panel show onHide={onHide} titulo={directo ? 'Crear sucursal' : 'Proponer compra o venta'}
      pie={[<Btn key="c" v="t" onClick={onHide}>Cancelar</Btn>, <Btn key="e" v="p" disabled={!ok} onClick={enviar}>{directo ? 'Crear sucursal' : 'Enviar al director'}</Btn>]}>
      {!directo && <Seg opciones={['Comprar', 'Vender']} valor={E.modo} onChange={(modo) => set({ modo })} />}
      {comprar ? <>
        <Campo l="Zona"><Form.Select disabled={E.costo != null} value={E.zona} onChange={(e) => set({ zona: e.target.value })}>{datos.zonas.map((z) => <option key={z}>{z}</option>)}</Form.Select></Campo>
        <Campo l="Tamaño"><Form.Select disabled={E.costo != null} value={E.tam} onChange={(e) => set({ tam: e.target.value })}>{datos.tamanos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</Form.Select></Campo>
        <div className="tw:flex tw:items-center tw:gap-3">
          <Btn disabled={E.costo != null} onClick={calcular}>Calcular costo</Btn>
          {E.costo != null && <b className="tw:text-lg">{$(E.costo)}</b>}
          {E.costo != null && <Btn v="t" onClick={() => set({ costo: null })}>Cambiar zona o tamaño</Btn>}
        </div>
        <Mut>La zona y el tamaño fijan el intervalo del costo.</Mut>
      </> : (
        <Campo l="Sucursal"><Form.Select value={E.suc} onChange={(e) => set({ suc: +e.target.value })}>{operando.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</Form.Select></Campo>
      )}
      {!directo && <Campo l="Motivo (mín. 10 caracteres)"><Form.Control as="textarea" rows={3} value={E.motivo} onChange={(e) => set({ motivo: e.target.value })} /></Campo>}
      {directo && <Mut>Se abre con su menú, proveedores y vacantes de máxima prioridad para Recursos Humanos.</Mut>}
      {!comprar && bl && <Err>{bl}</Err>}
    </Panel>
  );
}

const SS = { v: 'suc' };
function SucursalesTab() {
  const { confirmar, accion } = useDialogos();
  const { datos } = useDatos('/gg/sucursales');
  const [v, setVS] = useState(SS.v);
  const [prop, setProp] = useState(false);
  if (!datos) return <Cargando />;
  const abrir = datos.propuestas.filter((p) => p.estado === 'Compra aprobada');
  const abrirSuc = async (p) => {
    if (!(await confirmar({ titulo: 'Abrir sucursal', texto: 'Se crea la sucursal con su tamaño y se generan las vacantes mínimas de cada rol con máxima prioridad para que Recursos Humanos las cubra. El sistema genera el transporte y el tiempo de entrega de cada proveedor activo.', verbo: 'Abrir' }))) return;
    await accion(() => api.post(`/gg/sucursales/propuestas/${p.id}/abrir`), 'Sucursal abierta. Vacantes generadas');
  };
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Pildoras opciones={[['suc', 'Sucursales'], ['pro', `Propuestas (${datos.propuestas.length})`]]} valor={v} onChange={(x) => { SS.v = x; setVS(x); }} />
        <span className="tw:flex-1" /><Btn v="p" onClick={() => setProp(true)}>Proponer compra o venta</Btn>
      </div>
      {abrir.map((p) => (
        <Ban key={p.id} className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">Debes abrir esta sucursal: {p.zona} · {p.tamanoNombre}<span className="tw:flex-1" /><Btn v="p" onClick={() => abrirSuc(p)}>Abrir sucursal</Btn></Ban>
      ))}
      {v === 'pro' ? (datos.propuestas.length ? <Tabla cols={['Tipo', 'Detalle', 'Costo', 'Estado', 'Fecha']} filas={datos.propuestas.map((p) => [
        p.tipo, p.tipo === 'Compra' ? `${p.zona} · ${p.tamanoNombre}` : p.sucNombre, $(p.costo),
        <><Chip t={p.estado} o={TONO_P[p.estado]} />{p.rechazo && <div className="tw:text-er tw:text-xs">Motivo: {p.rechazo}</div>}</>, fmt(p.fecha),
      ])} /> : <Vacio ic="list">No hay propuestas de compra o venta</Vacio>)
        : <Grid min={240}>{datos.sucursales.map((s) => (
          <Card key={s.id} className="tw:flex tw:flex-col tw:gap-1.5">
            <b className="tw:text-[16px]">{s.nombre}</b>
            <Mut>{s.zona} · {s.tamanoNombre} · {s.mesas} mesas</Mut>
            <div className="tw:flex tw:flex-wrap tw:gap-1.5">
              <Chip t={s.estado === 'Cierre ordenado' ? 'Cierre ordenado en curso' : s.estado} o={ESTS[s.estado]} />
              {s.vacantes && <Chip t={`Vacantes ${s.vacantes.c} de ${s.vacantes.t} cubiertas`} o={s.vacantes.c >= s.vacantes.t ? 'ok' : 'wa'} />}
            </div>
          </Card>
        ))}</Grid>}
      {prop && <Proponer datos={datos} onHide={() => setProp(false)} />}
    </Stack>
  );
}

const SD = { v: 'sol' };
function Despidos() {
  const { motivo, confirmar, accion } = useDialogos();
  const { datos } = useDatos('/gg/despidos');
  const [v, setVS] = useState(SD.v);
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const x = ver && datos.solicitudes.find((s) => s.id === ver);
  const aprobar = async () => {
    if (!(await confirmar({ titulo: `Aprobar el despido de ${x.usuarioNombre}`, texto: 'Se aplica con su indemnización (art. 58) y la persona queda sin acceso. El historial se conserva.', verbo: 'Aprobar', rojo: true }))) return;
    if (await accion(() => api.post(`/gg/despidos/${x.id}/aprobar`), 'Despido aplicado')) setVer(null);
  };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/gg/despidos/${x.id}/rechazar`, { motivo: m }), 'Despido rechazado')) setVer(null);
  };
  return (
    <Stack>
      <div><Pildoras opciones={[['sol', `Solicitudes (${datos.solicitudes.length})`], ['rep', `Reportes (${datos.reportes.length})`]]} valor={v} onChange={(y) => { SD.v = y; setVS(y); }} /></div>
      {v === 'rep' ? <>
        <Mut>Informativo: despidos que aprobaron los gerentes de sucursal.</Mut>
        {datos.reportes.length ? <Tabla cols={['Empleado', 'Sucursal', 'Razón', 'Indemnización', 'Aprobó', 'Fecha']} filas={datos.reportes.map((s) => [
          s.usuarioNombre, s.sucNombre, s.motivo, $(s.datos?.indemn?.monto || s.monto || 0), s.aproboNombre || '—', fFecha(s.cierre)])} /> : <Vacio ic="list">No hay reportes de despidos</Vacio>}
      </> : datos.solicitudes.length ? <Tabla cols={['Empleado', 'Rol', 'Fecha']} filas={datos.solicitudes.map((s) => ({ onClick: () => setVer(s.id), celdas: [s.usuarioNombre, s.rolNombre, fmt(s.fecha)] }))} />
        : <Vacio ic="check">No hay despidos por aprobar</Vacio>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={`Despido · ${x.usuarioNombre}`} estado="Solicitada" pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="red" onClick={aprobar}>Aprobar</Btn>]}>
          <Kv pares={[['Empleado', x.usuarioNombre], ['Rol', x.rolNombre], ['Sucursal', x.sucNombre], ['Razón de Recursos Humanos', x.motivo], ['Fecha', fmt(x.fecha)]]} />
        </Panel>
      )}
    </Stack>
  );
}

const SP = { v: 'min', suc: '' };
function Plantilla() {
  const { motivo, confirmar, accion } = useDialogos();
  const { datos } = useDatos('/gg/plantilla');
  const [f, setFS] = useState(SP);
  const setF = (x) => { Object.assign(SP, x); setFS({ ...SP }); };
  const [draft, setDraft] = useState(null);
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const d = draft || datos.minimos;
  const cambia = JSON.stringify(d) !== JSON.stringify(datos.minimos);
  const paso = (t, r, n) => setDraft({ ...d, [t]: { ...d[t], [r]: Math.max(0, (d[t][r] || 0) + n) } });
  const x = ver && datos.solicitudes.find((s) => s.id === ver);
  const aprobar = async () => {
    if (!(await confirmar({ titulo: 'Aprobar la solicitud', texto: `Se abrirán ${x.cant} vacante${x.cant === 1 ? '' : 's'} con prioridad para que Recursos Humanos las cubra y asigne a esa sucursal.`, verbo: 'Aprobar' }))) return;
    if (await accion(() => api.post(`/gg/personal/${x.id}/aprobar`), 'Vacantes abiertas')) setVer(null);
  };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/gg/personal/${x.id}/rechazar`, { motivo: m }), 'Solicitud rechazada')) setVer(null);
  };
  return (
    <Stack>
      <div><Pildoras opciones={[['min', 'Mínimos por tamaño'], ['pla', 'Plantillas'], ['sol', `Solicitudes de personal (${datos.solicitudes.length})`]]} valor={f.v} onChange={(v) => setF({ v })} /></div>
      {f.v === 'min' && <>
        <Tabla cols={['Rol', ...datos.tamanos.map((t) => t.nombre)]} filas={datos.roles.map((r) => [r.nombre, ...datos.tamanos.map((t) => (
          <div key={t.id} className="tw:flex tw:items-center tw:gap-2">
            <Btn disabled={(d[t.id][r.id] || 0) <= 0} onClick={() => paso(t.id, r.id, -1)} aria-label={`Quitar ${r.nombre} ${t.nombre}`}>−</Btn>
            <b className="tw:min-w-[18px] tw:text-center">{d[t.id][r.id] || 0}</b>
            <Btn onClick={() => paso(t.id, r.id, 1)} aria-label={`Agregar ${r.nombre} ${t.nombre}`}>+</Btn>
          </div>
        ))])} />
        <Mut>Se aplica al abrir una sucursal y es el piso de la plantilla que define cada gerente.</Mut>
        <div className="tw:flex tw:justify-end"><Btn v="p" disabled={!cambia} onClick={async () => { if (await accion(() => api.put('/gg/minimos', d), 'Mínimos guardados')) setDraft(null); }}>Guardar mínimos</Btn></div>
      </>}
      {f.v === 'pla' && <>
        <Form.Select value={f.suc} onChange={(e) => setF({ suc: e.target.value })} className="tw:max-w-[220px]" aria-label="Sucursal">
          <option value="">Todas las sucursales</option>{datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Form.Select>
        <Tabla cols={['Sucursal', 'Rol', 'Necesarios', 'Actuales', 'Faltan']} filas={datos.plantillas.filter((p) => !f.suc || p.suc === +f.suc).map((p) => [
          p.sucNombre, p.rolNombre, p.necesarios, p.actuales, p.faltan ? <b className="tw:text-er">{p.faltan}</b> : '—'])} />
      </>}
      {f.v === 'sol' && (datos.solicitudes.length ? <Tabla cols={['Sucursal', 'Rol', 'Cantidad', 'Fecha']} filas={datos.solicitudes.map((s) => ({
        onClick: () => setVer(s.id), celdas: [s.sucNombre, s.rolNombre, s.cant, fmt(s.fecha)],
      }))} /> : <Vacio ic="check">No hay solicitudes de personal</Vacio>)}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={`Personal · ${x.sucNombre}`} estado="Solicitada" pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" onClick={aprobar}>Aprobar</Btn>]}>
          <Kv pares={[['Sucursal', x.sucNombre], ['Rol', x.rolNombre], ['Cantidad', x.cant], ['Plantilla actual', `${x.actuales} de ${x.necesarios} necesarios`], ['Motivo', x.motivo]]} />
        </Panel>
      )}
    </Stack>
  );
}

export default function SucursalesGG({ tab = 'sucursales' }) {
  if (tab === 'despidos') return <Despidos />;
  if (tab === 'plantilla') return <Plantilla />;
  return <SucursalesTab />;
}
