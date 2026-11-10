// Small stroke icons for the synthetic screenshots: <i data-i="mic"></i> becomes an inline SVG.
const PATHS = {
  logo: '<polygon points="48,8 82.6,28 82.6,68 48,88 13.4,68 13.4,28" fill="#0E0D0B" stroke="#E8B531" stroke-width="8" stroke-linejoin="round"/><path d="M48 26 L66 70 H56 L48 50 L40 70 H30 Z" fill="#E8B531" stroke="none"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micoff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/>',
  cam: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  phone: '<path d="M4 14c4-4 12-4 16 0l-2 3-3-1v-2c-2-1-4-1-6 0v2l-3 1z"/>',
  hash: '<path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 3-6 6-6s6 2.5 6 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3 2.8 3 6"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  pen: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  chevl: '<path d="M15 6l-6 6 6 6"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 9.5h.01M15 9.5h.01"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  vol: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  check: '<path d="M5 12l4 4 10-10"/>',
  clip: '<path d="M8 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l7-7"/>'
}
for (const el of document.querySelectorAll('i[data-i]')) {
  const name = el.dataset.i
  const logo = name === 'logo'
  const svg = logo
    ? `<svg viewBox="0 0 96 96" aria-hidden="true">${PATHS.logo}</svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
  // Keep the <i>'s class and style (a width there sets the height too); the default size is in shots.css.
  const own = el.getAttribute('style') || ''
  const size = /width:\s*(\d+)px/.exec(own)
  const style = size ? `${own};height:${size[1]}px` : own
  el.outerHTML = svg.replace('<svg', `<svg class="icon ${el.className}" style="${style}"`)
}
