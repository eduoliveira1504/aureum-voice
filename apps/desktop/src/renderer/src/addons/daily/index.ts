import type { ChatAddonModule } from '../types'
import { ChallengeCard } from './ChallengeCard'

/** Daily games challenges (block 4.2.10): not an addon a server installs, but a message that
 * carries a shared result, shown like the chat addons' things. Shared from the games' result. */
const daily: ChatAddonModule = {
  key: 'daily',
  Embed: ChallengeCard
}

export default daily
