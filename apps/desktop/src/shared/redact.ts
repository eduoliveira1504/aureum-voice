/**
 * Removes secrets from log lines before they leave the PC (bug reports): JWTs (access and
 * refresh tokens), Authorization headers, token=... query values (the WebSocket URL), e-mail
 * addresses and the account name in user folder paths (C:\Users\name, /Users/name).
 */
const PATTERNS: [RegExp, string][] = [
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]'],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 [token]'],
  [/([?&](?:access_)?token=)[^&\s"']+/gi, '$1[token]'],
  [/("?(?:access_token|refresh_token|password|token)"?\s*[:=]\s*"?)(?!\[)[^"\s,}]+/gi, '$1[removed]'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mail]'],
  [/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, '$1[user]'],
  [/(\/(?:Users|home)\/)[^/\s"']+/g, '$1[user]']
]

export function redact(line: string): string {
  return PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), line)
}
