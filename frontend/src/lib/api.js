/* Cliente de la API REST. La sesión viaja en una cookie httpOnly. */

let alCerrarSesion = () => {};
let alExigirPerfil = () => {};
export function configurarApi({ cerrarSesion, exigirPerfil }) {
  alCerrarSesion = cerrarSesion;
  alExigirPerfil = exigirPerfil;
}

export class ErrorApi extends Error {
  constructor(status, datos) {
    super(datos?.error || 'No se pudo completar la acción');
    this.status = status;
    this.datos = datos || {};
  }
}

async function llamar(metodo, url, cuerpo) {
  let r;
  try {
    r = await fetch(`/api${url}`, {
      method: metodo,
      credentials: 'include',
      headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi(0, { error: 'No hay conexión con el servidor' });
  }
  const datos = r.status === 204 ? null : await r.json().catch(() => null);
  if (r.status === 401 && !url.startsWith('/auth/login')) alCerrarSesion();
  if (r.status === 423) alExigirPerfil();
  if (!r.ok) throw new ErrorApi(r.status, datos);
  return datos;
}

export const api = {
  get: (url) => llamar('GET', url),
  post: (url, cuerpo = {}) => llamar('POST', url, cuerpo),
  put: (url, cuerpo = {}) => llamar('PUT', url, cuerpo),
  del: (url) => llamar('DELETE', url),
};
