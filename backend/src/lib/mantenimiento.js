/*
 * Mientras se restablecen los datos de la demo el esquema se borra y se vuelve a crear:
 * en esos segundos la API responde 503 y los procesos del reloj no corren.
 */
let activo = false;

export const enMantenimiento = () => activo;

export async function conMantenimiento(fn) {
  activo = true;
  try {
    return await fn();
  } finally {
    activo = false;
  }
}
