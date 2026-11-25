import { app } from './app.js';
import { config } from './config.js';
import { cargarReloj, latido } from './lib/reloj.js';
import { correrProcesos } from './lib/procesos.js';
import { migrar } from './migraciones.js';
import { enMantenimiento } from './lib/mantenimiento.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera a que la base de datos esté lista (útil al arrancar con Docker). */
async function conectar() {
  for (let i = 1; ; i++) {
    try {
      await migrar();
      await cargarReloj();
      return;
    } catch (e) {
      if (i >= 30) throw e;
      console.log(`Esperando a la base de datos… (${i})`);
      await espera(2000);
    }
  }
}

await conectar();
await correrProcesos();

app.listen(config.port, () => {
  console.log(`API de Orígenes SV en http://localhost:${config.port} · modo demo: ${config.demo ? 'sí' : 'no'}`);
});

// Cada 10 s: si alguien usa la app, el reloj sigue y se corren los procesos (llegadas, vencimientos, ofertas…);
// si no, el reloj queda en pausa.
setInterval(async () => {
  if (enMantenimiento()) return;
  try {
    if (await latido()) await correrProcesos();
  } catch (e) {
    console.error('Procesos:', e.message);
  }
}, 10_000);
