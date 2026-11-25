import { useState } from 'react';
import { api } from '../../lib/api.js';
import { $, fmt } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Cargando, Chip, Etapas, Kv, Panel, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { Contrasenas } from '../../components/Franquicia.jsx';

/* Director · 8.2 Aprobaciones: productos nuevos (veredicto final), compra y venta de sucursales, contraseñas */
const ETP = ['Cocinero', 'Gerente de sucursal', 'Gerente general', 'Director', 'Catálogo'];

function Productos() {
  const { motivo, confirmar, accion } = useDialogos();
  const { datos } = useDatos('/director/productos');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const x = ver && datos.find((s) => s.id === ver);
  const aprobar = async () => {
    if (!(await confirmar({ titulo: `Aprobar «${x.nombre}»`, texto: x.tipo === 'Categoría nueva' ? 'La categoría queda disponible en todo el catálogo.' : 'Entra al catálogo de toda la franquicia y se ofrece en cada sucursal.', verbo: 'Aprobar' }))) return;
    if (await accion(() => api.post(`/director/productos/${x.id}/aprobar`), 'En el catálogo')) setVer(null);
  };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/director/productos/${x.id}/rechazar`, { motivo: m }), 'Propuesta rechazada')) setVer(null);
  };
  return (
    <Stack>
      {datos.length ? <Tabla cols={['Propuesta', 'Tipo', 'Propone', 'Sucursal', 'Precio']} filas={datos.map((s) => ({
        onClick: () => setVer(s.id), celdas: [s.nombre, <Chip t={s.tipo} o="in" sinSimbolo />, s.propone, s.sucNombre, s.precio ? $(s.precio) : '—'],
      }))} /> : <Vacio ic="check">No hay productos por aprobar</Vacio>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={x.nombre} estado={x.estado} pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" onClick={aprobar}>Aprobar</Btn>]}>
          <Etapas l={ETP} a={3} />
          <Kv pares={[
            ['Propone', `${x.propone} · ${x.sucNombre}`],
            ...(x.tipo === 'Categoría nueva' ? [['Motivo', x.motivo || '—']] : [['Precio de venta (IVA incl.)', $(x.precio)]]),
            ...(x.tipo === 'Producto nuevo' ? [['Costo por porción (tope)', x.costo.incompleto ? 'Incompleto' : $(x.costo.costo)], ['Categorías', (x.datos.cats || []).join(', ') || '—'], ['Tiempo', `${x.datos.tiempo || '—'} min`]] : []),
            ...(x.tipo === 'Extra nuevo' ? [['Aparece en', x.prodsNombres.join(', ') || '—']] : []),
          ]} />
          {x.ings.length > 0 && <><h4 className="tw:text-sm tw:m-0">Receta</h4><Tabla cols={['Ingrediente', 'Cantidad']} filas={x.ings.map((i) => [i.nombre, `${i.cant} ${i.unidad}`])} /></>}
        </Panel>
      )}
    </Stack>
  );
}

function Sucursal({ tipo }) {
  const { motivo, confirmar, accion } = useDialogos();
  const { datos } = useDatos('/director/propuestas-sucursal');
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const compra = tipo === 'compra';
  const L = datos[tipo];
  const p = ver && L.find((s) => s.id === ver);
  const aprobar = async () => {
    if (!(await confirmar({ titulo: compra ? 'Aprobar la compra' : 'Aprobar la venta', texto: compra ? 'El gerente general debe abrir la sucursal y se generarán sus vacantes.' : 'La sucursal pasa a «Cierre ordenado»: no recibe pedidos nuevos.', verbo: 'Aprobar' }))) return;
    if (await accion(() => api.post(`/director/propuestas-sucursal/${p.id}/aprobar`), compra ? 'Compra aprobada' : 'Venta aprobada')) setVer(null);
  };
  const rechazar = async () => {
    const m = await motivo({ titulo: 'Motivo del rechazo' });
    if (m && await accion(() => api.post(`/director/propuestas-sucursal/${p.id}/rechazar`, { motivo: m }), 'Propuesta rechazada')) setVer(null);
  };
  return (
    <Stack>
      {L.length ? <Tabla cols={compra ? ['Zona', 'Tamaño', 'Costo', 'Propone', 'Fecha'] : ['Sucursal', 'Zona', 'Propone', 'Fecha']} filas={L.map((s) => ({
        onClick: () => setVer(s.id), celdas: compra ? [s.zona, s.tamanoNombre, $(s.costo), s.pideNombre, fmt(s.fecha)] : [s.sucNombre, s.zona, s.pideNombre, fmt(s.fecha)],
      }))} /> : <Vacio ic="check">No hay propuestas de {compra ? 'compra' : 'venta'}</Vacio>}
      {p && (
        <Panel show onHide={() => setVer(null)} titulo={compra ? 'Compra de sucursal' : `Venta · ${p.sucNombre}`} estado="Solicitada"
          pie={[<Btn key="r" onClick={rechazar}>Rechazar</Btn>, <Btn key="a" v="p" onClick={aprobar}>Aprobar</Btn>]}>
          <Kv pares={[['Propone', p.pideNombre], ['Zona', p.zona], ['Tamaño', p.tamanoNombre], [compra ? 'Costo estimado' : 'Valor de referencia', $(p.costo)], ['Motivo', p.motivo]]} />
        </Panel>
      )}
    </Stack>
  );
}

export default function AprobacionesDirector({ tab = 'productos' }) {
  if (tab === 'compra') return <Sucursal tipo="compra" />;
  if (tab === 'venta') return <Sucursal tipo="venta" />;
  if (tab === 'contrasenas') return <Contrasenas />;
  return <Productos />;
}
