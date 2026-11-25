import { useState } from 'react';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, D, fFecha, fmt } from '../../lib/formato.js';
import { useAhora, useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Campo, Cargando, Chip, Kpi, Kv, Mut, Panel, Pildoras, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { DetalleFactura } from '../../components/Franquicia.jsx';

/* Gerente general · 7.3 Cuentas por pagar y 7.7 Nómina */
const TONO = { Pagada: 'ok', Vencida: 'er', Anulada: 'g', Pendiente: 'wa' };
const SC = { est: '', suc: '', prov: '', desde: '', hasta: '' };
const dia = (s, fin) => (s ? Date.parse(`${s}T${fin ? '23:59:59' : '00:00:00'}-06:00`) : fin ? Infinity : 0);

function Cuentas() {
  const ahora = useAhora(60000);
  const { confirmar, accion } = useDialogos();
  const { datos } = useDatos('/gg/cuentas');
  const [f, setFS] = useState(SC);
  const setF = (x) => { Object.assign(SC, x); setFS({ ...SC }); };
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const L = datos.facturas.filter((x) => (!f.est || x.estado === f.est) && (!f.suc || x.suc === +f.suc) && (!f.prov || x.prov === +f.prov) && x.vence >= dia(f.desde) && x.vence <= dia(f.hasta, true));
  const pagar = async (x) => {
    if (!(await confirmar({ titulo: 'Marcar como pagada', texto: `${x.provNombre} · ${x.num} · ${$(x.debe)}. Si el proveedor tiene saldo a favor, se descuenta. Fecha de pago: ${fmt(ahora)}. No se puede deshacer.`, verbo: 'Pagar' }))) return;
    const r = await accion(() => api.post(`/gg/facturas/${x.id}/pagar`), 'Factura pagada');
    if (r) setVer(null);
  };
  return (
    <Stack>
      <div className="tw:grid tw:gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
        <Kpi t="Por pagar" v={$(datos.porPagar)} ic="dollar" />
        <Kpi t="Vencidas" v={$(datos.vencidas)} ic="bell" tono={datos.vencidas ? 'er' : undefined} />
        <Kpi t="Pagadas este mes" v={$(datos.pagadasMes)} ic="check" tono="ok" />
      </div>
      <div className="tw:flex tw:flex-wrap tw:items-end tw:gap-2">
        <Form.Select value={f.est} onChange={(e) => setF({ est: e.target.value })} className="tw:max-w-[160px]" aria-label="Estado">
          {[['', 'Todas'], ['Pendiente', 'Pendientes'], ['Vencida', 'Vencidas'], ['Pagada', 'Pagadas'], ['Anulada', 'Anuladas']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Form.Select>
        <Form.Select value={f.suc} onChange={(e) => setF({ suc: e.target.value })} className="tw:max-w-[190px]" aria-label="Sucursal">
          <option value="">Todas las sucursales</option>{datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Form.Select>
        <Form.Select value={f.prov} onChange={(e) => setF({ prov: e.target.value })} className="tw:max-w-[220px]" aria-label="Proveedor">
          <option value="">Todos los proveedores</option>{datos.proveedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
        </Form.Select>
        <Campo l="Vence desde" className="tw:text-xs"><Form.Control type="date" value={f.desde} onChange={(e) => setF({ desde: e.target.value })} /></Campo>
        <Campo l="hasta" className="tw:text-xs"><Form.Control type="date" value={f.hasta} onChange={(e) => setF({ hasta: e.target.value })} /></Campo>
      </div>
      {L.length ? <Tabla cols={['N.º', 'Proveedor', 'Sucursal', 'Monto', 'Condición', 'Vence', 'Estado', '']} filas={L.map((x) => {
        const dias = (x.vence - ahora) / D;
        return {
          onClick: () => setVer(x),
          celdas: [x.num, x.provNombre, x.sucNombre, <>{$(x.monto)}{x.creditos > 0 && <div className="tw:text-xs tw:text-tx2">Crédito a favor −{$(x.creditos)}</div>}</>, x.condicion,
            <span className={x.estado === 'Vencida' ? 'tw:text-er tw:font-bold' : dias <= 3 && x.estado === 'Pendiente' ? 'tw:text-wa tw:font-bold' : ''}>{fFecha(x.vence)}</span>,
            <Chip t={x.estado} o={TONO[x.estado]} />,
            ['Pendiente', 'Vencida'].includes(x.estado) ? <Btn v="p" onClick={(e) => { e.stopPropagation(); pagar(x); }}>Pagar</Btn> : ''],
        };
      })} /> : <Vacio ic="list">No hay facturas con ese filtro</Vacio>}
      <Kv pares={[['Saldo a favor con proveedores', $(datos.saldoFavor)]]} />
      {ver && <DetalleFactura id={ver.id} onHide={() => setVer(null)} pie={(fa) => (fa.estado === 'Pendiente' ? [<Btn key="p" v="p" onClick={() => pagar(ver)}>Pagar</Btn>] : null)} />}
    </Stack>
  );
}

const SN = { v: 'sal' };
function Nomina() {
  const { motivo, confirmar, accion } = useDialogos();
  const { datos } = useDatos('/gg/nomina');
  const [v, setVS] = useState(SN.v);
  const setV = (x) => { SN.v = x; setVS(x); };
  const [sal, setSal] = useState(null);
  const [rep, setRep] = useState(null);
  const { datos: r } = useDatos(rep ? `/gg/reportes/${rep}` : null);
  if (!datos) return <Cargando />;
  const x = sal && datos.salarios.find((s) => s.id === sal);
  const decidir = async (url, ok, cerrar, conMotivo) => {
    let body = {};
    if (conMotivo) { const m = await motivo({ titulo: 'Motivo del rechazo' }); if (!m) return; body = { motivo: m }; }
    if (await accion(() => api.post(url, body), ok)) cerrar();
  };
  return (
    <Stack>
      <div><Pildoras opciones={[['sal', `Solicitudes de salario (${datos.salarios.length})`], ['rep', `Reportes de pago (${datos.reportes.length})`], ['aum', `Aumentos automáticos (${datos.aumentos.length})`]]} valor={v} onChange={setV} /></div>
      {v === 'sal' && (datos.salarios.length ? <Tabla cols={['Rol', 'Actual', 'Propuesto', 'Fecha']} filas={datos.salarios.map((s) => ({ onClick: () => setSal(s.id), celdas: [s.rolNombre, $(s.actual), $(s.propuesto), fmt(s.fecha)] }))} />
        : <Vacio ic="check">No hay solicitudes de nómina</Vacio>)}
      {v === 'rep' && (datos.reportes.length ? <Tabla cols={['Sucursal', 'Quincena', 'Empleados', 'Total líquido']} filas={datos.reportes.map((s) => ({ onClick: () => setRep(s.id), celdas: [s.sucNombre, s.label, s.personas, $(s.total)] }))} />
        : <Vacio ic="check">No hay reportes de pago por aprobar</Vacio>)}
      {v === 'aum' && <>
        <div><Chip t="Solo lectura" o="g" /></div>
        {datos.aumentos.length ? <Tabla cols={['Empleado', 'Fecha', 'Años', 'Anterior', 'Nuevo']} filas={datos.aumentos.map((a) => [a.nombre, fFecha(a.fecha), a.anios, $(a.antes), $(a.despues)])} />
          : <Vacio ic="list">Aún no hay aumentos automáticos</Vacio>}
      </>}
      {x && (
        <Panel show onHide={() => setSal(null)} titulo={`Salario · ${x.rolNombre}`} estado="Solicitada"
          pie={[<Btn key="r" onClick={() => decidir(`/gg/salarios/${x.id}/rechazar`, 'Salario rechazado', () => setSal(null), true)}>Rechazar</Btn>,
            <Btn key="a" v="p" onClick={async () => { if (await confirmar({ titulo: 'Aprobar el salario', texto: `El salario de ${x.rolNombre} pasa a ${$(x.propuesto)} para sus ${x.empleados} empleados.`, verbo: 'Aprobar' })) decidir(`/gg/salarios/${x.id}/aprobar`, 'Salario aprobado', () => setSal(null)); }}>Aprobar</Btn>]}>
          <Kv pares={[['Salario actual', $(x.actual)], ['Propuesto', $(x.propuesto)], ['Mínimo legal', $(datos.minimo)], ['Diferencia', `${x.dif >= 0 ? '+' : ''}${x.dif} %`],
            ['Empleados con este rol', x.empleados], ['Motivo de Recursos Humanos', x.motivo]]} />
        </Panel>
      )}
      {rep && (
        <Panel show onHide={() => setRep(null)} titulo={r ? `Reporte · ${r.sucNombre}` : 'Reporte'} estado={r?.estado}
          pie={[<Btn key="r" onClick={() => decidir(`/gg/reportes/${rep}/rechazar`, 'Reporte rechazado', () => setRep(null), true)}>Rechazar</Btn>,
            <Btn key="a" v="p" onClick={async () => { if (await confirmar({ titulo: 'Aprobar el reporte de pago', texto: `${r?.sucNombre} · ${$(r?.total || 0)}`, verbo: 'Aprobar' })) decidir(`/gg/reportes/${rep}/aprobar`, 'Reporte aprobado', () => setRep(null)); }}>Aprobar</Btn>]}>
          {!r ? <Cargando /> : <>
            <Kv pares={[['Sucursal', r.sucNombre], ['Quincena', r.label], ['Empleados', r.personas]]} />
            <Tabla cols={['Empleado', 'Líquido']} filas={[...r.filas.map((f) => [f.nombre, $(f.liquido)]), [<b>Total</b>, <b>{$(r.total)}</b>]]} />
            <Mut>Al aprobarlo, el pago cuenta como gasto de la sucursal en el panel.</Mut>
          </>}
        </Panel>
      )}
    </Stack>
  );
}

export default function Dinero({ tab = 'cxp' }) {
  return tab === 'nomina' ? <Nomina /> : <Cuentas />;
}
