/**
 * Server moves (PHASE3 block 3.18): the beta first ran behind Tailscale Funnel (*.ts.net) and then
 * moved to its own server. An app still pointing at the old Funnel address is moved to the build's
 * default by itself; any other address someone typed is theirs and stays.
 */
export function isRetiredApiUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && hostname.endsWith('.ts.net')
  } catch {
    return false
  }
}

/** The address to use: the saved one, or `fallback` when the saved one was retired. */
export function currentApiUrl(saved: string, fallback: string): string {
  return isRetiredApiUrl(saved) && !isRetiredApiUrl(fallback) ? fallback : saved
}
