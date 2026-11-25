import { useState } from 'react';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fFecha, fmt } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Btn, Cargando, Chip, Err, Kv, Mut, Panel, Pildoras, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { ChipCompra, CompraResumen, LotesRecibidos, lineasTxt } from '../../components/Compras.jsx';
import { Contrasenas, FormProveedor, Proveedores } from '../../components/Franquicia.jsx';

/* Gerente general · 7.2 Compras, 7.4 Proveedores, 7.5 Precios, menús y contraseñas (sin clave: confirma y, al rechazar, motivo) */
const REV = ['Devolución en revisión', 'Cancelación en revisión', 'Descuento en revisión'];
const SC = { v: 'aceptar', suc: '' };

/* ---------- 7.2 Compras ---------- */
function Compras() {
  const { motivo, confirmar, accion } = useDialogos();
  const [f, setFS] = useState(SC);
  const setF = (x) => { Object.assign(SC, x); setFS({ ...SC }); };
  const { datos } = useDatos(`/gg/compras?vista=${f.v}&suc=${f.suc}`);
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const c = ver && datos.compras.find((x) => x.id === ver);
  const rev = c && REV.includes(c.estado);
  const d = c?.detalle || {};
  const aceptar = async () => {
    let t;
    if (!rev) t = { titulo: 'Aceptar la compra', texto: 'Se confirmará con el proveedor, se enviará una sola factura por toda la solicitud y se registrará el gasto. Si es a crédito se creará la cuenta por pagar.' };
    else if (c.estado === 'Descuento en revisión') t = { titulo: `Aprobar ${d.solDescuento.tipo.toLowerCase()}`, texto: `Se aplica ${$(d.solDescuento.monto)} a la factura (o crédito a favor con el proveedor si ya está pagada).` };
    else {
      const inf = c.estado === 'Devolución en revisión' ? d.devolucion : d.cancelacion;
      t = { titulo: `Aceptar ${c.estado === 'Devolución en revisión' ? 'la devolución' : 'la cancelación'}`, texto: `Queda registrada la pérdida de la sucursal (${$(inf?.perdida || 0)}) y la factura se anula salvo el costo ya incurrido.` };
    }
    if (!(await confirmar({ ...t, verbo: 'Aceptar' }))) return;
    if (await accion(() => api.post(`/gg/compras/${c.id}/aceptar`), rev ? 'Revisión aceptada' : 'Compra en camino')) setVer(null);
  };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/gg/compras/${c.id}/rechazar`, { motivo: m }), rev ? 'Sin cambios: se avisó al gerente' : 'Compra rechazada')) setVer(null);
  };
  const vacio = { aceptar: 'No hay compras por aceptar', rev: 'No hay devoluciones ni cancelaciones', hist: 'Aún no hay historial' }[f.v];
  const banner = () => {
    if (c.estado === 'Descuento en revisión') return <Ban>Solicitud de {d.solDescuento.tipo.toLowerCase()} por {$(d.solDescuento.monto)} · Motivo del gerente de sucursal: {d.solDescuento.motivo}</Ban>;
    const inf = c.estado === 'Devolución en revisión' ? d.devolucion : d.cancelacion;
    return <Ban>{c.estado === 'Devolución en revisión' ? 'Devolución de mercancía' : 'Cancelación de compra'} · Justificación del gerente de sucursal: {inf?.motivo} · Pérdida de la sucursal: {$(inf?.perdida || 0)}</Ban>;
  };
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Pildoras opciones={[['aceptar', `Compras por aceptar (${datos.n.aceptar})`], ['rev', `Devoluciones, descuentos y cancelaciones (${datos.n.rev})`], ['hist', `Historial (${datos.n.hist})`]]}
          valor={f.v} onChange={(v) => setF({ v })} />
        <Form.Select value={f.suc} onChange={(e) => setF({ suc: e.target.value })} className="tw:max-w-[210px]" aria-label="Sucursal">
          <option value="">Todas las sucursales</option>{datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Form.Select>
      </div>
      {datos.compras.length ? <Tabla cols={['Sucursal', 'Materias primas', 'Proveedor', 'Monto', 'Estado']} filas={datos.compras.map((x) => ({
        onClick: () => setVer(x.id), tono: x.cotVencida ? 'rj' : undefined,
        celdas: [x.sucNombre, lineasTxt(x), x.provNombre, $(x.total), <><ChipCompra e={x.estado} />{x.gerente && <div className="tw:text-xs tw:text-tx2">Aprobada con clave por {x.gerente.nombre}</div>}</>],
      }))} /> : <Vacio ic="check">{vacio}</Vacio>}
      {c && (
        <Panel show onHide={() => setVer(null)} titulo={`Compra #${c.id}`} estado={c.estado} ro={!(c.estado === 'Aceptada por gerente' || rev)}
          pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" disabled={c.cotVencida} onClick={aceptar}>Aceptar</Btn>]}>
          {c.cotVencida && <Err>La cotización venció. Rechaza la solicitud para que se cotice de nuevo.</Err>}
          {rev && banner()}
          <CompraResumen c={c} conSucursal />
          <Kv pares={[['Aprobada con clave por', c.gerente?.nombre || '—'], ...(c.gg ? [['Aceptó gerencia general', `${c.gg.nombre} · ${fmt(c.gg.fecha)}`]] : [])]} />
          {c.recepcion && <><h4 className="tw:text-sm tw:m-0">Lotes recibidos</h4><LotesRecibidos c={c} /></>}
        </Panel>
      )}
    </Stack>
  );
}

/* ---------- 7.4 Proveedores y materias primas sin proveedor ---------- */
function SinProveedor() {
  const { motivo, accion, toast } = useDialogos();
  const { datos } = useDatos('/gg/sin-proveedor');
  const [ver, setVer] = useState(null);
  const [sel, setSel] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  if (!datos) return <Cargando />;
  const x = ver && datos.find((s) => s.id === ver);
  const asignar = async (prov) => { if (await accion(() => api.post(`/gg/sin-proveedor/${x.id}/asignar`, { proveedor: prov }), 'Proveedor asignado')) { setSel(null); setVer(null); } };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo', nota: 'También se rechaza la propuesta del producto que la necesitaba.' });
    if (m && await accion(() => api.post(`/gg/sin-proveedor/${x.id}/rechazar`, { motivo: m }), 'Solicitud rechazada')) setVer(null);
  };
  return (
    <Stack>
      {datos.length ? <Tabla cols={['Materia prima', 'Producto', 'Propuso', 'Sucursal']} filas={datos.map((s) => ({ onClick: () => setVer(s.id), celdas: [s.mpNombre, s.producto, s.propone, s.sucNombre] }))} />
        : <Vacio ic="check">No hay materias primas sin proveedor</Vacio>}
      {x && !nuevo && (
        <Panel show onHide={() => setVer(null)} titulo={x.mpNombre}
          pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="n" onClick={() => setNuevo(true)}>Agregar proveedor nuevo</Btn>,
            <Btn key="a" v="p" onClick={() => (x.candidatos.length ? setSel(x.candidatos[0].id) : toast('No hay proveedores activos que la ofrezcan. Agrega uno nuevo'))}>Asignar proveedor</Btn>]}>
          <Kv pares={[['Materia prima', x.mpNombre], ['Producto que la origina', x.producto], ['Propuso', x.propone], ['Sucursal', x.sucNombre], ['Fecha', fmt(x.fecha)]]} />
          {x.nueva && <Mut>Es una materia prima nueva: se crea en el inventario de la franquicia al asignarle proveedor.</Mut>}
        </Panel>
      )}
      {x && nuevo && <FormProveedor mpPre={x.nueva ? x.ref : +x.ref} onHide={() => setNuevo(false)} onListo={(id) => asignar(id)} />}
      <Modal show={sel != null} onHide={() => setSel(null)} centered>
        <Modal.Body>
          <h3>Asignar proveedor · {x?.mpNombre}</h3>
          <Form.Select value={sel || ''} onChange={(e) => setSel(+e.target.value)}>{x?.candidatos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}</Form.Select>
          <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={() => setSel(null)}>Cancelar</Btn><Btn v="p" onClick={() => asignar(sel)}>Asignar</Btn></div>
        </Modal.Body>
      </Modal>
    </Stack>
  );
}

const SP = { v: 'prov' };
function ProveedoresGG() {
  const [v, setV] = useState(SP.v);
  const { datos } = useDatos('/gg/sin-proveedor');
  return (
    <Stack>
      <div><Pildoras opciones={[['prov', 'Proveedores'], ['sin', `Sin proveedor (${datos?.length ?? 0})`]]} valor={v} onChange={(x) => { SP.v = x; setV(x); }} /></div>
      {v === 'sin' ? <SinProveedor /> : <Proveedores />}
    </Stack>
  );
}

/* ---------- 7.5 Precios ---------- */
function Precios() {
  const { motivo, confirmar, accion } = useDialogos();
  const { datos } = useDatos('/gg/precios');
  const [v, setV] = useState('sol');
  const [ver, setVer] = useState(null);
  const [prod, setProd] = useState('');
  const pid = prod || datos?.productos[0]?.id;
  const { datos: hist } = useDatos(v === 'hist' && pid ? `/gg/precios/historial/${pid}` : null);
  if (!datos) return <Cargando />;
  const x = ver && datos.pendientes.find((s) => s.id === ver);
  const malo = x && x.neto < x.costoMax;
  const aprobar = async () => {
    if (!(await confirmar({ titulo: 'Aprobar el cambio de precio', texto: 'Se cierra el precio vigente y se crea el nuevo, válido en todas las sucursales desde el siguiente pedido. Los pedidos ya creados conservan su precio.', verbo: 'Aprobar' }))) return;
    if (await accion(() => api.post(`/gg/precios/${x.id}/aprobar`), 'Precio aprobado')) setVer(null);
  };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/gg/precios/${x.id}/rechazar`, { motivo: m }), 'Precio rechazado')) setVer(null);
  };
  return (
    <Stack>
      <div><Pildoras opciones={[['sol', `Solicitudes (${datos.pendientes.length})`], ['hist', 'Historial de precios']]} valor={v} onChange={setV} /></div>
      {v === 'hist' ? <>
        <Form.Select value={pid} onChange={(e) => setProd(e.target.value)} className="tw:max-w-[300px]" aria-label="Producto">
          {datos.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Form.Select>
        {!hist ? <Cargando /> : hist.length ? <Tabla cols={['Precio', 'Desde', 'Hasta', 'Aprobó']} filas={hist.map((h) => [$(h.precio), fFecha(h.desde), h.hasta ? fFecha(h.hasta) : <Chip t="Vigente" o="ok" />, h.aprobo || '—'])} />
          : <Vacio ic="list">Sin historial</Vacio>}
      </> : datos.pendientes.length ? <Tabla cols={['Producto', 'Sucursal', 'Actual', 'Propuesto', 'Fecha']} filas={datos.pendientes.map((s) => ({
        onClick: () => setVer(s.id), celdas: [s.nombre, s.sucNombre, $(s.precioActual), $(s.precio), fmt(s.fecha)],
      }))} /> : <Vacio ic="check">No hay cambios de precio pendientes</Vacio>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={x.nombre} estado="Solicitada" pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" disabled={malo} onClick={aprobar}>Aprobar</Btn>]}>
          {malo && <Err>El precio es menor que el costo más alto</Err>}
          <Kv pares={[['Pide', `${x.sucNombre} · ${x.solicitanteNombre}`], ['Motivo', x.motivo], ['Precio actual (IVA incluido)', $(x.precioActual)], ['Precio propuesto (IVA incluido)', $(x.precio)],
            ['Precio propuesto sin IVA', $(x.neto)], ['Costo más alto entre sucursales', <span className="tw:text-er">{$(x.costoMax)}</span>], ['Margen resultante', `${$(x.margen)} (${x.pct} %)`]]} />
        </Panel>
      )}
    </Stack>
  );
}

/* ---------- agregar productos al menú de una sucursal ---------- */
function Menus() {
  const { motivo, confirmar, accion } = useDialogos();
  const { datos } = useDatos('/gg/menus');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const x = ver && datos.find((s) => s.id === ver);
  const aprobar = async () => {
    if (!(await confirmar({ titulo: `Agregar «${x.nombre}» al menú`, texto: `Quedará disponible en ${x.sucNombre}.`, verbo: 'Aprobar' }))) return;
    if (await accion(() => api.post(`/gg/menus/${x.id}/aprobar`), 'Producto agregado al menú')) setVer(null);
  };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/gg/menus/${x.id}/rechazar`, { motivo: m }), 'Solicitud rechazada')) setVer(null);
  };
  return (
    <Stack>
      {datos.length ? <Tabla cols={['Producto', 'Sucursal', 'Pide', 'Fecha']} filas={datos.map((s) => ({ onClick: () => setVer(s.id), celdas: [s.nombre, s.sucNombre, s.solicitanteNombre, fmt(s.fecha)] }))} />
        : <Vacio ic="check">No hay solicitudes para agregar productos a un menú</Vacio>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={x.nombre} estado="Solicitada" pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" onClick={aprobar}>Aprobar</Btn>]}>
          <Kv pares={[['Sucursal', x.sucNombre], ['Pide', x.solicitanteNombre], ['Precio', `${$(x.precio)} IVA incluido`], ['Categorías', x.cats.join(', ') || '—']]} />
        </Panel>
      )}
    </Stack>
  );
}

const TABS = { compras: Compras, proveedores: ProveedoresGG, precios: Precios, menus: Menus, contrasenas: Contrasenas };
export default function AprobacionesGG({ tab = 'compras' }) {
  const T = TABS[tab] || Compras;
  return <T />;
}
