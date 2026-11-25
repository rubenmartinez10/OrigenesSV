import { useState } from 'react';
import { Form } from 'react-bootstrap';
import { api } from '../../lib/api.js';
import { $, fFecha } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Avatar, Btn, Cargando, Chip, Stack, Tabla, Vacio } from '../../components/ui.jsx';
import { DetalleFactura, Proveedores } from '../../components/Franquicia.jsx';

/* Recursos Humanos · proveedores y facturas: registra proveedores y archiva las facturas que envían */
const F = { prov: '' };

function Facturas({ vista }) {
  const { confirmar, accion } = useDialogos();
  const [f, setFS] = useState(F);
  const { datos } = useDatos(`/rrhh/facturas?vista=${vista}${f.prov ? `&prov=${f.prov}` : ''}`);
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const L = datos.facturas;
  const archivar = async (ids) => {
    if (ids.length > 1 && !(await confirmar({ titulo: `Archivar ${ids.length} facturas`, texto: 'Quedan en el archivo con tu nombre y la fecha.', verbo: 'Archivar' }))) return;
    if (await accion(() => api.post('/rrhh/facturas/archivar', { ids }), ids.length > 1 ? `${ids.length} facturas archivadas` : 'Factura archivada')) setVer(null);
  };
  const pend = vista === 'pend';
  return (
    <Stack>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Form.Select value={f.prov} onChange={(e) => { F.prov = e.target.value; setFS({ ...F }); }} className="tw:max-w-[260px]" aria-label="Proveedor">
          <option value="">Todos los proveedores</option>{datos.proveedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
        </Form.Select>
        <span className="tw:flex-1" />
        {pend && L.length > 1 && <Btn v="p" onClick={() => archivar(L.map((x) => x.id))}>Archivar las {L.length}</Btn>}
      </div>
      {L.length ? <Tabla cols={['N.º', 'Proveedor', 'Sucursal', 'Emitida', 'Monto', 'Pago', pend ? '' : 'Archivada por']} filas={L.map((x) => ({
        onClick: () => setVer(x.id),
        celdas: [x.num, <span className="tw:flex tw:items-center tw:gap-2"><Avatar u={{ id: `p${x.prov}`, nombre: x.provNombre, foto: x.provFoto }} size={28} />{x.provNombre}</span>,
          x.sucNombre, fFecha(x.emitida), $(x.monto), <Chip t={x.estado === 'Pagada' ? 'Pagada' : x.estado === 'Anulada' ? 'Anulada' : 'Pendiente'} o={x.estado === 'Pagada' ? 'ok' : x.estado === 'Anulada' ? 'g' : 'wa'} />,
          pend ? <Btn v="p" onClick={(e) => { e.stopPropagation(); archivar([x.id]); }}>Archivar</Btn> : `${x.archivo.por} · ${fFecha(x.archivo.fecha)}`],
      }))} /> : <Vacio ic="file">{pend ? 'No hay facturas por archivar' : 'Aún no hay facturas archivadas'}</Vacio>}
      {ver && <DetalleFactura id={ver} onHide={() => setVer(null)} pie={pend ? () => [<Btn key="a" v="p" onClick={() => archivar([ver])}>Archivar factura</Btn>] : undefined} />}
    </Stack>
  );
}

export default function ProveedoresRRHH({ tab = 'lista' }) {
  if (tab === 'porarchivar') return <Facturas vista="pend" />;
  if (tab === 'archivo') return <Facturas vista="arch" />;
  return <Proveedores />;
}
