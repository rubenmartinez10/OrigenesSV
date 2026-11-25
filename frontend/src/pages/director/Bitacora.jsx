import { useEffect, useState } from 'react';
import { Form } from 'react-bootstrap';
import { fmt } from '../../lib/formato.js';
import { useDatos } from '../../context/Sesion.jsx';
import { Btn, Cargando, Chip, Kv, Mut, Panel, Stack, Tabla, Vacio } from '../../components/ui.jsx';

/* Director · 8.6 Bitácora (solo lectura): toda acción queda registrada con usuario, fecha y motivo */
const S = { q: '', rol: '', suc: '', n: 10 };
const j = (o) => (o == null ? '—' : typeof o === 'object' ? JSON.stringify(o) : String(o));

export default function Bitacora() {
  const [f, setFS] = useState(S);
  const setF = (x) => { Object.assign(S, x); setFS({ ...S }); };
  const [q, setQ] = useState(f.q);
  useEffect(() => { const t = setTimeout(() => { if (q !== S.q) setF({ q, n: 10 }); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const { datos } = useDatos(`/director/bitacora?n=${f.n}&q=${encodeURIComponent(f.q)}&rol=${f.rol}&suc=${f.suc}`);
  const [ver, setVer] = useState(null);
  if (!datos) return <Cargando />;
  const b = ver && datos.registros.find((x) => x.id === ver);
  return (
    <Stack>
      <Mut>Solo lectura · {datos.total} registros</Mut>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Form.Control type="search" placeholder="Buscar acción, elemento, usuario o motivo" value={q} onChange={(e) => setQ(e.target.value)} className="tw:max-w-[320px]" aria-label="Buscar" />
        <Form.Select value={f.rol} onChange={(e) => setF({ rol: e.target.value, n: 10 })} className="tw:max-w-[210px]" aria-label="Rol">
          <option value="">Todos los roles</option>{datos.roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}<option value="sistema">Sistema</option>
        </Form.Select>
        <Form.Select value={f.suc} onChange={(e) => setF({ suc: e.target.value, n: 10 })} className="tw:max-w-[200px]" aria-label="Sucursal">
          <option value="">Todas las sucursales</option>{datos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Form.Select>
      </div>
      {datos.registros.length ? <Tabla cols={['Fecha', 'Usuario', 'Acción', 'Elemento', 'Sucursal']} filas={datos.registros.map((x) => ({
        onClick: () => setVer(x.id), celdas: [fmt(x.fecha), x.usuario, <span>{x.accion}{x.clave && <> <Chip t="Con clave" o="in" sinSimbolo /></>}</span>, x.elemento || '—', x.sucNombre || '—'],
      }))} /> : <Vacio ic="list">Sin registros</Vacio>}
      {datos.total > f.n && <div><Btn onClick={() => setF({ n: f.n + 10 })}>Mostrar 10 más</Btn></div>}
      {b && (
        <Panel show onHide={() => setVer(null)} titulo={b.accion} ro>
          <Kv pares={[['Fecha', fmt(b.fecha)], ['Usuario', b.usuario], ['Rol', b.rolNombre || '—'], ['Sucursal', b.sucNombre || '—'], ['Elemento', b.elemento || '—'],
            ['Motivo', b.motivo || '—'], ['Antes', j(b.antes)], ['Después', j(b.despues)], ['Con clave', b.clave ? 'Sí' : 'No']]} />
        </Panel>
      )}
    </Stack>
  );
}
