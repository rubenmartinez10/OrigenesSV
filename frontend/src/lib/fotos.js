/** Reduce la imagen elegida (máx. 640 px) y la devuelve como data URL JPG. */
export function leerFoto(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('No se pudo leer la imagen. Elige un archivo JPG o PNG.'));
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 640 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen. Elige un archivo JPG o PNG.'));
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
