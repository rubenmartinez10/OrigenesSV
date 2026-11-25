import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://origenes:origenes@localhost:5433/origenes',
  jwtSecret: process.env.JWT_SECRET || 'cambia-este-secreto',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  demo: (process.env.DEMO ?? 'true') !== 'false',
  sqlDir: path.resolve(aqui, '..', process.env.SQL_DIR || '../database/init'),
  uploadsDir: path.resolve(aqui, '..', 'uploads'),
  produccion: process.env.NODE_ENV === 'production',
  // Cookie solo por HTTPS: actívalo cuando la app se sirva con certificado
  cookieSegura: process.env.COOKIE_SECURE === 'true',
};
