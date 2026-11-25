import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $ } from '../../lib/formato.js';
import { useDatos, useSesion } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Card, Cargando, Err, Lab, Mut, Stack } from '../../components/ui.jsx';
import { FormExtra, Ingredientes, extraVacio, errorExtra, extraParaApi } from '../../components/Selectores.jsx';

/* Formularios que se conservan al cambiar de pantalla (y que «Mis propuestas» puede precargar). */
export const productoVacio = () => ({ id: null, nombre: '', desc: '', cats: [], ings: [{ mp: '', cant: '' }], tiempo: '', nuevas: [] });
export const formularios = { producto: productoVacio(), extra: extraVacio(), categoria: { nombre: '', motivo: '' } };

/** Costo para hacer el producto con el precio más alto posible de cada materia prima (sin IVA). */
export function costoPropuesta(ings, cat) {
  let costo = 0;
  let incompleto = false;
  for (const r of ings) {
    if (!r.mp || !(+r.cant > 0)) continue;
    if (String(r.mp).startsWith('new:') || !cat.conProveedor?.includes(+r.mp)) incompleto = true;
    else costo += +r.cant * (cat.costoTope?.[r.mp] || 0);
  }
  return { costo, incompleto };
}

const Seccion = ({ n, t, children }) => <Card className="tw:flex tw:flex-col tw:gap-3"><h3 className="tw:text-[15px] tw:m-0">{n}. {t}</h3>{children}</Card>;

/** Toggle de categorías (botones). */
export function Categorias({ todas, valor, onChange }) {
  return (
    <div className="tw:flex tw:flex-wrap tw:gap-2">
      {todas.map((c) => <Btn key={c} v={valor.includes(c) ? 'p' : ''} onClick={() => onChange(valor.includes(c) ? valor.filter((x) => x !== c) : [...valor, c])}>{c}</Btn>)}
    </div>
  );
}

function Producto({ cat }) {
  const { confirmar, accion } = useDialogos();
  const navigate = useNavigate();
  const [F, setFState] = useState(formularios.producto);
  const [err, setErr] = useState('');
  const setF = (v) => { formularios.producto = v; setFState(v); };
  const datos = () => ({ nombre: F.nombre, desc: F.desc, cats: F.cats, ings: F.ings, tiempo: F.tiempo, nuevas: F.nuevas });
  const c = costoPropuesta(F.ings, cat);

  const borrador = () => accion(async () => {
    const r = await api.post('/propuestas/producto', { id: F.id, estado: 'Borrador', datos: datos() });
    setF({ ...F, id: r.id });
    navigate('/cocinero/historial/propuestas');
  }, 'Borrador guardado');
  const enviar = async () => {
    const e = !F.nombre.trim() ? 'Escribe el nombre' : !F.cats.length ? 'Elige al menos una categoría' : !F.ings.some((r) => r.mp && +r.cant > 0) ? 'Agrega al menos un ingrediente' : !(+F.tiempo > 0) ? 'El tiempo debe ser mayor que 0' : '';
    setErr(e);
    if (e) return;
    if (!(await confirmar({ titulo: '¿Enviar al jefe de cocina?', texto: 'Lo revisará y podrá ajustar ingredientes antes de enviarlo al gerente. No podrás editarla mientras esté en revisión.', verbo: 'Enviar' }))) return;
    try {
      await api.post('/propuestas/producto', { id: F.id, estado: 'Propuesto', datos: datos() });
      setF(productoVacio());
      setErr('');
      accion(async () => navigate('/cocinero/historial/propuestas'), 'Propuesta enviada al jefe de cocina');
    } catch (x) { setErr(x.message); }
  };

  return (
    <Stack>
      <Err>{err}</Err>
      <Seccion n={1} t="Datos">
        <div><Lab>Nombre</Lab><Form.Control placeholder="Ej. Licuado" value={F.nombre} onChange={(e) => setF({ ...F, nombre: e.target.value })} /></div>
        <div><Lab>Descripción</Lab><Form.Control as="textarea" rows={2} value={F.desc} onChange={(e) => setF({ ...F, desc: e.target.value })} /></div>
        <div><Lab>Categorías</Lab><Categorias todas={cat.categorias.map((x) => x.nombre)} valor={F.cats} onChange={(cats) => setF({ ...F, cats })} /></div>
      </Seccion>
      <Seccion n={2} t="Ingredientes base">
        <Ingredientes ings={F.ings} onChange={(ings) => setF({ ...F, ings })} materias={cat.materias} unidades={cat.unidades}
          nuevas={F.nuevas} onNuevas={(nuevas) => setF({ ...F, nuevas })} />
      </Seccion>
      <Card className="tw:flex tw:flex-col tw:gap-1.5">
        <b>Costo para realizar este producto</b>
        <div className="tw:text-3xl tw:font-extrabold">{c.incompleto ? 'Incompleto' : $(c.costo)}</div>
        <Mut>{c.incompleto ? 'Hay materias primas nuevas o sin proveedor: el costo se completa cuando el gerente general les asigne uno.' : 'Usa el precio más alto posible de cada materia prima (todos los proveedores). Sin IVA.'}</Mut>
        <b className="tw:mt-2">Precio propuesto</b>
        <Mut>Lo define el gerente de sucursal al revisar tu propuesta.</Mut>
      </Card>
      <Seccion n={3} t="Tiempo">
        <div><Lab>Minutos estimados para 1 unidad</Lab><Form.Control inputMode="numeric" placeholder="Ej. 8" value={F.tiempo} onChange={(e) => setF({ ...F, tiempo: e.target.value })} /></div>
        <Mut>Los extras (curtido, salsa…) se proponen aparte, en la pestaña «Extra nuevo».</Mut>
      </Seccion>
      <div className="tw:flex tw:justify-end tw:gap-2"><Btn onClick={borrador}>Guardar borrador</Btn><Btn v="p" onClick={enviar}>Enviar propuesta</Btn></div>
    </Stack>
  );
}

function Extra({ cat }) {
  const { confirmar, accion } = useDialogos();
  const navigate = useNavigate();
  const [F, setFState] = useState(formularios.extra);
  const [err, setErr] = useState('');
  const setF = (v) => { formularios.extra = v; setFState(v); };
  const enviar = async () => {
    const e = errorExtra(F);
    setErr(e);
    if (e) return;
    if (!(await confirmar({ titulo: '¿Enviar al jefe de cocina?', texto: 'Lo revisa el jefe de cocina y sigue el mismo camino que un producto nuevo (gerente de sucursal, gerente general y director) hasta el catálogo.', verbo: 'Enviar' }))) return;
    try {
      await api.post('/propuestas/extra', { datos: extraParaApi(F) });
      setF(extraVacio());
      accion(async () => navigate('/cocinero/historial/propuestas'), 'Extra enviado al jefe de cocina');
    } catch (x) { setErr(x.message); }
  };
  return (
    <Stack>
      <Err>{err}</Err>
      <Card className="tw:flex tw:flex-col tw:gap-3">
        <h3 className="tw:text-[15px] tw:m-0">Extra nuevo</h3>
        <Mut>Un extra no sale en el menú: se ofrece solo al elegir alguno de los productos que marques abajo.</Mut>
        <FormExtra F={F} setF={setF} cat={cat} />
      </Card>
      <div className="tw:flex tw:justify-end"><Btn v="p" onClick={enviar}>Enviar propuesta</Btn></div>
    </Stack>
  );
}

function Categoria({ cat }) {
  const { accion } = useDialogos();
  const navigate = useNavigate();
  const [F, setFState] = useState(formularios.categoria);
  const [err, setErr] = useState('');
  const setF = (v) => { formularios.categoria = v; setFState(v); };
  const enviar = async () => {
    try {
      await api.post('/propuestas/categoria', F);
      setF({ nombre: '', motivo: '' });
      setErr('');
      accion(async () => navigate('/cocinero/historial/propuestas'), 'Solicitud enviada al jefe de cocina');
    } catch (x) { setErr(x.message); }
  };
  return (
    <Stack>
      <Err>{err}</Err>
      <Card className="tw:flex tw:flex-col tw:gap-3">
        <h3 className="tw:text-[15px] tw:m-0">Pedir una categoría nueva</h3>
        <Mut>Sigue el mismo camino que un producto nuevo: jefe de cocina, gerente de sucursal, gerente general y director.</Mut>
        <div><Lab>Nombre</Lab><Form.Control placeholder="Ej. Postres" value={F.nombre} onChange={(e) => setF({ ...F, nombre: e.target.value })} /></div>
        <div><Lab>Motivo</Lab><Form.Control as="textarea" rows={3} value={F.motivo} onChange={(e) => setF({ ...F, motivo: e.target.value })} /></div>
        <Mut>Existentes: {cat.categorias.map((c) => c.nombre).join(', ')}</Mut>
      </Card>
      <div className="tw:flex tw:justify-end"><Btn v="p" onClick={enviar}>Enviar solicitud</Btn></div>
    </Stack>
  );
}

export default function Proponer({ tab }) {
  const { usuario } = useSesion();
  const { datos: cat } = useDatos('/catalogo');
  if (!cat) return <Cargando />;
  if (usuario.rol !== 'cocinero') return null;
  return tab === 'extra' ? <Extra cat={cat} /> : tab === 'categoria' ? <Categoria cat={cat} /> : <Producto cat={cat} />;
}
