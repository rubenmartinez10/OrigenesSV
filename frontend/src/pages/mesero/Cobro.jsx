import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Form, Modal } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fmt, r2 } from '../../lib/formato.js';
import { donde, nom, resumen, txt } from '../../lib/pedidos.js';
import { imprimirTicket } from '../../lib/ticket.js';
import { useDatos, useSesion } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Campo, Cargando, Err, Mut, Seg, Vacio } from '../../components/ui.jsx';
import { Documento } from '../../components/Pedido.jsx';

const Sec = ({ t, children }) => (
  <div className="tw:bg-sf tw:border tw:border-bd tw:rounded-[20px] tw:shadow-osv tw:p-5 tw:flex tw:flex-col tw:gap-3.5">
    {t && <h4 className="tw:m-0 tw:text-xs tw:tracking-wider tw:uppercase tw:text-tx2 tw:font-semibold">{t}</h4>}
    {children}
  </div>
);
const Ln = ({ a, b, gt }) => (
  <div className={`tw:flex tw:justify-between tw:gap-3 tw:py-2 tw:border-b tw:border-dashed tw:border-bd tw:last:border-b-0 ${gt ? 'tw:text-[22px] tw:font-bold tw:text-br tw:pt-3' : ''}`}>
    <span className={gt ? '' : 'tw:text-tx2'}>{a}</span><span>{b}</span>
  </div>
);
const DOCS = [['Ticket simple', 'Ticket'], ['Factura de consumidor final', 'Factura consumidor final'], ['Comprobante de crédito fiscal (CCF)', 'Crédito fiscal (CCF)']];
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[(Math.random() * 16) | 0]).join('');
const b32 = (n) => Array.from({ length: n }, () => 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'[(Math.random() * 32) | 0]).join('');

/** Ventana de pago (ADENDA v6): efectivo, tarjeta o Bitcoin, cada uno con sus propios datos. */
function Pago({ p, total, doc, pct, onHide, onCobrado }) {
  const { config } = useSesion();
  const BTC = config?.btcUsd || 100000;
  const [met, setMet] = useState('Efectivo');
  const [rec, setRec] = useState('');
  const [tj, setTj] = useState({ tipo: 'Débito', marca: 'Visa', ult4: '', aut: '', voucher: '', modo: 'Chip', cuotas: 'Contado' });
  const [bt, setBt] = useState({ red: 'Lightning', id: '', conf: '1', ok: false, inv: '' });
  const [er, setEr] = useState('');
  const [enviando, setEnviando] = useState(false);
  const sats = Math.round((total / BTC) * 1e8);
  const factura = (red) => (red === 'Lightning' ? `lnbc${sats}n1p${b32(48)}` : `bc1q${b32(38)}`);
  useEffect(() => { if (met === 'Bitcoin' && !bt.inv) setBt((b) => ({ ...b, inv: factura(b.red) })); }, [met]); // eslint-disable-line react-hooks/exhaustive-deps

  const falta = total - (+rec || 0);
  const cobrar = async () => {
    setEr('');
    setEnviando(true);
    try {
      const v = await api.post('/mesero/cobrar', {
        pedidoId: p.id, tipoDoc: doc.tipo, fis: doc.fis, propinaPct: pct, metodo: met,
        efectivo: { recibido: +rec }, tarjeta: tj, bitcoin: bt,
      });
      onCobrado(v);
    } catch (e) { setEr(e.message); } finally { setEnviando(false); }
  };
  const L = bt.red === 'Lightning';
  return (
    <Modal show onHide={onHide} centered size="lg" dialogClassName="tw:max-w-[560px]">
      <Modal.Body>
        <h3>Cobrar {$(total)}</h3>
        <Mut>{nom(p)} · {donde(p)} · {doc.tipo}{pct ? ` · propina ${pct} %` : ''}</Mut>
        <Seg opciones={['Efectivo', 'Tarjeta', 'Bitcoin']} valor={met} onChange={(m) => { setMet(m); setEr(''); }} />

        {met === 'Efectivo' && (
          <div className="tw:flex tw:flex-col tw:gap-3">
            <Campo l="Monto recibido del cliente"><Form.Control inputMode="decimal" placeholder="0.00" value={rec} onChange={(e) => setRec(e.target.value)} autoFocus /></Campo>
            <Seg min={70} opciones={[1, 5, 10, 20, 50, 100, 'Exacto'].map((a) => [String(a), a === 'Exacto' ? a : `$${a}`])} valor="" onChange={(a) => setRec(a === 'Exacto' ? String(total) : a)} />
            <div className={`tw:p-3.5 tw:rounded-2xl tw:text-center tw:text-xl tw:font-bold ${+rec > 0 && falta > 0 ? 'tw:border tw:border-er tw:text-er' : 'tw:bg-brs tw:text-br'}`} aria-live="polite">
              {!(+rec > 0) ? 'Escribe lo que entrega el cliente' : falta > 0 ? `Falta ${$(falta)}` : `Cambio ${$(-falta)}`}
            </div>
          </div>
        )}

        {met === 'Tarjeta' && (
          <div className="tw:flex tw:flex-col tw:gap-3">
            <Mut>Pasa la tarjeta por la terminal y copia aquí lo que imprime o muestra el voucher.</Mut>
            <Seg opciones={['Débito', 'Crédito']} valor={tj.tipo} onChange={(k) => setTj({ ...tj, tipo: k })} />
            <Seg opciones={['Visa', 'Mastercard', 'American Express', 'Otra']} valor={tj.marca} onChange={(k) => setTj({ ...tj, marca: k })} min={110} />
            <Seg opciones={[['Chip', 'Chip'], ['Contactless', 'Sin contacto'], ['Banda', 'Banda']]} valor={tj.modo} onChange={(k) => setTj({ ...tj, modo: k })} />
            {tj.tipo === 'Crédito' && <Campo l="Plazo"><Seg opciones={['Contado', '3 cuotas', '6 cuotas', '12 cuotas']} valor={tj.cuotas} onChange={(k) => setTj({ ...tj, cuotas: k })} min={100} /></Campo>}
            <div className="tw:grid tw:gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <Campo l="Últimos 4 dígitos"><Form.Control inputMode="numeric" maxLength={4} placeholder="1234" value={tj.ult4} onChange={(e) => setTj({ ...tj, ult4: e.target.value })} /></Campo>
              <Campo l="Código de autorización"><Form.Control maxLength={8} placeholder="A1B2C3" value={tj.aut} onChange={(e) => setTj({ ...tj, aut: e.target.value })} /></Campo>
              <Campo l="No. de referencia / voucher"><Form.Control inputMode="numeric" maxLength={12} placeholder="000123" value={tj.voucher} onChange={(e) => setTj({ ...tj, voucher: e.target.value })} /></Campo>
            </div>
          </div>
        )}

        {met === 'Bitcoin' && (
          <div className="tw:flex tw:flex-col tw:gap-3">
            <Seg opciones={['Lightning', 'On-chain']} valor={bt.red} onChange={(k) => setBt({ ...bt, red: k, id: '', ok: false, inv: factura(k) })} />
            <div className="tw:p-3.5 tw:rounded-2xl tw:text-center tw:text-xl tw:font-bold tw:bg-brs tw:text-br">≈ {(total / BTC).toFixed(8)} BTC · {sats.toLocaleString('en-US')} sats</div>
            <Mut>Tasa de referencia de la demo: 1 BTC = ${BTC.toLocaleString('en-US')}. {L ? 'Muestra al cliente este código de cobro (invoice) para que lo pague desde su billetera:' : 'Muestra al cliente esta dirección para que envíe el monto exacto:'}</Mut>
            <Form.Control as="textarea" rows={3} readOnly value={bt.inv} onClick={(e) => e.target.select()} className="tw:font-mono tw:text-xs tw:break-all" aria-label="Código de cobro" />
            <Mut>Código generado por la demo.</Mut>
            <Campo l={L ? 'Hash del pago (payment hash) que muestra la billetera' : 'ID de la transacción (txid, 64 caracteres)'}>
              <Form.Control placeholder={L ? 'Pega aquí el hash' : 'Pega aquí el txid'} value={bt.id} onChange={(e) => setBt({ ...bt, id: e.target.value })} />
            </Campo>
            {!L && <Campo l="Confirmaciones en la red"><Seg opciones={[['0', '0 (sin confirmar)'], ['1', '1'], ['3', '3'], ['6', '6']]} valor={bt.conf} onChange={(k) => setBt({ ...bt, conf: k })} min={90} /></Campo>}
            <Form.Check id="btc-ok" checked={bt.ok} onChange={(e) => setBt({ ...bt, ok: e.target.checked })}
              label={L ? 'Confirmo que el pago ya llegó a la billetera del negocio' : 'Confirmo que la transacción ya aparece en la billetera del negocio'} />
            <Btn v="t" className="tw:self-start" onClick={() => setBt({ ...bt, id: hex(L ? 32 : 64) })}>Usar un hash de prueba</Btn>
          </div>
        )}

        <Err>{er}</Err>
        <div className="tw:flex tw:justify-end tw:gap-2">
          <Btn v="t" onClick={onHide}>Volver</Btn>
          <Btn v="p" disabled={enviando} onClick={cobrar}>Confirmar cobro {$(total)}</Btn>
        </div>
      </Modal.Body>
    </Modal>
  );
}

export default function Cobro() {
  const { config, usuario } = useSesion();
  const { recargar } = useSesion();
  const navigate = useNavigate();
  const location = useLocation();
  const { datos: lista } = useDatos('/mesero/pedidos?porCobrar=1', { cada: 5000 });
  const { datos: caja } = useDatos('/mesero/caja');
  const [sel, setSel] = useState(location.state?.pedido || null);
  const [doc, setDoc] = useState({ tipo: 'Ticket simple', fis: { nombre: '', nit: '', nrc: '' } });
  const [pct, setPct] = useState(0);
  const [er, setEr] = useState('');
  const [pago, setPago] = useState(false);
  const [emitido, setEmitido] = useState(null);
  if (!lista || !caja) return <Cargando />;

  const iva = config?.iva ?? 13;
  const p = lista.find((x) => x.id === sel) || lista[0];
  const izquierda = (
    <Sec t={`Por cobrar · ${lista.length}`}>
      <div className="tw:flex tw:flex-col tw:gap-2.5">
        {lista.length ? lista.map((x) => (
          <button key={x.id} type="button" onClick={() => setSel(x.id)}
            className={`tw:flex tw:flex-col tw:gap-1 tw:text-left tw:w-full tw:p-3.5 tw:rounded-[20px] tw:border ${p && x.id === p.id ? 'tw:border-br tw:bg-brs' : 'tw:border-bd tw:bg-bg'}`}>
            <span className="tw:flex tw:justify-between"><b>{donde(x)} · #{x.num}</b><b>{$(x.total)}</b></span>
            <small className="tw:text-tx2">{fmt(x.entregado || x.creado)}</small>
            <small className="tw:text-tx2">{resumen(x)}</small>
          </button>
        )) : <Vacio>No hay pedidos por cobrar</Vacio>}
      </div>
    </Sec>
  );
  const marco = (derecha) => <div className="tw:grid tw:gap-6 tw:items-start tw:lg:grid-cols-[minmax(260px,1fr)_minmax(0,1.7fr)]">{izquierda}{derecha}</div>;

  // el documento emitido se muestra aunque ya no queden pedidos por cobrar
  const modalEmitido = (
    <Modal show={!!emitido} onHide={() => setEmitido(null)} centered>
      {emitido && (
        <Modal.Body>
          <h3>Documento emitido</h3>
          <Documento v={emitido} iva={iva} />
          <div className="tw:flex tw:justify-end tw:gap-2">
            <Btn v="t" onClick={() => imprimirTicket(emitido.ped, emitido, usuario.sucursalNombre, iva)}>Imprimir ticket</Btn>
            <Btn v="p" onClick={() => setEmitido(null)}>Cerrar</Btn>
          </div>
        </Modal.Body>
      )}
    </Modal>
  );

  if (!caja.abierta) return <>{marco(<Sec><b>Abre tu caja para cobrar</b><div><Btn v="p" onClick={() => navigate('/mesero/caja')}>Ir a Mi caja</Btn></div></Sec>)}{modalEmitido}</>;
  if (!p) return <>{marco(<Sec><Vacio>Elige un pedido para cobrar</Vacio></Sec>)}{modalEmitido}</>;

  const sub = p.total / (1 + iva / 100);
  const propina = r2((p.total * pct) / 100);
  const T = r2(p.total + propina);
  const ccf = doc.tipo.startsWith('Comp');
  const validarDoc = () => {
    if (!ccf) return '';
    if (!doc.fis.nombre.trim()) return 'Falta el nombre o razón social';
    if (!/^\d{4}-\d{6}-\d{3}-\d$/.test(doc.fis.nit.trim())) return 'NIT inválido (0000-000000-000-0)';
    if (!/^\d{6}-\d$/.test(doc.fis.nrc.trim())) return 'NRC inválido (000000-0)';
    return '';
  };

  return (
    <>
      {marco(
        <div className="tw:flex tw:flex-col tw:gap-3.5">
          <Sec t={`Pedido #${p.num} · ${donde(p)}`}>
            <div className="tw:flex tw:flex-col">{p.lineas.map((l) => <Ln key={l.orden} a={<span className="tw:text-tx">{txt(l)}</span>} b={<b>{$(l.unit * l.cant)}</b>} />)}</div>
            <div className="tw:flex tw:flex-col tw:border-t tw:border-bd tw:pt-1.5">
              <Ln a="Subtotal sin IVA" b={$(sub)} />
              <Ln a={`IVA ${iva} %`} b={$(p.total - sub)} />
              {propina > 0 && <Ln a={`Propina ${pct} %`} b={$(propina)} />}
              <Ln gt a="Total a pagar" b={$(T)} />
            </div>
          </Sec>
          <Sec t="Documento">
            <Seg opciones={DOCS} valor={doc.tipo} onChange={(t) => setDoc({ ...doc, tipo: t })} />
            {ccf && (
              <div className="tw:grid tw:gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <Campo l="Nombre o razón social"><Form.Control value={doc.fis.nombre} onChange={(e) => setDoc({ ...doc, fis: { ...doc.fis, nombre: e.target.value } })} /></Campo>
                <Campo l="NIT (0000-000000-000-0)"><Form.Control placeholder="0614-010190-101-3" inputMode="numeric" value={doc.fis.nit} onChange={(e) => setDoc({ ...doc, fis: { ...doc.fis, nit: e.target.value } })} /></Campo>
                <Campo l="NRC (000000-0)"><Form.Control placeholder="123456-7" inputMode="numeric" value={doc.fis.nrc} onChange={(e) => setDoc({ ...doc, fis: { ...doc.fis, nrc: e.target.value } })} /></Campo>
              </div>
            )}
          </Sec>
          <Sec t="Propina (opcional)">
            <Seg opciones={[[0, 'Sin propina'], [5, '5 %'], [10, '10 %'], [15, '15 %']]} valor={pct} onChange={setPct} min={110} />
          </Sec>
          <Err>{er}</Err>
          <Btn v="p" big onClick={() => { const e = validarDoc(); setEr(e); if (!e) setPago(true); }}>Cobrar {$(T)}</Btn>
          <Mut>Al tocar «Cobrar» eliges el método de pago: efectivo, tarjeta o Bitcoin.</Mut>
        </div>,
      )}
      {pago && <Pago p={p} total={T} doc={doc} pct={pct} onHide={() => setPago(false)}
        onCobrado={(v) => { setPago(false); setPct(0); setSel(null); setEmitido(v); recargar(); }} />}
      {modalEmitido}
    </>
  );
}
