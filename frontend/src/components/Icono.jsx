/* Íconos de línea (los mismos trazos del borrador). */
const IC = {
  chart: 'M4 20V11M10 20V4M16 20v-7M22 20H2', bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 016 0v2', receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  enter: 'M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M9 17l5-5-5-5M14 12H3', help: 'M12 22a10 10 0 100-20 10 10 0 000 20zM9.5 9a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  sync: 'M21 12a9 9 0 01-15.5 6.2M3 12A9 9 0 0118.5 5.8M18 2v4h-4M6 22v-4h4', tag: 'M3 12V3h9l9 9-9 9z', chev: 'M9 6l6 6-6 6',
  cam: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z', truck: 'M2 6h12v10H2zM14 10h4l3 3v3h-7zM6 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5', file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6', user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  home: 'M3 11l9-8 9 8v9H3z', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', check: 'M20 6L9 17l-5-5', box: 'M21 8l-9-5-9 5v8l9 5 9-5z',
  dollar: 'M12 2v20M17 6H9a3 3 0 000 6h6a3 3 0 010 6H6', users: 'M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 11a4 4 0 100-8 4 4 0 000 8',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0', clock: 'M12 7v5l3 2M12 22a10 10 0 110-20 10 10 0 010 20', x: 'M18 6L6 18M6 6l12 12',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4', menu: 'M3 6h18M3 12h18M3 18h18', plus: 'M12 5v14M5 12h14',
  vol: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11', mute: 'M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6', print: 'M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z',
};

export function Icono({ n, size = 20, className = '' }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" className={`tw:shrink-0 ${className}`} aria-hidden="true">
      <path d={IC[n] || IC.list} />
    </svg>
  );
}
