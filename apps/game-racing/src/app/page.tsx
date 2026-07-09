'use client'

import dynamic from 'next/dynamic'

const Game = dynamic(() => import('../Game').then((mod) => mod.Game), {
  ssr: false,
  loading: () => <div className="game-loading">Loading game...</div>,
})

export default function HomePage() {
  return <Game />
}
