/* Sonidos de aviso con WebAudio (sin archivos). Se apagan desde el menú del usuario. */
let ctx = null;
const clave = 'osv_snd';

export const sonidoActivo = () => {
  try { return localStorage.getItem(clave) !== '0'; } catch { return true; }
};
export const alternarSonido = () => {
  try { localStorage.setItem(clave, sonidoActivo() ? '0' : '1'); } catch { /* sin almacenamiento */ }
};

function nota(f, t, d, tipo = 'sine', v = 0.16) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = tipo;
  o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
  g.gain.exponentialRampToValueAtTime(v, ctx.currentTime + t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + d);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(ctx.currentTime + t);
  o.stop(ctx.currentTime + t + d + 0.05);
}

/** 'ok' · 'falla' · 'urgente' · 'alerta' */
export function sonar(tipo) {
  if (!sonidoActivo()) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume?.();
    if (tipo === 'ok') { nota(660, 0, 0.12); nota(880, 0.12, 0.18); }
    else if (tipo === 'falla') { nota(330, 0, 0.14, 'sawtooth', 0.1); nota(220, 0.13, 0.26, 'sawtooth', 0.1); }
    else if (tipo === 'urgente') { for (let i = 0; i < 6; i++) nota(i % 2 ? 740 : 990, i * 0.17, 0.14, 'square', 0.09); }
    else { nota(880, 0, 0.14); nota(1175, 0.15, 0.22); }
  } catch { /* el navegador bloqueó el audio */ }
}

export const URGENTE = /cancel|vencid|agot|demora|urgente|emergencia|bajo|rechaz|devuelt|mala/i;
