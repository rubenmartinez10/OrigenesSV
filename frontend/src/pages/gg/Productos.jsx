import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fmt, r2 } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Campo, Card, Cargando, Chip, Err, Etapas, Foto, Kv, Mut, Panel, Pildoras, Stack, Tabla, Toggle, Vacio } from '../../components/ui.jsx';

/* Gerente general · 7.6 Productos nuevos y catálogo (solo el gerente general edita productos; la receta, con clave) */
const ETP = ['Cocinero', 'Gerente de sucursal', 'Gerente general', 'Director', 'Catálogo'];
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function Propuestas() {
  const navigate = useNavigate();
  const { motivo, confirmar, accion } = useDialogos();
  const { datos } = useDatos('/gg/propuestas');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const x = ver && datos.propuestas.find((s) => s.id === ver);
  const neto = x?.precio ? r2(x.precio / (1 + datos.iva / 100)) : 0;
  const prod = x?.tipo === 'Producto nuevo';
  const noCubre = prod && !x.costo.incompleto && neto <= x.costo.costo;
  const bloq = x && (x.faltan.length > 0 || noCubre);
  const aprobar = async () => {
    if (!(await confirmar({ titulo: `Enviar «${x.nombre}» al director`, texto: 'Pasa al director para el veredicto final (Aprobado por gerente general).', verbo: 'Aprobar' }))) return;
    if (await accion(() => api.post(`/gg/propuestas/${x.id}/aprobar`), 'Enviada al director')) setVer(null);
  };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/gg/propuestas/${x.id}/rechazar`, { motivo: m }), 'Propuesta rechazada')) setVer(null);
  };
  return (
    <Stack>
      {datos.propuestas.length ? <Tabla cols={['Propuesta', 'Tipo', 'Propone', 'Sucursal', 'Fecha']} filas={datos.propuestas.map((s) => ({
        onClick: () => setVer(s.id), celdas: [s.nombre, <Chip t={s.tipo} o="in" sinSimbolo />, s.propone, s.sucNombre, fmt(s.fecha)],
      }))} /> : <Vacio ic="check">No hay productos por evaluar</Vacio>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={x.nombre} estado={x.estado}
          pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" disabled={bloq} title={x.faltan.length ? 'Falta asignar proveedor' : ''} onClick={aprobar}>Aprobar</Btn>]}>
          {x.faltan.length > 0 && <Err>Falta proveedor para: {x.faltan.join(', ')}. <button type="button" className="tw:underline tw:text-br" onClick={() => navigate('/gg/aprobaciones/proveedores')}>Ir a Proveedores</button></Err>}
          <Etapas l={ETP} a={2} />
          {prod && <>
            <Kv pares={[['Propone', `${x.propone} · ${x.sucNombre}`], ['Categorías', (x.datos.cats || []).join(', ') || '—'], ['Tiempo', `${x.datos.tiempo || '—'} min`],
              ['Costo por porción (tope, sin IVA)', x.costo.incompleto ? 'Incompleto: faltan proveedores' : $(x.costo.costo)],
              ['Precio propuesto por el gerente (IVA incl.)', $(x.precio)], ['Margen sobre el costo', x.costo.incompleto ? '—' : $(neto - x.costo.costo)]]} />
            {noCubre && <Err>El precio no cubre el costo: rechaza la propuesta para que el gerente lo corrija.</Err>}
          </>}
          {x.tipo === 'Extra nuevo' && <Kv pares={[['Propone', x.propone], ['Precio', $(x.precio)], ['Aparece en', x.prodsNombres.join(', ') || '—']]} />}
          {x.tipo === 'Categoría nueva' && <Kv pares={[['Propone', x.propone], ['Motivo', x.motivo || '—']]} />}
          {x.ings.length > 0 && <>
            <h4 className="tw:text-sm tw:m-0">Receta</h4>
            <Tabla cols={['Ingrediente', 'Cantidad', 'Proveedor']} filas={x.ings.map((i) => [i.nombre, `${i.cant} ${i.unidad}`, <Chip t={i.conProv ? 'Con proveedor' : 'Sin proveedor'} o={i.conProv ? 'ok' : 'er'} />])} />
          </>}
        </Panel>
      )}
    </Stack>
  );
}

function Editar({ x, cat, onHide }) {
  const { accion, clave } = useDialogos();
  const [d, setD] = useState({ nombre: x.nombre, desc: x.desc || '', precio: String(x.precio), tiempo: String(x.tiempo), cats: [...x.cats], receta: x.receta.map((r) => ({ mp: r.mp, cant: String(r.cant) })) });
  const set = (y) => setD({ ...d, ...y });
  const rec = d.receta.filter((r) => r.mp && +r.cant > 0).map((r) => ({ mp: +r.mp, cant: +r.cant }));
  const e = !d.nombre.trim() ? 'Escribe el nombre' : !(+d.precio > 0) ? 'El precio debe ser mayor que 0' : !x.extra && !d.cats.length ? 'Elige al menos una categoría'
    : !(+d.tiempo > 0) ? 'El tiempo debe ser mayor que 0' : !rec.length ? 'Agrega al menos una materia prima'
      : new Set(rec.map((r) => r.mp)).size < rec.length ? 'Una materia prima está repetida en la receta' : '';
  const orden = (L) => JSON.stringify([...L].sort((a, b) => a.mp - b.mp));
  const cambio = orden(rec) !== orden(x.receta.map((r) => ({ mp: r.mp, cant: r.cant })));
  const cuerpo = { nombre: d.nombre.trim(), desc: d.desc, precio: +d.precio, tiempo: +d.tiempo, cats: d.cats, receta: rec };
  const guardar = async () => {
    const ok = cambio
      ? await clave({ resumen: `Cambiar las materias primas de «${x.nombre}». Se crea una versión nueva y la anterior queda en el historial.`, pideMotivo: true,
        accion: (k) => api.put(`/gg/catalogo/${x.id}`, { ...cuerpo, ...k }), ok: 'Producto actualizado' })
      : await accion(() => api.put(`/gg/catalogo/${x.id}`, cuerpo), 'Producto actualizado');
    if (ok) onHide();
  };
  const fila = (r, j) => (
    <div key={j} className="tw:flex tw:gap-2 tw:items-center">
      <Form.Select value={r.mp} onChange={(ev) => set({ receta: d.receta.map((z, k) => (k === j ? { ...z, mp: +ev.target.value } : z)) })} aria-label="Materia prima">
        <option value="">Elige</option>{cat.materias.map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.unidad})</option>)}
      </Form.Select>
      <Form.Control type="number" min={0} step="any" value={r.cant} className="tw:max-w-[110px]" aria-label="Cantidad" onChange={(ev) => set({ receta: d.receta.map((z, k) => (k === j ? { ...z, cant: ev.target.value } : z)) })} />
      <Btn v="t" aria-label="Quitar" onClick={() => set({ receta: d.receta.filter((_, k) => k !== j) })}>✕</Btn>
    </div>
  );
  return (
    <Panel show onHide={onHide} titulo={`Editar · ${x.nombre}`} pie={[<Btn key="c" v="t" onClick={onHide}>Cancelar</Btn>, <Btn key="g" v="p" disabled={!!e} onClick={guardar}>Guardar cambios</Btn>]}>
      <Campo l="Nombre"><Form.Control value={d.nombre} onChange={(ev) => set({ nombre: ev.target.value })} /></Campo>
      {!x.extra && <Campo l="Descripción"><Form.Control as="textarea" rows={2} value={d.desc} onChange={(ev) => set({ desc: ev.target.value })} /></Campo>}
      <div className="tw:flex tw:gap-2">
        <Campo l="Precio (IVA incluido)" className="tw:flex-1"><Form.Control type="number" min={0} step="0.05" value={d.precio} onChange={(ev) => set({ precio: ev.target.value })} /></Campo>
        <Campo l={x.extra ? 'Minutos extra' : 'Minutos para 1 unidad'} className="tw:flex-1"><Form.Control type="number" min={0} value={d.tiempo} onChange={(ev) => set({ tiempo: ev.target.value })} /></Campo>
      </div>
      {!x.extra && <div className="tw:flex tw:flex-col tw:gap-1.5"><span>Categorías</span><div className="tw:flex tw:flex-wrap tw:gap-1.5">
        {cat.categorias.map((c) => <Toggle key={c.nombre} on={d.cats.includes(c.nombre)} onClick={() => set({ cats: d.cats.includes(c.nombre) ? d.cats.filter((z) => z !== c.nombre) : [...d.cats, c.nombre] })}>{c.nombre}</Toggle>)}
      </div></div>}
      <Card className="tw:flex tw:flex-col tw:gap-2">
        <b>Materias primas de la receta</b>
        <Mut>Cambiarlas pide tu clave y crea una versión nueva; no se duplica el producto.</Mut>
        {d.receta.map(fila)}
        <div><Btn v="t" onClick={() => set({ receta: [...d.receta, { mp: '', cant: '' }] })}>+ Agregar materia prima</Btn></div>
      </Card>
      {e && <Mut>{e}</Mut>}
      {cambio && !e && <Mut>Al guardar se pedirá tu clave y la razón del cambio de receta.</Mut>}
    </Panel>
  );
}

const SC = { q: '', cat: '', ext: false };
export function Catalogo() {
  const { datos } = useDatos('/gg/catalogo');
  const [f, setFS] = useState(SC);
  const setF = (x) => { Object.assign(SC, x); setFS({ ...SC }); };
  const [ed, setEd] = useState(null);
  if (!datos) return <Cargando />;
  const L = datos.productos.filter((p) => p.extra === f.ext && (!f.q || norm(p.nombre).includes(norm(f.q))) && (!f.cat || p.cats.includes(f.cat)));
  const x = ed && datos.productos.find((p) => p.id === ed);
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Pildoras opciones={[['p', 'Productos'], ['e', 'Extras']]} valor={f.ext ? 'e' : 'p'} onChange={(v) => setF({ ext: v === 'e' })} />
        <Form.Control type="search" placeholder="Buscar" value={f.q} onChange={(e) => setF({ q: e.target.value })} className="tw:max-w-[220px]" aria-label="Buscar" />
        <Form.Select value={f.cat} onChange={(e) => setF({ cat: e.target.value })} className="tw:max-w-[200px]" aria-label="Categoría">
          <option value="">Categoría</option>{datos.categorias.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
        </Form.Select>
      </div>
      {L.length ? <Tabla cols={['', 'Producto', 'Precio', 'Versión', '']} filas={L.map((p) => [
        <Foto x={{ ...p, categorias: p.cats }} className="tw:w-12 tw:h-12 tw:rounded-xl" icono="tw:text-2xl" />,
        <div className="tw:flex tw:flex-col tw:gap-1"><b>{p.nombre}</b><div className="tw:flex tw:flex-wrap tw:gap-1">{p.cats.map((c) => <Chip key={c} t={c} o="g" sinSimbolo />)}{p.estado !== 'Activo' && <Chip t={p.estado} />}</div></div>,
        $(p.precio), <Chip t={`v${p.version}`} o="in" sinSimbolo />, <Btn v="p" onClick={() => setEd(p.id)}>Editar</Btn>,
      ])} /> : <Vacio ic="box">Nada coincide con la búsqueda</Vacio>}
      {x && <Editar x={x} cat={datos} onHide={() => setEd(null)} />}
    </Stack>
  );
}

export default function ProductosGG({ tab = 'propuestas' }) {
  return tab === 'catalogo' ? <Catalogo /> : <Propuestas />;
}
