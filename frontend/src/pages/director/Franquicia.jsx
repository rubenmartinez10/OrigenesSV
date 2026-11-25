import { useRef, useState } from 'react';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, D } from '../../lib/formato.js';
import { leerFoto } from '../../lib/fotos.js';
import { useAhora, useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Icono } from '../../components/Icono.jsx';
import { Avatar, Btn, Card, Cargando, Chip, Foto, Grid, Kv, Mut, Panel, Pildoras, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { AccionesPersonal, FichaPersona } from '../../components/Personal.jsx';
import { Credenciales, Proveedores } from '../../components/Franquicia.jsx';
import { Proponer } from '../gg/Sucursales.jsx';
import { DetalleSucursal } from './Ingresos.jsx';

/* Director · 8.3 Sucursales, personal, 8.5 Catálogo y proveedores */
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const ESTS = { Operando: 'ok', 'Cierre ordenado': 'er', Cerrada: 'er' };

function Sucursales() {
  const { datos } = useDatos('/director/sucursales');
  const [ver, setVer] = useState(null);
  const [crear, setCrear] = useState(false);
  if (!datos) return <Cargando />;
  const s = ver && datos.sucursales.find((x) => x.id === ver);
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2"><Mut>Últimos 30 días</Mut><span className="tw:flex-1" /><Btn v="p" onClick={() => setCrear(true)}><Icono n="plus" />Crear sucursal</Btn></div>
      <Grid min={240}>{datos.sucursales.map((x) => (
        <Card key={x.id} className="tw:flex tw:flex-col tw:gap-1.5 tw:cursor-pointer tw:hover:border-[#B9CEF0]" onClick={() => setVer(x.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setVer(x.id)}>
          <b className="tw:text-[16px]">{x.nombre}</b>
          <Mut>{x.zona} · {x.tamanoNombre}</Mut>
          <div><Chip t={x.estado === 'Cierre ordenado' ? 'Cierre ordenado en curso' : x.estado} o={ESTS[x.estado] || 'wa'} /></div>
          <div>Ingresos <b>{$(x.ingresos)}</b></div>
          <Mut>Personal activo: {x.personal}</Mut>
        </Card>
      ))}</Grid>
      {s && <DetalleSucursal s={s} onHide={() => setVer(null)} />}
      {crear && <Proponer datos={datos} directo url="/director/sucursales" costoUrl="/director/sucursales/costo" onHide={() => setCrear(false)} />}
    </Stack>
  );
}

const SP = { q: '', suc: '', rol: '' };
export function Personal() {
  const ahora = useAhora(60000);
  const { confirmar, accion, toast } = useDialogos();
  const { datos } = useDatos('/director/personal');
  const [f, setFS] = useState(SP);
  const setF = (x) => { Object.assign(SP, x); setFS({ ...SP }); };
  const [ver, setVer] = useState(null);
  const [cred, setCred] = useState(null);
  if (!datos) return <Cargando />;
  const roles = [...new Map(datos.personas.map((p) => [p.rol, p.rolNombre])).entries()];
  const L = datos.personas.filter((p) => p.puede && (!f.suc || p.sucursal === +f.suc) && (!f.rol || p.rol === f.rol) && (!f.q || norm(p.nombre).includes(norm(f.q))));
  const p = ver && datos.personas.find((x) => x.id === ver);
  const promover = async (u) => {
    if (datos.gg < 2) return toast('Para promover a un gerente general debe existir otro gerente general: ese puesto nunca puede quedar vacío');
    if (!(await confirmar({ titulo: 'Promover a director', texto: `${u.nombre} será director de toda la franquicia. Seguirá habiendo ${datos.gg - 1} gerente(s) general(es).`, verbo: 'Promover' }))) return;
    const r = await accion(() => api.post(`/director/personal/${u.id}/promover`), 'Nuevo director');
    if (r) { setVer(null); setCred([['Usuario', r.usuario], ['Contraseña temporal', r.pass], ['PIN temporal', r.pin]]); }
  };
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Form.Control type="search" placeholder="Buscar persona" value={f.q} onChange={(e) => setF({ q: e.target.value })} className="tw:max-w-[240px]" aria-label="Buscar persona" />
        <Form.Select value={f.suc} onChange={(e) => setF({ suc: e.target.value })} className="tw:max-w-[200px]" aria-label="Sucursal">
          <option value="">Todas las sucursales</option>{datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Form.Select>
        <Form.Select value={f.rol} onChange={(e) => setF({ rol: e.target.value })} className="tw:max-w-[220px]" aria-label="Rol">
          <option value="">Todos los roles</option>{roles.filter(([r]) => r !== 'director').map(([r, n]) => <option key={r} value={r}>{n}</option>)}
        </Form.Select>
      </div>
      {L.length ? <Tabla cols={['Nombre', 'Rol', 'Sucursal', 'Salario', 'Antigüedad', '']} filas={L.map((u) => ({
        onClick: () => setVer(u.id),
        celdas: [<span className="tw:flex tw:items-center tw:gap-2"><Avatar u={u} size={30} />{u.nombre}</span>, u.rolNombre, u.sucNombre, $(u.salario), `${Math.floor((ahora - u.ingreso) / (365.25 * D))} año(s)`,
          u.rol === 'gg' ? <Btn v="p" onClick={(e) => { e.stopPropagation(); promover(u); }}>Promover a director</Btn> : ''],
      }))} /> : <Vacio ic="users">No hay personas con ese filtro</Vacio>}
      {p && (
        <FichaPersona p={p} onHide={() => setVer(null)}
          nota="Puedes cambiar su rol (ascender o bajar) o despedirlo. Se avisa a Recursos Humanos y a gerencia general."
          pie={<>
            <AccionesPersonal p={p} base="/director/personal" salarios={datos.salarios} onListo={() => setVer(null)} />
            {p.rol === 'gg' && <Btn v="p" onClick={() => promover(p)}>Promover a director</Btn>}
          </>} />
      )}
      <Credenciales titulo="Credenciales del nuevo director" filas={cred} onHide={() => setCred(null)} />
    </Stack>
  );
}

const SC = { q: '', cat: '', v: 'pr' };
function Catalogo() {
  const { motivo, accion } = useDialogos();
  const { datos } = useDatos('/director/catalogo');
  const [f, setFS] = useState(SC);
  const setF = (x) => { Object.assign(SC, x); setFS({ ...SC }); };
  const [ver, setVer] = useState(null);
  const archivo = useRef(null);
  if (!datos) return <Cargando />;
  const L = datos.productos.filter((x) => (f.v === 'ex') === x.extra && (!f.cat || x.cats.includes(f.cat)) && (!f.q || norm(x.nombre).includes(norm(f.q))));
  const x = ver && datos.productos.find((p) => p.id === ver);
  const foto = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) accion(async () => api.put(`/director/catalogo/${x.id}/foto`, { dataUrl: await leerFoto(file) }), 'Foto actualizada');
  };
  const eliminar = async () => {
    const m = await motivo({ titulo: `Motivo para eliminar «${x.nombre}» del catálogo`, nota: 'Sale del menú de todas las sucursales. El historial de ventas se conserva.' });
    if (m && await accion(() => api.post(`/director/catalogo/${x.id}/eliminar`, { motivo: m }), 'Eliminado del catálogo')) setVer(null);
  };
  return (
    <Stack>
      <Mut>Toca un producto para ver su foto, cambiarla o eliminarlo del catálogo</Mut>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Pildoras opciones={[['pr', 'Productos'], ['ex', 'Extras']]} valor={f.v} onChange={(v) => setF({ v })} />
        <Form.Select value={f.cat} onChange={(e) => setF({ cat: e.target.value })} className="tw:max-w-[200px]" aria-label="Categoría">
          <option value="">Todas las categorías</option>{datos.categorias.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
        </Form.Select>
        <Form.Control type="search" placeholder="Buscar" value={f.q} onChange={(e) => setF({ q: e.target.value })} className="tw:max-w-[220px]" aria-label="Buscar" />
      </div>
      {L.length ? <Tabla cols={['', 'Nombre', 'Categorías', 'Precio', 'Estado']} filas={L.map((p) => ({
        onClick: () => setVer(p.id),
        celdas: [<Foto x={{ ...p, categorias: p.cats }} className="tw:w-11 tw:h-11 tw:rounded-xl" icono="tw:text-2xl" />, p.nombre, p.cats.join(', ') || '—', $(p.precio), <Chip t={p.estado} />],
      }))} /> : <Vacio ic="list">Sin resultados</Vacio>}
      {x && (
        <Panel show onHide={() => setVer(null)} titulo={x.nombre} estado={x.estado}
          pie={[<Btn key="f" onClick={() => archivo.current.click()}>Cambiar foto</Btn>,
            x.foto && <Btn key="q" onClick={() => accion(() => api.put(`/director/catalogo/${x.id}/foto`, {}), 'Foto quitada')}>Quitar foto</Btn>,
            <Btn key="e" v="red" onClick={eliminar}>Eliminar del catálogo</Btn>].filter(Boolean)}>
          <Foto x={{ ...x, categorias: x.cats }} className="tw:w-full tw:h-48 tw:rounded-2xl" />
          <input ref={archivo} type="file" accept="image/*" hidden onChange={foto} />
          <Kv pares={[['Tipo', x.extra ? 'Extra' : 'Producto'], ['Descripción', x.desc || '—'], ['Precio (IVA incl.)', $(x.precio)], ['Categorías', x.cats.join(', ') || '—'],
            ['Tiempo', `${x.tiempo || '—'} min`], ['Versión', `v${x.version}`], ['En menú de', `${x.enMenus} sucursal${x.enMenus === 1 ? '' : 'es'}`]]} />
          <h4 className="tw:text-sm tw:m-0">Receta</h4>
          <Tabla cols={['Ingrediente', 'Cantidad']} filas={x.receta.map((r) => [r.nombre, `${r.cant} ${r.unidad}`])} />
        </Panel>
      )}
    </Stack>
  );
}

export default function Franquicia({ tab = 'sucursales' }) {
  if (tab === 'personal') return <Personal />;
  if (tab === 'catalogo') return <Catalogo />;
  if (tab === 'proveedores') return <Proveedores />;
  return <Sucursales />;
}
