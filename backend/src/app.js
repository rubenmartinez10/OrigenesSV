import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { HttpError } from './lib/errores.js';
import { marcarActividad } from './lib/reloj.js';
import { enMantenimiento } from './lib/mantenimiento.js';
import { autenticar, exigirCredencialesAlDia, soloRoles } from './middleware/auth.js';
import auth from './routes/auth.js';
import sistema from './routes/sistema.js';
import perfil from './routes/perfil.js';
import catalogo from './routes/catalogo.js';
import mesero from './routes/mesero.js';
import { jefe, cocinero } from './routes/cocina.js';
import propuestas from './routes/propuestas.js';
import bodega from './routes/bodega.js';
import gerente from './routes/gerente.js';
import franquicia from './routes/franquicia.js';
import rrhh from './routes/rrhh.js';
import gg from './routes/gg.js';
import director from './routes/director.js';

export const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '3mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(config.uploadsDir, { maxAge: '7d', fallthrough: false }));

app.get('/api/salud', (req, res) => res.json({ ok: true }));

// Mientras se restablecen los datos de la demo, la API espera
app.use('/api', (req, res, next) => {
  if (enMantenimiento()) return res.status(503).json({ error: 'Estamos restableciendo los datos. Intenta de nuevo en unos segundos.' });
  return next();
});

// El reloj simulado solo corre mientras alguien usa la app
app.use('/api', async (req, res, next) => {
  await marcarActividad();
  next();
});

// Públicas: roles, inicio de sesión, contraseña olvidada, reloj
app.use('/api/auth', auth);
app.use('/api', sistema);

// Con sesión. Perfil se permite aunque la contraseña sea temporal; lo demás no.
const alDia = [autenticar, exigirCredencialesAlDia];
app.use('/api/perfil', autenticar, perfil);
app.use('/api/catalogo', ...alDia, catalogo);
app.use('/api/mesero', ...alDia, soloRoles('mesero'), mesero);
app.use('/api/jefe', ...alDia, soloRoles('jefe'), jefe);
app.use('/api/cocinero', ...alDia, soloRoles('cocinero'), cocinero);
app.use('/api/propuestas', ...alDia, soloRoles('cocinero', 'jefe'), propuestas);
app.use('/api/bodega', ...alDia, soloRoles('bodega'), bodega);
app.use('/api/gerente', ...alDia, soloRoles('gerente'), gerente);
app.use('/api/franquicia', ...alDia, soloRoles('rrhh', 'gg', 'director'), franquicia);
app.use('/api/rrhh', ...alDia, soloRoles('rrhh'), rrhh);
app.use('/api/gg', ...alDia, soloRoles('gg'), gg);
app.use('/api/director', ...alDia, soloRoles('director'), director);

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Errores: mensajes claros para el usuario; el detalle técnico solo en la consola del servidor
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con ese valor' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado grande' });
  if (err.status === 404 && req.path.startsWith('/uploads')) return res.status(404).end();
  console.error(err);
  res.status(500).json({ error: 'Algo salió mal en el servidor. Intenta de nuevo.' });
});
