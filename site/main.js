// Aureum landing page: the download buttons, the play/work and Windows/Mac toggles, and a few gentle
// effects. No libraries. Everything degrades: without JS or GitHub's API the page still works.
'use strict'

const REPO = 'eduoliveira1504/aureum-voice'
const RELEASES_PAGE = `https://github.com/${REPO}/releases`

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
document.documentElement.classList.add('js')

const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => Array.from(document.querySelectorAll(selector))

/** fetch() that gives up after a few seconds, so a slow API never leaves things hanging. */
async function getJson(url, ms = 6000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`${url}: ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// --- Who's visiting ------------------------------------------------------------------

const isMobile =
  navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
// An iPad says "Macintosh" too, but it has a touch screen.
const isMacVisitor = !isMobile && /Macintosh|Mac OS X/i.test(navigator.userAgent) && navigator.maxTouchPoints < 2
// The install tab that opens first: Mac for Mac visitors (and iPhone/iPad, likely Mac people), else Windows.
const firstOs = isMacVisitor || /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent) ? 'mac' : 'win'

// --- Toggles (Pra jogar / Pra trabalhar, Windows / Mac) --------------------------------

/** Shows the panel whose `data-<key>` is `value`, hides the others, and updates the toggle buttons. */
function choose(key, value) {
  for (const panel of $$(`[data-${key}]`)) panel.hidden = panel.dataset[key] !== value
  for (const button of $$(`.toggle [data-${key}-pick]`)) {
    button.setAttribute('aria-pressed', String(button.dataset[`${key}Pick`] === value))
  }
}

function setUpToggles() {
  choose('mode', 'jogar')
  choose('os', firstOs)
  for (const button of $$('[data-mode-pick]')) button.addEventListener('click', () => choose('mode', button.dataset.modePick))
  // The toggle's buttons and the hero's "Também pra …" link, which also scrolls down to the steps.
  for (const button of $$('[data-os-pick]')) button.addEventListener('click', () => choose('os', button.dataset.osPick))
}

// --- Download buttons ----------------------------------------------------------------
// The hero's button follows the visitor's system; the install tabs have one button each. Without JS
// (or GitHub's API) they go to the releases page.

/** The files of a release: the Windows installer (required) and the Mac's dmgs, if any. */
function installerOf(release) {
  if (!release || release.draft) return null
  const assets = release.assets || []
  const find = (pattern) => assets.find((a) => pattern.test(a.name))
  const exe = find(/\.exe$/i)
  if (!exe) return null
  const arm = find(/-arm64\.dmg$/i)
  const intel = find(/-x64\.dmg$/i)
  return {
    url: exe.browser_download_url,
    version: release.tag_name,
    size: exe.size,
    mac: arm && intel ? { arm: arm.browser_download_url, intel: intel.browser_download_url, size: arm.size } : null
  }
}

/** The newest release with an installer. Straight from the list, newest first: /releases/latest skips
 *  pre-releases, and a beta can be a pre-release newer than the last full release. */
async function latestInstaller() {
  const releases = await getJson(`https://api.github.com/repos/${REPO}/releases?per_page=10`)
  for (const release of releases) {
    const found = installerOf(release)
    if (found) return found
  }
  return null
}

/** Chromium tells the chip; Safari doesn't, so it's Apple Silicon (every Mac since 2020) unless known. */
async function macChip() {
  try {
    const { architecture } = await navigator.userAgentData.getHighEntropyValues(['architecture'])
    return architecture === 'x86' ? 'intel' : 'arm'
  } catch {
    return 'arm'
  }
}

const megabytes = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`
const SVG_NS = 'http://www.w3.org/2000/svg'

/** The hero button's Windows logo becomes a plain download arrow for Mac visitors. */
function useDownloadIcon(svg) {
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', 'M12 3v11m0 0l-4.5-4.5M12 14l4.5-4.5M4 17v3h16v-3')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '2.2')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.replaceChildren(path)
}

function link(href, text) {
  const a = document.createElement('a')
  a.href = href
  a.textContent = text
  return a
}

function setUpDownload() {
  const hero = $('[data-download]')
  const label = $('[data-download-label]')
  const meta = $('[data-download-meta]')
  const other = $('[data-download-other]')
  const winButton = $('[data-download-win]')
  const macButton = $('[data-download-mac]')
  const finalButton = $('[data-download-final]')
  const macLinks = $('[data-mac-links]')

  if (isMobile) {
    hero.classList.add('is-mobile')
    hero.removeAttribute('href')
    hero.setAttribute('aria-disabled', 'true')
    label.textContent = 'Pra Windows e Mac; abra no computador'
    other.hidden = true
    meta.textContent = 'Abra esta página no computador pra baixar o instalador.'
    return
  }

  if (isMacVisitor) {
    label.textContent = 'Baixar pra Mac'
    useDownloadIcon(hero.querySelector('svg'))
    hero.href = '#instalar' // until the dmg is known
    other.textContent = 'Também pra Windows'
    other.dataset.osPick = 'win'
    meta.textContent = 'macOS 12 ou mais novo · na primeira vez, veja como abrir em Instalar'
  }

  Promise.all([latestInstaller(), isMacVisitor ? macChip() : null])
    .then(([installer, chip]) => {
      if (!installer) return // every button already points at the releases page
      const { mac } = installer
      const intel = chip === 'intel'
      winButton.href = installer.url
      for (const el of $$('[data-download-size]')) el.textContent = `Uns ${megabytes(installer.size)}`
      if (mac) {
        macButton.href = intel ? mac.intel : mac.arm
        macLinks.replaceChildren(
          document.createTextNode('Outro chip? '),
          link(mac.arm, 'Mac com chip Apple'),
          document.createTextNode(' · '),
          link(mac.intel, 'Mac com Intel'),
          document.createTextNode(` · ${installer.version}`)
        )
      }

      if (isMacVisitor) {
        if (!mac) {
          // A release without Mac files yet: say so, Windows is still there.
          meta.textContent = `A ${installer.version} ainda não tem versão pra Mac.`
          return
        }
        hero.href = finalButton.href = intel ? mac.intel : mac.arm
        meta.textContent =
          `${installer.version} · ${megabytes(mac.size)} · ${intel ? 'Mac com Intel' : 'Mac com chip Apple'}` +
          ' · na primeira vez, veja como abrir em Instalar'
        return
      }
      hero.href = finalButton.href = installer.url
      meta.textContent = `${installer.version} · ${megabytes(installer.size)} · Windows 10 e 11 · atualiza sozinho`
    })
    .catch(() => {
      if (isMacVisitor) hero.href = RELEASES_PAGE
    })
}

// --- The final logo: one turn on the vertical axis on hover, then it stops ---------------
// The only logo on the page that moves.

function setUpCoin() {
  const coin = $('[data-coin]')
  if (!coin || reducedMotion) return
  coin.addEventListener('mouseenter', () => coin.classList.add('spin'))
  coin.addEventListener('animationend', () => coin.classList.remove('spin'))
}

// --- Sections fading in, hexagon parallax --------------------------------------------

function setUpReveal() {
  const items = $$('.reveal')
  if (reducedMotion || !('IntersectionObserver' in window)) {
    for (const el of items) el.classList.add('in')
    return
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('in')
      observer.unobserve(entry.target)
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' })
  for (const el of items) observer.observe(el)
}

function setUpParallax() {
  const layer = $('.hexes')
  if (!layer || reducedMotion) return
  // The pattern repeats every 97px, so wrapping the offset keeps it seamless.
  const TILE = 97
  let queued = false
  const update = () => {
    queued = false
    const offset = (window.scrollY * 0.08) % TILE
    layer.style.transform = `translate3d(0, ${-offset}px, 0)`
  }
  window.addEventListener('scroll', () => {
    if (!queued) {
      queued = true
      requestAnimationFrame(update)
    }
  }, { passive: true })
}

// --- Screenshot lightbox ---------------------------------------------------------------

function setUpZoom() {
  const dialog = $('[data-zoom-dialog]')
  const img = $('[data-zoom-img]')
  if (!dialog || !img || typeof dialog.showModal !== 'function') return
  for (const shot of $$('[data-zoom]')) {
    shot.addEventListener('click', () => {
      img.src = shot.dataset.zoom
      img.alt = shot.querySelector('img')?.alt || ''
      dialog.showModal()
    })
  }
  $('[data-zoom-close]').addEventListener('click', () => dialog.close())
  // A click on the backdrop (outside the image) closes it too.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close()
  })
}

setUpToggles()
setUpDownload()
setUpCoin()
setUpReveal()
setUpParallax()
setUpZoom()
