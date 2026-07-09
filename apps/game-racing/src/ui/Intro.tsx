import { Suspense, useEffect, useMemo, useState } from 'react'
import { Footer } from '@pmndrs/branding'
import { useProgress } from '@react-three/drei'
import { PairingScreen } from '@howls/ui-pairing'
import type { SlotAssignments } from '@howls/motion-sdk'

import type { ReactNode } from 'react'

import { MOTION_SERVER_URL, startMotionSession } from '../input/MotionRuntime'
import { useStore } from '../store'
import { useMotionStore } from '../store/motion-store'
import { setupSession, unAuthenticateUser } from '../data'
import { Keys } from './Keys'
import { Auth } from './Auth'

export function Intro({ children }: { children?: ReactNode }): JSX.Element {
  const [clicked, setClicked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showPairing, setShowPairing] = useState(false)
  const { progress } = useProgress()
  const [session, set, ready, racingInputConfig] = useStore((state) => [state.session, state.set, state.ready, state.racingInputConfig])
  const pairingComplete = useMotionStore((s) => s.pairingComplete)
  const sessionId = useMemo(() => crypto.randomUUID(), [])

  useEffect(() => {
    if (clicked && !loading) set({ ready: true })
  }, [clicked, loading, set])

  useEffect(() => {
    if (progress === 100) setLoading(false)
  }, [progress])

  useEffect(() => {
    setupSession(set)
  }, [set])

  useEffect(() => {
    if (ready && !pairingComplete) setShowPairing(true)
  }, [ready, pairingComplete])

  const handleSessionReady = (assignments: SlotAssignments) => {
    startMotionSession(assignments, sessionId)
    setShowPairing(false)
  }

  if (showPairing && !pairingComplete) {
    return (
      <div className="fullscreen pairing-flow">
        <PairingScreen serverUrl={MOTION_SERVER_URL} sessionId={sessionId} useMock={racingInputConfig.useMock} onSessionReady={handleSessionReady} />
      </div>
    )
  }

  if (children && pairingComplete && ready) {
    return <>{children}</>
  }

  return (
    <>
      {children && <Suspense fallback={null}>{children}</Suspense>}
      <div className={`fullscreen bg ${loading ? 'loading' : 'loaded'} ${clicked && 'clicked'}`}>
        <div className="stack">
          <div className="intro-keys">
            <Keys style={{ paddingBottom: 20 }} />
            <a className="start-link" href="#" onClick={() => setClicked(true)}>
              {loading ? `loading ${progress.toFixed()} %` : 'Click to start'}
            </a>
          </div>
          {session?.user?.aud !== 'authenticated' ? (
            <Auth />
          ) : (
            <div>
              Hello {session.user.user_metadata.full_name}
              <button className="logout" onClick={unAuthenticateUser}>
                Logout
              </button>{' '}
            </div>
          )}
        </div>
        <Footer
          date="2. June"
          year="2021"
          link1={<a href="https://github.com/pmndrs/react-three-fiber">@react-three/fiber</a>}
          link2={<a href="https://github.com/pmndrs/racing-game">/racing-game</a>}
        />
      </div>
    </>
  )
}
