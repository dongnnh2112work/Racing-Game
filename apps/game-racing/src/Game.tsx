'use client'

import { useGLTF, useTexture } from '@react-three/drei'
import { App } from './App'
import { Intro } from './ui/Intro'

useTexture.preload('/textures/heightmap_1024.png')
useGLTF.preload('/models/track-draco.glb')
useGLTF.preload('/models/chassis-draco.glb')
useGLTF.preload('/models/wheel-draco.glb')

export function Game() {
  return (
    <Intro>
      <App />
    </Intro>
  )
}
