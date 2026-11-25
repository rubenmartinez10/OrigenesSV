import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Form } from 'react-bootstrap';
import { api } from '../lib/api.js';
import { useSesion } from '../context/Sesion.jsx';
import { useDialogos } from '../context/Dialogos.jsx';
import { Icono } from '../components/Icono.jsx';
import { Btn, Err } from '../components/ui.jsx';
import { RelojChip } from '../components/RelojChip.jsx';
import { MarcaGrande } from '../components/Layout.jsx';

const Ornamento = () => <div className="osv-orn" aria-hidden="true"><i /><span className="osv-rombo" /><i /></div>;

function CampoLogin({ ic, label, ...props }) {
  return (
    <div className="tw:flex tw:items-center tw:gap-3 tw:mb-3">
      <span className="tw:shrink-0 tw:grid tw:place-items-center tw:w-[46px] tw:h-[46px] tw:rounded-full tw:bg-brs tw:border tw:border-[#CFE0F7] tw:text-br"><Icono n={ic} size={22} /></span>
      <label className="tw:flex-1 tw:flex tw:flex-col tw:gap-[3px] tw:text-sm tw:font-bold tw:text-tx">
        {label}
        <input className="tw:w-full tw:border-[1.5px] tw:border-line tw:rounded-full tw:px-4 tw:py-2.5 tw:min-h-11 tw:bg-white tw:font-normal tw:text-[15px] tw:outline-none tw:focus:border-br tw:focus:ring-4 tw:focus:ring-br/15" {...props} />
      </label>
    </div>
  );
}

/** «¿Olvidaste tu contraseña?»: crea una solicitud para quien la atiende (RN-AUT-01). */
function Olvido({ show, onHide, inicial }) {
  const [us, setUs] = useState(inicial);
  const [msg, setMsg] = useState({});
  useEffect(() => { if (show) { setUs(inicial); setMsg({}); } }, [show, inicial]);
  const enviar = async () => {
    try { setMsg({ ok: (await api.post('/auth/olvido', { usuario: us.trim().toLowerCase() })).ok }); }
    catch (e) { setMsg({ er: e.message }); }
  };
  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Body>
        <h3>¿Olvidaste tu contraseña?</h3>
        <p className="tw:text-tx2 tw:m-0">Escribe tu usuario. Se enviará una solicitud para que te asignen una contraseña temporal.</p>
        <Form.Group><Form.Label>Usuario</Form.Label><Form.Control value={us} onChange={(e) => setUs(e.target.value)} autoComplete="username" autoFocus /></Form.Group>
        <Err>{msg.er}</Err>
        {msg.ok && <div className="tw:text-ok tw:font-semibold">{msg.ok}</div>}
        <div className="tw:flex tw:justify-end tw:gap-2"><Btn v="t" onClick={onHide}>Cerrar</Btn><Btn v="p" onClick={enviar}>Enviar solicitud</Btn></div>
      </Modal.Body>
    </Modal>
  );
}

export default function Login() {
  const { entrar, sincronizar } = useSesion();
  const { confirmar, toast } = useDialogos();
  const navigate = useNavigate();
  const [roles, setRoles] = useState([]);
  const [rol, setRol] = useState(null);
  const [f, setF] = useState({ usuario: '', password: '', pin: '' });
  const [er, setEr] = useState('');
  const [olvido, setOlvido] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { api.get('/auth/roles').then(setRoles).catch(() => setEr('No hay conexión con el servidor')); }, []);
  const R = roles.find((x) => x.id === rol);
  const esDirector = rol === 'director';

  const go = async (e) => {
    e?.preventDefault();
    setEnviando(true);
    try {
      const r = await api.post('/auth/login', { rol, usuario: f.usuario, password: f.password, pin: esDirector ? f.pin : undefined });
      entrar(r);
      const u = r.usuario;
      navigate(u.cambiarPass || u.cambiarPin ? `/${u.rol}/perfil` : `/${u.rol}/${u.entra}`);
    } catch (x) {
      setEr(x.message);
    } finally {
      setEnviando(false);
    }
  };

  const restablecer = async () => {
    if (!(await confirmar({ titulo: '¿Restablecer la demo?', texto: 'La base de datos vuelve a los datos iniciales. Se pierde todo lo registrado.', verbo: 'Restablecer', rojo: true }))) return;
    try {
      await api.post('/sistema/restablecer');
      sincronizar((await api.get('/reloj')).ahora);
      toast('Datos restablecidos');
      setRol(null);
    }
    catch (x) { toast(x.message); }
  };

  return (
    <div className="osv-login tw:fixed tw:inset-0 tw:overflow-auto tw:grid tw:place-items-center tw:px-3.5 tw:pt-16 tw:pb-5 tw:md:p-6">
      <div className="tw:absolute tw:top-4 tw:right-5"><RelojChip claro /></div>
      <div className="tw:grid tw:items-center tw:gap-5 tw:w-[min(1180px,100%)] tw:grid-cols-1 tw:min-[900px]:grid-cols-[minmax(0,1fr)_46px_500px]">
        <div className="tw:grid tw:place-items-center tw:max-[899px]:[&_img]:w-[min(240px,60vw)]"><MarcaGrande /></div>
        <div className="osv-ldiv tw:hidden tw:min-[900px]:flex tw:flex-col tw:items-center tw:gap-2 tw:h-[430px] tw:justify-self-center" aria-hidden="true">
          <i /><span className="osv-rombo tw:w-[22px] tw:h-[22px]" /><i />
        </div>

        <div className="tw:bg-white tw:rounded-[34px] tw:px-5 tw:md:px-9 tw:pt-6 tw:pb-5 tw:shadow-[0_18px_50px_rgba(15,50,120,.18)]">
          {!R ? (
            <>
              <h2 className="tw:m-0 tw:text-center tw:text-2xl tw:md:text-[30px] tw:font-extrabold tw:text-nav tw:tracking-tight">¿Qué rol eres?</h2>
              <Ornamento />
              <div className="tw:grid tw:grid-cols-1 tw:min-[900px]:grid-cols-2 tw:gap-2.5">
                {roles.map((r) => (
                  <button key={r.id} type="button" onClick={() => { setRol(r.id); setEr(''); setF({ usuario: '', password: '', pin: '' }); }}
                    className="tw:group tw:flex tw:flex-col tw:items-start tw:gap-px tw:px-[18px] tw:py-[11px] tw:rounded-full tw:border-[1.5px] tw:border-[#B9D0F0] tw:bg-white tw:text-left tw:transition tw:hover:bg-br tw:hover:border-br">
                    <b className="tw:text-sm tw:text-tx tw:group-hover:text-white">{r.nombre}</b>
                    <small className="tw:text-[11.5px] tw:text-tx2 tw:group-hover:text-white">{r.alcance === 'sucursal' ? 'De sucursal' : 'Toda la franquicia'}</small>
                  </button>
                ))}
              </div>
              <Err>{er}</Err>
              <div className="tw:flex tw:justify-center tw:mt-2.5 tw:pt-2 tw:border-t tw:border-[#E1EAF7]">
                <Btn v="t" onClick={restablecer}>Restablecer datos</Btn>
              </div>
            </>
          ) : (
            <form onSubmit={go}>
              <h2 className="tw:m-0 tw:text-center tw:text-2xl tw:md:text-[30px] tw:font-extrabold tw:text-nav tw:tracking-tight">Entrar como {R.nombre}</h2>
              <Ornamento />
              <div className="tw:flex tw:flex-wrap tw:gap-2.5 tw:mb-3.5">
                <span className="tw:inline-flex tw:items-center tw:gap-2 tw:px-[18px] tw:py-[9px] tw:rounded-full tw:bg-nav tw:text-white tw:font-bold tw:text-[13.5px]"><Icono n="check" size={17} />Rol: {R.nombre}</span>
                {R.alcance !== 'sucursal' && <span className="tw:inline-flex tw:items-center tw:gap-2 tw:px-[18px] tw:py-[9px] tw:rounded-full tw:border-[1.5px] tw:border-br tw:font-bold tw:text-[13.5px]"><Icono n="home" size={17} />Toda la franquicia</span>}
              </div>
              <CampoLogin ic="user" label="Usuario" value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.target.value })} autoComplete="username" autoFocus />
              <CampoLogin ic="lock" label="Contraseña" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" />
              {esDirector && <CampoLogin ic="lock" label="PIN" type="password" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} autoComplete="off" />}
              <Err>{er}</Err>
              <button type="submit" disabled={enviando}
                className="tw:w-full tw:flex tw:items-center tw:justify-center tw:gap-2.5 tw:mt-1.5 tw:p-3.5 tw:rounded-full tw:bg-gradient-to-b tw:from-[#1357C8] tw:to-nav tw:text-white tw:font-bold tw:text-lg tw:shadow-[0_8px_20px_rgba(10,47,143,.35)] tw:hover:brightness-110 tw:disabled:opacity-60">
                Entrar <Icono n="enter" size={22} />
              </button>
              <div className="tw:flex tw:justify-center tw:mt-2"><Btn v="t" onClick={() => { setRol(null); setEr(''); }}><Icono n="sync" />Cambiar de rol</Btn></div>
              <div className="tw:flex tw:justify-center tw:mt-2.5 tw:pt-2 tw:border-t tw:border-[#E1EAF7]">
                <Btn v="t" onClick={() => setOlvido(true)}><Icono n="help" />¿Olvidaste tu contraseña?</Btn>
              </div>
              <p className="tw:text-center tw:text-tx2 tw:text-xs tw:mt-2 tw:mb-0">Demo: contraseña <b>demo</b>{esDirector ? ' · PIN 2468' : ''}</p>
            </form>
          )}
        </div>
      </div>
      <Olvido show={olvido} onHide={() => setOlvido(false)} inicial={f.usuario} />
    </div>
  );
}
