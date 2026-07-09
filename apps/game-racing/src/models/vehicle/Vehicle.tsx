import { MathUtils, Vector3, Quaternion, Euler } from 'three'
import { useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useRaycastVehicle } from '@react-three/cannon'

import type { PropsWithChildren } from 'react'
import type { BoxProps, RaycastVehicleProps, WheelInfoOptions } from '@react-three/cannon'

import { AccelerateAudio, BoostAudio, Boost, BrakeAudio, Dust, EngineAudio, HonkAudio, Skid, Cameras } from '../../effects'
import { getState, mutation, useStore } from '../../store'
import { useToggle } from '../../useToggle'
import { isMotionDriveMode, isVehicleOverturned, recoverVehicle } from '../../vehicleRecovery'

import { Chassis } from './Chassis'
import { Wheel } from './Wheel'

import type { Camera, Controls, WheelInfo } from '../../store'

const { lerp } = MathUtils
const worldPos = new Vector3()
const worldQuat = new Quaternion()
const yawQuat = new Quaternion()
const euler = new Euler()
const chaseOffset = new Vector3()
const lookTarget = new Vector3()
const up = new Vector3(0, 1, 0)
const forward = new Vector3()

type VehicleProps = PropsWithChildren<Pick<BoxProps, 'angularVelocity' | 'position' | 'rotation'>>
type DerivedWheelInfo = WheelInfo & Required<Pick<WheelInfoOptions, 'chassisConnectionPointLocal' | 'isFrontWheel'>>

export function Vehicle({ angularVelocity, children, position, rotation }: VehicleProps) {
  const defaultCamera = useThree((state) => state.camera)
  const [chassisBody, vehicleConfig, wheelInfo, wheels] = useStore((s) => [s.chassisBody, s.vehicleConfig, s.wheelInfo, s.wheels])
  const { back, force, front, height, maxBrake, steer, maxSpeed, width } = vehicleConfig

  const wheelInfos = wheels.map((_, index): DerivedWheelInfo => {
    const length = index < 2 ? front : back
    const sideMulti = index % 2 ? 0.5 : -0.5
    return {
      ...wheelInfo,
      chassisConnectionPointLocal: [width * sideMulti, height, length],
      isFrontWheel: Boolean(index % 2),
    }
  })

  const raycast: RaycastVehicleProps = {
    chassisBody,
    wheels,
    wheelInfos,
  }

  const [, api] = useRaycastVehicle(() => raycast, null, [wheelInfo])

  useLayoutEffect(() => api.sliding.subscribe((sliding) => (mutation.sliding = sliding)), [api])

  let camera: Camera
  let editor: boolean
  let controls: Controls
  let engineValue = 0
  let i = 0
  let isBoosting = false
  let speed = 0
  let steeringValue = 0
  let swaySpeed = 0
  let swayTarget = 0
  let swayValue = 0
  let stuckTimer = 0

  const STUCK_SPEED = 1.5
  const STUCK_DELAY = 0.4
  const REVERSE_DURATION = 1.0
  const OVERTURNED_DELAY = 0.5

  useFrame((state, delta) => {
    camera = getState().camera
    editor = getState().editor
    controls = getState().controls
    speed = mutation.speed

    isBoosting = controls.boost && mutation.boost > 0

    if (isBoosting) {
      mutation.boost = Math.max(mutation.boost - 1, 0)
    }

    const motionMode = isMotionDriveMode(mutation.racingInput.source)
    const handMode = mutation.racingInput.source === 'hands'
    const throttle = mutation.racingInput.throttle
    const cruiseSpeed = maxSpeed * (handMode ? throttle : 1)
    const speedCap = motionMode && handMode ? cruiseSpeed : maxSpeed

    let targetEngine = 0
    if (motionMode && !editor) {
      if (mutation.stuckPhase === 'reversing') {
        targetEngine = force * 0.45
      } else if (mutation.stuckPhase !== 'recovering') {
        if (handMode) {
          if (speed < cruiseSpeed * 0.6) {
            targetEngine = force * -throttle * 2.75
          } else if (speed < cruiseSpeed) {
            targetEngine = force * -throttle * 1.75
          } else if (speed > cruiseSpeed * 1.02) {
            targetEngine = force * throttle * 1.75
          } else {
            targetEngine = force * -throttle
          }
        } else {
          targetEngine = force * -throttle
        }
      }
    } else {
      targetEngine = controls.forward || controls.backward ? force * (controls.forward && !controls.backward ? (isBoosting ? -1.5 : -1) : 1) : 0
    }

    engineValue = lerp(engineValue, targetEngine, delta * 20)
    steeringValue = lerp(steeringValue, getState().steering * steer, delta * 20)
    for (i = 2; i < 4; i++) api.applyEngineForce(speed < speedCap ? engineValue : 0, i)
    for (i = 0; i < 2; i++) api.setSteeringValue(steeringValue, i)
    const braking = motionMode ? false : controls.brake
    for (i = 2; i < 4; i++) api.setBrake(braking ? (controls.forward ? maxBrake / 1.5 : maxBrake) : 0, i)

    if (motionMode && !editor && chassisBody.current) {
      chassisBody.current.getWorldPosition(worldPos)
      chassisBody.current.getWorldQuaternion(worldQuat)

      const overturned = isVehicleOverturned(worldQuat)
      if (overturned) {
        mutation.overturnedTimer += delta
        mutation.needsTrackRecovery = true
      } else {
        mutation.overturnedTimer = 0
      }

      if (speed > STUCK_SPEED) {
        mutation.hasMoved = true
        if (mutation.stuckPhase === 'normal') {
          stuckTimer = 0
          if (!overturned) mutation.needsTrackRecovery = false
        }
      } else if (mutation.hasMoved && mutation.stuckPhase === 'normal') {
        stuckTimer += delta
      }

      if (mutation.stuckPhase === 'normal') {
        const shouldStartReverse = mutation.hasMoved && speed < STUCK_SPEED && (mutation.needsTrackRecovery || stuckTimer >= STUCK_DELAY) && !overturned
        if (shouldStartReverse) {
          mutation.stuckPhase = 'reversing'
          mutation.reverseTimer = 0
          stuckTimer = 0
        }
      } else if (mutation.stuckPhase === 'reversing') {
        mutation.reverseTimer += delta
        if (mutation.reverseTimer >= REVERSE_DURATION) {
          mutation.stuckPhase = speed < STUCK_SPEED ? 'recovering' : 'normal'
          mutation.reverseTimer = 0
          if (speed >= STUCK_SPEED) mutation.needsTrackRecovery = false
        }
      }

      const shouldRecover = mutation.stuckPhase === 'recovering' || (overturned && mutation.overturnedTimer >= OVERTURNED_DELAY)
      if (shouldRecover) {
        const chassisApi = getState().api
        if (chassisApi) {
          recoverVehicle(chassisApi, worldPos.x, worldPos.z)
        }
        mutation.stuckPhase = 'normal'
        mutation.needsTrackRecovery = false
        mutation.overturnedTimer = 0
        mutation.reverseTimer = 0
        stuckTimer = 0
      }
    } else if (!motionMode) {
      stuckTimer = 0
      mutation.stuckPhase = 'normal'
      mutation.reverseTimer = 0
      mutation.overturnedTimer = 0
    }

    if (!editor && chassisBody.current) {
      const follow = 1 - Math.pow(0.001, delta)
      chassisBody.current.getWorldPosition(worldPos)
      chassisBody.current.getWorldQuaternion(worldQuat)
      euler.setFromQuaternion(worldQuat, 'YXZ')
      yawQuat.setFromAxisAngle(up, euler.y)

      if (camera === 'BIRD_EYE') {
        lookTarget.set(worldPos.x, worldPos.y + 100, worldPos.z)
        defaultCamera.position.lerp(lookTarget, follow)
        defaultCamera.rotation.set(-Math.PI / 2, 0, Math.PI + (-steeringValue * speed) / 60)
      } else {
        if (camera === 'FIRST_PERSON') {
          chaseOffset.set(0.3 + (Math.sin(-steeringValue) * speed) / 30, 0.4, -0.1)
        } else {
          const lateral = handMode ? 0 : (Math.sin(steeringValue) * speed) / 2.5
          const height = handMode ? 1.35 : 1.25 + (engineValue / 1000) * -0.5
          const distance = handMode ? -4.2 : -4.5 - speed / 18 + (braking ? 1 : 0)
          chaseOffset.set(lateral, height, distance)
        }

        chaseOffset.applyQuaternion(yawQuat)
        lookTarget.copy(worldPos).add(chaseOffset)
        defaultCamera.position.lerp(lookTarget, follow)

        forward.set(0, 0, 1).applyQuaternion(yawQuat)
        lookTarget.copy(worldPos).addScaledVector(forward, 4)
        lookTarget.y = worldPos.y + 0.85
        defaultCamera.up.set(0, 1, 0)
        defaultCamera.lookAt(lookTarget)

        const swivelZ = handMode ? 0 : (-steeringValue * speed) / (camera === 'DEFAULT' ? 40 : 60)
        if (swivelZ !== 0) defaultCamera.rotateZ(swivelZ)
      }
    }

    // lean chassis — dampen visual lean at low speed in motion mode
    const leanScale = motionMode && speed < 2 ? 0.35 : 1
    chassisBody.current!.children[0].rotation.z = MathUtils.lerp(
      chassisBody.current!.children[0].rotation.z,
      ((-steeringValue * speed) / 200) * leanScale,
      delta * 4,
    )

    if (!motionMode) {
      // Camera sway
      swaySpeed = isBoosting ? 60 : 30
      swayTarget = isBoosting ? (speed / maxSpeed) * 8 : (speed / maxSpeed) * 2
      swayValue = isBoosting ? (speed / maxSpeed + 0.25) * 30 : MathUtils.lerp(swayValue, swayTarget, delta * (isBoosting ? 10 : 20))
      defaultCamera.rotation.z += (Math.sin(state.clock.elapsedTime * swaySpeed * 0.9) / 1000) * swayValue
      defaultCamera.rotation.x += (Math.sin(state.clock.elapsedTime * swaySpeed) / 1000) * swayValue

      // Vibrations
      chassisBody.current!.children[0].rotation.x = (Math.sin(state.clock.getElapsedTime() * 20) * (speed / maxSpeed)) / 100
      chassisBody.current!.children[0].rotation.z = (Math.cos(state.clock.getElapsedTime() * 20) * (speed / maxSpeed)) / 100
    } else {
      chassisBody.current!.children[0].rotation.x = 0
    }
  })

  const ToggledAccelerateAudio = useToggle(AccelerateAudio, ['ready', 'sound'])
  const ToggledEngineAudio = useToggle(EngineAudio, ['ready', 'sound'])

  return (
    <group>
      <Chassis ref={chassisBody} {...{ angularVelocity, position, rotation }}>
        <ToggledAccelerateAudio />
        <BoostAudio />
        <BrakeAudio />
        <ToggledEngineAudio />
        <HonkAudio />
        <Boost />
        {children}
      </Chassis>
      <Cameras />
      <>
        {wheels.map((wheel, index) => (
          <Wheel ref={wheel} leftSide={!(index % 2)} key={index} />
        ))}
      </>
      <Dust />
      <Skid />
    </group>
  )
}
