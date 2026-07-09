import { useEffect } from 'react'
import { keys } from '../keys'
import { getState, isControl, useStore } from '../store'
import type { BindableActionName } from '../store'

export function useKeyboardAdapter() {
  const [actionInputMap, actions, binding] = useStore(({ actionInputMap, actions, binding }) => [actionInputMap, actions, binding])

  useEffect(() => {
    if (binding) return

    const keyMap: Partial<Record<string, BindableActionName>> = keys(actionInputMap).reduce(
      (out, actionName) => ({ ...out, ...actionInputMap[actionName].reduce((inputs, input) => ({ ...inputs, [input]: actionName }), {}) }),
      {},
    )

    const downHandler = ({ key, target }: KeyboardEvent) => {
      const actionName = keyMap[key.toLowerCase()]
      if (!actionName || (target as HTMLElement).nodeName === 'INPUT' || !isControl(actionName)) return
      actions[actionName](true)
    }

    const upHandler = ({ key, target }: KeyboardEvent) => {
      const actionName = keyMap[key.toLowerCase()]
      if (!actionName || (target as HTMLElement).nodeName === 'INPUT') return
      if (isControl(actionName)) {
        actions[actionName](false)
        return
      }
      actions[actionName]()
    }

    window.addEventListener('keydown', downHandler, { passive: true })
    window.addEventListener('keyup', upHandler, { passive: true })

    return () => {
      window.removeEventListener('keydown', downHandler)
      window.removeEventListener('keyup', upHandler)
    }
  }, [actionInputMap, actions, binding])
}
