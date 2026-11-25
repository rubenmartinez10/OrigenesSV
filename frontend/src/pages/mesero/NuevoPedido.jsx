import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $ } from '../../lib/formato.js';
import { cabe, estimar, minutos, precioCon, txt } from '../../lib/pedidos.js';
import { useDatos, useSesion } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Cargando, Chip, Foto, Lab, Mut, Panel, Pildoras, Seg, Sub, Vacio, Err } from '../../components/ui.jsx';
import { TicketPedido } from '../../components/Pedido.jsx';

/* El borrador del pedido se conserva al cambiar de pantalla (no reserva inventario hasta enviarlo). */
const nuevo = () => ({ lineas: [], tipo: 'Aquí', mesa: null, ref: '', cat: 'Todos' });
let guardado = nuevo();
const clave = (l) => JSON.stringify([l.pr, [...l.extras].sort()]);

/** Ficha de un producto: foto, ingredientes, extras y cantidad. */
function FichaProducto({ x, cat, lineas, disp, onAgregar, onHide }) {
  const { config } = useSesion();
  const P = cat.P;
  const [cant, setCant] = useState(1);
  const [extras, setExtras] = useState([]);
  const [ficha, setFicha] = useState(null);
  const exs = cat.productos.filter((e) => e.extra && e.estado === 'Activo' && e.prods.includes(x.id));
  const linea = (n = cant, ids = extras) => ({ pr: x.id, cant: n, extras: ids });
  const ok = cabe([...lineas, linea()], P, disp);
  const mas = cabe([...lineas, linea(cant + 1)], P, disp);
  const unit = precioCon(x.precio, cat.ofertas[x.id]) + extras.reduce((a, e) => a + P[e].precio, 0);
  const cabeExtra = (id) => cabe([...lineas, linea(cant, [...extras, id])], P, disp);
  const extraU = config?.extraUnidad ?? 35;
  return (
    <Panel show onHide={onHide} titulo={x.nombre} pie={<Btn v="p" disabled={!ok} onClick={() => onAgregar(linea())}>Agregar al carrito · {$(unit * cant)}</Btn>}>
      <Foto x={x} className="tw:h-[200px] tw:rounded-2xl" icono="tw:text-6xl" />
      {x.desc && <p className="tw:text-tx2 tw:m-0">{x.desc}</p>}
      <Sub><Lab>Ingredientes</Lab><div>{x.receta.map((r) => cat.M[r.mp]?.nombre).join(', ')}</div></Sub>
      {exs.length > 0 && (
        <Sub>
          <Lab>Extras · toca uno para ver su foto y descripción</Lab>
          <div className="tw:grid tw:gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}>
            {exs.map((e) => {
              const on = extras.includes(e.id);
              const puede = on || cabeExtra(e.id);
              return (
                <button key={e.id} type="button" disabled={!puede} onClick={() => setFicha(e)}
                  className={`tw:flex tw:flex-col tw:gap-0.5 tw:pb-2 tw:border tw:rounded-2xl tw:bg-sf tw:overflow-hidden tw:text-left tw:text-tx tw:disabled:opacity-50 tw:disabled:cursor-not-allowed ${on ? 'tw:border-br tw:ring-2 tw:ring-br' : 'tw:border-bd'}`}>
                  <Foto x={e} className="tw:h-16 tw:w-full tw:mb-1.5" icono="tw:text-2xl" />
                  <b className="tw:px-2 tw:text-[13px]">{e.nombre}</b>
                  <small className="tw:px-2 tw:text-[12px] tw:text-tx2">{$(e.precio)}{on ? ' · agregado' : ''}{puede ? '' : ' · sin existencias'}</small>
                </button>
              );
            })}
          </div>
        </Sub>
      )}
      <div className="tw:flex tw:items-center tw:gap-2.5">
        <Btn onClick={() => cant > 1 && setCant(cant - 1)} aria-label="Quitar uno">−</Btn>
        <b className="tw:text-lg tw:min-w-6 tw:text-center">{cant}</b>
        {mas ? <Btn onClick={() => setCant(cant + 1)} aria-label="Agregar uno">+</Btn> : <Mut>Máximo disponible</Mut>}
      </div>
      <Mut>Preparación aprox. {Math.ceil(estimar([linea()], P, config) / 60)} min{cant > 1 ? ` para ${cant} (cada unidad adicional suma ${extraU} % del tiempo)` : ''}</Mut>

      <Modal show={!!ficha} onHide={() => setFicha(null)} centered>
        {ficha && (
          <Modal.Body>
            <Foto x={ficha} className="tw:h-[200px] tw:rounded-2xl" icono="tw:text-6xl" />
            <h3>{ficha.nombre} · {$(ficha.precio)}</h3>
            <p className="tw:text-tx2 tw:m-0">{ficha.desc || 'Sin descripción'}</p>
            <Mut>Lleva: {ficha.receta.map((r) => cat.M[r.mp]?.nombre).join(', ')}</Mut>
            <div className="tw:flex tw:justify-end tw:gap-2">
              <Btn v="t" onClick={() => setFicha(null)}>Cerrar</Btn>
              {extras.includes(ficha.id)
                ? <Btn onClick={() => { setExtras(extras.filter((q) => q !== ficha.id)); setFicha(null); }}>Quitar extra</Btn>
                : <Btn v="p" disabled={!cabeExtra(ficha.id)} onClick={() => { setExtras([...extras, ficha.id]); setFicha(null); }}>Agregar extra · {$(ficha.precio)}</Btn>}
            </div>
          </Modal.Body>
        )}
      </Modal>
    </Panel>
  );
}

/** Selector de mesa: libres, ocupadas (tachadas) y la elegida. */
function SelectorMesa({ mesas, valor, onChange }) {
  const total = mesas.total;
  const libres = total - Object.keys(mesas.ocupadas).length;
  return (
    <Sub>
      <Lab>Mesa · {libres} libres de {total}</Lab>
      {libres ? (
        <div className="tw:grid tw:gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))' }}>
          {Array.from({ length: total }, (_, i) => i + 1).map((m) => {
            const oc = mesas.ocupadas[m];
            return (
              <button key={m} type="button" disabled={!!oc} title={oc ? `Ocupada por ${oc.ref || 'cliente'}` : 'Libre'} onClick={() => onChange(m)}
                className={`tw:min-h-11 tw:rounded-[14px] tw:border tw:font-bold ${oc ? 'tw:bg-erbg tw:text-er tw:line-through tw:cursor-not-allowed tw:border-bd'
                  : valor === m ? 'tw:bg-br tw:text-white tw:border-br' : 'tw:bg-sf tw:text-tx tw:border-bd tw:hover:border-br'}`}>
                {m}
              </button>
            );
          })}
        </div>
      ) : <Err>Todas las mesas están ocupadas: no se pueden recibir pedidos para comer aquí hasta que se libere una.</Err>}
    </Sub>
  );
}

export default function NuevoPedido() {
  const { config } = useSesion();
  const { confirmar, accion } = useDialogos();
  const navigate = useNavigate();
  const { datos } = useDatos('/catalogo', { cada: 15000 });
  const [B, setB] = useState(guardado);
  const [abierto, setAbierto] = useState(null);
  const [ticket, setTicket] = useState(null);
  useEffect(() => { guardado = B; }, [B]);

  const cat = useMemo(() => datos && ({
    ...datos,
    P: Object.fromEntries(datos.productos.map((x) => [x.id, x])),
    M: Object.fromEntries(datos.materias.map((m) => [m.id, m])),
  }), [datos]);
  if (!cat) return <Cargando />;

  const { P, disp, ofertas, tendencia } = cat;
  const enMenu = cat.productos.filter((x) => !x.extra && ['Activo', 'Precio por revisar'].includes(x.estado) && cat.menu.includes(x.id));
  const cats = ['Tendencia', 'Todos', ...new Set(enMenu.flatMap((x) => x.categorias))];
  const lista = enMenu.filter((x) => B.cat === 'Todos' || (B.cat === 'Tendencia' ? tendencia.includes(x.id) : x.categorias.includes(B.cat)));
  const unit = (l) => precioCon(P[l.pr].precio, ofertas[l.pr]) + l.extras.reduce((a, e) => a + P[e].precio, 0);
  const total = B.lineas.reduce((a, l) => a + l.cant * unit(l), 0);
  const libres = cat.mesas.total - Object.keys(cat.mesas.ocupadas).length;
  const mesaValida = B.mesa && !cat.mesas.ocupadas[B.mesa] ? B.mesa : null;
  const set = (cambio) => setB((b) => ({ ...b, ...cambio }));
  const nombre = (l) => ({ ...l, nombre: P[l.pr].nombre, extras: l.extras.map((e) => ({ nombre: P[e].nombre })) });

  const agregar = (n) => {
    const i = B.lineas.findIndex((l) => clave(l) === clave(n));
    const lineas = [...B.lineas];
    if (i >= 0) lineas[i] = { ...lineas[i], cant: lineas[i].cant + n.cant }; else lineas.push(n);
    set({ lineas });
    setAbierto(null);
  };
  const cambiarCant = (i, d) => {
    const lineas = [...B.lineas];
    const n = lineas[i].cant + d;
    if (n <= 0) lineas.splice(i, 1); else lineas[i] = { ...lineas[i], cant: n };
    set({ lineas });
  };
  const enviar = () => accion(async () => {
    if (!B.ref.trim()) throw new Error('Escribe el nombre del cliente');
    if (B.tipo === 'Aquí' && !libres) throw new Error('Todas las mesas están ocupadas');
    if (B.tipo === 'Aquí' && !mesaValida) throw new Error('Elige la mesa del cliente');
    if (!cabe(B.lineas, P, disp)) throw new Error('No alcanzan los insumos para el pedido');
    const p = await api.post('/mesero/pedidos', { tipo: B.tipo, mesa: B.tipo === 'Aquí' ? mesaValida : null, ref: B.ref.trim(), lineas: B.lineas });
    setB(nuevo());
    setTicket(p);
  });
  const descartar = async () => {
    if (await confirmar({ titulo: '¿Descartar el borrador?', texto: 'No se ha reservado inventario.', verbo: 'Descartar', rojo: true })) setB(nuevo());
  };

  const carrito = B.lineas.length > 0;
  return (
    <div className="tw:flex tw:flex-col tw:gap-3.5">
      <Pildoras opciones={cats.map((c) => [c, c === 'Tendencia' ? '🔥 Tendencia' : c])} valor={B.cat} onChange={(c) => set({ cat: c })} />
      <div className={`tw:grid tw:gap-4 tw:items-start ${carrito ? 'tw:lg:grid-cols-[minmax(0,1.8fr)_minmax(330px,1fr)] tw:max-lg:pb-[48vh]' : ''}`}>
        {lista.length ? (
          <div className="tw:grid tw:gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(210px, 100%), 1fr))' }}>
            {lista.map((x) => {
              const agot = !cabe([...B.lineas, { pr: x.id, cant: 1, extras: [] }], P, disp) && !cabe([{ pr: x.id, cant: 1, extras: [] }], P, disp);
              const rv = x.estado === 'Precio por revisar' || cat.revisar.includes(x.id);
              const n = B.lineas.filter((l) => l.pr === x.id).reduce((a, l) => a + l.cant, 0);
              const of = ofertas[x.id];
              return (
                <button key={x.id} type="button" disabled={agot || rv} onClick={() => setAbierto(x)}
                  className="tw:group tw:relative tw:block tw:aspect-[4/3] tw:overflow-hidden tw:rounded-[20px] tw:bg-tx tw:text-left tw:shadow-osv tw:transition tw:hover:shadow-osv2 tw:disabled:cursor-not-allowed">
                  <Foto x={x} className={`tw:absolute tw:inset-0 tw:w-full tw:h-full ${agot || rv ? 'tw:grayscale-[.8] tw:brightness-[.7]' : ''}`} icono="tw:text-[56px] tw:mb-7" />
                  <span className="tw:absolute tw:top-2.5 tw:left-2.5 tw:flex tw:flex-wrap tw:gap-1.5">
                    {tendencia.includes(x.id) && <Chip t="Tendencia" o="wa" className="tw:bg-white" />}
                    {of && <Chip t={`−${of} %`} o="ok" className="tw:bg-white" />}
                    {agot && <Chip t="Agotado" o="g" className="tw:bg-white" />}
                    {rv && <Chip t="No disponible" o="g" className="tw:bg-white" />}
                  </span>
                  {n > 0 && <span className="tw:absolute tw:top-2.5 tw:right-2.5 tw:min-w-[30px] tw:h-[30px] tw:px-2 tw:rounded-[15px] tw:bg-br tw:text-white tw:font-bold tw:grid tw:place-items-center">×{n}</span>}
                  <span className="osv-pcard-grad tw:absolute tw:inset-x-0 tw:bottom-0 tw:px-3.5 tw:pt-[30px] tw:pb-3 tw:flex tw:flex-col tw:gap-0.5">
                    <b className="tw:text-white tw:text-[15px] tw:leading-tight">{x.nombre}</b>
                    <span className="tw:text-white tw:font-bold tw:text-sm">{of ? <><s className="tw:opacity-70 tw:font-medium tw:mr-1">{$(x.precio)}</s>{$(precioCon(x.precio, of))}</> : $(x.precio)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : <Vacio>No hay productos en esta categoría</Vacio>}

        {carrito && (
          <aside className="tw:flex tw:flex-col tw:gap-3 tw:rounded-[26px] tw:border tw:border-br/30 tw:shadow-osv2 tw:p-[18px] tw:bg-gradient-to-b tw:from-[#EEF4FD] tw:to-white
            tw:max-lg:fixed tw:max-lg:left-3 tw:max-lg:right-3 tw:max-lg:bottom-[92px] tw:max-lg:max-h-[44vh] tw:max-lg:overflow-auto tw:max-lg:z-20
            tw:lg:sticky tw:lg:top-[76px] tw:lg:max-h-[calc(100vh-96px)]" aria-label="Pedido en curso">
            <h3 className="tw:text-[17px] tw:m-0">Pedido en curso</h3>
            <Seg opciones={['Aquí', 'Llevar', 'Delivery']} valor={B.tipo} onChange={(t) => set({ tipo: t })} min={80} />
            <Form.Control placeholder="Nombre del cliente" value={B.ref} onChange={(e) => set({ ref: e.target.value })} aria-label="Nombre del cliente" />
            {B.tipo === 'Aquí' && <SelectorMesa mesas={cat.mesas} valor={mesaValida} onChange={(m) => set({ mesa: m })} />}
            <div className="tw:flex tw:flex-col tw:gap-2.5 tw:overflow-auto tw:min-h-24 tw:flex-1">
              {B.lineas.map((l, i) => {
                const mas = cabe(B.lineas.map((q, j) => (j === i ? { ...q, cant: q.cant + 1 } : q)), P, disp);
                return (
                  <Sub key={clave(l)}>
                    <div className="tw:flex tw:gap-2"><b className="tw:flex-1">{txt(nombre(l))}</b><span>{$(l.cant * unit(l))}</span></div>
                    <div className="tw:flex tw:items-center tw:gap-2">
                      <Btn onClick={() => cambiarCant(i, -1)} aria-label={l.cant === 1 ? 'Quitar del pedido' : 'Quitar uno'}>{l.cant === 1 ? '🗑' : '−'}</Btn>
                      <b>{l.cant}</b>
                      {mas ? <Btn onClick={() => cambiarCant(i, 1)} aria-label="Agregar uno">+</Btn> : <Mut>Máximo disponible</Mut>}
                    </div>
                  </Sub>
                );
              })}
            </div>
            <Mut>Tiempo estimado del pedido: ~{minutos(estimar(B.lineas, P, config))} min</Mut>
            <h3 className="tw:text-[17px] tw:m-0">Total (IVA incluido) {$(total)}</h3>
            <Btn v="p" disabled={B.tipo === 'Aquí' && !libres} onClick={enviar}>Enviar pedido</Btn>
            <Btn v="t" onClick={descartar}>Descartar borrador</Btn>
          </aside>
        )}
      </div>

      {abierto && <FichaProducto x={abierto} cat={cat} lineas={B.lineas} disp={disp} onAgregar={agregar} onHide={() => setAbierto(null)} />}

      <Modal show={!!ticket} onHide={() => setTicket(null)} centered>
        {ticket && (
          <Modal.Body>
            <h3>{ticket.rep ? 'Reposición' : 'Ticket'} #{ticket.num}</h3>
            <TicketPedido p={ticket} />
            <div className="tw:flex tw:justify-end tw:gap-2">
              <Btn v="t" onClick={() => setTicket(null)}>Nuevo pedido</Btn>
              <Btn v="p" onClick={() => navigate('/mesero/pedidos')}>Ver mis pedidos</Btn>
            </div>
          </Modal.Body>
        )}
      </Modal>
    </div>
  );
}
