import { useRef, useState } from 'react';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../lib/api.js';
import { $, fFecha, fmt } from '../lib/formato.js';
import { leerFoto } from '../lib/fotos.js';
import { useDatos, useSesion } from '../context/Sesion.jsx';
import { useDialogos } from '../context/Dialogos.jsx';
import { Icono } from './Icono.jsx';
import { Avatar, Btn, Campo, Card, Cargando, Chip, Err, Kv, Mut, Panel, Pildoras, Stack, Tabla, Vacio } from './ui.jsx';

/* Piezas que comparten Recursos Humanos, el gerente general y el director. */
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ---------- credenciales: se muestran una sola vez ---------- */
export function Credenciales({ titulo, filas, onHide }) {
  return (
    <Modal show={!!filas} onHide={onHide} centered>
      <Modal.Body>
        <h3>{titulo}</h3>
        <p className="tw:text-tx2 tw:m-0">Se muestra una sola vez. Anótalo y entrégaselo a la persona.</p>
        {filas && <Kv pares={filas} />}
        <div className="tw:flex tw:justify-end"><Btn v="p" onClick={onHide}>Entendido</Btn></div>
      </Modal.Body>
    </Modal>
  );
}

/* ---------- contraseñas por restablecer ---------- */
export function Contrasenas() {
  const { motivo, confirmar, accion } = useDialogos();
  const { datos } = useDatos('/franquicia/contrasenas');
  const [cred, setCred] = useState(null);
  if (!datos) return <Cargando />;
  const asignar = async (x) => {
    if (!(await confirmar({ titulo: 'Asignar contraseña temporal', texto: `Se la generamos a ${x.usuarioNombre || x.nombre}. La verás una sola vez y deberá cambiarla al entrar.`, verbo: 'Asignar' }))) return;
    const r = await accion(() => api.post(`/franquicia/contrasenas/${x.id}/asignar`), 'Contraseña temporal asignada');
    if (r) setCred([['Usuario', r.usuario], ['Contraseña temporal', r.pass], ...(r.pin ? [['PIN temporal', r.pin]] : [])]);
  };
  const rechazar = async (x) => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m) await accion(() => api.post(`/franquicia/contrasenas/${x.id}/rechazar`, { motivo: m }), 'Solicitud rechazada');
  };
  return (
    <Stack>
      {datos.length ? datos.map((x) => {
        const pen = x.estado === 'Solicitada';
        return (
          <Card key={x.id} className="tw:flex tw:flex-col tw:gap-2">
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
              <b>{x.usuarioNombre || x.nombre}</b><Mut>@{x.usuarioLogin} · {fmt(x.fecha)}</Mut><span className="tw:flex-1" />
              <Chip t={pen ? 'Solicitada' : x.estado} o={pen ? 'g' : x.estado === 'Aplicada' ? 'ok' : 'er'} />
            </div>
            {x.rechazo && <Err>Motivo: {x.rechazo.motivo}</Err>}
            {pen && <div className="tw:flex tw:flex-wrap tw:gap-2"><Btn v="p" onClick={() => asignar(x)}>Asignar contraseña temporal</Btn><Btn onClick={() => rechazar(x)}>Rechazar</Btn></div>}
          </Card>
        );
      }) : <Vacio ic="lock">No hay solicitudes de contraseña</Vacio>}
      <Credenciales titulo="Contraseña temporal" filas={cred} onHide={() => setCred(null)} />
    </Stack>
  );
}

/* ---------- elegir varias materias primas ---------- */
export function ElegirMaterias({ show, materias, valor, onDone, onHide }) {
  const [sel, setSel] = useState(valor);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Todas');
  const cats = [...new Set(materias.map((m) => m.categoria).filter(Boolean))];
  const vis = materias.filter((m) => (cat === 'Todas' || m.categoria === cat) && (!q || norm(m.nombre).includes(norm(q))));
  const alterna = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  return (
    <Modal show={show} onHide={onHide} centered scrollable>
      <Modal.Body>
        <h3>Materias primas que ofrece</h3>
        <Form.Control type="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar materia prima" />
        {cats.length > 1 && <Pildoras opciones={['Todas', ...cats]} valor={cat} onChange={setCat} />}
        <div className="tw:flex tw:flex-col tw:gap-1.5 tw:max-h-[46vh] tw:overflow-auto tw:p-0.5">
          {vis.length ? vis.map((m) => (
            <button key={m.id} type="button" onClick={() => alterna(m.id)}
              className={`tw:flex tw:items-center tw:gap-3 tw:px-3.5 tw:py-2.5 tw:border tw:rounded-[16px] tw:text-left tw:text-tx ${sel.includes(m.id) ? 'tw:border-br tw:bg-brs' : 'tw:border-bd tw:bg-sf'}`}>
              <span className={`tw:w-6 tw:h-6 tw:rounded-md tw:grid tw:place-items-center tw:border ${sel.includes(m.id) ? 'tw:bg-br tw:border-br tw:text-white' : 'tw:border-bd'}`}>{sel.includes(m.id) && <Icono n="check" size={14} />}</span>
              <span className="tw:flex-1"><b>{m.nombre}</b> <small className="tw:text-tx2">{m.unidad}</small></span>
            </button>
          )) : <Vacio ic="search">Nada coincide con tu búsqueda</Vacio>}
        </div>
        <div className="tw:flex tw:items-center tw:gap-2"><Mut>{sel.length} elegida{sel.length === 1 ? '' : 's'}</Mut><span className="tw:flex-1" />
          <Btn v="t" onClick={onHide}>Cancelar</Btn><Btn v="p" onClick={() => onDone(sel)}>Listo</Btn></div>
      </Modal.Body>
    </Modal>
  );
}

/* ---------- alta y edición de proveedor (no pide precios, transporte ni tiempos: los genera el sistema) ---------- */
export function FormProveedor({ id, mpPre, nombrePre, onHide, onListo }) {
  const { accion } = useDialogos();
  const { datos: materias } = useDatos('/franquicia/materias');
  const { datos: v } = useDatos(id ? `/franquicia/proveedores/${id}` : null);
  const [E, setE] = useState(null);
  const [elegir, setElegir] = useState(false);
  const [er, setEr] = useState('');
  if (!materias || (id && !v)) return <Panel show onHide={onHide} titulo={id ? 'Editar proveedor' : 'Agregar proveedor'}><Cargando /></Panel>;
  const e = E || (v
    ? { nombre: v.nombre, pago: v.pago, mps: v.mps.map((m) => m.id), tipo: v.politica.tipo, tol: v.politica.tolH, esc: v.politica.escala, tope: v.politica.tope }
    : { nombre: '', pago: 'Contado', mps: mpPre ? [mpPre] : [], tipo: 'Descuento', tol: 12, esc: 5, tope: 20 });
  const set = (x) => setE({ ...e, ...x });
  const lista = [...materias, ...(mpPre && String(mpPre).startsWith('new:') ? [{ id: mpPre, nombre: `${nombrePre || String(mpPre).slice(4)} (nueva)`, unidad: '' }] : [])];
  const nombreDe = (m) => lista.find((x) => x.id === m)?.nombre || String(m);
  const ok = e.nombre.trim().length >= 3 && e.mps.length && +e.esc > 0 && +e.tope > 0 && +e.tol >= 0 && +e.tope >= +e.esc;
  const ind = e.tipo === 'Indemnización';
  const guardar = async () => {
    try {
      const r = id ? await api.put(`/franquicia/proveedores/${id}`, e) : await api.post('/franquicia/proveedores', e);
      await accion(async () => {}, id ? 'Proveedor actualizado' : 'Proveedor agregado');
      onListo?.(r.id);
      onHide();
    } catch (x) { setEr(x.message); }
  };
  return (
    <Panel show onHide={onHide} titulo={id ? 'Editar proveedor' : 'Agregar proveedor'} pie={[<Btn key="c" v="t" onClick={onHide}>Cancelar</Btn>, <Btn key="g" v="p" disabled={!ok} onClick={guardar}>Guardar</Btn>]}>
      <Campo l="Nombre"><Form.Control value={e.nombre} onChange={(x) => set({ nombre: x.target.value })} /></Campo>
      <Campo l="Condición de pago"><Form.Select value={e.pago} onChange={(x) => set({ pago: x.target.value })}>{['Contado', '15 días', '30 días'].map((p) => <option key={p}>{p}</option>)}</Form.Select></Campo>
      <div className="tw:flex tw:flex-col tw:gap-1.5">
        <span>Materias primas que ofrece</span>
        <Btn onClick={() => setElegir(true)}>{e.mps.length ? `${e.mps.length} materia${e.mps.length === 1 ? '' : 's'} prima${e.mps.length === 1 ? '' : 's'} elegida${e.mps.length === 1 ? '' : 's'}` : 'Elegir materias primas'}</Btn>
        {e.mps.length > 0 && <div className="tw:flex tw:flex-wrap tw:gap-1.5">{e.mps.map((m) => <Chip key={m} t={nombreDe(m)} o="g" sinSimbolo />)}</div>}
      </div>
      <h4 className="tw:text-sm tw:m-0">Política de atrasos</h4>
      <Campo l="Tipo"><Form.Select value={e.tipo} onChange={(x) => set({ tipo: x.target.value })}>{['Descuento', 'Indemnización', 'Reembolso'].map((p) => <option key={p}>{p}</option>)}</Form.Select></Campo>
      <Campo l="Tolerancia de atraso (horas)"><Form.Control type="number" min={0} value={e.tol} onChange={(x) => set({ tol: x.target.value })} /></Campo>
      <Campo l={ind ? 'Monto por día de atraso ($)' : 'Porcentaje por día de atraso (%)'}><Form.Control type="number" min={0} step="any" value={e.esc} onChange={(x) => set({ esc: x.target.value })} /></Campo>
      <Campo l={ind ? 'Tope ($)' : 'Tope (%)'}><Form.Control type="number" min={0} step="any" value={e.tope} onChange={(x) => set({ tope: x.target.value })} /></Campo>
      <Mut>No pide precios, transporte ni tiempos: el sistema los genera solo para cada materia prima y cada sucursal.</Mut>
      <Err>{er}</Err>
      {elegir && <ElegirMaterias show materias={lista} valor={e.mps} onHide={() => setElegir(false)} onDone={(mps) => { set({ mps }); setElegir(false); }} />}
    </Panel>
  );
}

function HistorialProveedor({ id, nombre, onHide }) {
  const { datos } = useDatos(`/franquicia/proveedores/${id}/historial`);
  const vig = <Chip t="Vigente" o="ok" />;
  return (
    <Panel show onHide={onHide} titulo={`Historial · ${nombre}`} ro>
      {!datos ? <Cargando /> : <>
        <Mut>Actualizado por el sistema, cada semana simulada.</Mut>
        <h4 className="tw:text-sm tw:m-0">Precios</h4>
        <Tabla cols={['Materia prima', 'Precio', 'Desde', 'Hasta']} filas={datos.precios.map((h) => [h.nombre, $(h.precio), fFecha(h.desde), h.hasta ? fFecha(h.hasta) : vig])} />
        <h4 className="tw:text-sm tw:m-0">Transporte</h4>
        <Tabla cols={['Sucursal', 'Costo', 'Desde', 'Hasta']} filas={datos.transporte.map((h) => [h.sucursal, $(h.costo), fFecha(h.desde), h.hasta ? fFecha(h.hasta) : vig])} />
      </>}
    </Panel>
  );
}

/* ---------- ficha de proveedor ---------- */
export function FichaProveedor({ id, onHide }) {
  const { usuario } = useSesion();
  const { motivo, accion, toast } = useDialogos();
  const { datos: v } = useDatos(`/franquicia/proveedores/${id}`);
  const [vista, setVista] = useState(null);
  const [factura, setFactura] = useState(null);
  const archivo = useRef(null);
  if (!v) return <Panel show onHide={onHide} titulo="Proveedor"><Cargando /></Panel>;
  if (vista === 'editar') return <FormProveedor id={id} onHide={() => setVista(null)} />;
  if (vista === 'hist') return <HistorialProveedor id={id} nombre={v.nombre} onHide={() => setVista(null)} />;
  if (factura) return <DetalleFactura id={factura} onHide={() => setFactura(null)} />;
  const activo = v.estado === 'Activo';
  const inhabilitar = async () => {
    const m = await motivo({ titulo: `Motivo para inhabilitar a ${v.nombre}` });
    if (m && await accion(() => api.post(`/franquicia/proveedores/${id}/inhabilitar`, { motivo: m }), 'Proveedor inhabilitado')) onHide();
  };
  const eliminar = async () => {
    if (v.ocupado) return toast('Tiene compras o facturas pendientes: no se puede eliminar todavía');
    const m = await motivo({ titulo: `Motivo para eliminar a ${v.nombre}` });
    if (m && await accion(() => api.post(`/franquicia/proveedores/${id}/eliminar`, { motivo: m }), 'Proveedor eliminado')) onHide();
  };
  const foto = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) accion(async () => api.put(`/franquicia/proveedores/${id}/foto`, { dataUrl: await leerFoto(f) }), 'Foto actualizada');
  };
  return (
    <Panel show onHide={onHide} titulo={v.nombre} estado={activo ? 'Activo' : 'Inhabilitado'}
      pie={[
        activo && <Btn key="i" v="red" disabled={v.ocupado} title={v.ocupado ? 'Tiene compras en camino o facturas por pagar' : ''} onClick={inhabilitar}>Inhabilitar</Btn>,
        usuario.rol === 'director' && <Btn key="e" v="red" onClick={eliminar}>Eliminar proveedor</Btn>,
        <Btn key="h" onClick={() => setVista('hist')}>Historial de precios</Btn>,
        activo && <Btn key="ed" v="p" onClick={() => setVista('editar')}>Editar</Btn>,
      ].filter(Boolean)}>
      <div className="tw:flex tw:items-center tw:gap-4">
        <Avatar u={{ id: `p${v.id}`, nombre: v.nombre, foto: v.foto }} size={72} />
        <div className="tw:flex tw:flex-wrap tw:gap-1">
          <Btn v="t" onClick={() => archivo.current.click()}>{v.foto ? 'Cambiar foto' : 'Agregar foto'}</Btn>
          {v.foto && <Btn v="t" onClick={() => accion(() => api.put(`/franquicia/proveedores/${id}/foto`, {}), 'Foto quitada')}>Quitar</Btn>}
        </div>
        <input ref={archivo} type="file" accept="image/*" hidden onChange={foto} />
      </div>
      {v.ocupado && activo && <Mut>Tiene compras en camino o facturas por pagar: no se puede inhabilitar todavía.</Mut>}
      <Kv pares={[
        ['Condición de pago', v.pago], ['Política de atrasos', v.politicaTxt], ['Saldo a favor', $(v.saldoFavor)],
        ['Registrado por', v.creo ? `${v.creo.nombre} · ${fFecha(v.creo.fecha)}` : 'Datos iniciales'],
        ['Última edición', v.edito ? `${v.edito.nombre} · ${fFecha(v.edito.fecha)}` : 'Sin ediciones'],
      ]} />
      <h4 className="tw:text-sm tw:m-0">Precios por materia prima</h4>
      {v.mps.length ? <Tabla cols={['Materia prima', 'Precio']} filas={v.mps.map((m) => [m.nombre, `${$(m.precio)} / ${m.unidad}`])} /> : <Mut>No ofrece materias primas</Mut>}
      <h4 className="tw:text-sm tw:m-0">Facturas enviadas</h4>
      {v.facturas.length ? <Tabla cols={['N.º', 'Emitida', 'Monto', 'Estado']} filas={v.facturas.map((f) => ({ onClick: () => setFactura(f.id), celdas: [f.num, fFecha(f.emitida), $(f.monto), <Chip t={f.estado} o={f.estado === 'Pagada' ? 'ok' : f.estado === 'Anulada' ? 'g' : 'wa'} />] }))} />
        : <Mut>Aún no ha enviado facturas</Mut>}
      <h4 className="tw:text-sm tw:m-0">Cambios</h4>
      {v.cambios.length ? <Tabla cols={['Desde', 'Cambio']} filas={v.cambios.map((c) => [fFecha(c.fecha), c.detalle])} /> : <Mut>Sin cambios registrados</Mut>}
    </Panel>
  );
}

/* ---------- lista de proveedores con alta ---------- */
export function Proveedores() {
  const { datos } = useDatos('/franquicia/proveedores');
  const [ver, setVer] = useState(null);
  const [alta, setAlta] = useState(false);
  const [q, setQ] = useState('');
  if (!datos) return <Cargando />;
  const L = datos.filter((v) => !q || norm(`${v.nombre} ${v.mps.join(' ')}`).includes(norm(q)));
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Form.Control type="search" placeholder="Buscar proveedor o materia prima" value={q} onChange={(e) => setQ(e.target.value)} className="tw:max-w-[320px]" aria-label="Buscar" />
        <Mut>{datos.length} proveedor{datos.length === 1 ? '' : 'es'}</Mut><span className="tw:flex-1" />
        <Btn v="p" onClick={() => setAlta(true)}><Icono n="plus" />Agregar proveedor</Btn>
      </div>
      {L.length ? <Tabla cols={['Proveedor', 'Materias primas', 'Pago', 'Registrado por', 'Estado']} filas={L.map((v) => ({
        onClick: () => setVer(v.id), dim: v.estado !== 'Activo',
        celdas: [<span className="tw:flex tw:items-center tw:gap-2"><Avatar u={{ id: `p${v.id}`, nombre: v.nombre, foto: v.foto }} size={30} /><b>{v.nombre}</b></span>,
          `${v.mps.length} · ${v.mps.slice(0, 3).join(', ')}${v.mps.length > 3 ? '…' : ''}`, v.pago, v.creo || 'Datos iniciales',
          <Chip t={v.estado === 'Activo' ? 'Activo' : 'Inhabilitado'} o={v.estado === 'Activo' ? 'ok' : 'g'} />],
      }))} /> : <Vacio ic="truck">{datos.length ? 'Nada coincide con la búsqueda' : 'Aún no hay proveedores'}</Vacio>}
      {ver && <FichaProveedor id={ver} onHide={() => setVer(null)} />}
      {alta && <FormProveedor onHide={() => setAlta(false)} />}
    </Stack>
  );
}

/* ---------- detalle de factura ---------- */
export function DetalleFactura({ id, onHide, pie }) {
  const { datos: f } = useDatos(`/franquicia/facturas/${id}`);
  if (!f) return <Panel show onHide={onHide} titulo="Factura"><Cargando /></Panel>;
  return (
    <Panel show onHide={onHide} titulo={`Factura ${f.num}`} estado={f.estado} ro={!pie} pie={pie?.(f)}>
      <div className="tw:flex tw:items-center tw:gap-3"><Avatar u={{ id: `p${f.prov}`, nombre: f.provNombre, foto: f.provFoto }} size={52} />
        <div className="tw:flex tw:flex-col"><b>{f.provNombre}</b><Mut>Envió la factura el {fmt(f.emitida)}</Mut></div></div>
      <Kv pares={[
        ['Sucursal', f.sucNombre], ['Solicitud de compra', f.compra ? `#${f.compra}` : 'Registro anterior'], ['Condición de pago', f.condicion],
        ['Vence', fFecha(f.vence)], ['Monto', $(f.monto)], ...(f.original !== f.monto ? [['Monto original', $(f.original)]] : []),
        ...(f.creditos.length ? [['Créditos a favor', `−${$(f.creditos.reduce((a, c) => a + c.monto, 0))}`]] : []),
        ['Pago', f.estado === 'Pagada' ? `Pagada el ${fFecha(f.pagada)}${f.saldoUsado ? ` (saldo a favor ${$(f.saldoUsado)})` : ''}` : f.estado === 'Anulada' ? 'Anulada' : 'Pendiente'],
        ['Archivo de RR. HH.', f.archivo ? `${f.archivo.por} · ${fFecha(f.archivo.fecha)}` : 'Sin archivar'],
      ]} />
      {f.lineas.length ? <>
        <h4 className="tw:text-sm tw:m-0">Detalle</h4>
        <Tabla cols={['Materia prima', 'Cantidad', 'Precio', 'Subtotal']} filas={f.lineas.map((l) => [l.nombre, `${l.cant} ${l.unidad}`, $(l.precio), $(l.cant * l.precio)])} />
        <Kv pares={[['Subtotal', $(f.subtotal)], ['Transporte', $(f.transporte)]]} />
      </> : <Mut>Esta factura es de un registro anterior y no trae detalle por materia prima.</Mut>}
    </Panel>
  );
}
