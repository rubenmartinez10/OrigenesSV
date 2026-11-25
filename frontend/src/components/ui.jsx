import { useState } from 'react';
import { Button, Offcanvas, Table } from 'react-bootstrap';
import { Icono } from './Icono.jsx';

/* ---------- botón (React-Bootstrap) · v: '' contorno · 'p' principal · 't' transparente · 'red' peligro ---------- */
export function Btn({ v = '', big, className = '', children, ...props }) {
  return (
    <Button variant={v ? `osv-${v}` : 'osv'} className={`${big ? 'btn-big' : ''} ${className}`} {...props}>
      {children}
    </Button>
  );
}

/* ---------- chip de estado ---------- */
const TONO = {
  Creado: 'g', Aceptado: 'in', Asignado: 'in', Preparando: 'wa', Listo: 'ok', Entregado: 'ok', Cobrado: 'br', Cancelado: 'er', Rechazado: 'er',
  Preparada: 'g', Recibida: 'ok', Devuelta: 'er', Rechazada: 'er', Solicitada: 'g', Aprobada: 'ok', Aplicada: 'br', Caducada: 'g', Disponible: 'ok',
  'Por vencer': 'wa', Agotado: 'g', Vencido: 'er', Propuesto: 'g', 'En catálogo': 'ok', Inhabilitado: 'g', 'Precio por revisar': 'wa', Abierta: 'ok',
  Observada: 'er', 'En camino': 'wa', Cubierta: 'ok', Activo: 'ok', Aprobado: 'ok', Creada: 'ok', Autorizada: 'ok', Aceptada: 'ok', Borrador: 'g',
};
const SIM = { ok: '✓', er: '✕', wa: '!', in: '•', g: '○', br: '✓' };
const COLOR = { ok: 'tw:text-ok', er: 'tw:text-er', wa: 'tw:text-wa', in: 'tw:text-in', g: 'tw:text-tx2', br: 'tw:text-br' };
export const tonoDe = (t) => TONO[t] || (/^Aprob/.test(t) ? 'ok' : /Rechaz/.test(t) ? 'er' : 'g');

export function Chip({ t, o, sinSimbolo, className = '' }) {
  const tono = o || tonoDe(t);
  return (
    <span className={`tw:inline-flex tw:items-center tw:gap-[5px] tw:leading-none tw:whitespace-nowrap tw:rounded-full tw:border tw:border-current tw:px-2.5 tw:py-[3px] tw:text-[11.5px] tw:font-bold ${COLOR[tono]} ${className}`}>
      {!sinSimbolo && <span>{SIM[tono]}</span>}{t}
    </span>
  );
}

/* ---------- contenedores ---------- */
export const Card = ({ className = '', children, ...p }) => (
  <div className={`tw:bg-sf tw:border tw:border-bd tw:rounded-[20px] tw:shadow-osv tw:px-5 tw:py-[18px] ${className}`} {...p}>{children}</div>
);
export const Sub = ({ className = '', children }) => (
  <div className={`tw:bg-suave tw:border tw:border-bd tw:rounded-2xl tw:px-4 tw:py-3.5 tw:flex tw:flex-col tw:gap-2 ${className}`}>{children}</div>
);
export const Stack = ({ className = '', children }) => <div className={`tw:flex tw:flex-col tw:gap-3.5 ${className}`}>{children}</div>;
export const Fila2 = ({ className = '', children }) => <div className={`tw:flex tw:flex-wrap tw:items-center tw:gap-2 ${className}`}>{children}</div>;
export const Grid = ({ min = 260, className = '', children }) => (
  <div className={`tw:grid tw:gap-3.5 ${className}`} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))` }}>{children}</div>
);
export const Lab = ({ children }) => <div className="tw:text-xs tw:font-bold tw:text-tx2 tw:mb-1.5">{children}</div>;
export const Mut = ({ children, className = '' }) => <small className={`tw:text-tx2 ${className}`}>{children}</small>;
export const Err = ({ children }) => (children ? <div className="tw:text-er tw:text-sm tw:mt-1" role="alert">{children}</div> : null);
export const Ban = ({ children, className = '' }) => (
  <div className={`tw:rounded-2xl tw:bg-[#FFF8E6] tw:border tw:border-[#F0D08A] tw:text-[#7A5200] tw:px-4 tw:py-3 ${className}`}>{children}</div>
);

/* ---------- ícono circular con color según el estado ---------- */
const FONDO = { ok: 'tw:bg-okbg tw:text-ok', wa: 'tw:bg-wabg tw:text-wa', er: 'tw:bg-erbg tw:text-er', g: 'tw:bg-gbg tw:text-tx2', in: 'tw:bg-brs tw:text-br', br: 'tw:bg-brs tw:text-br' };
export const CirculoIcono = ({ ic, tono = 'in', className = 'tw:w-11 tw:h-11 tw:rounded-[14px]' }) => (
  <span className={`tw:grid tw:place-items-center tw:shrink-0 ${FONDO[tono] || FONDO.in} ${className}`}><Icono n={ic} size={20} /></span>
);

/* ---------- fila limpia para listas e historiales ---------- */
export function Fila({ ico, tono = 'in', t, chips, s, m, der, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={`tw:flex tw:items-center tw:gap-3.5 tw:w-full tw:px-4 tw:py-3.5 tw:bg-sf tw:border tw:border-bd tw:rounded-[18px] tw:text-left tw:text-tx tw:shadow-osv ${onClick ? 'tw:cursor-pointer tw:hover:border-[#B9CEF0] tw:hover:bg-[#FAFCFF]' : ''}`}>
      <CirculoIcono ic={ico || 'list'} tono={tono} />
      <div className="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-1">
        <div className="tw:flex tw:items-center tw:flex-wrap tw:gap-x-2 tw:gap-y-1.5"><b className="tw:text-[15px]">{t}</b>{chips}</div>
        {s && <div className="tw:text-[13px] tw:text-tx2">{s}</div>}
        {m && <div className="tw:text-xs tw:text-tx2">{m}</div>}
      </div>
      {der != null && der !== '' && <div className="tw:shrink-0 tw:font-bold tw:text-[15px] tw:text-right">{der}</div>}
      {onClick && <span className="tw:text-[#8DA6CF]"><Icono n="chev" size={18} /></span>}
    </Tag>
  );
}

/* ---------- cajita de dato y KPI ---------- */
export const Stat = ({ l, v, ic = 'dollar', tono = 'in' }) => (
  <div className="tw:flex tw:items-center tw:gap-3 tw:px-4 tw:py-3.5 tw:bg-sf tw:border tw:border-bd tw:rounded-[18px]">
    <CirculoIcono ic={ic} tono={tono} className="tw:w-[42px] tw:h-[42px] tw:rounded-[13px]" />
    <div className="tw:flex tw:flex-col tw:gap-0.5"><small className="tw:text-tx2 tw:text-xs">{l}</small><b className="tw:text-lg">{v}</b></div>
  </div>
);
export const Stats = ({ children }) => <div className="tw:grid tw:gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>{children}</div>;
export const Kpi = ({ t, v, s, ic = 'check', tono }) => (
  <Card className="tw:flex tw:items-center tw:justify-between tw:gap-3.5">
    <div>
      <small className="tw:uppercase tw:font-bold tw:tracking-wide tw:text-[11.5px] tw:text-tx2">{t}</small>
      <div className={`tw:text-3xl tw:font-extrabold tw:tracking-tight tw:my-0.5 ${tono ? COLOR[tono] : ''}`}>{v}</div>
      {s && <small className="tw:text-tx2">{s}</small>}
    </div>
    <CirculoIcono ic={ic} tono={tono || 'in'} className="tw:w-14 tw:h-14 tw:rounded-full" />
  </Card>
);

/* ---------- vacío ---------- */
export const Vacio = ({ children, ic = 'box' }) => (
  <div className="tw:grid tw:place-items-center tw:gap-2.5 tw:text-center tw:text-tx2 tw:px-4 tw:py-10 tw:border-[1.5px] tw:border-dashed tw:border-bd tw:rounded-[20px] tw:bg-[#F2F7FE]">
    <span className="tw:w-[54px] tw:h-[54px] tw:rounded-full tw:bg-brs tw:text-br tw:grid tw:place-items-center"><Icono n={ic} size={24} /></span>
    {children}
  </div>
);

/* ---------- pestañas (píldoras) y segmentos ---------- */
export function Pildoras({ opciones, valor, onChange }) {
  return (
    <div className="osv-tabs tw:inline-flex tw:max-w-full tw:overflow-x-auto tw:gap-1 tw:p-1 tw:bg-[#DFEAFA] tw:rounded-full" role="tablist">
      {opciones.map((o) => {
        const [id, label] = Array.isArray(o) ? o : [o, o];
        const on = id === valor;
        return (
          <button key={id} type="button" role="tab" aria-selected={on} onClick={() => onChange(id)}
            className={`tw:rounded-full tw:px-4 tw:py-[7px] tw:text-[13.5px] tw:font-semibold tw:whitespace-nowrap tw:transition ${on ? 'tw:bg-br tw:text-white tw:shadow-[0_2px_8px_rgba(15,77,184,.35)]' : 'tw:text-tx2 tw:hover:text-tx'}`}>
            {label}
          </button>
        );
      })}
    </div>
  );
}
/** Botones de opción en cuadrícula (método de pago, documento, propina…). */
export function Seg({ opciones, valor, onChange, min = 130 }) {
  return (
    <div className="tw:grid tw:gap-2.5" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}>
      {opciones.map((o) => {
        const [id, label] = Array.isArray(o) ? o : [o, o];
        return <Btn key={id} v={id === valor ? 'p' : ''} className="tw:w-full tw:py-3" onClick={() => onChange(id)}>{label}</Btn>;
      })}
    </div>
  );
}

/* ---------- etapas de un flujo ---------- */
export function Etapas({ l, a, rech }) {
  return (
    <div className="tw:flex tw:gap-1.5">
      {l.map((x, i) => {
        const er = rech === i;
        const dn = i < a;
        const cur = i === a;
        return (
          <div key={x} className={`tw:flex-1 tw:text-center tw:text-xs ${cur ? 'tw:text-tx' : 'tw:text-tx2'}`}>
            <b className={`tw:grid tw:place-items-center tw:w-6 tw:h-6 tw:mx-auto tw:mb-1 tw:rounded-full tw:border tw:border-bd ${er ? 'tw:bg-er tw:text-white' : dn ? 'tw:bg-ok tw:text-white' : cur ? 'tw:bg-br tw:text-white' : ''}`}>
              {er ? '✕' : dn ? '✓' : i + 1}
            </b>
            <span>{x}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- barra de progreso ---------- */
const BARRA = { ok: 'tw:bg-ok', wa: 'tw:bg-wa', er: 'tw:bg-er', g: 'tw:bg-tx2' };
export const Barra = ({ pct, tono, texto }) => (
  <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2.5 tw:gap-y-1.5">
    <div className="tw:flex-1 tw:basis-[160px] tw:h-2 tw:rounded-lg tw:bg-bd tw:overflow-hidden"><i className={`tw:block tw:h-full ${BARRA[tono]}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
    {texto && <span className="tw:text-[13px]">{texto}</span>}
  </div>
);

/* ---------- pares clave / valor ---------- */
export const Kv = ({ pares }) => (
  <div className="tw:flex tw:flex-col">
    {pares.map(([k, v]) => (
      <div key={k} className="tw:flex tw:justify-between tw:gap-4 tw:py-2.5 tw:border-b tw:border-dashed tw:border-bd tw:last:border-b-0">
        <span className="tw:text-tx2 tw:text-[13px]">{k}</span><b className="tw:text-right">{v}</b>
      </div>
    ))}
  </div>
);

/* ---------- tabla (Bootstrap) · cada fila es un arreglo de celdas o {celdas, onClick, tono:'rj'|'az', dim} ---------- */
const TONO_FILA = { rj: 'tw:[&>td]:bg-[#FDF0EE]', az: 'tw:[&>td]:bg-[#EEF5FF]' };
export const Tabla = ({ cols, filas }) => (
  <div className="tw:overflow-x-auto tw:rounded-[20px] tw:border tw:border-bd tw:shadow-osv tw:bg-sf">
    <Table hover className="tbl-osv">
      <thead><tr>{cols.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>
        {filas.map((f, i) => {
          const o = Array.isArray(f) ? { celdas: f } : f;
          return (
            <tr key={i} onClick={o.onClick} className={`${o.onClick ? 'tw:cursor-pointer' : ''} ${TONO_FILA[o.tono] || ''} ${o.dim ? 'tw:opacity-55' : ''}`}>
              {o.celdas.map((c, j) => <td key={j}>{c}</td>)}
            </tr>
          );
        })}
      </tbody>
    </Table>
  </div>
);

/** Nivel de stock contra el mínimo. */
export function Nivel({ v, min }) {
  const p = min ? v / min : 1;
  const t = p < 0.5 ? 'er' : p < 1 ? 'wa' : 'ok';
  return <div className="tw:flex tw:items-center tw:gap-2 tw:min-w-[140px]"><div className="tw:flex-1"><Barra pct={p * 100} tono={t} /></div>{p < 1 && <Chip t="Bajo" o={t} />}</div>;
}

/** Botón de opción que se activa/desactiva (✓). */
export const Toggle = ({ on, onClick, children }) => <Btn v={on ? 'p' : ''} onClick={onClick}>{on ? '✓ ' : ''}{children}</Btn>;

/* ---------- panel lateral (Offcanvas de React-Bootstrap) ---------- */
export function Panel({ show, onHide, titulo, estado, ro, pie, children }) {
  return (
    <Offcanvas show={show} onHide={onHide} placement="end" aria-labelledby="panel-titulo">
      <Offcanvas.Header closeButton>
        <Offcanvas.Title id="panel-titulo" className="tw:flex-1">{titulo}</Offcanvas.Title>
        {estado && <Chip t={estado} />}
        {ro && <small className="tw:text-tx2">Solo lectura</small>}
      </Offcanvas.Header>
      <Offcanvas.Body>{children}</Offcanvas.Body>
      {pie && !ro && <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2 tw:px-5 tw:py-3.5 tw:border-t tw:border-bd">{pie}</div>}
    </Offcanvas>
  );
}

/* ---------- foto de producto con ícono si no hay ---------- */
const ICO_CAT = { Pupusas: '🫓', Bebidas: '🥤', Platos: '🍽️' };
export function Foto({ x, className = '', icono = 'tw:text-5xl' }) {
  const [falla, setFalla] = useState(false);
  const ico = x.extra ? '➕' : ICO_CAT[x.categorias?.[0]] || '🍴';
  return (
    <div className={`osv-foto tw:relative tw:flex tw:items-center tw:justify-center tw:overflow-hidden ${className}`}>
      {x.foto && !falla
        ? <img src={x.foto} alt={x.nombre} className="tw:absolute tw:inset-0 tw:w-full tw:h-full tw:object-cover" onError={() => setFalla(true)} />
        : <span className={`${icono} tw:leading-none`} aria-hidden="true">{ico}</span>}
    </div>
  );
}

/* ---------- avatar de persona (foto o iniciales) ---------- */
const COL = ['#0F5C54', '#B7791F', '#3B6FB6', '#9C4A8F', '#C2553D', '#4E7F3A'];
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
export function Avatar({ u, size = 40, className = '' }) {
  const ini = String(u?.nombre || '?').trim().split(/\s+/).slice(0, 2).map((a) => a[0]).join('').toUpperCase();
  return (
    <span className={`tw:inline-grid tw:place-items-center tw:rounded-full tw:overflow-hidden tw:text-white tw:font-bold tw:shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.36, background: u?.foto ? 'transparent' : COL[hash(u?.id || u?.nombre) % COL.length] }}>
      {u?.foto ? <img src={u.foto} alt="" className="tw:w-full tw:h-full tw:object-cover" /> : ini}
    </span>
  );
}

/* ---------- campo con etiqueta ---------- */
export const Campo = ({ l, children, className = '' }) => (
  <label className={`tw:flex tw:flex-col tw:gap-1.5 ${className}`}><span>{l}</span>{children}</label>
);

/* ---------- carga ---------- */
export const Cargando = () => (
  <div className="tw:grid tw:place-items-center tw:py-16 tw:text-tx2" role="status">
    <span className="spinner-border text-primary" aria-hidden="true" /><span className="tw:mt-3">Cargando…</span>
  </div>
);
