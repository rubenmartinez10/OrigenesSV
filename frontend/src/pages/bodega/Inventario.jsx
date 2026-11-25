import { useState } from 'react';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fFecha, fmt } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Btn, Campo, Cargando, Chip, Err, Fila, Kv, Mut, Nivel, Panel, Pildoras, Stack, Tabla, Toggle, Vacio } from '../../components/ui.jsx';
import { Icono } from '../../components/Icono.jsx';

/* Encargado de bodega · 4.1 Inventario */
const F0 = { vista: 'mp', q: '', cat: '', bajo: false, inh: false };
const filtros = { ...F0 };

function Categorias({ todas, valor, onChange }) {
  return (
    <div className="tw:flex tw:flex-wrap tw:gap-2">
      {todas.map((c) => <Toggle key={c} on={valor.includes(c)} onClick={() => onChange(valor.includes(c) ? valor.filter((x) => x !== c) : [...valor, c])}>{c}</Toggle>)}
    </div>
  );
}

function Ficha({ m, cats, onHide }) {
  const { motivo, accion } = useDialogos();
  const { datos } = useDatos(`/bodega/materias/${m.id}`);
  const [ed, setEd] = useState(null);
  const [er, setEr] = useState('');
  const solicitar = async () => {
    const usan = datos?.usan || [];
    const mo = await motivo({ titulo: `Motivo para inhabilitar ${m.nombre}`, nota: usan.length ? `La usan ${usan.length} productos activos: ${usan.join(', ')}.` : '' });
    if (mo && await accion(() => api.post(`/bodega/materias/${m.id}/inhabilitar`, { motivo: mo }), 'Solicitud enviada al gerente')) onHide();
  };
  const guardar = async () => {
    try {
      await api.put(`/bodega/materias/${m.id}`, ed);
      accion(async () => {}, 'Información actualizada');
      setEd(null);
    } catch (e) { setEr(e.message); }
  };
  const pie = ed
    ? [<Btn key="c" v="t" onClick={() => setEd(null)}>Cancelar</Btn>, <Btn key="g" v="p" onClick={guardar}>Guardar</Btn>]
    : [datos?.solicitud ? <Chip key="s" t="Inhabilitación solicitada" o="wa" /> : m.inhabilitada ? null : <Btn key="i" v="red" onClick={solicitar}>Solicitar inhabilitación</Btn>,
      <Btn key="e" onClick={() => { setEr(''); setEd({ nombre: m.nombre, categorias: m.categorias, desc: m.desc || '' }); }}>Editar información</Btn>];
  return (
    <Panel show onHide={onHide} titulo={m.nombre} estado={m.inhabilitada ? 'Inhabilitado' : null} pie={pie}>
      <h4 className="tw:text-sm tw:m-0">Lotes</h4>
      {!datos ? <Cargando /> : datos.lotes.length ? (
        <Tabla cols={['SKU', 'Compra', 'Vence', 'Proveedor', 'Precio', 'Resta', 'Estado']}
          filas={datos.lotes.map((l) => [l.sku, fFecha(l.compra), fFecha(l.vence), l.prov || '—', $(l.precio), `${l.cant} ${m.unidad}`, <Chip t={l.estado} />])} />
      ) : <Vacio>Sin lotes todavía. La cantidad entra con las compras recibidas</Vacio>}
      <h4 className="tw:text-sm tw:m-0">Información</h4>
      {ed ? (
        <div className="tw:flex tw:flex-col tw:gap-3">
          <Err>{er}</Err>
          <Campo l="Nombre"><Form.Control value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} /></Campo>
          <Campo l="Categorías"><Categorias todas={cats} valor={ed.categorias} onChange={(categorias) => setEd({ ...ed, categorias })} /></Campo>
          <Campo l="Descripción"><Form.Control as="textarea" rows={3} value={ed.desc} onChange={(e) => setEd({ ...ed, desc: e.target.value })} /></Campo>
          <Kv pares={[['Cantidad', `🔒 ${m.stock} ${m.unidad}`], ['Precio de compra', '🔒 según el lote'], ['Proveedor', '🔒 según el lote']]} />
          <Mut>Solo cambia con compras recibidas, pedidos y mermas</Mut>
        </div>
      ) : <Kv pares={[['Nombre', m.nombre], ['Unidad', m.unidad], ['Categorías', m.categorias.join(', ') || '—'], ['Descripción', m.desc || '—']]} />}
    </Panel>
  );
}

function NuevaMateria({ datos, onHide }) {
  const { accion } = useDialogos();
  const [f, setF] = useState({ nombre: '', unidad: datos.unidades[0], categorias: [] });
  const [er, setEr] = useState('');
  const guardar = async () => {
    try {
      await api.post('/bodega/materias', f);
      accion(async () => {}, 'Materia prima creada. Ya puedes usarla en recetas y compras');
      onHide();
    } catch (e) { setEr(e.message); }
  };
  return (
    <Panel show onHide={onHide} titulo="Nueva materia prima" pie={[<Btn key="c" v="t" onClick={onHide}>Cancelar</Btn>, <Btn key="g" v="p" onClick={guardar}>Guardar</Btn>]}>
      <Err>{er}</Err>
      <Campo l="Nombre"><Form.Control placeholder="Ej. Frijol rojo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
      <Campo l="Unidad"><Form.Select value={f.unidad} onChange={(e) => setF({ ...f, unidad: e.target.value })}>{datos.unidades.map((u) => <option key={u}>{u}</option>)}</Form.Select></Campo>
      <Campo l="Categorías (al menos una)"><Categorias todas={datos.categorias} valor={f.categorias} onChange={(categorias) => setF({ ...f, categorias })} /></Campo>
      <Mut>La cantidad entra con las compras recibidas</Mut>
    </Panel>
  );
}

function SolicitarCatalogo({ tipo, onHide }) {
  const { accion } = useDialogos();
  const esU = tipo === 'Unidad nueva';
  const [f, setF] = useState({ nombre: '', motivo: '' });
  const [er, setEr] = useState('');
  const enviar = async () => {
    try {
      await api.post('/bodega/catalogo', { tipo, ...f });
      accion(async () => {}, 'Enviada al gerente; luego la aprueba Recursos Humanos');
      onHide();
    } catch (e) { setEr(e.message); }
  };
  return (
    <Panel show onHide={onHide} titulo={esU ? 'Solicitar una unidad' : 'Solicitar una categoría'}
      pie={[<Btn key="c" v="t" onClick={onHide}>Cancelar</Btn>, <Btn key="e" v="p" disabled={!f.nombre.trim() || f.motivo.trim().length < 10} onClick={enviar}>Enviar</Btn>]}>
      <Ban>La aprueba primero el gerente de sucursal y después Recursos Humanos.</Ban>
      <Campo l="Nombre"><Form.Control placeholder={esU ? 'Ej. docena' : 'Ej. Especias'} value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
      <Campo l="Motivo"><Form.Control as="textarea" rows={3} placeholder="Motivo (mín. 10 caracteres)" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} /></Campo>
      <Err>{er}</Err>
    </Panel>
  );
}

function MisSolicitudes() {
  const { datos } = useDatos('/bodega/solicitudes');
  if (!datos) return <Cargando />;
  if (!datos.length) return <Vacio ic="check">No has enviado solicitudes de inhabilitación ni de catálogo</Vacio>;
  return (
    <Stack>
      {datos.map((x) => {
        const est = x.estado === 'Aplicada' ? 'Aprobada' : x.estado;
        const t = /Solicitada|por gerente/.test(x.estado) ? 'wa' : x.estado === 'Rechazada' ? 'er' : 'ok';
        return <Fila key={x.id} ico={x.tipo === 'Inhabilitar materia prima' ? 'x' : 'tag'} tono={t} t={x.tipo === 'Inhabilitar materia prima' ? x.nombre : `${x.tipo}: ${x.nombre}`}
          chips={<Chip t={est} o={t === 'wa' ? 'g' : t} />} s={`Motivo: ${x.motivo}`} m={x.rechazo ? `Rechazada por ${x.rechazo.por}: ${x.rechazo.motivo}` : fmt(x.fecha)} />;
      })}
    </Stack>
  );
}

export default function Inventario() {
  const { datos } = useDatos('/bodega/inventario');
  const [f, setFState] = useState(filtros);
  const [ver, setVer] = useState(null);
  const [nueva, setNueva] = useState(false);
  const [cat, setCat] = useState(null);
  const setF = (x) => { Object.assign(filtros, x); setFState({ ...filtros }); };
  if (!datos) return <Cargando />;

  const L = datos.materias.filter((x) => (f.inh || !x.inhabilitada) && (!f.q || x.nombre.toLowerCase().includes(f.q.toLowerCase()))
    && (!f.cat || x.categorias.includes(f.cat)) && (!f.bajo || (x.minimo > 0 && x.stock < x.minimo)));
  const actual = ver && datos.materias.find((m) => m.id === ver);

  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Pildoras opciones={[['mp', 'Materias primas'], ['sol', 'Mis solicitudes']]} valor={f.vista} onChange={(v) => setF({ vista: v })} />
        <span className="tw:flex-1" />
        <Btn v="p" onClick={() => setNueva(true)}><Icono n="plus" />Nueva materia prima</Btn>
      </div>
      {f.vista === 'sol' ? <MisSolicitudes /> : (
        <>
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Form.Control type="search" placeholder="Buscar materia prima" value={f.q} onChange={(e) => setF({ q: e.target.value })} className="tw:max-w-[260px]" aria-label="Buscar materia prima" />
            <Form.Select value={f.cat} onChange={(e) => setF({ cat: e.target.value })} className="tw:max-w-[200px]" aria-label="Categoría">
              <option value="">Categoría</option>{datos.categorias.map((c) => <option key={c}>{c}</option>)}
            </Form.Select>
            <Toggle on={f.bajo} onClick={() => setF({ bajo: !f.bajo })}>Solo stock bajo</Toggle>
            <Toggle on={f.inh} onClick={() => setF({ inh: !f.inh })}>Mostrar inhabilitadas</Toggle>
            <Btn onClick={() => setCat('Unidad nueva')}>+ Unidad</Btn>
            <Btn onClick={() => setCat('Categoría de materia prima')}>+ Categoría</Btn>
          </div>
          <div className="tw:flex tw:flex-wrap tw:gap-4 tw:text-xs tw:text-tx2">
            <span className="tw:inline-flex tw:items-center tw:gap-1.5"><i className="tw:w-2.5 tw:h-2.5 tw:rounded-sm tw:bg-er" />Con lotes por vencer</span>
            <span className="tw:inline-flex tw:items-center tw:gap-1.5"><i className="tw:w-2.5 tw:h-2.5 tw:rounded-sm tw:bg-in" />Stock completo</span>
          </div>
          {L.length ? (
            <Tabla cols={['Materia prima', 'Categorías', 'Stock', 'Nivel', 'Próximo vencimiento']} filas={L.map((x) => ({
              onClick: () => setVer(x.id), dim: x.inhabilitada, tono: x.inhabilitada ? '' : x.porVencer ? 'rj' : x.minimo > 0 && x.stock >= x.minimo ? 'az' : '',
              celdas: [
                <span className="tw:inline-flex tw:items-center tw:gap-2.5"><span className="tw:w-[34px] tw:h-[34px] tw:rounded-[14px] tw:bg-brs tw:text-br tw:grid tw:place-items-center"><Icono n="box" size={18} /></span><b>{x.nombre}</b>{x.inhabilitada && <Chip t="Inhabilitada" o="g" />}</span>,
                <span className="tw:flex tw:flex-wrap tw:gap-1">{x.categorias.map((c) => <Chip key={c} t={c} o="g" sinSimbolo />)}</span>,
                `${x.stock.toFixed(x.unidad === 'unidad' ? 0 : 1)} ${x.unidad}`,
                x.minimo ? <Nivel v={x.stock} min={x.minimo} /> : '—',
                x.proximo ? fFecha(x.proximo) : '—',
              ],
            }))} />
          ) : <Vacio>{f.q || f.cat || f.bajo ? 'Nada coincide con los filtros' : 'Aún no hay materias primas'}</Vacio>}
        </>
      )}
      {actual && <Ficha m={actual} cats={datos.categorias} onHide={() => setVer(null)} />}
      {nueva && <NuevaMateria datos={datos} onHide={() => setNueva(false)} />}
      {cat && <SolicitarCatalogo tipo={cat} onHide={() => setCat(null)} />}
    </Stack>
  );
}
