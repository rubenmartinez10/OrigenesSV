import { useState } from 'react';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fFecha, fmt, r2 } from '../../lib/formato.js';
import { corr } from '../../lib/pedidos.js';
import { useDatos, useSesion, useAhora } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Btn, Campo, Card, Cargando, Chip, Err, Fila, Kv, Mut, Panel, Pildoras, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { ChipCompra, CompraResumen, LotesRecibidos, lineasTxt, recepcionParcial } from '../../components/Compras.jsx';
import { DetalleConteo } from '../bodega/Conteo.jsx';

/* Gerente de sucursal · Aprobaciones (5.2 productos, 5.3 compras y recepción, 5.5 ofertas, 5.7 caja, conteos, 5.10 equipo, 5.12 historial) */
const mn = (mp, M) => (String(mp).startsWith('new:') ? `${String(mp).slice(4)} (nueva)` : M[mp]?.nombre || mp);

/* ---------- 5.2 productos, extras y categorías propuestos ---------- */
function Productos() {
  const { config } = useSesion();
  const { motivo, confirmar, accion } = useDialogos();
  const { datos } = useDatos('/gerente/propuestas');
  const { datos: cat } = useDatos('/catalogo');
  const [ver, setVer] = useState(null);
  const [precio, setPrecio] = useState('');
  if (!datos || !cat) return <Cargando />;
  const M = Object.fromEntries(cat.materias.map((m) => [m.id, m]));
  const P = Object.fromEntries(cat.productos.map((p) => [p.id, p]));
  const x = ver && datos.find((s) => s.id === ver);
  const d = x?.datos || {};
  const precioOk = x?.tipo !== 'Producto nuevo' || (+precio > 0 && (x.costo.incompleto || +precio / (1 + (config?.iva ?? 13) / 100) > x.costo.costo));
  const aprobar = async () => {
    if (!(await confirmar({ titulo: `¿Aprobar «${x.nombre}»?`, texto: 'Pasa a Aprobado por gerente de sucursal y se envía al gerente general. No pide clave.', verbo: 'Aprobar' }))) return;
    if (await accion(() => api.post(`/gerente/propuestas/${x.id}/aprobar`, { precio: +precio }), 'Enviada al gerente general')) setVer(null);
  };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/gerente/propuestas/${x.id}/rechazar`, { motivo: m }), 'Propuesta rechazada')) setVer(null);
  };
  return (
    <Stack>
      {datos.length ? datos.map((s) => (
        <Fila key={s.id} ico="box" tono="wa" t={s.nombre} chips={<><Chip t={s.tipo} o="in" />{s.datos?.nuevas?.length ? <Chip t={`${s.datos.nuevas.length} MP nueva${s.datos.nuevas.length === 1 ? '' : 's'}`} o="wa" /> : null}</>}
          s={`Propone: ${s.solicitanteNombre}`} m={fmt(s.fecha)} onClick={() => { setPrecio(''); setVer(s.id); }} />
      )) : <Vacio ic="check">No hay propuestas por revisar</Vacio>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={x.nombre} estado={x.estado}
          pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" disabled={!precioOk} onClick={aprobar}>Aprobar</Btn>]}>
          {x.tipo === 'Producto nuevo' && <>
            <Kv pares={[['Propone', x.solicitanteNombre], ['Categorías', (d.cats || []).join(', ') || '—'], ['Tiempo de preparación', `${d.tiempo || '—'} min`]]} />
            <Card className="tw:flex tw:flex-col tw:gap-1.5">
              <b>Costo para realizar este producto</b>
              <div className="tw:text-3xl tw:font-extrabold">{x.costo.incompleto ? 'Incompleto' : $(x.costo.costo)}</div>
              <Mut>{x.costo.incompleto ? 'Hay materias primas sin proveedor; el costo se completa cuando el gerente general les asigne uno.'
                : 'Se toma el precio más alto posible de cada materia prima en esta sucursal (todos los proveedores, con su intervalo de variación). Sin IVA.'}</Mut>
              <b>Precio propuesto (IVA incluido)</b>
              <Form.Control type="number" min="0" step="0.05" placeholder="Ej. 1.50" value={precio} onChange={(e) => setPrecio(e.target.value)} />
              <Mut>Tú defines el precio. Sin IVA debe superar el costo.</Mut>
            </Card>
            <h4 className="tw:text-sm tw:m-0">Receta</h4>
            <Tabla cols={['Ingrediente', 'Cantidad', '']} filas={(d.ings || []).map((r) => [mn(r.mp, M), r.cant, x.sinProveedor.includes(r.mp) ? <Chip t="Proveedor en trámite" o="wa" /> : ''])} />
            {x.sinProveedor.length > 0 && <Mut>El sistema envía solo al gerente general las materias primas sin proveedor; el gerente de sucursal no solicita proveedores.</Mut>}
          </>}
          {x.tipo === 'Extra nuevo' && <>
            <Kv pares={[['Propone', x.solicitanteNombre], ['Precio', $(d.precio)], ['Tiempo extra', `${d.tiempo || 0} min`], ['Aparece en', (d.prods || []).map((i) => P[i]?.nombre).join(', ') || '—']]} />
            <Tabla cols={['Ingrediente', 'Cantidad']} filas={(d.ings || []).map((r) => [mn(r.mp, M), r.cant])} />
          </>}
          {x.tipo === 'Categoría nueva' && <Kv pares={[['Pide', x.solicitanteNombre], ['Motivo', x.motivo || '—']]} />}
        </Panel>
      )}
    </Stack>
  );
}

/* ---------- 5.3 compras por aceptar o denegar ---------- */
function Compras() {
  const { motivo, clave, accion } = useDialogos();
  const { datos } = useDatos('/gerente/compras?vista=preparadas');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const c = ver && datos.find((x) => x.id === ver);
  const aceptar = async () => {
    if (await clave({ resumen: `Aceptar la compra #${c.id} a ${c.provNombre} por ${$(c.total)}. Pasa al gerente general.`, accion: (k) => api.post(`/gerente/compras/${c.id}/aceptar`, k), ok: 'Compra aceptada: pasa al gerente general' })) setVer(null);
  };
  const denegar = async () => {
    const m = await motivo({ titulo: 'Motivo de la denegación' });
    if (m && await accion(() => api.post(`/gerente/compras/${c.id}/rechazar`, { motivo: m }), 'Solicitud denegada')) setVer(null);
  };
  return (
    <Stack>
      <div><Chip t="Aceptar o denegar solicitudes de compra" o="g" sinSimbolo /></div>
      {datos.length ? (
        <Tabla cols={['Solicitud', 'Proveedor', 'Materias primas (precio unitario)', 'Total', 'Estado']} filas={datos.map((x) => ({
          onClick: () => setVer(x.id), celdas: [`#${x.id}`, x.provNombre, x.lineas.map((l) => `${l.nombre} ${$(l.precio)}/${l.unidad}`).join(', '), $(x.total), <ChipCompra e={x.estado} />],
        }))} />
      ) : <Vacio ic="check">No hay solicitudes de compra por decidir</Vacio>}
      {c && (
        <Panel show onHide={() => setVer(null)} titulo={`Compra #${c.id}`} estado={c.estado}
          pie={[<Btn key="d" onClick={denegar}>Denegar</Btn>, <Btn key="a" v="p" onClick={aceptar}>Aceptar con clave</Btn>]}>
          <CompraResumen c={c} />
        </Panel>
      )}
    </Stack>
  );
}

/* ---------- 5.3 recepción: aceptar, devolver o pedir descuento; compras en curso ---------- */
let vistaRec = 'recibidas';
function Recepcion() {
  const { clave, accion } = useDialogos();
  const [v, setV] = useState(vistaRec);
  const { datos } = useDatos(`/gerente/compras?vista=${v}`);
  const [ver, setVer] = useState(null);
  const [aceptar, setAceptar] = useState(null);
  const [desc, setDesc] = useState(null);
  if (!datos) return <Cargando />;
  const c = ver && datos.find((x) => x.id === ver);
  const bod = c?.detalle?.devolucionBodega;
  const pa = c && recepcionParcial(c);
  const maxDesc = c ? r2((c.valorRecibido || 0) + (c.transporte || 0)) : 0;
  const devolver = () => clave({
    resumen: `Devolver la mercancía de ${c.provNombre}. La pérdida de la sucursal queda registrada y la solicitud pasa al gerente general.`, pideMotivo: true,
    accion: (k) => api.post(`/gerente/compras/${c.id}/devolver`, k), ok: 'Devolución enviada al gerente general',
  }).then((r) => r && setVer(null));
  const cancelar = () => clave({
    resumen: `Cancelar la compra #${c.id}. Se registra la pérdida y pasa al gerente general.`, pideMotivo: true,
    accion: (k) => api.post(`/gerente/compras/${c.id}/cancelar`, k), ok: 'Cancelación enviada al gerente general',
  }).then((r) => r && setVer(null));
  const confirmarAceptar = async () => {
    const pend = aceptar.pend;
    setAceptar(null);
    if (await accion(() => api.post(`/gerente/compras/${c.id}/aceptar-mercancia`, { pendiente: pend }), 'Mercancía aceptada. El stock subió por lote')) setVer(null);
  };
  const enviarDesc = async () => {
    if (+desc.monto > maxDesc) return setDesc({ ...desc, er: `El monto no puede superar ${$(maxDesc)}` });
    try {
      await api.post(`/gerente/compras/${c.id}/descuento`, desc);
      setDesc(null);
      setVer(null);
      accion(async () => {}, 'Enviada al gerente general');
    } catch (e) { setDesc({ ...desc, er: e.message }); }
  };
  const puedeCancelar = c && ['Aceptada por gerente', 'En camino'].includes(c.estado) && !c.llego;
  return (
    <Stack>
      <Pildoras opciones={[['recibidas', 'Mercancía recibida'], ['curso', 'En curso']]} valor={v} onChange={(x) => { vistaRec = x; setV(x); }} />
      {datos.length ? (
        <Tabla cols={['Solicitud', 'Proveedor', 'Materias primas', 'Total', 'Estado']} filas={datos.map((x) => ({
          onClick: () => setVer(x.id),
          celdas: [`#${x.id}`, x.provNombre, x.lineas.map((l) => l.nombre).join(', '), $(x.total),
            <><ChipCompra e={x.estado} />{x.detalle?.devolucionBodega && x.estado === 'Recibida' && <div className="tw:text-er tw:text-xs">Bodega propone devolver</div>}</>],
        }))} />
      ) : <Vacio ic="check">{v === 'curso' ? 'No hay compras en curso' : 'No hay mercancía por decidir'}</Vacio>}
      {c && (
        <Panel show onHide={() => setVer(null)} titulo={`Compra #${c.id}`} estado={c.estado}
          pie={c.estado === 'Recibida' ? [
            <Btn key="d" onClick={() => setDesc({ tipo: 'Descuento', monto: '', motivo: '', er: '' })}>Solicitar descuento o reembolso</Btn>,
            <Btn key="v" onClick={devolver}>{bod ? 'Aprobar devolución' : 'Devolver mercancía'}</Btn>,
            <Btn key="a" v="p" onClick={() => setAceptar({ pend: 'seguir' })}>{bod ? 'Quedarme con la mercancía' : 'Aceptar mercancía'}</Btn>,
          ] : [<Btn key="c" v="red" disabled={!puedeCancelar} onClick={cancelar}>Cancelar compra</Btn>,
            !puedeCancelar && ['En camino', 'Aceptada por gerente'].includes(c.estado) ? <small key="n" className="tw:text-tx2">Ya llegó: usa Devolver</small> : null]}>
          <CompraResumen c={c} />
          {c.estado === 'Recibida' && <>
            {bod && <Ban>Bodega propone devolver esta mercancía ({bod.porNombre}): {bod.motivo}. Tú decides: aprobar la devolución o quedarte con la mercancía.</Ban>}
            <h4 className="tw:text-sm tw:m-0">Lotes recibidos <Chip t={pa ? 'Parcial' : 'Completa'} o={pa ? 'wa' : 'ok'} /></h4>
            <LotesRecibidos c={c} />
            {c.atraso && <Ban>{c.atraso.tipo === 'Descuento' ? `Descuento por retraso de ${c.atraso.pct} %: el precio ya está recalculado.` : `${c.atraso.tipo} por retraso: crédito a favor de ${$(c.atraso.monto)} en Cuentas por pagar.`}</Ban>}
            <Kv pares={[['Se pagará solo por lo recibido', $(maxDesc)]]} />
          </>}
        </Panel>
      )}
      <Modal show={!!aceptar} onHide={() => setAceptar(null)} centered>
        {aceptar && (
          <Modal.Body>
            <h3>Aceptar mercancía</h3>
            <p className="tw:text-tx2 tw:m-0">El stock sube por lote, se ajusta la factura y el pago es solo por lo recibido.</p>
            {pa && (
              <div className="tw:flex tw:flex-col tw:gap-2">
                <b>Lo pendiente (obligatorio)</b>
                <Form.Check type="radio" id="p1" name="pend" checked={aceptar.pend === 'seguir'} onChange={() => setAceptar({ pend: 'seguir' })}
                  label="Sigue pendiente (llegará con 10 % a 20 % de descuento, mismo precio base, lote y vencimiento nuevos)" />
                <Form.Check type="radio" id="p2" name="pend" checked={aceptar.pend === 'cancelar'} onChange={() => setAceptar({ pend: 'cancelar' })} label="Cancelar lo pendiente" />
              </div>
            )}
            <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={() => setAceptar(null)}>Volver</Btn><Btn v="p" onClick={confirmarAceptar}>Aceptar</Btn></div>
          </Modal.Body>
        )}
      </Modal>
      <Modal show={!!desc} onHide={() => setDesc(null)} centered>
        {desc && (
          <Modal.Body>
            <h3>Solicitar descuento o reembolso</h3>
            <p className="tw:text-tx2 tw:m-0">Lo decide el gerente general. Si lo aprueba, baja el monto de la factura o queda crédito a favor con el proveedor.</p>
            <Campo l="Tipo"><Form.Select value={desc.tipo} onChange={(e) => setDesc({ ...desc, tipo: e.target.value })}><option>Descuento</option><option>Reembolso</option></Form.Select></Campo>
            <Campo l="Monto"><Form.Control type="number" min={0.01} step="0.01" placeholder={`Monto, máx. ${$(maxDesc)}`} value={desc.monto} onChange={(e) => setDesc({ ...desc, monto: e.target.value })} /></Campo>
            <Campo l="Motivo"><Form.Control as="textarea" rows={3} placeholder="Motivo (mín. 10 caracteres)" value={desc.motivo} onChange={(e) => setDesc({ ...desc, motivo: e.target.value })} /></Campo>
            <Err>{desc.er}</Err>
            <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={() => setDesc(null)}>Volver</Btn><Btn v="p" disabled={!(+desc.monto > 0 && desc.motivo.trim().length >= 10)} onClick={enviarDesc}>Enviar</Btn></div>
          </Modal.Body>
        )}
      </Modal>
    </Stack>
  );
}

/* ---------- 5.5 ofertas por lote por vencer ---------- */
let vistaOf = 'pend';
function Ofertas() {
  const { config } = useSesion();
  const { confirmar, clave, accion } = useDialogos();
  const { datos } = useDatos('/gerente/ofertas');
  const ahora = useAhora(60_000);
  const [v, setV] = useState(vistaOf);
  const [ver, setVer] = useState(null);
  const [pct, setPct] = useState(1);
  if (!datos) return <Cargando />;
  const grupos = { pend: datos.filter((o) => o.estado === 'Pendiente'), act: datos.filter((o) => o.estado === 'Activa'), cer: datos.filter((o) => !['Pendiente', 'Activa'].includes(o.estado)) };
  const o = ver && datos.find((x) => x.id === ver);
  const iva = config?.iva ?? 13;
  const dias = (t) => Math.max(0, Math.ceil((t - ahora) / 864e5));
  const autorizar = () => clave({
    resumen: `Autorizar oferta de ${pct} % en el lote ${o.lote} (${o.mpNombre}). Aplica a los productos afectados en tu sucursal.`,
    accion: (k) => api.post(`/gerente/ofertas/${o.id}/autorizar`, { ...k, pct }), ok: 'Oferta activa',
  }).then((r) => r && setVer(null));
  const rechazar = async () => {
    if (await confirmar({ titulo: 'Rechazar la oferta', texto: 'El lote seguirá su curso hasta vencer.', verbo: 'Rechazar', rojo: true })) {
      if (await accion(() => api.post(`/gerente/ofertas/${o.id}/rechazar`), 'Oferta rechazada')) setVer(null);
    }
  };
  return (
    <Stack>
      <Pildoras opciones={[['pend', `Pendientes (${grupos.pend.length})`], ['act', `Activas (${grupos.act.length})`], ['cer', `Cerradas (${grupos.cer.length})`]]} valor={v} onChange={(x) => { vistaOf = x; setV(x); }} />
      {grupos[v].length ? (
        <Tabla cols={['Lote', 'Materia prima', 'Quedan', 'Productos', 'Descuento', 'Estado']} filas={grupos[v].map((x) => ({
          onClick: () => { setPct(x.pctSug); setVer(x.id); },
          celdas: [x.lote, x.mpNombre, ['Pendiente', 'Activa'].includes(x.estado) ? `${dias(x.vence)} día${dias(x.vence) === 1 ? '' : 's'}` : '—',
            <span className="tw:flex tw:flex-wrap tw:gap-1">{x.productos.map((p) => <Chip key={p.id} t={p.nombre} o="g" sinSimbolo />)}</span>,
            x.estado === 'Pendiente' ? `${x.pctSug} % sugerido` : x.pct != null ? `${x.pct} %` : '—', x.estado === 'Pendiente' ? '' : <Chip t={x.estado} o={x.estado === 'Activa' ? 'ok' : 'g'} />],
        }))} />
      ) : <Vacio ic="check">{v === 'pend' ? 'No hay lotes por vencer' : `No hay ofertas ${v === 'act' ? 'activas' : 'cerradas'}`}</Vacio>}
      {o && (
        <Panel show onHide={() => setVer(null)} titulo={`Oferta · lote ${o.lote}`} estado={o.estado} ro={o.estado !== 'Pendiente'}
          pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" onClick={autorizar}>Autorizar con clave</Btn>]}>
          <Kv pares={[['Materia prima', o.mpNombre], ['Resta', `${o.resta} ${o.unidad}`], ['Vence', fmt(o.vence)], ...(o.estado !== 'Pendiente' ? [['Descuento', o.pct != null ? `${o.pct} %` : '—']] : [])]} />
          {o.estado === 'Pendiente' ? <>
            <h4 className="tw:text-sm tw:m-0">Descuento %</h4>
            <div className="tw:flex tw:items-center tw:gap-3">
              <Form.Range min={1} max={o.pctSug} value={pct} onChange={(e) => setPct(+e.target.value)} />
              <Form.Control type="number" min={1} max={o.pctSug} value={pct} className="tw:w-[90px]" onChange={(e) => setPct(Math.max(1, Math.min(o.pctSug, Math.round(+e.target.value || 1))))} />
            </div>
            <Mut>Máximo permitido: {o.pctSug} % (el sistema lo limita para que el precio nunca quede por debajo del costo). Solo puedes bajarlo.</Mut>
            <Tabla cols={['Producto', 'Normal', 'Costo', 'Con oferta', 'Margen']} filas={o.productos.map((p) => {
              const of = r2(p.precio * (1 - pct / 100));
              return [p.nombre, $(p.precio), $(p.costo), $(of), $(r2(of / (1 + iva / 100) - p.costo))];
            })} />
            <Mut>No cambia el precio base ni aplica a extras.</Mut>
          </> : <>
            {o.estado === 'Caducada' && <Ban>El lote pasó a pérdida como vencido.</Ban>}
            {o.cierre && <Mut>Cerrada: {fmt(o.cierre)}</Mut>}
          </>}
        </Panel>
      )}
    </Stack>
  );
}

/* ---------- 5.7 cierres de caja ---------- */
let vistaCaja = 'pend';
function Caja() {
  const { confirmar, motivo, accion } = useDialogos();
  const [v, setV] = useState(vistaCaja);
  const { datos } = useDatos(`/gerente/cajas?vista=${v}`);
  const [ver, setVer] = useState(null);
  const { datos: ventas } = useDatos(ver ? `/gerente/cajas/${ver}/ventas` : null);
  if (!datos) return <Cargando />;
  const dif = (c) => r2((c.declarado || 0) - (c.esp.Efectivo || 0));
  const chipDif = (c) => (c.estado === 'Observada' ? <Chip t="Observada" o="er" /> : dif(c) === 0 ? <Chip t="Cuadra" o="ok" />
    : dif(c) < 0 ? <Chip t={`Faltante −${$(-dif(c))}`} o="er" /> : <Chip t={`Sobrante +${$(dif(c))}`} o="wa" />);
  const c = ver && datos.find((x) => x.id === ver);
  const aprobar = async () => {
    if (await confirmar({ titulo: 'Aprobar el cierre', texto: 'Queda confirmado y pasa al historial.', verbo: 'Aprobar' })) {
      if (await accion(() => api.post(`/gerente/cajas/${c.id}/aprobar`), 'Cierre aprobado')) setVer(null);
    }
  };
  const observar = async () => {
    const m = await motivo({ titulo: 'Comentario sobre la diferencia' });
    if (m && await accion(() => api.post(`/gerente/cajas/${c.id}/observar`, { motivo: m }), 'Cierre observado')) setVer(null);
  };
  const dv = (ventas || []).filter((x) => x.devuelto > 0);
  return (
    <Stack>
      <Pildoras opciones={[['pend', 'Pendientes'], ['hist', 'Historial']]} valor={v} onChange={(x) => { vistaCaja = x; setV(x); setVer(null); }} />
      {datos.length ? (
        <Tabla cols={['Mesero', 'Fecha y turno', 'Cierre', 'Diferencia']} filas={datos.map((x) => ({
          onClick: () => setVer(x.id), celdas: [x.meseroNombre, fFecha(x.abierta), fmt(x.cerrada), <>{chipDif(x)} {x.estado === 'Aprobada' && v === 'hist' && <Chip t="Aprobada" o="ok" />}</>],
        }))} />
      ) : <Vacio ic="check">No hay cierres {v === 'pend' ? 'pendientes' : 'en el historial'}</Vacio>}
      {c && (
        <Panel show onHide={() => setVer(null)} titulo={`Caja de ${c.meseroNombre}`} estado={c.estado === 'Pendiente de aprobación' ? 'Solicitada' : c.estado}
          ro={c.estado !== 'Pendiente de aprobación'} pie={[<Btn key="o" onClick={observar}>Observar cierre</Btn>, <Btn key="a" v="p" onClick={aprobar}>Aprobar cierre</Btn>]}>
          <Kv pares={[['Fondo inicial', $(c.fondo)], ['Cierre', fmt(c.cerrada)]]} />
          <Tabla cols={['Método', 'Esperado', 'Declarado', 'Diferencia']} filas={[
            ['Efectivo', $(c.esp.Efectivo), $(c.declarado), $(dif(c))], ['Tarjeta', $(c.esp.Tarjeta), $(c.esp.Tarjeta), $(0)], ['Bitcoin', $(c.esp.Bitcoin), $(c.esp.Bitcoin), $(0)]]} />
          <Mut>El efectivo esperado es el fondo más las ventas en efectivo. Tarjeta y Bitcoin vienen de los cobros registrados.</Mut>
          <h4 className="tw:text-sm tw:m-0">Ventas del turno ({ventas?.length ?? '…'})</h4>
          {ventas?.length ? <Tabla cols={['#', 'Documento', 'Método', 'Total']} filas={ventas.slice(0, 15).map((x) => [`#${x.num}`, corr(x), x.metodo, $(x.total)])} /> : ventas ? <Vacio>Sin ventas</Vacio> : <Cargando />}
          {ventas?.length > 15 && <Mut>Y {ventas.length - 15} más.</Mut>}
          {dv.length > 0 && <><h4 className="tw:text-sm tw:m-0">Devoluciones aprobadas</h4>{dv.map((x) => <div key={x.id}>#{x.num} · −{$(x.devuelto)} ({x.metodo})</div>)}</>}
          {c.comentario && <Ban>Comentario: {c.comentario}</Ban>}
        </Panel>
      )}
    </Stack>
  );
}

/* ---------- conteos de inventario ---------- */
function Conteos() {
  const { motivo, clave, accion } = useDialogos();
  const { datos } = useDatos('/gerente/conteos');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const k = ver && datos.find((x) => x.id === ver);
  const dif = k ? k.filas.filter((f) => f.contado !== f.sistema).length : 0;
  const aprobar = () => clave({
    resumen: `Aprobar el conteo: se ajusta el inventario (${dif} diferencias, ${$(k.valor)}) y los faltantes quedan como pérdida.`,
    accion: (x) => api.post(`/gerente/conteos/${k.id}/aprobar`, x), ok: 'Conteo aprobado: inventario ajustado',
  }).then((r) => r && setVer(null));
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/gerente/conteos/${k.id}/rechazar`, { motivo: m }), 'Conteo rechazado')) setVer(null);
  };
  return (
    <Stack>
      {datos.length ? (
        <Tabla cols={['Fecha', 'Bodega', 'Con diferencia', 'Estado']} filas={datos.map((x) => ({
          onClick: () => setVer(x.id), celdas: [fmt(x.fecha), x.bodegaNombre, x.filas.filter((f) => f.contado !== f.sistema).length,
            <Chip t={x.estado} o={x.estado === 'Aprobado' ? 'ok' : x.estado === 'Rechazado' ? 'er' : 'wa'} />],
        }))} />
      ) : <Vacio ic="check">No hay conteos</Vacio>}
      {k && <DetalleConteo k={k} onHide={() => setVer(null)} extra={[['Valor de las diferencias', $(k.valor)]]}
        pie={k.estado === 'Enviado' ? [<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" onClick={aprobar}>Aprobar con clave</Btn>] : null} />}
    </Stack>
  );
}

/* ---------- 5.10 solicitudes del equipo ---------- */
const tipoSol = (x) => (x.tipo === 'Despido' ? 'Despido' : ['Unidad nueva', 'Categoría de materia prima'].includes(x.tipo) ? 'Catálogo' : 'Inhabilitación');
function Solicitudes() {
  const { usuario } = useSesion();
  const { motivo, clave, accion, toast } = useDialogos();
  const { datos } = useDatos('/gerente/solicitudes');
  const [t, setT] = useState('');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const n = (k) => datos.filter((x) => tipoSol(x) === k).length;
  const L = datos.filter((x) => !t || tipoSol(x) === t);
  const x = ver && datos.find((s) => s.id === ver);
  const resumen = x && (x.tipo === 'Despido' ? `Aprobar el despido de ${x.usuarioNombre}. Se aplica con su indemnización y se genera el reporte al gerente general.`
    : tipoSol(x) === 'Catálogo' ? `Aprobar «${x.nombre}» y enviarla a Recursos Humanos.`
      : `Inhabilitar «${x.nombre}» en tu sucursal. Deja de verse en nuevas compras y recetas; el historial se conserva.`);
  const aprobar = () => {
    if (x.solicitante === usuario.id) return toast('No puedes aprobar tus propias solicitudes');
    return clave({ resumen, accion: (k) => api.post(`/gerente/solicitudes/${x.id}/aprobar`, k), ok: 'Solicitud aprobada' }).then((r) => r && setVer(null));
  };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/gerente/solicitudes/${x.id}/rechazar`, { motivo: m }), 'Solicitud rechazada')) setVer(null);
  };
  return (
    <Stack>
      <Pildoras opciones={[['', `Todas (${datos.length})`], ['Inhabilitación', `Inhabilitación (${n('Inhabilitación')})`], ['Catálogo', `Catálogo (${n('Catálogo')})`], ['Despido', `Despido (${n('Despido')})`]]} valor={t} onChange={setT} />
      {L.length ? (
        <Tabla cols={['Tipo', 'Pide', 'Fecha', 'Motivo']} filas={L.map((s) => ({ onClick: () => setVer(s.id), celdas: [<Chip t={tipoSol(s)} o="in" sinSimbolo />, s.solicitanteNombre, fmt(s.fecha), (s.motivo || '').slice(0, 70)] }))} />
      ) : <Vacio ic="check">No hay solicitudes del equipo</Vacio>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={tipoSol(x)} estado="Solicitada" pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" onClick={aprobar}>Aprobar con clave</Btn>]}>
          {x.tipo === 'Despido' && <Kv pares={[['Tipo', 'Despido'], ['Pide', `${x.solicitanteNombre} (Recursos Humanos)`], ['Empleado', x.usuarioNombre], ['Razón', x.motivo]]} />}
          {tipoSol(x) === 'Catálogo' && <><Kv pares={[['Tipo', x.tipo], ['Pide', x.solicitanteNombre], ['Nombre', x.nombre], ['Motivo', x.motivo]]} /><Ban>Si la apruebas, pasa a Recursos Humanos para su aprobación final.</Ban></>}
          {x.tipo === 'Inhabilitar materia prima' && <>
            <Kv pares={[['Tipo', 'Inhabilitación de materia prima'], ['Pide', x.solicitanteNombre], ['Elemento', x.nombre], ['Motivo', x.motivo]]} />
            {x.datos?.usan?.length > 0 && <Ban>La usan {x.datos.usan.length} productos activos: {x.datos.usan.join(', ')}.</Ban>}
          </>}
        </Panel>
      )}
    </Stack>
  );
}

/* ---------- 5.12 historial de aprobaciones ---------- */
const ACC = {
  'compra.aceptar.gerente': 'Aceptó una compra', 'compra.rechazar.gerente': 'Denegó una compra', 'compra.aceptar_mercancia': 'Aceptó mercancía', 'compra.devolver': 'Devolvió mercancía',
  'compra.cancelar': 'Canceló una compra', 'compra.solicitar_descuento': 'Pidió descuento o reembolso', 'oferta.autorizar': 'Autorizó una oferta', 'oferta.rechazar': 'Rechazó una oferta',
  'producto.inhabilitar': 'Inhabilitó un producto', 'materia.inhabilitar': 'Aprobó inhabilitar una materia prima', 'despido.aprobar': 'Aprobó un despido', 'solicitud.rechazar': 'Rechazó una solicitud',
  'menu.solicitar': 'Pidió agregar un producto al menú', 'caja.aprobar': 'Aprobó un cierre de caja', 'caja.observar': 'Observó un cierre de caja', 'conteo.aprobar': 'Aprobó un conteo',
  'conteo.rechazar': 'Rechazó un conteo', 'propuesta.aprobar.gerente': 'Aprobó una propuesta', 'propuesta.rechazar.gerente': 'Rechazó una propuesta', 'merma.registrar': 'Registró una merma',
  'precio.solicitar': 'Pidió un cambio de precio', 'personal.solicitar': 'Pidió personal', 'empleado.cambiar_rol': 'Cambió un rol', 'despido.directo': 'Despidió a una persona',
  'catalogoMP.aprobar.gerente': 'Aprobó una unidad o categoría',
};
function Historial() {
  const { datos } = useDatos('/gerente/historial');
  const [q, setQ] = useState('');
  if (!datos) return <Cargando />;
  const L = datos.filter((b) => !q || `${ACC[b.accion] || b.accion} ${b.elemento || ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Form.Control type="search" placeholder="Buscar en tu historial" value={q} onChange={(e) => setQ(e.target.value)} className="tw:max-w-[320px]" />
        <Chip t="Solo lo que se hizo en tu sucursal" o="g" sinSimbolo />
      </div>
      {L.length ? <Tabla cols={['Fecha', 'Quién', 'Acción', 'Elemento', 'Motivo', 'Clave']} filas={L.map((b) => [fmt(b.fecha), b.usuario, ACC[b.accion] || b.accion,
        String(b.elemento || '—').slice(0, 30), (b.motivo || '—').slice(0, 60), b.clave ? <Chip t="Con clave" o="ok" /> : '—'])} /> : <Vacio ic="list">Aún no hay aprobaciones registradas</Vacio>}
    </Stack>
  );
}

const TABS = { productos: Productos, compras: Compras, recepcion: Recepcion, ofertas: Ofertas, caja: Caja, conteos: Conteos, solicitudes: Solicitudes, historial: Historial };
export default function Aprobaciones({ tab = 'productos' }) {
  const T = TABS[tab] || Productos;
  return <T />;
}
export { lineasTxt };
