import { useState } from 'react';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fmt } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Btn, Card, Cargando, Chip, Err, Fila, Grid, Kv, Lab, Mut, Panel, Stack, Sub, Tabla, Vacio } from '../../components/ui.jsx';
import { Icono } from '../../components/Icono.jsx';
import { FormExtra, Ingredientes, extraVacio, extraDesde, errorExtra, extraParaApi } from '../../components/Selectores.jsx';
import { Categorias } from '../cocinero/Proponer.jsx';

const ingsDe = (d) => ((d.ings || []).length ? d.ings.map((i) => ({ mp: i.mp, cant: String(i.cant) })) : [{ mp: '', cant: '' }]);
const listos = (ings) => ings.filter((r) => r.mp && +r.cant > 0).map((r) => ({ mp: r.mp, cant: +r.cant }));

/* ---------- productos (solo lectura: los edita el gerente general) ---------- */
function Productos({ cat, P, M }) {
  const { confirmar, accion } = useDialogos();
  const [q, setQ] = useState('');
  const [ver, setVer] = useState(null);
  const [nuevo, setNuevo] = useState(null);
  const [er, setEr] = useState('');
  const extrasDe = (x) => cat.productos.filter((e) => e.extra && e.estado === 'Activo' && e.prods.includes(x.id));
  const lista = cat.productos.filter((x) => !x.extra && x.estado !== 'Eliminado' && x.nombre.toLowerCase().includes(q.trim().toLowerCase()));

  const proponer = async () => {
    const d = { ...nuevo, ings: listos(nuevo.ings), nombre: nuevo.nombre.trim() };
    const e = !d.nombre ? 'Escribe el nombre' : !d.cats.length ? 'Elige al menos una categoría' : !d.ings.length ? 'Agrega al menos un ingrediente' : !(+d.tiempo > 0) ? 'El tiempo debe ser mayor que 0' : '';
    setEr(e);
    if (e) return;
    if (!(await confirmar({ titulo: `¿Proponer «${d.nombre}»?`, texto: 'Se envía directo al gerente de sucursal, sin pasar por tu verificación.', verbo: 'Proponer' }))) return;
    try {
      await api.post('/propuestas/producto', { estado: 'Propuesto', datos: d });
      setNuevo(null);
      accion(async () => {}, 'Enviado al gerente de sucursal');
    } catch (x) { setEr(x.message); }
  };

  return (
    <Stack>
      <div><Btn v="p" onClick={() => { setEr(''); setNuevo({ nombre: '', desc: '', cats: [], ings: [{ mp: '', cant: '' }], tiempo: '', nuevas: [] }); }}>+ Proponer producto</Btn></div>
      <Form.Control placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar producto" />
      {lista.length ? (
        <Grid min={300}>
          {lista.map((x) => (
            <button key={x.id} type="button" onClick={() => setVer(x)}
              className="tw:flex tw:flex-col tw:gap-2.5 tw:px-[18px] tw:py-4 tw:bg-sf tw:border tw:border-bd tw:rounded-[20px] tw:shadow-osv tw:text-left tw:text-tx tw:hover:border-[#B9CEF0]">
              <div className="tw:flex tw:items-start tw:justify-between tw:gap-3"><b className="tw:text-base tw:leading-tight">{x.nombre}</b><span className="tw:shrink-0 tw:px-3 tw:py-1 tw:rounded-full tw:bg-brs tw:text-br tw:font-bold">{$(x.precio)}</span></div>
              <div className="tw:flex tw:flex-wrap tw:gap-1.5">
                {x.categorias.map((k) => <Chip key={k} t={k} o="g" sinSimbolo />)}
                <Chip t={`${x.tiempo} min`} o="in" sinSimbolo />
                {x.version > 1 && <Chip t={`v${x.version}`} o="in" sinSimbolo />}
                {x.estado !== 'Activo' && <Chip t={x.estado} />}
              </div>
              <div className="tw:flex tw:flex-col tw:gap-0.5 tw:pt-2 tw:border-t tw:border-bd"><small className="tw:text-[11px] tw:uppercase tw:tracking-wide tw:text-tx2">Receta</small><span className="tw:text-[13px]">{x.receta.map((r) => M[r.mp]?.nombre).join(', ')}</span></div>
              <div className="tw:flex tw:flex-col tw:gap-0.5 tw:pt-2 tw:border-t tw:border-bd"><small className="tw:text-[11px] tw:uppercase tw:tracking-wide tw:text-tx2">Extras</small><span className="tw:text-[13px]">{extrasDe(x).map((e) => e.nombre).join(', ') || 'Ninguno'}</span></div>
              <span className="tw:flex tw:items-center tw:gap-1 tw:text-br tw:font-semibold tw:text-[13px]">Ver receta <Icono n="chev" size={16} /></span>
            </button>
          ))}
        </Grid>
      ) : <Vacio>No encontramos ese producto</Vacio>}

      {ver && (
        <Panel show ro onHide={() => setVer(null)} titulo={ver.nombre} estado={ver.estado}>
          <Ban>Solo lectura: los productos los edita el gerente general. Si ves un error, avísale a la gerencia.</Ban>
          <Kv pares={[['Precio', $(ver.precio)], ['Categorías', ver.categorias.join(', ')], ['Tiempo', `${ver.tiempo} min para 1 unidad`], ['Versión', `v${ver.version}`]]} />
          <h4 className="tw:text-sm tw:m-0">Receta</h4>
          <Tabla cols={['Materia prima', 'Cantidad']} filas={ver.receta.map((r) => [M[r.mp]?.nombre, `${r.cant} ${M[r.mp]?.unidad || ''}`])} />
          <h4 className="tw:text-sm tw:m-0">Extras</h4>
          <div className="tw:text-tx2">{extrasDe(ver).map((e) => e.nombre).join(', ') || 'Ninguno'}</div>
        </Panel>
      )}
      {nuevo && (
        <Panel show onHide={() => setNuevo(null)} titulo="Proponer producto" pie={<Btn v="p" onClick={proponer}>Proponer</Btn>}>
          <Err>{er}</Err>
          <div><Lab>Nombre</Lab><Form.Control placeholder="Ej. Licuado" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
          <div><Lab>Descripción</Lab><Form.Control as="textarea" rows={2} value={nuevo.desc} onChange={(e) => setNuevo({ ...nuevo, desc: e.target.value })} /></div>
          <div><Lab>Categorías</Lab><Categorias todas={cat.categorias.map((c) => c.nombre)} valor={nuevo.cats} onChange={(cats) => setNuevo({ ...nuevo, cats })} /></div>
          <Sub><Lab>Ingredientes</Lab><Ingredientes ings={nuevo.ings} onChange={(ings) => setNuevo({ ...nuevo, ings })} materias={cat.materias} unidades={cat.unidades} nuevas={nuevo.nuevas} onNuevas={(nuevas) => setNuevo({ ...nuevo, nuevas })} /></Sub>
          <div><Lab>Minutos estimados para 1 unidad</Lab><Form.Control inputMode="numeric" placeholder="Ej. 8" value={nuevo.tiempo} onChange={(e) => setNuevo({ ...nuevo, tiempo: e.target.value })} /></div>
          <Mut>Va directo al gerente de sucursal: no pasa por tu aprobación. Los extras se crean en la pestaña Extras.</Mut>
        </Panel>
      )}
    </Stack>
  );
}

/* ---------- extras ---------- */
function Extras({ cat, P, M }) {
  const { confirmar, accion } = useDialogos();
  const [ver, setVer] = useState(null);
  const [F, setF] = useState(null);
  const [er, setEr] = useState('');
  const L = cat.productos.filter((x) => x.extra && x.estado !== 'Eliminado');
  const nombres = (ids) => ids.map((i) => P[i]?.nombre).filter(Boolean).join(', ');
  const proponer = async () => {
    const e = errorExtra(F);
    setEr(e);
    if (e) return;
    if (!(await confirmar({ titulo: `¿Proponer «${F.nombre.trim()}»?`, texto: 'Se envía directo al gerente de sucursal y sigue el mismo camino que un producto nuevo.', verbo: 'Proponer' }))) return;
    try {
      await api.post('/propuestas/extra', { datos: extraParaApi(F) });
      setF(null);
      accion(async () => {}, 'Enviado al gerente de sucursal');
    } catch (x) { setEr(x.message); }
  };
  return (
    <Stack>
      <div><Btn v="p" onClick={() => { setEr(''); setF(extraVacio()); }}>+ Proponer extra</Btn></div>
      <Mut>Los extras no salen en el menú: cada uno se ofrece solo en los productos que le asignes.</Mut>
      {L.length ? (
        <Grid min={280}>
          {L.map((x) => (
            <Fila key={x.id} ico="plus" tono="in" t={x.nombre} chips={x.version > 1 && <Chip t={`v${x.version}`} o="in" />}
              s={`${$(x.precio)} · +${x.tiempo} min · Aparece en: ${nombres(x.prods) || '—'}`} m={x.receta.map((r) => `${M[r.mp]?.nombre} ${r.cant}`).join(', ')} onClick={() => setVer(x)} />
          ))}
        </Grid>
      ) : <Vacio>Aún no hay extras</Vacio>}
      {ver && (
        <Panel show ro onHide={() => setVer(null)} titulo={ver.nombre}>
          <Ban>Solo lectura: los extras los edita el gerente general.</Ban>
          <Kv pares={[['Precio', $(ver.precio)], ['Tiempo extra', `${ver.tiempo} min`], ['Aparece en', nombres(ver.prods) || '—']]} />
          <h4 className="tw:text-sm tw:m-0">Receta</h4>
          <Tabla cols={['Materia prima', 'Cantidad']} filas={ver.receta.map((r) => [M[r.mp]?.nombre, `${r.cant} ${M[r.mp]?.unidad || ''}`])} />
        </Panel>
      )}
      {F && (
        <Panel show onHide={() => setF(null)} titulo="Proponer extra" pie={<Btn v="p" onClick={proponer}>Guardar</Btn>}>
          <Err>{er}</Err>
          <FormExtra F={F} setF={setF} cat={cat} />
        </Panel>
      )}
    </Stack>
  );
}

/* ---------- categorías ---------- */
function CategoriasTab({ cat }) {
  const { accion } = useDialogos();
  const [nueva, setNueva] = useState(null);
  const [er, setEr] = useState('');
  const crear = async () => {
    try {
      await api.post('/propuestas/categoria', { nombre: nueva });
      setNueva(null);
      accion(async () => {}, 'Enviada al gerente de sucursal');
    } catch (x) { setEr(x.message); }
  };
  return (
    <Stack>
      <div><Btn v="p" onClick={() => { setEr(''); setNueva(''); }}>+ Proponer categoría</Btn></div>
      <Grid min={220}>
        {cat.categorias.map((c) => (
          <Card key={c.id} className="tw:flex tw:items-center tw:gap-3">
            <span className="tw:text-3xl" aria-hidden="true">{c.icono || '🍴'}</span>
            <div><b>{c.nombre}</b>
              <div className="tw:text-tx2">{cat.productos.filter((x) => !x.extra && x.categorias.includes(c.nombre)).length} productos · {cat.productos.filter((x) => x.extra && x.estado === 'Activo' && x.categorias.includes(c.nombre)).length} extras</div>
            </div>
          </Card>
        ))}
      </Grid>
      <Modal show={nueva != null} onHide={() => setNueva(null)} centered>
        <Modal.Body>
          <h3>Nueva categoría</h3>
          <Form.Control placeholder="Nombre de la categoría" value={nueva || ''} onChange={(e) => setNueva(e.target.value)} autoFocus />
          <Err>{er}</Err>
          <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={() => setNueva(null)}>Cancelar</Btn><Btn v="p" onClick={crear}>Crear</Btn></div>
        </Modal.Body>
      </Modal>
    </Stack>
  );
}

/* ---------- propuestas de los cocineros ---------- */
function Propuestas({ cat, M }) {
  const { confirmar, motivo, accion } = useDialogos();
  const { datos } = useDatos('/propuestas/pendientes', { cada: 8000 });
  const [rev, setRev] = useState(null);
  const [d, setD] = useState(null);
  const [er, setEr] = useState('');
  if (!datos) return <Cargando />;
  const abrir = (x) => {
    setEr('');
    setRev(x);
    setD(x.tipo === 'Producto nuevo' ? { ...x.datos, ings: ingsDe(x.datos), tiempo: String(x.datos.tiempo || '') } : x.tipo === 'Extra nuevo' ? extraDesde(x.datos) : null);
  };
  const cerrar = () => { setRev(null); setD(null); };
  const rechazar = async () => {
    const m = await motivo({ titulo: rev.tipo === 'Categoría nueva' ? 'Motivo por el que no se crea la categoría' : 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/propuestas/${rev.id}/rechazar`, { motivo: m }), 'Propuesta rechazada')) cerrar();
  };
  const aprobar = async () => {
    let cuerpo = {};
    if (rev.tipo === 'Producto nuevo') {
      const e = { ...d, nombre: String(d.nombre).trim(), ings: listos(d.ings), tiempo: +d.tiempo };
      if (!e.nombre || !(e.tiempo > 0) || !e.ings.length) return setEr('Revisa nombre, tiempo e ingredientes');
      cuerpo = { datos: e };
    } else if (rev.tipo === 'Extra nuevo') {
      const e = errorExtra(d);
      if (e) return setEr(e);
      cuerpo = { datos: extraParaApi(d) };
    }
    const nombre = rev.tipo === 'Categoría nueva' ? rev.nombre : String(d.nombre).trim();
    if (!(await confirmar({ titulo: `¿Aprobar «${nombre}» y enviarlo al gerente de sucursal?`, texto: 'Sigue el mismo camino que un producto nuevo.', verbo: 'Aprobar' }))) return;
    try {
      await api.post(`/propuestas/${rev.id}/aprobar`, cuerpo);
      cerrar();
      accion(async () => {}, 'Aprobada y enviada al gerente');
    } catch (x) { setEr(x.message); }
  };

  return (
    <Stack>
      {datos.length ? datos.map((x) => (
        <Fila key={x.id} ico={x.tipo === 'Producto nuevo' ? 'box' : x.tipo === 'Extra nuevo' ? 'plus' : 'tag'} tono="wa" t={x.nombre}
          chips={<Chip t={x.tipo} o="in" />} s={`Cocinero: ${x.solicitanteNombre} · ${fmt(x.fecha)}`}
          m={x.datos?.nuevas?.length ? `${x.datos.nuevas.length} materias primas nuevas` : ''} onClick={() => abrir(x)} />
      )) : <Vacio ic="check">No hay propuestas por revisar</Vacio>}

      {rev && (
        <Panel show onHide={cerrar} titulo={`${rev.tipo === 'Producto nuevo' ? '' : `${rev.tipo.split(' ')[0]} · `}${rev.nombre}`} estado={rev.estado}
          pie={[<Btn key="r" v="t" onClick={rechazar}>{rev.tipo === 'Categoría nueva' ? 'No crearla' : 'Rechazar'}</Btn>, <Btn key="a" v="p" onClick={aprobar}>Aprobar y enviar al gerente</Btn>]}>
          <Err>{er}</Err>
          {rev.tipo === 'Producto nuevo' && d && <>
            <div className="tw:text-tx2">Cocinero: {rev.solicitanteNombre} · {(d.cats || []).join(', ')}</div>
            <div><Lab>Nombre</Lab><Form.Control value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></div>
            <div><Lab>Minutos estimados</Lab><Form.Control inputMode="numeric" value={d.tiempo} onChange={(e) => setD({ ...d, tiempo: e.target.value })} /></div>
            <Sub><Lab>Ingredientes</Lab><Ingredientes ings={d.ings} onChange={(ings) => setD({ ...d, ings })} materias={cat.materias} unidades={cat.unidades} nuevas={d.nuevas || []} onNuevas={(nuevas) => setD({ ...d, nuevas })} /></Sub>
            {d.desc && <Mut>{d.desc}</Mut>}
          </>}
          {rev.tipo === 'Extra nuevo' && d && <>
            <div className="tw:text-tx2">Cocinero: {rev.solicitanteNombre}</div>
            <FormExtra F={d} setF={setD} cat={cat} />
          </>}
          {rev.tipo === 'Categoría nueva' && <>
            <div className="tw:text-tx2">Pide: {rev.solicitanteNombre}</div>
            <div>Motivo: {rev.motivo}</div>
          </>}
        </Panel>
      )}
    </Stack>
  );
}

export default function Recetas({ tab = 'productos' }) {
  const { datos: cat } = useDatos('/catalogo');
  if (!cat) return <Cargando />;
  const P = Object.fromEntries(cat.productos.map((x) => [x.id, x]));
  const M = Object.fromEntries(cat.materias.map((m) => [m.id, m]));
  if (tab === 'extras') return <Extras cat={cat} P={P} M={M} />;
  if (tab === 'categorias') return <CategoriasTab cat={cat} />;
  if (tab === 'propuestas') return <Propuestas cat={cat} M={M} />;
  return <Productos cat={cat} P={P} M={M} />;
}
