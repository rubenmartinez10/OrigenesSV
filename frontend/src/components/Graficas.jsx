import { $ } from '../lib/formato.js';
import { Card, Mut } from './ui.jsx';

/* Gráficas de los tableros (SVG, sin librerías), como las del borrador: línea por día, barras y dona. */
const PAL = ['#0E4C9E', '#3F86E0', '#9CC3F2', '#F2B632', '#17794A', '#7A5BC7', '#C23A2E'];
const C = { br: '#0F4DB8', bd: '#D9E5F6', tx: '#0F2347', tx2: '#566A8C' };

export const Tarjeta = ({ t, sub, children }) => (
  <Card className="tw:flex tw:flex-col tw:gap-3 tw:min-w-0">
    <div className="tw:flex tw:items-center tw:gap-2"><b>{t}</b><span className="tw:flex-1" />{sub && <Mut>{sub}</Mut>}</div>
    {children}
  </Card>
);

export function Linea({ datos, fmt = $ }) {
  const W = 640; const H = 190; const p = 30;
  const vals = datos.map((d) => d.v);
  const mx = Math.max(1, ...vals);
  const x = (i) => (vals.length < 2 ? W / 2 : p + (i * (W - 2 * p)) / (vals.length - 1));
  const y = (v) => H - p - (v / mx) * (H - 2 * p);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const paso = Math.ceil(vals.length / 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ventas por día" className="tw:w-full tw:h-auto">
      <line x1={p} y1={H - p} x2={W - p} y2={H - p} stroke={C.bd} />
      <path d={`M${x(0)},${H - p} L${pts.join(' L')} L${x(vals.length - 1)},${H - p}Z`} fill={C.br} opacity=".12" />
      <polyline points={pts.join(' ')} fill="none" stroke={C.br} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {datos.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.v)} r="4" fill="#fff" stroke={C.br} strokeWidth="2"><title>{`${d.l}: ${fmt(d.v)}`}</title></circle>
      ))}
      {datos.map((d, i) => (vals.length < 9 || i % paso === 0
        ? <text key={`t${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={C.tx2}>{d.l}</text> : null))}
      <text x={p} y="14" fontSize="11" fill={C.tx2}>máx. {fmt(mx)}</text>
    </svg>
  );
}

export function Barras({ items, fmt = $ }) {
  if (!items.length || !items.some(([, v]) => v)) return <Mut>Sin datos en este periodo</Mut>;
  const mx = Math.max(1, ...items.map((i) => i[1]));
  return (
    <div className="tw:flex tw:flex-col tw:gap-2">
      {items.map(([n, v], i) => (
        <div key={n} className="tw:flex tw:items-center tw:gap-2.5">
          <span className="tw:w-[38%] tw:min-w-[90px] tw:truncate tw:text-[13px]" title={n}>{n}</span>
          <div className="tw:flex-1 tw:h-3 tw:rounded-lg tw:bg-bd tw:overflow-hidden"><i className="tw:block tw:h-full tw:rounded-lg" style={{ width: `${Math.max(2, (v / mx) * 100)}%`, background: PAL[i % PAL.length] }} /></div>
          <b className="tw:text-[13px] tw:whitespace-nowrap">{fmt(v)}</b>
        </div>
      ))}
    </div>
  );
}

export function Dona({ items, fmt = $ }) {
  const t = items.reduce((a, i) => a + i[1], 0);
  if (!t) return <Mut>Sin datos en este periodo</Mut>;
  const R = 54; const L = 2 * Math.PI * R;
  let ac = 0;
  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-4">
      <svg viewBox="0 0 140 140" role="img" aria-label="Ventas por categoría" className="tw:w-[150px] tw:h-[150px] tw:shrink-0">
        <g transform="rotate(-90 70 70)">
          {items.map(([n, v], i) => {
            const l = (v / t) * L;
            const el = (
              <circle key={n} cx="70" cy="70" r={R} fill="none" stroke={PAL[i % PAL.length]} strokeWidth="22"
                strokeDasharray={`${l.toFixed(2)} ${(L - l).toFixed(2)}`} strokeDashoffset={(-ac).toFixed(2)}><title>{`${n}: ${fmt(v)}`}</title></circle>
            );
            ac += l;
            return el;
          })}
        </g>
        <text x="70" y="75" textAnchor="middle" fontSize="15" fontWeight="700" fill={C.tx}>{fmt(t)}</text>
      </svg>
      <div className="tw:flex-1 tw:min-w-[140px] tw:flex tw:flex-col tw:gap-1.5">
        {items.map(([n, v], i) => (
          <div key={n} className="tw:flex tw:items-center tw:gap-2 tw:text-[13px]">
            <i className="tw:inline-block tw:w-3 tw:h-3 tw:rounded" style={{ background: PAL[i % PAL.length] }} />{n}
            <span className="tw:flex-1" /><b>{Math.round((v / t) * 100)} %</b>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tablero: ventas por día, por sucursal, por categoría y productos con más ingresos. */
export function Tablero({ d, n }) {
  const g = { gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))' };
  return (
    <>
      <div className="tw:grid tw:gap-3.5" style={g}>
        <Tarjeta t="Ventas por día" sub={`Últimos ${n} días`}><Linea datos={d.dias} /></Tarjeta>
        <Tarjeta t="Ventas por sucursal"><Barras items={d.porSucursal} /></Tarjeta>
      </div>
      <div className="tw:grid tw:gap-3.5" style={g}>
        <Tarjeta t="Ventas por categoría"><Dona items={d.porCategoria} /></Tarjeta>
        <Tarjeta t="Productos con más ingresos"><Barras items={d.topProductos} /></Tarjeta>
      </div>
    </>
  );
}
