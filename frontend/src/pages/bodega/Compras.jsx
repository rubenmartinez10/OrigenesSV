import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fFecha, fmt, r2 } from '../../lib/formato.js';
import { useDatos, useSesion } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Card, Cargando, Chip, Err, Etapas, Kv, Mut, Panel, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { ChipCompra, CompraResumen, fH, lineasTxt } from '../../components/Compras.jsx';
import { Icono } from '../../components/Icono.jsx';

/* Encargado de bodega · 4.3 Solicitudes de compra (asistente: materias primas → cotización → revisión) */
const ESTADOS = ['', 'Preparada', 'Aceptada por gerente', 'En camino', 'Recibida', 'Aceptada', 'Devuelta', 'Rechazada', 'Cancelada'];

function Asistente({ inicial, onHide }) {
  const { confirmar, accion } = useDialogos();
  const { datos: inv } = useDatos('/bodega/inventario');
  const [paso, setPaso] = useState(1);
  const [items, setItems] = useState(inicial ? [{ mp: inicial, prov: null, cant: 1 }] : []);
  const [q, setQ] = useState('');
  const [cot, setCot] = useState(null);
  const [er, setEr] = useState('');
  useEffect(() => {
    if (paso === 2 && items.length) api.get(`/bodega/cotizar?mps=${items.map((i) => i.mp).join(',')}`).then(setCot).catch((e) => setEr(e.message));
  }, [paso]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!inv) return null;
  const M = Object.fromEntries(inv.materias.map((m) => [m.id, m]));
  const disponibles = inv.materias.filter((m) => !m.inhabilitada && m.nombre.toLowerCase().includes(q.toLowerCase()));
  const set = (mp, cambio) => setItems(items.map((i) => (i.mp === mp ? { ...i, ...cambio } : i)));
  const valido = paso === 1 ? items.length > 0 : items.every((i) => i.prov && i.cant > 0);
  const grupos = {};
  if (cot) for (const i of items) if (i.prov) (grupos[i.prov] ||= []).push(i);
  const opcion = (i) => cot?.[i.mp]?.find((c) => c.prov === i.prov);

  const enviar = async () => {
    if (!(await confirmar({ titulo: 'Enviar al gerente', texto: 'La solicitud quedará Preparada y pasará al gerente de sucursal, que la acepta con su clave.', verbo: 'Enviar' }))) return;
    const r = await accion(() => api.post('/bodega/compras', { items }));
    if (r) { accion(async () => {}, r.length > 1 ? `Se crearon ${r.length} solicitudes, una por proveedor` : 'Solicitud enviada al gerente'); onHide(); }
  };

  return (
    <Modal show onHide={onHide} centered size="lg" scrollable>
      <Modal.Body>
        <h3>Nueva solicitud de compra</h3>
        <Etapas l={['Materias primas', 'Cotización', 'Revisión']} a={paso - 1} />
        <Err>{er}</Err>
        {paso === 1 && (
          <>
            <h4 className="tw:text-sm tw:m-0">Materias primas de la solicitud · {items.length} elegida{items.length === 1 ? '' : 's'}</h4>
            <Form.Control type="search" placeholder="Buscar materia prima" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="tw:flex tw:flex-col tw:gap-2 tw:max-h-[46vh] tw:overflow-auto">
              {disponibles.map((m) => {
                const on = items.some((i) => i.mp === m.id);
                return (
                  <button key={m.id} type="button" onClick={() => setItems(on ? items.filter((i) => i.mp !== m.id) : [...items, { mp: m.id, prov: null, cant: 1 }])}
                    className={`tw:flex tw:items-center tw:gap-3 tw:px-3.5 tw:py-2.5 tw:rounded-[18px] tw:border tw:text-left ${on ? 'tw:bg-brs tw:border-br' : 'tw:bg-sf tw:border-bd'}`}>
                    <span className="tw:w-[34px] tw:h-[34px] tw:rounded-[14px] tw:bg-brs tw:text-br tw:grid tw:place-items-center"><Icono n="box" size={18} /></span>
                    <span className="tw:flex-1 tw:flex tw:flex-col"><b>{m.nombre}</b><small className="tw:text-tx2">{m.unidad} · stock {m.stock}{m.minimo ? ` de ${m.minimo}` : ''}</small></span>
                    <span className={`tw:w-6 tw:h-6 tw:rounded-full tw:border-2 tw:grid tw:place-items-center ${on ? 'tw:bg-br tw:border-br tw:text-white' : 'tw:border-bd'}`}>{on && <Icono n="check" size={14} />}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {paso === 2 && (!cot ? <Cargando /> : (
          <>
            <Mut>El precio, el transporte y el vencimiento quedan fijos hasta que el gerente general responda.</Mut>
            {items.map((i) => {
              const ops = cot[i.mp] || [];
              return (
                <Card key={i.mp} className="tw:flex tw:flex-col tw:gap-2">
                  <b>{M[i.mp]?.nombre}</b>
                  <Tabla cols={['', 'Proveedor', 'Precio', 'Transporte', 'Total est.', 'Lote vence', 'Entrega', 'Pago', 'Vigencia']} filas={ops.map((c) => ({
                    dim: !c.ok, onClick: c.ok ? () => set(i.mp, { prov: c.prov }) : undefined,
                    celdas: [i.prov === c.prov ? '●' : '○', c.provNombre, c.ok ? $(c.precio) : '—', c.ok ? $(c.transp) : '—',
                      c.ok ? $(c.precio * i.cant + c.transp) : <><Chip t="No disponible" o="g" /> <small className="tw:text-tx2">{c.motivo}</small></>,
                      c.ok ? fFecha(c.vence) : '—', c.ok ? fH(c.horas) : '—', c.ok ? c.pago : '—', c.ok ? fmt(c.vig) : '—'],
                  }))} />
                  {!ops.some((c) => c.ok) && <Err>Ningún proveedor ofrece esta materia prima para tu sucursal. Quítala o pídele a gerencia un proveedor.</Err>}
                  {i.prov && (
                    <label className="tw:flex tw:items-center tw:gap-2">Cantidad ({M[i.mp]?.unidad})
                      <Form.Control type="number" min={1} step={1} value={i.cant} className="tw:max-w-[140px]" onChange={(e) => set(i.mp, { cant: Math.max(0, +e.target.value || 0) })} />
                    </label>
                  )}
                </Card>
              );
            })}
          </>
        ))}
        {paso === 3 && (
          <>
            <Mut>{Object.keys(grupos).length > 1 ? `Elegiste proveedores distintos: el sistema separa tu pedido en ${Object.keys(grupos).length} solicitudes.` : 'Revisa tu solicitud.'}</Mut>
            {Object.entries(grupos).map(([pid, lista]) => {
              const o = opcion(lista[0]);
              const sub = r2(lista.reduce((a, i) => a + i.cant * opcion(i).precio, 0));
              return (
                <Card key={pid} className="tw:flex tw:flex-col tw:gap-1.5">
                  <div className="tw:flex tw:items-center tw:gap-2"><b>{o.provNombre}</b><Chip t={o.pago} o="g" /></div>
                  {lista.map((i) => <div key={i.mp} className="tw:flex tw:gap-2"><span className="tw:flex-1">{M[i.mp].nombre} ×{i.cant} {M[i.mp].unidad} a {$(opcion(i).precio)} c/u</span><span>{$(i.cant * opcion(i).precio)}</span></div>)}
                  <Kv pares={[['Transporte (una vez)', $(o.transp)], ['Total', $(sub + o.transp)], ['Entrega', fH(o.horas)]]} />
                </Card>
              );
            })}
          </>
        )}
        <div className="tw:flex tw:justify-end tw:gap-2">
          {paso > 1 ? <Btn v="t" onClick={() => setPaso(paso - 1)}>Atrás</Btn> : <Btn v="t" onClick={onHide}>Cancelar</Btn>}
          {paso < 3 ? <Btn v="p" disabled={!valido} onClick={() => setPaso(paso + 1)}>Siguiente</Btn> : <Btn v="p" onClick={enviar}>Enviar al gerente</Btn>}
        </div>
      </Modal.Body>
    </Modal>
  );
}

export default function Compras() {
  const { confirmar, accion } = useDialogos();
  const location = useLocation();
  const navigate = useNavigate();
  const [estado, setEstado] = useState('');
  const { datos } = useDatos(`/bodega/compras${estado ? `?estado=${encodeURIComponent(estado)}` : ''}`);
  const [ver, setVer] = useState(null);
  const [nueva, setNueva] = useState(location.state?.mp ? { mp: location.state.mp } : null);
  useEffect(() => { if (location.state?.mp) navigate('.', { replace: true, state: null }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!datos) return <Cargando />;
  const c = ver && datos.find((x) => x.id === ver);
  const cancelar = async () => {
    if (await confirmar({ titulo: `Cancelar la solicitud #${c.id}`, texto: 'Quedará Cancelada y no pasará al gerente.', verbo: 'Cancelar solicitud', rojo: true })) {
      if (await accion(() => api.post(`/bodega/compras/${c.id}/cancelar`), 'Solicitud cancelada')) setVer(null);
    }
  };
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Form.Select value={estado} onChange={(e) => setEstado(e.target.value)} className="tw:max-w-[260px]" aria-label="Estado">
          {ESTADOS.map((e) => <option key={e} value={e}>{e || 'Todos los estados'}</option>)}
        </Form.Select>
        <span className="tw:flex-1" />
        <Btn v="p" onClick={() => setNueva({})}><Icono n="plus" />Nueva solicitud</Btn>
      </div>
      {datos.length ? (
        <Tabla cols={['Solicitud', 'Materias primas', 'Proveedor', 'Fecha', 'Total', 'Estado']} filas={datos.map((x) => ({
          onClick: () => setVer(x.id), celdas: [`#${x.id}`, lineasTxt(x), x.provNombre, fmt(x.creada), $(x.total), <ChipCompra e={x.estado} />],
        }))} />
      ) : <Vacio ic="list">{estado ? 'Sin solicitudes con ese estado' : 'No has preparado solicitudes'}</Vacio>}
      {c && (
        <Panel show onHide={() => setVer(null)} titulo={`Solicitud #${c.id}`} estado={c.estado}
          pie={c.estado === 'Preparada' ? <Btn v="red" onClick={cancelar}>Cancelar solicitud</Btn> : null}>
          <CompraResumen c={c} />
          <Mut>{['Aceptada por gerente', 'En camino', 'Recibida', 'Aceptada', 'Devuelta'].includes(c.estado) ? 'Ya fue aceptada por el gerente. ' : ''}El precio, el transporte y el vencimiento quedan fijos hasta que el gerente general responda.</Mut>
        </Panel>
      )}
      {nueva && <Asistente inicial={nueva.mp} onHide={() => setNueva(null)} />}
    </Stack>
  );
}
