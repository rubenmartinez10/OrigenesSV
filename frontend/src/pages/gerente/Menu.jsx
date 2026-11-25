import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, D, fFecha } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Btn, Cargando, Chip, Foto, Pildoras, Stat, Stats, Stack, Tabla, Vacio } from '../../components/ui.jsx';

/* Gerente de sucursal · 5.6 Menú de la sucursal: mi menú, catálogo de la franquicia e historial */
const F = { q: '', cat: '', est: '' };

/** Fila de producto: foto, nombre y categorías, precio, estado y acción. */
export function FilaMenu({ x, chips, accion }) {
  return (
    <div className="tw:grid tw:items-center tw:gap-3.5 tw:px-[18px] tw:py-3 tw:border-t tw:border-bd tw:grid-cols-[48px_1fr_auto] tw:md:grid-cols-[48px_minmax(160px,1fr)_90px_minmax(120px,170px)_minmax(150px,auto)]">
      <Foto x={{ ...x, categorias: x.categorias }} className="tw:w-12 tw:h-12 tw:rounded-xl" icono="tw:text-2xl" />
      <div className="tw:flex tw:flex-col tw:gap-1 tw:min-w-0"><b className="tw:text-[15px]">{x.nombre}</b><div className="tw:flex tw:flex-wrap tw:gap-1">{x.categorias.map((c) => <Chip key={c} t={c} o="g" sinSimbolo />)}</div></div>
      <div className="tw:font-bold tw:text-[15px] tw:text-right">{$(x.precio)}</div>
      <div className="tw:flex tw:flex-wrap tw:gap-1.5 tw:col-span-2 tw:md:col-span-1">{chips}</div>
      <div className="tw:flex tw:flex-wrap tw:gap-2 tw:md:justify-end tw:col-span-3 tw:md:col-span-1">{accion}</div>
    </div>
  );
}
const Cabecera = () => (
  <div className="tw:hidden tw:md:grid tw:items-center tw:gap-3.5 tw:px-[18px] tw:py-2.5 tw:bg-[#F3F8FF] tw:text-xs tw:font-bold tw:uppercase tw:tracking-wide tw:text-tx2 tw:grid-cols-[48px_minmax(160px,1fr)_90px_minmax(120px,170px)_minmax(150px,auto)]">
    <span /><span>Producto</span><span className="tw:text-right">Precio</span><span>Estado</span><span className="tw:text-right">Acción</span>
  </div>
);
export const Bloque = ({ children, titulo, sub }) => (
  <div className="tw:bg-sf tw:border tw:border-bd tw:rounded-[20px] tw:shadow-osv tw:overflow-hidden">
    {titulo && <div className="tw:flex tw:items-baseline tw:gap-2.5 tw:px-[18px] tw:pt-3.5 tw:pb-2.5 tw:bg-[#F3F8FF]"><b className="tw:text-[15px]">{titulo}</b><small className="tw:text-tx2">{sub}</small></div>}
    {children}
  </div>
);

export default function Menu({ tab = 'mi' }) {
  const navigate = useNavigate();
  const { confirmar, clave, accion } = useDialogos();
  const { datos } = useDatos('/gerente/menu');
  const [f, setFState] = useState(F);
  const setF = (x) => { Object.assign(F, x); setFState({ ...F }); };
  if (!datos) return <Cargando />;
  const cats = [...new Set(datos.productos.flatMap((x) => x.categorias))];
  const pasa = (x) => (!f.q || x.nombre.toLowerCase().includes(f.q.toLowerCase())) && (!f.cat || x.categorias.includes(f.cat));
  const filtros = (
    <div className="tw:flex tw:flex-wrap tw:gap-2">
      <Form.Control type="search" placeholder="Buscar" value={f.q} onChange={(e) => setF({ q: e.target.value })} className="tw:max-w-[260px]" aria-label="Buscar" />
      <Form.Select value={f.cat} onChange={(e) => setF({ cat: e.target.value })} className="tw:max-w-[200px]" aria-label="Categoría">
        <option value="">Categoría</option>{cats.map((c) => <option key={c}>{c}</option>)}
      </Form.Select>
    </div>
  );
  const enMenu = datos.productos.filter((x) => x.en_menu);
  const n = enMenu.filter((x) => !x.es_reventa && x.estado !== 'Inhabilitado').length;

  if (tab === 'catalogo') {
    const L = datos.productos.filter((x) => x.estado === 'Activo' && pasa(x));
    const agregar = async (x) => {
      if (await confirmar({ titulo: 'Pedir permiso al gerente general', texto: `Agregar «${x.nombre}» al menú de tu sucursal necesita la aprobación del gerente general.`, verbo: 'Enviar solicitud' })) {
        accion(() => api.post(`/gerente/menu/${x.id}/agregar`), 'Solicitud enviada al gerente general');
      }
    };
    return (
      <Stack>
        <Stats>
          <Stat l="En el catálogo" v={L.length} ic="box" tono="in" />
          <Stat l="Ya en tu menú" v={L.filter((x) => x.en_menu).length} ic="check" tono="ok" />
          <Stat l="Solicitudes enviadas" v={L.filter((x) => !x.en_menu && x.solicitado).length} ic="clock" tono="wa" />
        </Stats>
        {filtros}
        {L.length ? cats.map((c) => {
          const g = L.filter((x) => x.categorias[0] === c);
          return g.length ? (
            <Bloque key={c} titulo={c} sub={`${g.length} ${g.length === 1 ? 'producto' : 'productos'}`}>
              {g.map((x) => (
                <FilaMenu key={x.id} x={x}
                  chips={<>{x.en_menu ? <Chip t="En tu menú" o="ok" /> : x.solicitado ? <Chip t="Esperando al gerente general" o="wa" /> : null}
                    {x.publicado && datos.ahora - x.publicado < 7 * D && <Chip t="Nuevo" o="in" />}</>}
                  accion={!x.en_menu && !x.solicitado && <Btn v="p" onClick={() => agregar(x)}>Agregar a mi menú</Btn>} />
              ))}
            </Bloque>
          ) : null;
        }) : <Vacio>No hay productos con ese filtro</Vacio>}
      </Stack>
    );
  }

  if (tab === 'historial') {
    const inh = new Set(enMenu.map((x) => x.id));
    const filas = [
      ...enMenu.map((x) => ({ x, estado: x.revisar ? 'Precio por revisar' : 'Activo', fecha: datos.historial.find((h) => h.producto_id === x.id && h.estado === 'Activo')?.fecha, razon: '' })),
      ...datos.historial.filter((h) => h.estado === 'Inhabilitado' && !inh.has(h.producto_id))
        .map((h) => ({ x: datos.productos.find((p) => p.id === h.producto_id), estado: 'Inhabilitado', fecha: h.fecha, razon: h.razon })),
    ].filter((r) => r.x && (!f.est || r.estado === f.est));
    return (
      <Stack>
        <Pildoras opciones={[['', 'Todos'], ['Activo', 'Activos'], ['Precio por revisar', 'Precio por revisar'], ['Inhabilitado', 'Inhabilitados']]} valor={f.est} onChange={(v) => setF({ est: v })} />
        {filas.length ? <Tabla cols={['Producto', 'Estado', 'Fecha', 'Información', 'Razón']} filas={filas.map((r) => ({
          dim: r.estado === 'Inhabilitado', celdas: [r.x.nombre, <Chip t={r.estado} o={r.estado === 'Inhabilitado' ? 'g' : r.estado === 'Activo' ? 'ok' : 'wa'} />,
            r.fecha ? fFecha(r.fecha) : '—', `${r.x.categorias.join(', ')} · ${$(r.x.precio)}`, r.razon || '—'],
        }))} /> : <Vacio ic="list">No hay productos con ese estado</Vacio>}
      </Stack>
    );
  }

  const L = enMenu.filter(pasa);
  const rvN = L.filter((x) => x.revisar).length;
  const inhabilitar = (x) => clave({
    resumen: `Inhabilitar «${x.nombre}» en tu sucursal. Deja de verse en el POS y pasa al historial. No se elimina.`, pideMotivo: true,
    accion: (k) => api.post(`/gerente/menu/${x.id}/inhabilitar`, k), ok: 'Producto inhabilitado. Quedó en el historial',
  });
  return (
    <Stack>
      {n < 12 && <Ban>Tu menú tiene {n} de 12 productos mínimos</Ban>}
      <Stats>
        <Stat l="En tu menú" v={n} ic="list" tono="in" />
        <Stat l="Mínimo requerido" v="12" ic="check" tono={n < 12 ? 'er' : 'ok'} />
        <Stat l="Precio por revisar" v={rvN} ic="tag" tono={rvN ? 'wa' : 'ok'} />
      </Stats>
      {filtros}
      {L.length ? (
        <Bloque>
          <Cabecera />
          {L.map((x) => (
            <FilaMenu key={x.id} x={x} chips={<Chip t={x.revisar ? 'Precio por revisar' : 'Activo'} o={x.revisar ? 'wa' : 'ok'} />}
              accion={<>{x.revisar && <Btn v="p" onClick={() => navigate('/gerente/pedir', { state: { prod: x.id } })}>Cambiar precio</Btn>}<Btn v="red" onClick={() => inhabilitar(x)}>Inhabilitar</Btn></>} />
          ))}
        </Bloque>
      ) : enMenu.length ? <Vacio>Nada coincide con la búsqueda</Vacio> : <Stack><Vacio>Tu menú está vacío</Vacio><div><Btn v="p" onClick={() => navigate('/gerente/menu/catalogo')}>Ir al catálogo</Btn></div></Stack>}
    </Stack>
  );
}
