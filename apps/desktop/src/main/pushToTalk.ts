/**
 * Push-to-talk: the app's window turns it on while it's in a call with "Pressionar para falar"
 * picked, and off otherwise. Reads only the configured key, through the key watch (works while a
 * game has focus), under the same privacy rule (docs/decisions/0012-in-game-overlay.md).
 */
import { virtualKeys, watchCombos } from './keyWatch'

let stop: () => void = () => {}

/** Watches `key` (null stops), reporting presses and releases. False if the key isn't supported. */
export function watchPushToTalk(key: string | null, onChange: (held: boolean) => void): boolean {
  stop()
  stop = () => {}
  if (key === null) return true
  if (virtualKeys(key) === null) return false
  stop = watchCombos([{ accelerator: key, onPress: () => onChange(true), onRelease: () => onChange(false) }])
  return true
}
