import { useState, forwardRef } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Dropdown, Offcanvas } from 'react-bootstrap';
import { useSesion, useAhora } from '../context/Sesion.jsx';
import { useDialogos } from '../context/Dialogos.jsx';
import { ROLES, pendientesDe } from '../roles.js';
import { saludo } from '../lib/formato.js';
import { sonidoActivo, alternarSonido, sonar } from '../lib/sonido.js';
import { Icono } from './Icono.jsx';
import { Avatar } from './ui.jsx';
import { RelojChip } from './RelojChip.jsx';

const SLOGAN = 'Puchica, qué buen sabor';
const Badge = ({ n, className = '' }) => (n ? (
  <b className={`tw:min-w-5 tw:h-5 tw:px-1.5 tw:rounded-full tw:bg-er tw:text-white tw:text-[11px] tw:font-bold tw:inline-grid tw:place-items-center ${className}`}>{n > 99 ? '99+' : n}</b>
) : null);

/* ---------- menú lateral ---------- */
function Sidebar({ rol, activo }) {
  const { usuario, pend } = useSesion();
  const R = ROLES[rol];
  const [col, setCol] = useState(() => { try { return localStorage.getItem('osv_col') === '1'; } catch { return false; } });
  const alternar = () => { setCol(!col); try { localStorage.setItem('osv_col', col ? '0' : '1'); } catch { /* sin almacenamiento */ } };
  const donde = usuario.sucursalNombre || 'Toda la franquicia';
  const ancho = col ? 'tw:xl:w-[72px]' : 'tw:xl:w-[248px]';
  const ocultarTexto = col ? 'tw:hidden' : 'tw:hidden tw:xl:inline';
  return (
    <nav aria-label="Menú principal"
      className={`osv-side no-print tw:fixed tw:z-20 tw:bottom-3 tw:left-3 tw:right-3 tw:h-[68px] tw:rounded-[30px] tw:shadow-osv2 tw:flex tw:flex-row tw:gap-0.5 tw:px-2 tw:py-1.5 tw:overflow-x-auto
        tw:md:sticky tw:md:top-0 tw:md:bottom-auto tw:md:left-auto tw:md:right-auto tw:md:h-screen tw:md:w-[72px] ${ancho} tw:md:shrink-0 tw:md:flex-col tw:md:rounded-none tw:md:rounded-r-[28px] tw:md:px-3 tw:md:py-3.5 tw:md:overflow-hidden tw:md:shadow-[0_0_24px_rgba(15,50,120,.10)]`}>
      <button type="button" onClick={alternar} aria-label={col ? 'Expandir menú' : 'Contraer menú'}
        className="tw:hidden tw:xl:grid tw:place-items-center tw:w-9 tw:h-8 tw:rounded-lg tw:text-tx2 tw:hover:bg-brs">
        <Icono n="menu" />
      </button>
      <div className="tw:hidden tw:md:flex tw:items-center tw:gap-2.5 tw:px-1.5 tw:pt-1 tw:pb-3.5">
        <img src="/assets/personaje-azul.png" alt="Orígenes SV" className="tw:w-[46px] tw:h-auto" />
        <div className={`${ocultarTexto} tw:leading-tight`}>
          <b className="tw:block tw:text-br tw:text-[19px] tw:font-extrabold tw:tracking-tight">Orígenes SV</b>
          <small className="tw:text-tx2 tw:text-[11px]">{SLOGAN}</small>
        </div>
      </div>
      {R.menu.map((it) => {
        const on = it.id === activo;
        const n = pend.menu[it.id] || 0;
        return (
          <Link key={it.id} to={`/${rol}/${it.id}`} title={it.label} aria-current={on ? 'page' : undefined}
            className={`tw:relative tw:z-[1] tw:flex tw:flex-col tw:md:flex-row tw:items-center tw:justify-center tw:xl:justify-start tw:gap-0.5 tw:md:gap-3 tw:min-w-16 tw:md:min-w-0 tw:rounded-[22px] tw:md:rounded-[14px] tw:px-2 tw:md:px-3 tw:py-1.5 tw:md:py-2.5 tw:text-[11px] tw:md:text-sm tw:no-underline
              ${on ? 'tw:bg-br tw:text-white tw:md:bg-white tw:md:text-br tw:font-bold tw:md:shadow-[0_2px_10px_rgba(15,77,184,.14),inset_4px_0_0_#0F4DB8]' : 'tw:text-tx tw:font-medium tw:hover:bg-br/7'}`}>
            <Icono n={it.ic} size={21} />
            <span className={`tw:md:hidden tw:whitespace-nowrap tw:max-w-20 tw:overflow-hidden tw:text-ellipsis`}>{it.label}</span>
            <span className={ocultarTexto}>{it.label}</span>
            {n > 0 && <Badge n={n} className={`tw:absolute tw:top-0.5 tw:right-1 tw:md:static tw:md:ml-auto ${col ? 'tw:xl:absolute' : ''}`} />}
          </Link>
        );
      })}
      <div className="osv-sfondo tw:hidden tw:md:block tw:flex-1 tw:min-h-[120px] tw:-mx-3 tw:-mb-1.5 tw:mt-1.5 tw:opacity-95 tw:pointer-events-none" />
      <div className={`tw:hidden ${col ? '' : 'tw:xl:flex'} tw:absolute tw:left-3 tw:right-3 tw:bottom-3 tw:z-[2] tw:items-center tw:gap-2 tw:bg-white tw:border tw:border-bd tw:rounded-2xl tw:shadow-osv tw:px-3 tw:py-2.5`}>
        <div className="tw:flex-1 tw:min-w-0">
          <b className="tw:block tw:truncate tw:text-[13.5px]">{usuario.nombre}</b>
          <small className="tw:block tw:truncate tw:text-tx2 tw:text-[11.5px]">{usuario.rolNombre} · {donde}</small>
        </div>
        <Icono n="chev" size={18} className="tw:text-tx2" />
      </div>
    </nav>
  );
}

/* ---------- campana de pendientes ---------- */
function Campana({ rol }) {
  const { pend } = useSesion();
  const [abierta, setAbierta] = useState(false);
  const items = pendientesDe(rol, pend);
  const total = items.reduce((a, x) => a + x.n, 0);
  return (
    <>
      <button type="button" onClick={() => setAbierta(true)} aria-label={`Pendientes: ${total}`}
        className="tw:relative tw:w-[38px] tw:h-[38px] tw:grid tw:place-items-center tw:rounded-full tw:text-white tw:hover:bg-white/10">
        <Icono n="bell" />
        {total > 0 && <Badge n={total} className="osv-ping tw:absolute tw:-top-0.5 tw:-right-0.5 tw:shadow-[0_0_0_2px_#1747B8]" />}
      </button>
      <Offcanvas show={abierta} onHide={() => setAbierta(false)} placement="end">
        <Offcanvas.Header closeButton><Offcanvas.Title>Pendientes</Offcanvas.Title></Offcanvas.Header>
        <Offcanvas.Body>
          {items.length ? (
            <>
              <p className="tw:text-tx2 tw:m-0">{total} {total === 1 ? 'cosa por hacer' : 'cosas por hacer'}</p>
              <div className="tw:flex tw:flex-col tw:gap-2.5">
                {items.map((x) => (
                  <Link key={x.href} to={x.href} onClick={() => setAbierta(false)}
                    className="tw:flex tw:items-center tw:gap-3 tw:px-3.5 tw:py-3 tw:border tw:border-bd tw:rounded-[18px] tw:bg-sf tw:text-tx tw:no-underline tw:hover:border-br">
                    <span className="tw:w-10 tw:h-10 tw:rounded-[13px] tw:grid tw:place-items-center tw:bg-brs tw:text-br"><Icono n={x.ic || 'check'} /></span>
                    <span className="tw:flex-1 tw:flex tw:flex-col"><b>{x.txt}</b>{x.sub && <small className="tw:text-tx2">{x.sub}</small>}</span>
                    <Badge n={x.n} />
                    <Icono n="chev" size={18} className="tw:text-tx2" />
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <div className="tw:grid tw:place-items-center tw:gap-2 tw:py-11 tw:text-center">
              <span className="tw:w-[68px] tw:h-[68px] tw:rounded-full tw:bg-brs tw:text-ok tw:grid tw:place-items-center"><Icono n="check" size={30} /></span>
              <b>Estás al día</b><small className="tw:text-tx2">No tienes nada pendiente.</small>
            </div>
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}

/* ---------- menú del usuario (avatar) ---------- */
const AvatarBoton = forwardRef(({ onClick, u }, ref) => (
  <button ref={ref} type="button" onClick={onClick} aria-label="Menú de usuario"
    className="tw:w-[38px] tw:h-[38px] tw:rounded-full tw:border-2 tw:border-white/60 tw:bg-celeste tw:overflow-hidden tw:p-0">
    <Avatar u={u} size={34} />
  </button>
));

function MenuUsuario({ rol }) {
  const { usuario, salir } = useSesion();
  const { toast } = useDialogos();
  const navigate = useNavigate();
  const [snd, setSnd] = useState(sonidoActivo());
  return (
    <Dropdown align="end">
      <Dropdown.Toggle as={AvatarBoton} u={usuario} />
      <Dropdown.Menu>
        <div className="tw:px-3 tw:py-2"><b>{usuario.nombre}</b><br /><small className="tw:text-tx2">{usuario.rolNombre} · {usuario.sucursalNombre || 'Toda la franquicia'}</small></div>
        <Dropdown.Divider />
        <Dropdown.Item onClick={() => navigate(`/${rol}/perfil`)}>Mi perfil</Dropdown.Item>
        <Dropdown.Item onClick={() => { alternarSonido(); setSnd(sonidoActivo()); sonar('ok'); toast(sonidoActivo() ? 'Sonidos activados' : 'Sonidos apagados'); }}>
          {snd ? 'Sonido: activado' : 'Sonido: apagado'}
        </Dropdown.Item>
        <Dropdown.Item onClick={salir}>Cerrar sesión</Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
}

/* ---------- bienvenida en la primera pantalla del rol ---------- */
function Hero() {
  const { usuario } = useSesion();
  const ahora = useAhora(60_000);
  return (
    <div className="osv-hero tw:relative tw:overflow-hidden tw:rounded-[26px] tw:px-7 tw:py-5 tw:mb-4 tw:min-h-[104px] tw:text-white tw:flex tw:items-center tw:gap-4 tw:shadow-osv">
      <div>
        <h2 className="tw:text-white tw:text-xl tw:md:text-[26px] tw:font-extrabold tw:italic tw:m-0 tw:tracking-tight">¡{SLOGAN}!</h2>
        <p className="tw:m-0 tw:mt-1 tw:text-[#DDE9FF] tw:italic">
          {saludo(ahora)}, {usuario.nombre.split(' ')[0]}. ¿Qué se antoja hoy? · {usuario.rolNombre} · {usuario.sucursalNombre || 'toda la franquicia'}
        </p>
      </div>
      <img src="/assets/personaje-blanco.png" alt="" className="tw:hidden tw:md:block tw:w-[74px] tw:h-auto tw:ml-auto" />
    </div>
  );
}

/* ---------- armazón de cada pantalla ---------- */
export function Shell({ rol, item, tab, titulo, accion, children }) {
  const R = ROLES[rol];
  const { pend } = useSesion();
  const esInicio = item.id === R.entra;
  return (
    <div className="tw:flex tw:min-h-screen">
      <Sidebar rol={rol} activo={item.id} />
      <div className="tw:flex-1 tw:min-w-0">
        <header className="osv-top no-print tw:sticky tw:top-0 tw:z-10 tw:h-[60px] tw:flex tw:items-center tw:gap-2 tw:px-3 tw:md:px-[26px] tw:rounded-bl-[22px] tw:md:rounded-bl-[30px] tw:shadow-[0_6px_18px_rgba(10,47,143,.25)] tw:text-white">
          <span className="tw:font-bold tw:text-[17px] tw:truncate">{item.label}{tab ? ` › ${tab.label}` : ''}</span>
          <span className="tw:flex-1" />
          <RelojChip />
          <Campana rol={rol} />
          <MenuUsuario rol={rol} />
        </header>
        <main className="tw:max-w-[1440px] tw:mx-auto tw:px-3 tw:md:px-7 tw:pt-[18px] tw:pb-28 tw:md:pb-9">
          {esInicio && <Hero />}
          <div className="tw:flex tw:items-center tw:gap-3.5 tw:mb-3.5">
            <h1 className="tw:flex tw:items-center tw:gap-3 tw:text-[19px] tw:md:text-[23px] tw:font-bold tw:m-0">
              <span className="tw:grid tw:place-items-center tw:w-[42px] tw:h-[42px] tw:rounded-full tw:bg-brs tw:text-br"><Icono n={item.ic || 'user'} size={22} /></span>
              {titulo || item.titulo}
            </h1>
            <i className="osv-hl tw:flex-1 tw:h-px" />
            {accion}
          </div>
          {item.tabs && (
            <nav className="osv-tabs tw:inline-flex tw:max-w-full tw:overflow-x-auto tw:gap-1 tw:p-1 tw:bg-[#DFEAFA] tw:rounded-full tw:mb-3.5" aria-label="Pestañas">
              {item.tabs.map((t) => {
                const n = pend.tabs[`${item.id}/${t.id}`] || 0;
                return (
                  <NavLink key={t.id} to={`/${rol}/${item.id}/${t.id}`}
                    className={() => `tw:inline-flex tw:items-center tw:gap-2 tw:rounded-full tw:px-4 tw:py-[7px] tw:text-[13.5px] tw:font-semibold tw:whitespace-nowrap tw:no-underline ${t.id === tab?.id ? 'tw:bg-br tw:text-white tw:shadow-[0_2px_8px_rgba(15,77,184,.35)]' : 'tw:text-tx2 tw:hover:text-tx'}`}>
                    {t.label}{n > 0 && <Badge n={n} />}
                  </NavLink>
                );
              })}
            </nav>
          )}
          <section>{children}</section>
        </main>
      </div>
    </div>
  );
}

/* ---------- marca grande (entrada) ---------- */
export const MarcaGrande = () => <img src="/assets/logo-azul.png" alt="Orígenes SV · ¡Puchica, qué buen sabor!" className="tw:w-[min(470px,100%)] tw:h-auto" />;
