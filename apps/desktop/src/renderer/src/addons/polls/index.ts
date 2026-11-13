import { ChartBar } from 'lucide-react'

import type { ChatAddonModule } from '../types'
import { CreatePollModal } from './CreatePollModal'
import { PollCard } from './PollCard'
import { reloadPolls, usePolls } from './store'
import { t } from '../../lib/i18n'

/** Polls: created from the "+" of any message box and shown as a message, with live counts. */
const polls: ChatAddonModule = {
  key: 'polls',
  Embed: PollCard,
  composer: {
    get label() {
      return t('addons.polls.create')
    },
    icon: ChartBar,
    Dialog: CreatePollModal
  },
  onEvent: ({ type, data }) => {
    if (type === 'ready') reloadPolls()
    else usePolls.getState().apply(type, data)
  }
}

export default polls
