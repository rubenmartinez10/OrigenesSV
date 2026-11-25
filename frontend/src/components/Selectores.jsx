import { useState } from 'react';
import { Form, Modal } from 'react-bootstrap';
import { Icono } from './Icono.jsx';
import { Btn, Lab, Mut, Pildoras, Sub, Vacio, Chip } from './ui.jsx';

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Selector con buscador y filtro por categoría (U.picker del borrador). */
export function Selector({ show, onHide, titulo, items, onElegir, nuevo }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Todas');
  const cats = [...new Set(items.map((i) => i.cat).filter(Boolean))];
  const vis = items.filter((i) => (cat === 'Todas' || i.cat === cat) && (!q || norm(`${i.nombre} ${i.sub || ''}`).includes(norm(q))));
  return (
    <Modal show={show} onHide={onHide} centered scrollable>
      <Modal.Body>
        <h3>{titulo}</h3>
        <div className="tw:flex tw:items-center tw:gap-2 tw:border tw:border-bd tw:rounded-full tw:px-4 tw:bg-bg tw:text-tx2 tw:focus-within:border-br">
          <Icono n="search" size={18} />
          <input type="search" autoFocus placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar"
            className="tw:flex-1 tw:border-0 tw:bg-transparent tw:py-2.5 tw:outline-none tw:text-tx" />
        </div>
        {cats.length > 1 && <Pildoras opciones={['Todas', ...cats]} valor={cat} onChange={setCat} />}
        <div className="tw:flex tw:flex-col tw:gap-2 tw:max-h-[46vh] tw:overflow-auto tw:p-0.5">
          {vis.length ? vis.map((i) => (
            <button key={i.id} type="button" onClick={() => onElegir(i.id)}
              className="tw:flex tw:items-center tw:gap-3 tw:px-3.5 tw:py-2.5 tw:border tw:border-bd tw:rounded-[18px] tw:bg-sf tw:text-left tw:text-tx tw:hover:border-br">
              <span className="tw:w-[34px] tw:h-[34px] tw:rounded-[14px] tw:bg-brs tw:text-br tw:grid tw:place-items-center"><Icono n="box" size={18} /></span>
              <span className="tw:flex-1 tw:flex tw:flex-col"><b>{i.nombre}</b>{i.sub && <small className="tw:text-tx2">{i.sub}</small>}</span>
              {i.chip && <Chip t={i.chip} o="wa" />}
            </button>
          )) : <Vacio ic="search">Nada coincide con tu búsqueda</Vacio>}
        </div>
        <div className="tw:flex tw:items-center tw:gap-2">
          <span className="tw:flex-1" />
          {nuevo && <Btn v="t" onClick={nuevo}>+ Nueva materia prima</Btn>}
          <Btn v="t" onClick={onHide}>Cancelar</Btn>
        </div>
      </Modal.Body>
    </Modal>
  );
}

/** Lista editable de ingredientes [{mp, cant}]; mp puede ser «new:Nombre» si se permiten materias nuevas. */
export function Ingredientes({ ings, onChange, materias, unidades, nuevas, onNuevas }) {
  const [abierto, setAbierto] = useState(null);
  const [crear, setCrear] = useState(null);
  const M = Object.fromEntries(materias.map((m) => [m.id, m]));
  const nombreDe = (mp) => (!mp ? '' : String(mp).startsWith('new:') ? `${String(mp).slice(4)} · Nueva` : M[mp]?.nombre);
  const unidadDe = (mp) => (!mp ? '' : String(mp).startsWith('new:') ? (nuevas || []).find((n) => `new:${n.nombre}` === mp)?.unidad : M[mp]?.unidad);
  const set = (i, cambio) => onChange(ings.map((r, j) => (j === i ? { ...r, ...cambio } : r)));
  const items = [
    ...materias.filter((m) => m.estado === 'Activo').map((m) => ({ id: m.id, nombre: m.nombre, sub: `${m.unidad} · ${m.categoria}`, cat: m.categoria })),
    ...(nuevas || []).map((n) => ({ id: `new:${n.nombre}`, nombre: n.nombre, sub: `${n.unidad} · Nueva`, chip: 'Nueva' })),
  ];
  return (
    <div className="tw:flex tw:flex-col tw:gap-2">
      {ings.map((r, i) => (
        <div key={i} className="tw:grid tw:gap-2 tw:items-center tw:grid-cols-2 tw:md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <button type="button" onClick={() => setAbierto(i)}
            className={`tw:flex tw:items-center tw:gap-2.5 tw:w-full tw:min-h-[42px] tw:px-3.5 tw:py-1.5 tw:rounded-[14px] tw:text-left tw:text-tx ${r.mp ? 'tw:border tw:border-bd tw:bg-sf' : 'tw:border tw:border-dashed tw:border-br/55 tw:bg-bg tw:hover:bg-brs'}`}>
            <span className="tw:flex-1 tw:truncate">{r.mp ? <b>{nombreDe(r.mp)}</b> : <span className="tw:text-tx2">Elegir materia prima</span>}</span>
            <Icono n="chev" size={16} className="tw:text-tx2" />
          </button>
          <Form.Control inputMode="decimal" placeholder={`Cantidad${unidadDe(r.mp) ? ` (${unidadDe(r.mp)})` : ''}`} value={r.cant} onChange={(e) => set(i, { cant: e.target.value })} aria-label="Cantidad" />
          <Btn v="t" onClick={() => onChange(ings.filter((_, j) => j !== i))}>Quitar</Btn>
        </div>
      ))}
      <div><Btn onClick={() => onChange([...ings, { mp: '', cant: '' }])}>+ Agregar ingrediente</Btn></div>
      <Selector show={abierto != null} onHide={() => setAbierto(null)} titulo="Elige la materia prima" items={items}
        onElegir={(id) => { set(abierto, { mp: id }); setAbierto(null); }}
        nuevo={onNuevas ? () => { setCrear({ i: abierto, nombre: '', unidad: unidades?.[0] || 'kg' }); setAbierto(null); } : null} />
      <Modal show={!!crear} onHide={() => setCrear(null)} centered>
        {crear && (
          <Modal.Body>
            <h3>Nueva materia prima</h3>
            <Form.Control placeholder="Nombre" value={crear.nombre} onChange={(e) => setCrear({ ...crear, nombre: e.target.value })} autoFocus />
            <Form.Select value={crear.unidad} onChange={(e) => setCrear({ ...crear, unidad: e.target.value })}>{(unidades || []).map((u) => <option key={u}>{u}</option>)}</Form.Select>
            <div className="tw:flex tw:justify-end tw:gap-2">
              <Btn v="t" onClick={() => setCrear(null)}>Cancelar</Btn>
              <Btn v="p" disabled={!crear.nombre.trim()} onClick={() => {
                const n = crear.nombre.trim();
                onNuevas([...(nuevas || []).filter((x) => x.nombre !== n), { nombre: n, unidad: crear.unidad }]);
                set(crear.i, { mp: `new:${n}` });
                setCrear(null);
              }}>Guardar</Btn>
            </div>
          </Modal.Body>
        )}
      </Modal>
    </div>
  );
}

/** Productos donde aparecerá el extra: buscador, filtro por categoría, «elegir los mostrados» y «limpiar selección». */
function ProductosDelExtra({ show, valor, productos, categorias, onListo, onHide }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Todas');
  const [tmp, setTmp] = useState(valor);
  const ps = productos.filter((x) => !x.extra && ['Activo', 'Precio por revisar'].includes(x.estado));
  const vis = ps.filter((x) => (cat === 'Todas' || x.categorias.includes(cat)) && norm(x.nombre).includes(norm(q)));
  const ids = vis.map((x) => x.id);
  const todos = vis.length > 0 && ids.every((i) => tmp.includes(i));
  return (
    <Modal show={show} onHide={onHide} centered scrollable onEnter={() => { setTmp(valor); setQ(''); setCat('Todas'); }}>
      <Modal.Body>
        <h3>Productos donde aparecerá el extra</h3>
        <Form.Control placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Pildoras opciones={['Todas', ...categorias]} valor={cat} onChange={setCat} />
        <div className="tw:flex tw:flex-wrap tw:gap-2">
          <Btn v="t" onClick={() => setTmp(todos ? tmp.filter((i) => !ids.includes(i)) : [...new Set([...tmp, ...ids])])}>
            {todos ? `Quitar los ${vis.length} mostrados` : `Elegir los ${vis.length} mostrados`}
          </Btn>
          {tmp.length > 0 && <Btn v="t" onClick={() => setTmp([])}>Limpiar selección</Btn>}
        </div>
        <div className="tw:flex tw:flex-col tw:gap-2 tw:max-h-[42vh] tw:overflow-auto">
          {vis.length ? vis.map((x) => {
            const on = tmp.includes(x.id);
            return (
              <button key={x.id} type="button" onClick={() => setTmp(on ? tmp.filter((i) => i !== x.id) : [...tmp, x.id])}
                className={`tw:flex tw:flex-col tw:text-left tw:px-4 tw:py-2.5 tw:rounded-[18px] tw:border ${on ? 'tw:bg-br tw:text-white tw:border-br' : 'tw:bg-sf tw:border-bd tw:text-tx'}`}>
                <b>{on ? '✓ ' : ''}{x.nombre}</b><small className={on ? '' : 'tw:text-tx2'}>{x.categorias.join(', ')}</small>
              </button>
            );
          }) : <Vacio>No hay productos con ese filtro</Vacio>}
        </div>
        <b>{tmp.length} producto(s) elegido(s)</b>
        <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={onHide}>Cancelar</Btn><Btn v="p" onClick={() => onListo(tmp)}>Listo</Btn></div>
      </Modal.Body>
    </Modal>
  );
}

export const extraVacio = () => ({ nombre: '', precio: '', tiempo: '0', prods: [], ings: [{ mp: '', cant: '' }] });
export const extraDesde = (d) => ({ nombre: d.nombre, precio: String(d.precio), tiempo: String(d.tiempo), prods: [...(d.prods || [])], ings: (d.ings || []).map((i) => ({ mp: i.mp, cant: String(i.cant) })) });
export const errorExtra = (F) => (!String(F.nombre).trim() ? 'Escribe el nombre' : !(+F.precio > 0) ? 'El precio debe ser mayor que 0' : !(+F.tiempo >= 0) ? 'Los minutos deben ser 0 o más'
  : !F.prods.length ? 'Elige al menos un producto donde aparecerá' : !F.ings.some((r) => r.mp && +r.cant > 0) ? 'Agrega al menos un ingrediente' : '');

/** Formulario de un extra (lo usan el cocinero y el jefe de cocina). */
export function FormExtra({ F, setF, cat }) {
  const [abrir, setAbrir] = useState(false);
  const P = Object.fromEntries(cat.productos.map((x) => [x.id, x]));
  const nombres = F.prods.map((i) => P[i]?.nombre).filter(Boolean).join(', ');
  return (
    <div className="tw:flex tw:flex-col tw:gap-3">
      <div><Lab>Nombre del extra</Lab><Form.Control placeholder="Ej. Curtido" value={F.nombre} onChange={(e) => setF({ ...F, nombre: e.target.value })} /></div>
      <div><Lab>Precio $ (se suma al producto)</Lab><Form.Control inputMode="decimal" placeholder="Ej. 0.25" value={F.precio} onChange={(e) => setF({ ...F, precio: e.target.value })} /></div>
      <div><Lab>Minutos extra de preparación (0 si no suma)</Lab><Form.Control inputMode="numeric" placeholder="0" value={F.tiempo} onChange={(e) => setF({ ...F, tiempo: e.target.value })} /></div>
      <div>
        <Lab>Aparece solo en estos productos</Lab>
        <div className="tw:flex tw:flex-col tw:gap-1.5">
          <div><Btn v="p" onClick={() => setAbrir(true)}>Productos donde aparecerá el extra{F.prods.length ? ` · ${F.prods.length}` : ''}</Btn></div>
          <Mut>{nombres || 'Aún no has elegido ningún producto'}</Mut>
        </div>
      </div>
      <Sub>
        <Lab>Ingredientes (por cada unidad del producto)</Lab>
        <Ingredientes ings={F.ings} onChange={(ings) => setF({ ...F, ings })} materias={cat.materias} />
      </Sub>
      <ProductosDelExtra show={abrir} valor={F.prods} productos={cat.productos} categorias={cat.categorias.map((c) => c.nombre)}
        onHide={() => setAbrir(false)} onListo={(prods) => { setF({ ...F, prods }); setAbrir(false); }} />
    </div>
  );
}

/** Extra en formato para la API. */
export const extraParaApi = (F) => ({
  nombre: String(F.nombre).trim(), precio: +F.precio, tiempo: +F.tiempo || 0, prods: F.prods,
  ings: F.ings.filter((r) => r.mp && +r.cant > 0).map((r) => ({ mp: r.mp, cant: +r.cant })),
});
