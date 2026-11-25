import { api } from '../../lib/api.js';
import { fm, fmt } from '../../lib/formato.js';
import { nom } from '../../lib/pedidos.js';
import { useDatos, useSesion, useAhora } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Btn, Cargando, Chip, Grid, Kpi, CirculoIcono } from '../../components/ui.jsx';

/** Mesas: quién ocupa cada una y cuánto lleva comiendo (después de 30 min se le puede pedir que desocupe). */
export default function Mesas() {
  const { config } = useSesion();
  const { confirmar, accion } = useDialogos();
  const ahora = useAhora();
  const { datos } = useDatos('/mesero/mesas', { cada: 5000 });
  if (!datos) return <Cargando />;
  const LIM = (config?.minutosMesa ?? 30) * 60;
  const oc = Object.fromEntries(datos.ocupadas.map((p) => [p.mesa, p]));
  const n = datos.total;
  const libres = n - datos.ocupadas.length;

  const pedir = async (p) => {
    if (await confirmar({ titulo: `¿Pedir a ${p.ref || 'el cliente'} que desocupe la mesa ${p.mesa}?`, texto: `Ya lleva más de ${LIM / 60} minutos comiendo. Se registra la hora en que se le pidió.`, verbo: 'Pedir que se desocupe' })) {
      accion(() => api.post(`/mesero/mesas/${p.id}/pedir-salida`));
    }
  };
  const liberar = async (p) => {
    if (p.estado !== 'Cobrado') return accion(async () => { throw new Error(`Cobra el pedido #${p.num} antes de liberar la mesa`); });
    if (await confirmar({ titulo: '¿Ya se fueron?', texto: `La mesa ${p.mesa} queda libre y puede recibir otro pedido.`, verbo: 'Sí, liberar mesa' })) {
      accion(() => api.post(`/mesero/mesas/${p.id}/liberar`), `Mesa ${p.mesa} libre`);
    }
  };

  const tarjeta = (m) => {
    const p = oc[m];
    if (!p) {
      return (
        <div key={m} className="tw:relative tw:overflow-hidden tw:grid tw:grid-cols-[40px_1fr_auto] tw:items-center tw:gap-3 tw:bg-sf tw:border tw:border-bd tw:rounded-[20px] tw:shadow-osv tw:px-4 tw:py-3.5">
          <span className="tw:absolute tw:left-0 tw:inset-y-0 tw:w-[5px] tw:bg-ok" />
          <CirculoIcono ic="check" tono="ok" className="tw:w-10 tw:h-10 tw:rounded-full" />
          <b className="tw:text-[15px]">Mesa {m}</b>
          <Chip t="Libre" o="ok" />
        </div>
      );
    }
    const t = p.entregado ? Math.max(0, (ahora - p.entregado) / 1000) : null;
    const pasa = t != null && t >= LIM;
    const falta = t != null && !pasa ? Math.ceil((LIM - t) / 60) : 0;
    const tono = t == null ? 'g' : pasa ? 'er' : 'wa';
    return (
      <div key={m} className="tw:relative tw:overflow-hidden tw:flex tw:flex-col tw:gap-2 tw:bg-sf tw:border tw:border-bd tw:rounded-[20px] tw:shadow-osv tw:px-4 tw:py-3.5">
        <span className={`tw:absolute tw:left-0 tw:inset-y-0 tw:w-[5px] ${{ g: 'tw:bg-[#9FB0C8]', er: 'tw:bg-er', wa: 'tw:bg-[#E0A42E]' }[tono]}`} />
        <div className="tw:flex tw:items-center tw:gap-2">
          <b className="tw:text-[15px]">Mesa {m}</b>
          <span className="tw:flex-1" />
          <Chip t={t == null ? 'Sin entregar' : pasa ? `Pasó de ${LIM / 60} min` : 'Comiendo'} o={tono} />
        </div>
        <div><b>{p.ref || 'Cliente'}</b><span className="tw:text-tx2"> · {nom(p)}</span></div>
        {t == null ? <div className="tw:text-tx2">Esperando el platillo · {p.estado}</div>
          : <div>Lleva comiendo {fm(t)} min{pasa ? '' : ` · faltan ${falta} min para poder pedirle que desocupe`}</div>}
        {p.salidaPedida && <small className="tw:text-tx2">Se le pidió desocupar a las {fmt(p.salidaPedida)}</small>}
        {p.estado === 'Entregado' && <small className="tw:text-tx2">Falta cobrar el pedido</small>}
        <div className="tw:flex tw:flex-col tw:gap-1.5 tw:mt-1.5">
          <Btn disabled={!pasa || !!p.salidaPedida} onClick={() => pedir(p)}>{p.salidaPedida ? 'Ya se le pidió' : 'Pedir que desocupe'}</Btn>
          <Btn v="p" disabled={t == null} onClick={() => liberar(p)}>Ya se fueron · liberar</Btn>
        </div>
      </div>
    );
  };

  const ocupadas = Object.keys(oc).map(Number).sort((a, b) => a - b);
  return (
    <div className="tw:flex tw:flex-col tw:gap-3.5">
      <div className="tw:grid tw:gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' }}>
        <Kpi t="Mesas libres" v={`${libres} de ${n}`} ic="users" tono="ok" />
        <Kpi t="Ocupadas" v={String(n - libres)} s={libres ? '' : 'No se reciben pedidos para comer aquí'} ic="users" tono={libres ? 'wa' : 'er'} />
      </div>
      {ocupadas.length > 0 && <h3 className="tw:text-[15px] tw:mt-2 tw:mb-0">Ocupadas</h3>}
      <Grid min={240}>{ocupadas.map(tarjeta)}</Grid>
      <h3 className="tw:text-[15px] tw:mt-2 tw:mb-0">Libres</h3>
      <Grid min={200}>{Array.from({ length: n }, (_, i) => i + 1).filter((m) => !oc[m]).map(tarjeta)}</Grid>
    </div>
  );
}
