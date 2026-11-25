import { useState } from 'react';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { D, H, fFecha, fmt, r2 } from '../../lib/formato.js';
import { useDatos, useAhora } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Ban, Barra, Btn, Card, Cargando, Chip, Err, Kv, Panel, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { ChipCompra, LotesRecibidos, atrasoTxt, lineasTxt, politicaTxt, recepcionDistinta } from '../../components/Compras.jsx';

/* Encargado de bodega · 4.4 Recepción de mercancía */
function estadoLlegada(c, t) {
  if (c.llego) {
    const a = c.llegada - c.prom;
    if (a > (c.politica.tolH || 0) * H || a > 6 * H) { const dd = Math.max(1, Math.ceil(a / D)); return [`Retrasado +${dd} día${dd === 1 ? '' : 's'}`, 'er']; }
    return a < -H ? ['Adelantado', 'in'] : ['A tiempo', 'ok'];
  }
  if (t > c.prom) return ['Retrasado', 'wa'];
  return (t - c.enviada) / (c.prom - c.enviada) >= 0.85 ? ['Ya casi llega', 'in'] : ['A tiempo', 'ok'];
}
const fechaInput = (t) => new Date(t - 6 * H).toISOString().slice(0, 10);

/** Registrar la llegada: uno o varios lotes por materia prima, con su SKU, cantidad y vencimiento real. */
function Registrar({ c, onHide }) {
  const { confirmar, accion } = useDialogos();
  const ahora = useAhora(60_000);
  const [T, setT] = useState(() => Object.fromEntries(c.lineas.map((l) => [l.mp, [{ sku: c.sugerido[l.mp].sku, cant: l.cant, vence: c.sugerido[l.mp].vence }]])));
  const setFila = (mp, k, cambio) => setT({ ...T, [mp]: T[mp].map((x, j) => (j === k ? { ...x, ...cambio } : x)) });
  const errores = [];
  for (const l of c.lineas) {
    const rec = T[l.mp].reduce((a, x) => a + (+x.cant || 0), 0);
    if (rec > l.cant + 1e-9) errores.push(`${l.nombre}: recibiste más de lo pedido`);
    for (const x of T[l.mp]) {
      if (!String(x.sku).trim()) errores.push('Falta el código SKU');
      if (!(x.cant > 0)) errores.push(`Cantidad mayor que 0 en ${x.sku}`);
      if (!(x.vence > ahora)) errores.push(`El vencimiento de ${x.sku} debe ser posterior a hoy`);
    }
  }
  const skus = Object.values(T).flat().map((x) => String(x.sku).trim());
  if (new Set(skus).size !== skus.length) errores.push('Hay códigos SKU repetidos');
  if (!skus.length) errores.push('Registra al menos un lote');
  const parcial = c.lineas.some((l) => T[l.mp].reduce((a, x) => a + (+x.cant || 0), 0) < l.cant - 1e-9);
  const enviar = async () => {
    if (!(await confirmar({ titulo: 'Enviar al gerente', texto: 'Ya no podrás cambiar lo registrado. El stock no sube hasta que el gerente de sucursal acepte la mercancía.', verbo: 'Enviar' }))) return;
    const lotes = Object.entries(T).flatMap(([mp, rows]) => rows.map((x) => ({ mp: +mp, sku: String(x.sku).trim(), cant: +x.cant, vence: x.vence })));
    if (await accion(() => api.post(`/bodega/compras/${c.id}/recepcion`, { lotes }), 'Recepción enviada al gerente')) onHide();
  };
  return (
    <Modal show onHide={onHide} centered size="lg" scrollable>
      <Modal.Body>
        <h3>Registrar llegada · #{c.id}</h3>
        <Kv pares={[['Proveedor', c.provNombre], ['Llegada', fmt(c.llegada)]]} />
        {c.atraso && <Ban>{atrasoTxt(c)}</Ban>}
        {c.lineas.map((l) => {
          const rows = T[l.mp];
          const rec = rows.reduce((a, x) => a + (+x.cant || 0), 0);
          const completa = rec >= l.cant - 1e-9;
          return (
            <Card key={l.mp} className="tw:flex tw:flex-col tw:gap-2">
              <b>{l.nombre}</b>
              {rows.map((x, k) => (
                <div key={k} className="tw:grid tw:gap-2 tw:items-center tw:grid-cols-2 tw:md:grid-cols-[1.3fr_1fr_1.2fr_auto_auto]">
                  <Form.Control value={x.sku} aria-label="Código SKU" onChange={(e) => setFila(l.mp, k, { sku: e.target.value })} />
                  <Form.Control type="number" min={0} step="any" value={x.cant} aria-label="Cantidad recibida" onChange={(e) => setFila(l.mp, k, { cant: +e.target.value })} />
                  <Form.Control type="date" value={fechaInput(x.vence)} aria-label="Vencimiento real"
                    onChange={(e) => setFila(l.mp, k, { vence: e.target.value ? Date.parse(`${e.target.value}T23:59:00-06:00`) : 0 })} />
                  <span className="tw:text-tx2">{l.unidad}</span>
                  <Btn v="t" aria-label="Quitar lote" onClick={() => setT({ ...T, [l.mp]: rows.filter((_, j) => j !== k) })}>✕</Btn>
                </div>
              ))}
              <div><Btn v="t" onClick={() => setT({ ...T, [l.mp]: [...rows, { sku: `${c.sugerido[l.mp].sku}-${rows.length + 1}`, cant: 0, vence: c.sugerido[l.mp].vence }] })}>+ Agregar lote</Btn></div>
              <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                <span>Pedido {l.cant} · Recibido {r2(rec)} · Faltan {Math.max(0, r2(l.cant - rec))}</span>
                <Chip t={completa ? 'Completa' : 'Parcial'} o={completa ? 'ok' : 'wa'} />
              </div>
            </Card>
          );
        })}
        <div><Chip t={parcial ? 'Recepción parcial' : 'Recepción completa'} o={parcial ? 'wa' : 'ok'} /></div>
        <Err>{errores[0]}</Err>
        <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={onHide}>Cancelar</Btn><Btn v="p" disabled={errores.length > 0} onClick={enviar}>Enviar al gerente</Btn></div>
      </Modal.Body>
    </Modal>
  );
}

function EnCamino({ lista }) {
  const { toast } = useDialogos();
  const ahora = useAhora(30_000);
  const [reg, setReg] = useState(null);
  const [pol, setPol] = useState(null);
  if (!lista.length) return <Vacio>No hay mercancía en camino</Vacio>;
  return (
    <Stack>
      {lista.map((c) => {
        const [tx, to] = estadoLlegada(c, ahora);
        const pr = Math.max(0, Math.min(1, (ahora - c.enviada) / (c.prom - c.enviada)));
        return (
          <button key={c.id} type="button" onClick={() => (c.llego ? setReg(c) : toast(`Todavía no llega la mercancía de ${c.provNombre}`))}
            className="tw:flex tw:flex-col tw:gap-2 tw:text-left tw:bg-sf tw:border tw:border-bd tw:rounded-[20px] tw:shadow-osv tw:px-5 tw:py-4 tw:hover:border-[#B9CEF0]">
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2"><b>{c.provNombre}</b><span className="tw:text-tx2">{lineasTxt(c)}</span><Chip t={tx} o={to} /></div>
            <div className="tw:flex tw:items-center tw:gap-2"><span aria-hidden="true">🚚</span><div className="tw:flex-1"><Barra pct={c.llego ? 100 : pr * 100} tono={to === 'er' ? 'er' : 'ok'} /></div>
              <small className="tw:text-tx2">{c.llego ? 'Llegó · toca para registrar' : `Promesa: ${fmt(c.prom)}`}</small></div>
            {c.atraso && (
              <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2"><small>{atrasoTxt(c)}</small>
                <span role="button" tabIndex={0} className="tw:text-br tw:font-semibold tw:text-[13px]" onClick={(e) => { e.stopPropagation(); setPol(c); }}>Ver política</span>
              </div>
            )}
          </button>
        );
      })}
      {reg && <Registrar c={reg} onHide={() => setReg(null)} />}
      <Modal show={!!pol} onHide={() => setPol(null)} centered>
        {pol && <Modal.Body><h3>Política de atrasos · {pol.provNombre}</h3><p className="tw:m-0">{politicaTxt(pol.politica)}</p><div className="tw:flex tw:justify-end"><Btn v="p" onClick={() => setPol(null)}>Cerrar</Btn></div></Modal.Body>}
      </Modal>
    </Stack>
  );
}

function Enviadas({ lista }) {
  const { motivo, accion } = useDialogos();
  const [ver, setVer] = useState(null);
  if (!lista.length) return <Vacio ic="check">Aún no has enviado recepciones</Vacio>;
  const c = ver && lista.find((x) => x.id === ver);
  const dif = c && recepcionDistinta(c);
  const puede = c && c.estado === 'Recibida' && dif && !c.detalle.devolucionBodega;
  const proponer = async () => {
    const m = await motivo({ titulo: 'Motivo de la devolución (llegó menos o más de lo pedido)' });
    if (m && await accion(() => api.post(`/bodega/compras/${c.id}/devolver`, { motivo: m }), 'El gerente decidirá si aprueba la devolución')) setVer(null);
  };
  return (
    <>
      <Tabla cols={['Solicitud', 'Proveedor', 'Enviada', 'Recibido', 'Estado']} filas={lista.map((x) => ({
        onClick: () => setVer(x.id), celdas: [`#${x.id}`, x.provNombre, fmt(x.recepcion.fecha), `${x.recepcion.lotes.length} lote${x.recepcion.lotes.length === 1 ? '' : 's'}`, <ChipCompra e={x.estado} />],
      }))} />
      {c && (
        <Panel show onHide={() => setVer(null)} titulo={`Recepción #${c.id}`} estado={c.estado} ro={!puede}
          pie={puede ? <Btn v="red" onClick={proponer}>Devolver mercancía (avisa al gerente)</Btn> : null}>
          {c.detalle.devolucionBodega && c.estado === 'Recibida' && <Ban>Propusiste devolver esta mercancía. Espera la decisión del gerente.</Ban>}
          {dif && c.estado === 'Recibida' && <Ban>Lo recibido no coincide con lo pedido.</Ban>}
          {c.estado === 'Devuelta' && c.detalle.devolucion && <Err>Devuelta: {c.detalle.devolucion.motivo}</Err>}
          {c.estado === 'Recibida' && <Ban>Esperando al gerente de sucursal. El stock no sube hasta que acepte la mercancía.</Ban>}
          <LotesRecibidos c={c} />
          {c.parcial && <Ban>{c.hijo ? `Lo pendiente sigue en camino con descuento (solicitud #${c.hijo}).` : 'Lo pendiente se canceló.'}</Ban>}
        </Panel>
      )}
    </>
  );
}

export default function Recepcion({ tab = 'camino' }) {
  const { datos } = useDatos('/bodega/recepcion', { cada: 10000 });
  if (!datos) return <Cargando />;
  return tab === 'enviadas' ? <Enviadas lista={datos.enviadas} /> : <EnCamino lista={datos.enCamino} />;
}
