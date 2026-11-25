import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, configurarApi } from '../lib/api.js';
import { sonar, URGENTE } from '../lib/sonido.js';

/*
 * Estado global de la sesión:
 *  - usuario y configuración del negocio
 *  - reloj simulado (desfase contra la hora del navegador)
 *  - «version»: sube después de cada cambio para que las pantallas vuelvan a pedir sus datos
 *  - pendientes (campana y contadores del menú), con sonido cuando llega algo nuevo
 */
const Ctx = createContext(null);

export function SesionProvider({ children }) {
  const [usuario, setUsuario] = useState(undefined); // undefined = cargando · null = sin sesión
  const [config, setConfig] = useState(null);
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [pend, setPend] = useState({ menu: {}, tabs: {}, ultima: null });
  const navigate = useNavigate();
  const ultimo = useRef(null);
  const rolRef = useRef(null);
  rolRef.current = usuario?.rol;

  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  const sincronizar = useCallback((t) => setOffset(t - Date.now()), []);

  useEffect(() => {
    configurarApi({
      cerrarSesion: () => setUsuario(null),
      exigirPerfil: () => rolRef.current && navigate(`/${rolRef.current}/perfil`),
    });
  }, [navigate]);

  const entrar = useCallback((r) => { setUsuario(r.usuario); setConfig(r.config); ultimo.current = null; }, []);
  const salir = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setUsuario(null);
    navigate('/');
  }, [navigate]);
  const actualizarUsuario = useCallback((u) => setUsuario(u), []);

  // sesión guardada (cookie) y hora simulada
  useEffect(() => {
    api.get('/auth/yo').then(entrar).catch(() => setUsuario(null));
  }, [entrar]);
  useEffect(() => {
    const leer = () => api.get('/reloj').then((r) => sincronizar(r.ahora)).catch(() => {});
    leer();
    const id = setInterval(leer, 30_000);
    return () => clearInterval(id);
  }, [sincronizar]);

  // pendientes: cada 5 s y después de cada cambio
  useEffect(() => {
    if (!usuario) return undefined;
    let vivo = true;
    const leer = async () => {
      try {
        const p = await api.get('/pendientes');
        if (!vivo) return;
        const total = Object.values(p.menu).concat(Object.values(p.tabs)).reduce((a, n) => a + n, 0);
        const antes = ultimo.current;
        if (antes) {
          if (p.ultima && p.ultima.id > (antes.id || 0)) sonar(URGENTE.test(`${p.ultima.titulo} ${p.ultima.detalle}`) ? 'urgente' : 'alerta');
          else if (total > antes.total) sonar('alerta');
          if ((p.ultima?.id || 0) !== (antes.id || 0) || total !== antes.total) setVersion((v) => v + 1);
        }
        ultimo.current = { id: p.ultima?.id || 0, total };
        setPend(p);
        sincronizar(p.ahora);
      } catch { /* sin conexión: se reintenta */ }
    };
    leer();
    const id = setInterval(leer, 5000);
    return () => { vivo = false; clearInterval(id); };
  }, [usuario, version, sincronizar]);

  const valor = useMemo(() => ({
    usuario, config, offset, version, pend, recargar, sincronizar, entrar, salir, actualizarUsuario,
  }), [usuario, config, offset, version, pend, recargar, sincronizar, entrar, salir, actualizarUsuario]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useSesion = () => useContext(Ctx);

/** Hora simulada que se actualiza sola (por defecto cada segundo). */
export function useAhora(cada = 1000) {
  const { offset } = useSesion();
  const [t, setT] = useState(() => Date.now() + offset);
  useEffect(() => {
    setT(Date.now() + offset);
    const id = setInterval(() => setT(Date.now() + offset), cada);
    return () => clearInterval(id);
  }, [offset, cada]);
  return t;
}

/** Pide datos a la API y los vuelve a pedir después de cada cambio (y cada «cada» ms si se indica). */
export function useDatos(url, { cada } = {}) {
  const { version } = useSesion();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return undefined;
    let vivo = true;
    api.get(url)
      .then((d) => { if (vivo) { setDatos(d); setError(null); } })
      .catch((e) => { if (vivo) setError(e); });
    return () => { vivo = false; };
  }, [url, version, tick]);
  useEffect(() => {
    if (!cada) return undefined;
    const id = setInterval(() => setTick((x) => x + 1), cada);
    return () => clearInterval(id);
  }, [cada]);
  return { datos, error, recargar: () => setTick((x) => x + 1) };
}
