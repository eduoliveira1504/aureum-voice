import { useEffect, useMemo, useRef, type ReactNode } from 'react'

import { tourStart, tourSteps } from '../lib/onboarding'
import { useAppearance } from '../store/appearance'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import { useOnboarding } from '../store/onboarding'
import { Modal, SecondaryButton } from './Modal'
import { TourOverlay } from './Tour'
import { TOUR_STEPS, tourServer } from './tourSteps'
import { PrimaryButton } from './ui'

/** After the loading screen fades out and the first layout settles. */
const START_DELAY_MS = 900

/**
 * Starts the tour once per session when it's due (block 3.16): by itself on a new account, as a
 * one-time question on older ones, or only the new steps after the tour grows. Also shows the
 * tour when "Rever tour" asks for it.
 */
export function TourHost(): ReactNode {
  const ready = useOnboarding((s) => s.ready)
  const loaded = useChat((s) => s.loaded)
  const tour = useOnboarding((s) => s.tour)
  const invite = useOnboarding((s) => s.invite)
  const decided = useRef(false)
  const startedAt = useRef<string | null>(null)

  useEffect(() => {
    if (!ready || !loaded || decided.current) return
    decided.current = true
    const timer = setTimeout(() => {
      const start = tourStart(useAppearance.getState().settings.onboarding)
      const onboarding = useOnboarding.getState()
      if (start.kind === 'auto') onboarding.startTour()
      else if (start.kind === 'invite') onboarding.showInvite()
      else if (start.kind === 'news') onboarding.startTour(start.since)
    }, START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [ready, loaded])

  // Where the person was, to go back there at the end (the tour visits a server).
  useEffect(() => {
    if (tour) startedAt.current = useNav.getState().place
  }, [tour])

  const steps = useMemo(() => (tour ? tourSteps(TOUR_STEPS, { since: tour.since, hasServer: !!tourServer() }) : []), [tour])

  const end = (): void => {
    useOnboarding.getState().endTour()
    const back = startedAt.current
    if (back && back !== useNav.getState().place) useNav.getState().go(back)
  }

  if (invite) return <TourInvite />
  if (!tour) return null
  return <TourOverlay steps={steps} news={tour.since !== undefined} onEnd={end} />
}

/** The one-time question for accounts that existed before the tour. Closing it counts as "Agora não". */
function TourInvite(): ReactNode {
  const { acceptInvite, declineInvite } = useOnboarding.getState()
  return (
    <Modal title="Quer fazer um tour rápido pelo Aureum?" subtitle="Menos de um minuto pra conhecer o layout. Dá pra rever depois no menu do perfil." onClose={declineInvite}>
      <div className="flex flex-col gap-2">
        <PrimaryButton type="button" onClick={acceptInvite}>
          Sim, bora
        </PrimaryButton>
        <SecondaryButton type="button" onClick={declineInvite}>
          Agora não
        </SecondaryButton>
      </div>
    </Modal>
  )
}
