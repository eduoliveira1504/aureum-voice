/**
 * The loading screen shown while the app opens (block 3.23): the logo spins like a coin and the
 * line under it says what's happening. Plain DOM, no React, so it paints right away. The main
 * process decides everything (see main/startup.ts); this page only shows it.
 */
import './splash.css'

const status = document.getElementById('status')!

window.aureumSplash?.onStatus((text) => {
  status.textContent = text
})
window.aureumSplash?.onLeave(() => document.body.classList.add('leaving'))
