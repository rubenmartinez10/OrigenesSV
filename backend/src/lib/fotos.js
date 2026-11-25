import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { fallo, si } from './errores.js';

/** Guarda una imagen que llega reducida desde el navegador como data URL y devuelve su ruta pública. */
export async function guardarImagen(dataUrl, carpeta, prefijo) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw fallo('No se pudo leer la imagen. Elige un archivo JPG o PNG.');
  const datos = Buffer.from(m[2], 'base64');
  si(datos.length > 1.5 * 1024 * 1024, 'La imagen es demasiado grande');
  const dir = path.join(config.uploadsDir, carpeta);
  await fs.mkdir(dir, { recursive: true });
  const nombre = `${prefijo}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  await fs.writeFile(path.join(dir, nombre), datos);
  return `/uploads/${carpeta}/${nombre}`;
}
