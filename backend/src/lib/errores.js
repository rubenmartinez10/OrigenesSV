/** Error con código HTTP y mensaje para mostrar al usuario. */
export class HttpError extends Error {
  constructor(status, mensaje, extra) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

export const fallo = (mensaje, extra) => new HttpError(400, mensaje, extra);
export const prohibido = (mensaje = 'No tienes permiso para esta acción') => new HttpError(403, mensaje);
export const noEncontrado = (mensaje = 'No se encontró') => new HttpError(404, mensaje);

/** Lanza 400 con el mensaje si la condición se cumple. */
export function si(condicion, mensaje) {
  if (condicion) throw fallo(mensaje);
}

/** Valida un motivo de al menos 10 caracteres. */
export function motivo(texto, etiqueta = 'El motivo') {
  const m = String(texto || '').trim();
  si(m.length < 10, `${etiqueta} necesita al menos 10 caracteres`);
  return m;
}
