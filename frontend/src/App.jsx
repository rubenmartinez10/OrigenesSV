import { Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useSesion } from './context/Sesion.jsx';
import { ROLES } from './roles.js';
import { PAGINAS } from './pages/index.js';
import { Shell } from './components/Layout.jsx';
import { Cargando } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Perfil from './pages/Perfil.jsx';

const PERFIL = { id: 'perfil', label: 'Perfil', ic: 'user', titulo: 'Mi perfil' };

/** Pantalla de un rol: valida el rol, la entrada del menú y la pestaña; con contraseña temporal solo deja ir a Perfil. */
function Pantalla({ perfil }) {
  const { usuario } = useSesion();
  const { rol, item: itemId, tab: tabId } = useParams();
  const R = ROLES[usuario.rol];
  if (rol !== usuario.rol) return <Navigate to={`/${usuario.rol}/${R.entra}`} replace />;
  if ((usuario.cambiarPass || usuario.cambiarPin) && !perfil) return <Navigate to={`/${rol}/perfil`} replace />;
  if (perfil) return <Shell rol={rol} item={PERFIL}><Perfil /></Shell>;
  const item = R.menu.find((m) => m.id === itemId);
  if (!item) return <Navigate to={`/${rol}/${R.entra}`} replace />;
  const tab = item.tabs ? item.tabs.find((t) => t.id === tabId) || item.tabs[0] : null;
  const Comp = PAGINAS[`${rol}/${item.id}`];
  if (!Comp) return <Navigate to={`/${rol}/${R.entra}`} replace />;
  return <Shell rol={rol} item={item} tab={tab}><Suspense fallback={<Cargando />}><Comp tab={tab?.id} key={`${item.id}/${tab?.id}`} /></Suspense></Shell>;
}

/** Pantalla de carga con la marca (una vez por sesión del navegador). */
function Splash() {
  const [ver, setVer] = useState(() => { try { return !sessionStorage.getItem('osv_splash'); } catch { return false; } });
  useEffect(() => {
    if (!ver) return undefined;
    try { sessionStorage.setItem('osv_splash', '1'); } catch { /* sin almacenamiento */ }
    const t = setTimeout(() => setVer(false), 3300);
    return () => clearTimeout(t);
  }, [ver]);
  if (!ver) return null;
  return (
    <div className="osv-splash osv-hero tw:fixed tw:inset-0 tw:z-[3000] tw:grid tw:place-items-center tw:content-center tw:gap-3.5 tw:pointer-events-none" aria-hidden="true">
      <img src="/assets/personaje-blanco.png" alt="" className="osv-pj tw:w-[150px]" />
      <b className="tw:text-white tw:text-[32px] tw:font-extrabold tw:tracking-tight">Orígenes SV</b>
      <small className="tw:text-[#DCE9FB] tw:italic tw:text-[17px] tw:-mt-2">¡Puchica, qué buen sabor!</small>
      <div className="tw:mt-6 tw:flex tw:flex-col tw:items-center tw:gap-2.5 tw:text-white tw:font-semibold">
        <span>Cargando…</span>
        <div className="tw:w-[220px] tw:h-1.5 tw:rounded-full tw:bg-white/30 tw:overflow-hidden"><i className="osv-barra tw:block tw:h-full tw:w-full tw:rounded-full tw:bg-white" /></div>
      </div>
    </div>
  );
}

export default function App() {
  const { usuario } = useSesion();
  return (
    <>
      <Splash />
      {usuario === undefined ? <Cargando /> : !usuario ? <Login /> : (
        <Routes>
          <Route path="/:rol/perfil" element={<Pantalla perfil />} />
          <Route path="/:rol/:item/:tab?" element={<Pantalla />} />
          <Route path="*" element={<Navigate to={usuario.cambiarPass || usuario.cambiarPin ? `/${usuario.rol}/perfil` : `/${usuario.rol}/${usuario.entra}`} replace />} />
        </Routes>
      )}
    </>
  );
}
