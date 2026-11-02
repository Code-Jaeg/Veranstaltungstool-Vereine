'use strict';

// Feine Liniensymbole im Stil der SF Symbols (24er-Raster, Strichstärke 1,7, Farbe = currentColor).
const PATHS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-6.2-5.7-6.2-11.1a6.2 6.2 0 1 1 12.4 0C18.2 15.3 12 21 12 21z"/><circle cx="12" cy="9.9" r="2.2"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4"/>',
  people: '<circle cx="9" cy="8.8" r="3"/><path d="M3.5 19c.9-3 3-4.6 5.5-4.6s4.6 1.6 5.5 4.6"/><circle cx="16.6" cy="8" r="2.4"/><path d="M15.6 13.3c2.4-.3 4.4 1 5.1 3.8"/>',
  phone: '<path d="M6.6 3.5h2.6l1.4 4-2 1.3a11 11 0 0 0 6.6 6.6l1.3-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.6"/><path d="M3.6 7.2l8.4 6 8.4-6"/>',
  check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  xmark: '<path d="M7 7l10 10M17 7L7 17"/>',
  download: '<path d="M12 4v10.5m0 0l-4.4-4.4M12 14.5l4.4-4.4M5 19.5h14"/>',
  doc: '<path d="M7 3.5h6.4L18 8.1v12.4H7z"/><path d="M13.4 3.5v4.6H18M9.6 12.5h5.8M9.6 16h5.8"/>',
  clipboard: '<rect x="5.8" y="4.8" width="12.4" height="15.7" rx="2.2"/><path d="M9.4 4.8V3.6h5.2v1.2M9 10h6M9 13.4h6M9 16.8h3.6"/>',
  megaphone: '<path d="M4 10v4h2.8l7.2 4.6V5.4L6.8 10H4z"/><path d="M17.4 9.4a3.6 3.6 0 0 1 0 5.2M7.4 14.2l1 4.8"/>',
  table: '<rect x="3.5" y="5" width="17" height="14" rx="2.4"/><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14"/>',
  pencil: '<path d="M15.4 4.6l4 4L8.9 19.1H4.9v-4z"/><path d="M13.4 6.6l4 4"/>',
  warning: '<path d="M12 4.2L2.9 19.5h18.2z"/><path d="M12 10.2v4"/><circle cx="12" cy="16.9" r=".5" fill="currentColor"/>',
  chevronLeft: '<path d="M14.8 5.2L8 12l6.8 6.8"/>',
  chevronRight: '<path d="M9.2 5.2L16 12l-6.8 6.8"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  share: '<path d="M12 3.6v11M8.2 7.4L12 3.6l3.8 3.8M7 10.5H5.8v9.9h12.4v-9.9H17"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.4"/><path d="M15.5 8.5V6.4A2.4 2.4 0 0 0 13.1 4H6.4A2.4 2.4 0 0 0 4 6.4v6.7a2.4 2.4 0 0 0 2.4 2.4h2.1"/>',
  qrcode: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 19.5h1M19.5 14h.5"/>',
  gift: '<rect x="4" y="9" width="16" height="11.5" rx="2"/><path d="M3.5 9h17M12 9v11.5M12 9S10.8 4 8.2 4.6C6 5.1 7.4 9 12 9zM12 9s1.2-5 3.8-4.4C18 5.1 16.6 9 12 9z"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.8V9h4.2M12 8v4.2l2.8 1.8"/>',
  trash: '<path d="M5 7h14M10 7V4.6h4V7M7 7l.8 12.5h8.4L17 7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
};

function icon(name, cls = '') {
  const paths = PATHS[name];
  if (!paths) throw new Error(`Unbekanntes Symbol: ${name}`);
  return `<svg class="sym${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

module.exports = { icon, names: Object.keys(PATHS) };
