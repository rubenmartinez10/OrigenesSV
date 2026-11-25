import { useState } from 'react';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fmt, r2 } from '../../lib/formato.js';
import { descargar, imprimir, tablaHtml, xlsx } from '../../lib/excel.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { ROLES } from '../../roles.js';
import { Ban, Btn, Cargando, Chip, Err, Etapas, Kv, Mut, Panel, Stack, Tabla, Vacio } from '../../components/ui.jsx';

/* Recursos Humanos · 6.4 Planilla y 6.5 Reportes de pago */
const rolN = (r) => ROLES[r]?.nombre || r;
const S = { q: null, suc: '' };
const tramo = (b) => (b <= 236 ? 'I (exento)' : b <= 447.62 ? 'II (10 %)' : b <= 1019.05 ? 'III (20 %)' : 'IV (30 %)');
const sumar = (L, k) => r2(L.reduce((a, f) => a + f[k], 0));

export function DetallePago({ f, sucN, onHide }) {
  return (
    <Panel show onHide={onHide} titulo={f.nombre} ro>
      <Kv pares={[
        ['Rol', rolN(f.rol)], ['Sucursal', sucN(f.suc)], ['Salario mensual', $(f.mensual)], ['Salario quincenal', $(f.bruto)],
        ['ISSS 3 % (tope $15 por quincena)', `−${$(f.isss)}`], ['AFP 7.25 %', `−${$(f.afp)}`], ['Base para renta', $(f.base)],
        ['Tramo de renta', tramo(f.base)], ['Retención de renta', `−${$(f.renta)}`], ['Líquido a pagar', $(f.liquido)],
      ]} />
      <Mut>La tabla de renta es la vigente configurada en el sistema; confírmala con tu contador antes de usarla en producción.</Mut>
    </Panel>
  );
}

function Boleta({ f, label, sucN, onHide }) {
  const imp = () => imprimir('Boleta de pago', `<div class="mut">${label}</div>${tablaHtml(['Concepto', 'Monto'], [
    ['Empleado', f.nombre], ['Cargo', rolN(f.rol)], ['Sucursal', sucN(f.suc)], ['Devengado', $(f.bruto)], ['ISSS', `−${$(f.isss)}`], ['AFP', `−${$(f.afp)}`],
    ['Renta', `−${$(f.renta)}`], ['Líquido a pagar', $(f.liquido)]])}`);
  return (
    <Modal show onHide={onHide} centered>
      <Modal.Body>
        <h3>Boleta de pago</h3>
        <Mut>Orígenes SV · {label}</Mut>
        <Kv pares={[['Empleado', f.nombre], ['Cargo', rolN(f.rol)], ['Sucursal', sucN(f.suc)], ['Devengado', $(f.bruto)], ['ISSS', `−${$(f.isss)}`],
          ['AFP', `−${$(f.afp)}`], ['Renta', `−${$(f.renta)}`], ['Líquido a pagar', $(f.liquido)]]} />
        <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={onHide}>Cerrar</Btn><Btn v="p" onClick={imp}>Imprimir</Btn></div>
      </Modal.Body>
    </Modal>
  );
}

const COLS = ['Quincena', 'Empleado', 'Rol', 'Sucursal', 'Salario mensual', 'Quincenal', 'ISSS', 'AFP', 'Base de renta', 'Renta', 'Líquido'];
function excelDe(planillas, suc, sucN) {
  const filas = [];
  const res = [];
  for (const p of planillas) {
    const L = p.filas.filter((f) => !suc || f.suc === +suc);
    for (const f of L) filas.push([p.label, f.nombre, rolN(f.rol), sucN(f.suc), f.mensual, f.bruto, f.isss, f.afp, f.base, f.renta, f.liquido]);
    res.push([p.label, L.length, sumar(L, 'bruto'), sumar(L, 'isss'), sumar(L, 'afp'), sumar(L, 'renta'), sumar(L, 'liquido')]);
  }
  return xlsx([{ nombre: 'Pagos', cols: COLS, filas, dinero: [4, 5, 6, 7, 8, 9, 10] },
    { nombre: 'Resumen', cols: ['Quincena', 'Empleados', 'Quincenal', 'ISSS', 'AFP', 'Renta', 'Líquido'], filas: res, dinero: [2, 3, 4, 5, 6] }]);
}

function Planilla() {
  const { confirmar, accion } = useDialogos();
  const [f, setFS] = useState(S);
  const setF = (x) => { Object.assign(S, x); setFS({ ...S }); };
  const { datos } = useDatos(`/rrhh/planilla${f.q ? `?q=${f.q}` : ''}`);
  const [ver, setVer] = useState(null);
  const [bol, setBol] = useState(null);
  if (!datos) return <Cargando />;
  const p = datos.planilla;
  const SN = Object.fromEntries(datos.sucursales.map((s) => [s.id, s.nombre]));
  const sucN = (s) => (s ? SN[s] || `Sucursal ${s}` : 'Gerencia central');
  const filas = p ? p.filas.filter((x) => !f.suc || x.suc === +f.suc) : [];
  const pasada = datos.q !== datos.actual;
  const label = datos.quincenas.find((x) => x.id === datos.q)?.label;
  const generar = async () => {
    if (await confirmar({ titulo: 'Generar quincena', texto: `${label}. Se calcula el pago de todas las personas activas y un reporte por sucursal para el gerente general.`, verbo: 'Generar' })) {
      await accion(() => api.post('/rrhh/planilla', { q: datos.q }), 'Quincena generada');
    }
  };
  const resumen = () => {
    const g = new Map();
    for (const x of filas) { const k = x.suc ?? 0; if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
    return [...g.entries()].map(([k, L]) => [sucN(k), L.length, $(sumar(L, 'bruto')), $(r2(sumar(L, 'isss') + sumar(L, 'afp') + sumar(L, 'renta'))), $(sumar(L, 'liquido'))]);
  };
  const todas = () => accion(async () => descargar(excelDe(await api.get('/rrhh/planillas'), f.suc, sucN), 'planillas-generadas.xlsx'));
  const imp = () => imprimir(`Planilla · ${label}`, tablaHtml(['Empleado', 'Rol', 'Sucursal', 'Mensual', 'Quincenal', 'ISSS', 'AFP', 'Base renta', 'Renta', 'Líquido'], [
    ...filas.map((x) => [x.nombre, rolN(x.rol), sucN(x.suc), $(x.mensual), $(x.bruto), $(x.isss), $(x.afp), $(x.base), $(x.renta), $(x.liquido)]),
    ['Totales', '', '', '', $(sumar(filas, 'bruto')), $(sumar(filas, 'isss')), $(sumar(filas, 'afp')), '', $(sumar(filas, 'renta')), $(sumar(filas, 'liquido'))]]));
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Form.Select value={datos.q} onChange={(e) => setF({ q: e.target.value })} className="tw:max-w-[320px]" aria-label="Quincena">
          {datos.quincenas.map((x) => <option key={x.id} value={x.id}>{x.label}{datos.generadas.includes(x.id) ? ' ✓' : ''}</option>)}
        </Form.Select>
        <Form.Select value={f.suc} onChange={(e) => setF({ suc: e.target.value })} className="tw:max-w-[210px]" aria-label="Sucursal">
          <option value="">Todas las sucursales</option>{datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Form.Select>
        {p && <Chip t="Generada" o="ok" />}
      </div>
      <div className="tw:flex tw:flex-wrap tw:gap-2">
        <Btn disabled={!p} onClick={() => descargar(excelDe([p], f.suc, sucN), `planilla-${datos.q}.xlsx`)}>Excel de esta quincena</Btn>
        <Btn disabled={!datos.generadas.length} onClick={todas}>Excel de todas</Btn>
        <Btn disabled={!p} onClick={imp}>Imprimir detalle</Btn>
        <Btn disabled={!p || p.boletas} onClick={() => accion(() => api.post(`/rrhh/planilla/${datos.q}/boletas`), 'Boletas generadas')}>Generar boletas</Btn>
        <span className="tw:flex-1" />
        <Btn v="p" disabled={!!p} onClick={generar}>Generar quincena</Btn>
      </div>
      {!p ? <Vacio ic="list">Toca Generar quincena para calcular el pago</Vacio>
        : pasada ? <>
          <Ban>Quincena pasada: solo se muestra el resumen. Usa Imprimir detalle para ver cada pago con sus descuentos.</Ban>
          <Tabla cols={['Sucursal', 'Empleados', 'Quincenal', 'Descuentos', 'Líquido']} filas={[...resumen(),
            [<b>Totales</b>, <b>{filas.length}</b>, <b>{$(sumar(filas, 'bruto'))}</b>, <b>{$(r2(sumar(filas, 'isss') + sumar(filas, 'afp') + sumar(filas, 'renta')))}</b>, <b>{$(sumar(filas, 'liquido'))}</b>]]} />
        </> : <Tabla cols={['Empleado', 'Rol', 'Quincenal', 'ISSS', 'AFP', 'Renta', 'Líquido', '']} filas={[
          ...filas.map((x) => ({
            onClick: () => setVer(x),
            celdas: [x.nombre, rolN(x.rol), $(x.bruto), $(x.isss), $(x.afp), $(x.renta), $(x.liquido),
              p.boletas ? <Btn v="t" onClick={(e) => { e.stopPropagation(); setBol(x); }}>Ver boleta</Btn> : ''],
          })),
          [<b>Totales</b>, '', <b>{$(sumar(filas, 'bruto'))}</b>, <b>{$(sumar(filas, 'isss'))}</b>, <b>{$(sumar(filas, 'afp'))}</b>, <b>{$(sumar(filas, 'renta'))}</b>, <b>{$(sumar(filas, 'liquido'))}</b>, ''],
        ]} />}
      {ver && <DetallePago f={ver} sucN={sucN} onHide={() => setVer(null)} />}
      {bol && <Boleta f={bol} label={label} sucN={sucN} onHide={() => setBol(null)} />}
    </Stack>
  );
}

const ETR = ['Generado', 'Enviado', 'Aprobado'];
const TONO = { Aprobado: 'ok', Rechazado: 'er', Enviado: 'in', 'Sin enviar': 'g' };
function Reportes() {
  const { confirmar, accion } = useDialogos();
  const { datos } = useDatos('/rrhh/reportes');
  const [ver, setVer] = useState(null);
  const { datos: r } = useDatos(ver ? `/rrhh/reportes/${ver}` : null);
  if (!datos) return <Cargando />;
  const enviar = async () => {
    if (!(await confirmar({ titulo: 'Enviar a gerencia general', texto: `El reporte de ${r.sucNombre} llegará al gerente general.`, verbo: 'Enviar' }))) return;
    if (await accion(() => api.post(`/rrhh/reportes/${r.id}/enviar`), 'Reporte enviado')) setVer(null);
  };
  return (
    <Stack>
      {datos.length ? <Tabla cols={['Sucursal', 'Quincena', 'Empleados', 'Total líquido', 'Estado']} filas={datos.map((x) => ({
        onClick: () => setVer(x.id), celdas: [x.sucNombre, x.label, x.personas, $(x.total), <Chip t={x.estado} o={TONO[x.estado]} />],
      }))} /> : <Vacio ic="list">Genera una quincena para crear los reportes</Vacio>}
      {ver && (
        <Panel show onHide={() => setVer(null)} titulo={r ? `Reporte · ${r.sucNombre}` : 'Reporte'} estado={r?.estado === 'Sin enviar' ? 'Creada' : r?.estado}
          pie={r && ['Sin enviar', 'Rechazado'].includes(r.estado) ? [<Btn key="e" v="p" onClick={enviar}>{r.estado === 'Rechazado' ? 'Reenviar' : 'Enviar a gerencia general'}</Btn>] : null} ro={r && !['Sin enviar', 'Rechazado'].includes(r.estado)}>
          {!r ? <Cargando /> : <>
            <Etapas l={ETR} a={r.estado === 'Sin enviar' ? 0 : r.estado === 'Enviado' ? 1 : 3} rech={r.estado === 'Rechazado' ? 2 : undefined} />
            {r.estado === 'Rechazado' && <Err>Rechazado: {r.motivo}</Err>}
            <Kv pares={[['Quincena', r.label], ['Empleados', r.personas], ...(r.enviado ? [['Enviado', fmt(r.enviado)]] : []), ...(r.decidido ? [['Decidió', `${r.decidioNombre} · ${fmt(r.decidido)}`]] : [])]} />
            <Tabla cols={['Empleado', 'Líquido']} filas={[...r.filas.map((x) => [x.nombre, $(x.liquido)]), [<b>Total</b>, <b>{$(r.total)}</b>]]} />
          </>}
        </Panel>
      )}
    </Stack>
  );
}

export default function Pagos({ tab = 'planilla' }) {
  return tab === 'reportes' ? <Reportes /> : <Planilla />;
}
