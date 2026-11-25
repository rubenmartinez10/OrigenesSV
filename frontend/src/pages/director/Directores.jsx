import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { fFecha } from '../../lib/formato.js';
import { useDatos, useSesion } from '../../context/Sesion.jsx';
import { useDialogos } from '../../context/Dialogos.jsx';
import { Avatar, Btn, Cargando, Mut, Stack, Tabla } from '../../components/ui.jsx';
import { Credenciales } from '../../components/Franquicia.jsx';
import { Personal } from './Franquicia.jsx';

/* Director · 8.4 Directores: quién dirige la franquicia, dejar el cargo y promover a un gerente general */
export default function Directores() {
  const navigate = useNavigate();
  const { actualizarUsuario } = useSesion();
  const { confirmar, accion } = useDialogos();
  const { datos } = useDatos('/director/directores');
  const [cred, setCred] = useState(null);
  if (!datos) return <Cargando />;
  const n = datos.directores.length;
  const dejar = async () => {
    if (!(await confirmar({ titulo: 'Dejar el cargo de director', texto: 'Pasas a ser gerente general. Debe haber otro director activo.', verbo: 'Confirmar', rojo: true }))) return;
    const r = await accion(() => api.post('/director/directores/dejar'), 'Ahora eres gerente general');
    if (!r) return;
    if (r.clave) setCred([['Clave de aprobaciones', r.clave]]);
    else { actualizarUsuario((await api.get('/auth/yo')).usuario); navigate('/gg/panel'); }
  };
  const cerrarCred = async () => { setCred(null); actualizarUsuario((await api.get('/auth/yo')).usuario); navigate('/gg/panel'); };
  return (
    <Stack>
      <h4 className="tw:text-[15px] tw:m-0">Directores activos</h4>
      <Tabla cols={['Nombre', 'Usuario', 'Desde', '']} filas={datos.directores.map((d) => [
        <span className="tw:flex tw:items-center tw:gap-2"><Avatar u={d} size={30} />{d.nombre}</span>, d.usuario, fFecha(d.ingreso),
        d.id !== datos.yo ? <Mut>Solo esa persona puede dejar su cargo</Mut> : n > 1 ? <Btn onClick={dejar}>Dejar el cargo</Btn> : <Mut>Único director</Mut>,
      ])} />
      <h4 className="tw:text-[15px] tw:m-0">Todo el personal</h4>
      <Mut>
        Toca a una persona para ascenderla, cambiar su rol o despedirla. Para llegar a director primero debe ser gerente general
        {datos.gg < 2 ? ' · Ahora hay un solo gerente general: para promoverlo debe existir otro, el puesto nunca puede quedar vacío' : ''}.
      </Mut>
      <Personal />
      <Credenciales titulo="Tu clave de aprobaciones como gerente general" filas={cred} onHide={cerrarCred} />
    </Stack>
  );
}
