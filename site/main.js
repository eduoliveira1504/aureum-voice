// Aureum landing page: the download button, the live pioneer count and a few gentle effects.
// No libraries. Everything degrades: without JS or the APIs the page still works.
'use strict'

const REPO = 'eduoliveira1504/aureum-voice'
const RELEASES_PAGE = `https://github.com/${REPO}/releases`
const STATS_URL = 'https://api.aureum-voice.duckdns.org/api/public/stats'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
document.documentElement.classList.add('js')

const $$ = (selector) => Array.from(document.querySelectorAll(selector))

/** fetch() that gives up after a few seconds, so a sleeping server never leaves things hanging. */
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

// --- Download button ---------------------------------------------------------------
// Windows by default; a Mac visitor gets the Mac's dmg (block 3.21), with the other files linked
// below the button. Without JS, the buttons go to the releases page.

const isMobile =
  navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
// An iPad says "Macintosh" too, but it has a touch screen.
const isMacVisitor = !isMobile && /Macintosh|Mac OS X/i.test(navigator.userAgent) && navigator.maxTouchPoints < 2

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

/** /releases/latest skips pre-releases (the beta builds are), so the list is the fallback. */
async function latestInstaller() {
  try {
    const found = installerOf(await getJson(`https://api.github.com/repos/${REPO}/releases/latest`))
    if (found) return found
  } catch {
    // No full release yet: look through the list below.
  }
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

/** The button's Windows logo becomes a plain download arrow for Mac visitors. */
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

/** "Também pra …" under the button: the files this visitor's button doesn't give. */
function fillOther(other, items) {
  other.replaceChildren(document.createTextNode('Também pra '))
  items.forEach(([href, text], i) => {
    if (i) other.append(document.createTextNode(' · '))
    other.append(link(href, text))
  })
}

function setUpDownload() {
  const buttons = $$('[data-download]')
  const meta = document.querySelector('[data-download-meta]')
  const other = document.querySelector('[data-download-other]')
  const macLinks = document.querySelector('[data-mac-links]')

  if (isMobile) {
    for (const button of buttons) {
      button.classList.add('is-mobile')
      button.removeAttribute('href')
      button.setAttribute('aria-disabled', 'true')
      button.querySelector('[data-download-label]').textContent = 'Pra Windows e Mac; abra no computador'
    }
    if (meta) meta.textContent = 'Abra esta página no computador pra baixar o instalador.'
    return
  }

  if (isMacVisitor) {
    for (const button of buttons) {
      button.querySelector('[data-download-label]').textContent = 'Baixar pra Mac'
      useDownloadIcon(button.querySelector('svg'))
      button.href = '#mac'
    }
    if (meta) meta.textContent = 'macOS 12 ou mais novo · na primeira vez, veja como abrir abaixo'
  }

  Promise.all([latestInstaller(), isMacVisitor ? macChip() : null])
    .then(([installer, chip]) => {
      if (!installer) return // the buttons already point at the releases page (or #mac)
      const { mac } = installer
      if (mac && macLinks) {
        macLinks.replaceChildren(
          document.createTextNode('Baixar: '),
          link(mac.arm, 'Mac com chip Apple'),
          document.createTextNode(' · '),
          link(mac.intel, 'Mac com Intel'),
          document.createTextNode(` · ${installer.version}`)
        )
      }
      if (isMacVisitor) {
        if (!mac) {
          // A release without Mac files yet: say so, Windows is still there.
          if (meta) meta.textContent = `A ${installer.version} ainda não tem versão pra Mac.`
          if (other) fillOther(other, [[installer.url, 'Windows']])
          return
        }
        const intel = chip === 'intel'
        for (const button of buttons) button.href = intel ? mac.intel : mac.arm
        if (meta) {
          meta.textContent =
            `${installer.version} · ${megabytes(mac.size)} · ${intel ? 'Mac com Intel' : 'Mac com chip Apple'}` +
            ' · na primeira vez, veja como abrir abaixo'
        }
        if (other) {
          fillOther(other, [
            [intel ? mac.arm : mac.intel, intel ? 'Mac com chip Apple' : 'Mac com Intel'],
            [installer.url, 'Windows']
          ])
        }
        return
      }
      const size = megabytes(installer.size)
      for (const button of buttons) button.href = installer.url
      if (meta) meta.textContent = `${installer.version} · ${size} · Windows 10 e 11 · atualiza sozinho`
      for (const el of $$('[data-download-size]')) el.textContent = `uns ${size}`
      if (other && mac) {
        fillOther(other, [[mac.arm, 'Mac com chip Apple'], [mac.intel, 'Mac com Intel'], ['#mac', 'como instalar no Mac']])
      }
    })
    .catch(() => {
      if (!isMacVisitor) for (const button of buttons) button.href = RELEASES_PAGE
    })
}

// --- "Tenho um convite" -----------------------------------------------------------

function setUpInvite() {
  const toggle = document.querySelector('[data-invite-toggle]')
  const note = document.getElementById('convite')
  if (!toggle || !note) return
  toggle.addEventListener('click', () => {
    const open = note.hidden
    note.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
  })
}

// --- Pioneer count -----------------------------------------------------------------

function countUp(el, target) {
  if (reducedMotion || target === 0) {
    el.textContent = target.toLocaleString('pt-BR')
    return
  }
  const duration = Math.min(1600, 500 + target * 20)
  const start = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - t, 3)
    el.textContent = Math.round(target * eased).toLocaleString('pt-BR')
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function setUpPioneers() {
  const box = document.querySelector('[data-pioneers]')
  const number = document.querySelector('[data-pioneers-count]')
  if (!box || !number) return
  // The server may be off: then the box simply stays hidden.
  getJson(STATS_URL)
    .then((data) => {
      const count = data && data.pioneers
      if (!Number.isInteger(count) || count < 0) return
      box.hidden = false
      if (!('IntersectionObserver' in window)) return countUp(number, count)
      const seen = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        seen.disconnect()
        countUp(number, count)
      }, { threshold: 0.6 })
      seen.observe(box)
    })
    .catch(() => {})
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
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
  for (const el of items) observer.observe(el)
}

function setUpParallax() {
  const layer = document.querySelector('.hexes')
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
  const dialog = document.querySelector('[data-zoom-dialog]')
  const img = document.querySelector('[data-zoom-img]')
  if (!dialog || !img || typeof dialog.showModal !== 'function') return
  for (const shot of $$('[data-zoom]')) {
    shot.addEventListener('click', () => {
      img.src = shot.dataset.zoom
      img.alt = shot.dataset.alt || ''
      dialog.showModal()
    })
  }
  document.querySelector('[data-zoom-close]').addEventListener('click', () => dialog.close())
  // A click on the backdrop (outside the image) closes it too.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close()
  })
}

setUpDownload()
setUpInvite()
setUpPioneers()
setUpReveal()
setUpParallax()
setUpZoom()
