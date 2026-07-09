'use client'

import Link from 'next/link'
import { Settings } from '../../ui/Settings'
import { MotionRuntime } from '../../input/MotionRuntime'
import { useStore } from '../../store'
import { useEffect } from 'react'

export default function SettingsPage() {
  const settings = useStore((s) => s.settings)
  const actions = useStore((s) => s.actions)

  useEffect(() => {
    if (!settings) actions.settings()
  }, [actions, settings])

  return (
    <main className="settings-page">
      <MotionRuntime />
      <div className="settings-page-nav">
        <Link href="/">Back to game</Link>
      </div>
      <Settings />
    </main>
  )
}
