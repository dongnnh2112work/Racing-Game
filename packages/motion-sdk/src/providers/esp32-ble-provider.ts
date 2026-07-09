import { decodeMotionPacket, encodeControlCommand, packetToMotionFrame } from '../packet-decoder'
import { MOTION_NOTIFY_CHAR_UUID, MOTION_SERVICE_UUID, MOTION_WRITE_CHAR_UUID } from '../types'
import type { MotionFrame } from '../types'
import type { MotionProvider, ProviderStatus } from '../provider'

declare global {
  interface Navigator {
    bluetooth?: {
      requestDevice(options: { filters: Array<{ namePrefix?: string; services?: string[] }>; optionalServices?: string[] }): Promise<BluetoothDevice>
    }
  }
  interface BluetoothDevice {
    name?: string
    gatt?: { connect(): Promise<BluetoothRemoteGATTServer>; disconnect(): void }
    addEventListener(type: 'gattserverdisconnected', listener: () => void): void
    removeEventListener(type: 'gattserverdisconnected', listener: () => void): void
  }
  interface BluetoothRemoteGATTServer {
    getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>
  }
  interface BluetoothRemoteGATTService {
    getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>
  }
  interface BluetoothRemoteGATTCharacteristic {
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
    writeValue(value: BufferSource): Promise<void>
    addEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void
    removeEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void
    value?: DataView
  }
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
}

export class Esp32BleProvider implements MotionProvider {
  readonly type = 'esp32-ble' as const
  readonly id: string
  private device: BluetoothDevice | null = null
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null
  private status: ProviderStatus = { state: 'idle' }
  private frameCallbacks = new Set<(frame: MotionFrame) => void>()
  private statusCallbacks = new Set<(status: ProviderStatus) => void>()
  private onDisconnect = () => this.handleDisconnect()

  constructor(deviceId: string) {
    this.id = deviceId
  }

  static async pair(slotId: string): Promise<Esp32BleProvider> {
    if (!isWebBluetoothSupported()) {
      throw new Error('Web Bluetooth is not supported in this browser')
    }
    if (isSafari()) {
      throw new Error('Safari does not support Web Bluetooth. Use the WiFi/WebSocket path instead.')
    }
    const device = await navigator.bluetooth!.requestDevice({
      filters: [{ namePrefix: 'MotionCtrl-' }],
      optionalServices: [MOTION_SERVICE_UUID],
    })
    const shortId = device.name?.replace('MotionCtrl-', '').toLowerCase() ?? '0000'
    const provider = new Esp32BleProvider(`esp32-${shortId}`)
    provider.device = device
    void slotId
    await provider.connectGatt()
    return provider
  }

  async connect(): Promise<void> {
    if (!this.device) {
      throw new Error('Call Esp32BleProvider.pair() first')
    }
    await this.connectGatt()
  }

  private async connectGatt(): Promise<void> {
    this.setStatus({ state: 'connecting' })
    const server = await this.device!.gatt!.connect()
    const service = await server.getPrimaryService(MOTION_SERVICE_UUID)
    this.notifyChar = await service.getCharacteristic(MOTION_NOTIFY_CHAR_UUID)
    this.writeChar = await service.getCharacteristic(MOTION_WRITE_CHAR_UUID)
    this.notifyChar.addEventListener('characteristicvaluechanged', this.onNotify)
    await this.notifyChar.startNotifications()
    this.device!.addEventListener('gattserverdisconnected', this.onDisconnect)
    this.setStatus({ state: 'connected' })
  }

  disconnect(): void {
    this.notifyChar?.removeEventListener('characteristicvaluechanged', this.onNotify)
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnect)
    this.device?.gatt?.disconnect()
    this.device = null
    this.setStatus({ state: 'disconnected' })
  }

  async sendCommand(cmd: 'identify' | 'calibrate'): Promise<void> {
    if (!this.writeChar) return
    await this.writeChar.writeValue(encodeControlCommand(cmd) as BufferSource)
  }

  onFrame(callback: (frame: MotionFrame) => void): () => void {
    this.frameCallbacks.add(callback)
    return () => this.frameCallbacks.delete(callback)
  }

  getStatus(): ProviderStatus {
    return this.status
  }

  onStatusChange(callback: (status: ProviderStatus) => void): () => void {
    this.statusCallbacks.add(callback)
    callback(this.status)
    return () => this.statusCallbacks.delete(callback)
  }

  private onNotify = (event: Event): void => {
    const char = event.target as unknown as BluetoothRemoteGATTCharacteristic
    const value = char.value
    if (!value) return
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    try {
      const decoded = decodeMotionPacket(bytes)
      const frame = packetToMotionFrame(decoded, 'esp32-ble')
      frame.deviceId = this.id
      for (const cb of this.frameCallbacks) cb(frame)
    } catch {
      // ignore bad packet
    }
  }

  private handleDisconnect(): void {
    this.setStatus({ state: 'disconnected', reason: 'GATT disconnected' })
  }

  private setStatus(status: ProviderStatus): void {
    this.status = status
    for (const cb of this.statusCallbacks) cb(status)
  }
}
