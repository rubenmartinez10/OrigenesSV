import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fmt, r2 } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Campo, Card, Cargando, Chip, Err, Kv, Mut, Panel, Stack, Tabla, Vacio } from '../../components/ui.jsx';

/* Gerente de sucursal · 5.8 Pedir a gerencia: cambio de precio (lo aprueba el gerente general) */
function NuevoPrecio({ datos, inicial, onHide }) {
  const { accion } = useDialogos();
  const [P, setP] = useState({ producto: inicial || '', precio: '', motivo: '' });
  const [er, setEr] = useState('');
  const x = datos.productos.find((p) => p.id === +P.producto);
  const neto = +P.precio > 0 ? r2(+P.precio / (1 + datos.iva / 100)) : null;
  const bajo = x && neto != null && neto < x.costoMax;
  const ok = x && +P.precio > 0 && +P.precio !== x.precio && P.motivo.trim().length >= 10 && !bajo;
  const enviar = async () => {
    try {
      await api.post('/gerente/precios', { producto: x.id, precio: +P.precio, motivo: P.motivo });
      accion(async () => {}, 'Enviada al gerente general');
      onHide();
    } catch (e) { setEr(e.message); }
  };
  return (
    <Panel show onHide={onHide} titulo="Cambio de precio" pie={[<Btn key="c" v="t" onClick={onHide}>Cancelar</Btn>, <Btn key="e" v="p" disabled={!ok} onClick={enviar}>Enviar a gerencia general</Btn>]}>
      <Campo l="Producto"><Form.Select value={P.producto} onChange={(e) => setP({ ...P, producto: e.target.value })}>
        <option value="">Elige</option>{datos.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {$(p.precio)}</option>)}
      </Form.Select></Campo>
      <Campo l="Precio propuesto"><Form.Control type="number" min={0} step="0.01" value={P.precio} onChange={(e) => setP({ ...P, precio: e.target.value })} /></Campo>
      <Campo l="Motivo (mín. 10 caracteres)"><Form.Control as="textarea" rows={3} value={P.motivo} onChange={(e) => setP({ ...P, motivo: e.target.value })} /></Campo>
      {x && <Kv pares={[['Costo de producción (materias primas al precio más alto)', $(x.costoMax)], ['Tu precio sin IVA', neto != null ? $(neto) : '—']]} />}
      {bajo && <Err>El precio sin IVA no puede ser menor que el costo de producción ({$(x.costoMax)}).</Err>}
      <Err>{er}</Err>
      <Mut>El precio no cambia hasta que se apruebe.</Mut>
    </Panel>
  );
}

export default function Pedir() {
  const location = useLocation();
  const navigate = useNavigate();
  const { datos } = useDatos('/gerente/precios');
  const [nuevo, setNuevo] = useState(location.state?.prod ? { prod: location.state.prod } : null);
  useEffect(() => { if (location.state?.prod) navigate('.', { replace: true, state: null }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!datos) return <Cargando />;
  const est = (x) => (x.estado === 'Aplicada' ? 'Aprobada' : x.estado);
  return (
    <Stack>
      <Card className="tw:flex tw:flex-col tw:gap-2">
        <h3 className="tw:text-[15px] tw:m-0">Cambio de precio</h3>
        <p className="tw:text-tx2 tw:m-0">Propón un nuevo precio para un producto de tu menú. El precio es único en toda la franquicia y lo aprueba el gerente general.</p>
        <div><Btn v="p" onClick={() => setNuevo({})}>Nueva solicitud</Btn></div>
      </Card>
      <h4 className="tw:text-[15px] tw:m-0">Mis solicitudes</h4>
      {datos.solicitudes.length ? <Tabla cols={['Producto', 'Precio', 'Fecha', 'Estado']} filas={datos.solicitudes.map((x) => [
        x.nombre, `${$(x.datos.precioActual)} → ${$(x.datos.precio)}`, fmt(x.fecha),
        <><Chip t={est(x)} o={x.estado === 'Solicitada' ? 'g' : x.estado === 'Rechazada' ? 'er' : 'ok'} />{x.rechazo && <div className="tw:text-er tw:text-xs">Motivo: {x.rechazo.motivo}</div>}</>,
      ])} /> : <Vacio ic="list">Aún no has enviado solicitudes</Vacio>}
      {nuevo && <NuevoPrecio datos={datos} inicial={nuevo.prod} onHide={() => setNuevo(null)} />}
    </Stack>
  );
}
