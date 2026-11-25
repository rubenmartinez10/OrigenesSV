import pg from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// Fechas como milisegundos (igual que el reloj del frontend), NUMERIC y BIGINT como número
const parseFecha = types.getTypeParser(1184);
types.setTypeParser(1184, (v) => (v == null ? null : parseFecha(v).getTime()));
types.setTypeParser(1700, (v) => (v == null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v == null ? null : parseInt(v, 10)));
types.setTypeParser(1082, (v) => v); // DATE como texto «2026-11-23»

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export const q = (text, params) => pool.query(text, params);

/** Ejecuta fn dentro de una transacción. Si algo falla, se revierte todo. */
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/** ms → Date para mandar a PostgreSQL */
export const ts = (ms) => (ms == null ? null : new Date(ms));
