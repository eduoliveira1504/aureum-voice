/** Block 4.1.2: a connection that went silent is replaced, so the app re-sends its call state. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ getApiBaseUrl: () => 'http://api.test', getFreshAccessToken: async () => 'tok' }))

import { DEVICE_ID, Realtime } from './realtime'

class FakeSocket {
  static OPEN = 1
  static all: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((m: { data: string }) => void) | null = null
  onclose: ((c: { code: number }) => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  open(): void {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  receive(type: string): void {
    this.onmessage?.({ data: JSON.stringify({ type, data: {} }) })
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true // a dead network: no close event arrives
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function started(): Promise<{ realtime: Realtime; onStatus: ReturnType<typeof vi.fn> }> {
  const onStatus = vi.fn()
  const realtime = new Realtime(() => {}, onStatus)
  realtime.start()
  await vi.advanceTimersByTimeAsync(0)
  FakeSocket.all[0].open()
  FakeSocket.all[0].receive('ready')
  return { realtime, onStatus }
}

describe('realtime connection', () => {
  it("tells the API which app run it is (this device)", async () => {
    const { realtime } = await started()
    expect(FakeSocket.all[0].url).toContain(`&device=${DEVICE_ID}`)
    realtime.stop()
  })

  it('stays while the API answers the pings', async () => {
    const { realtime } = await started()
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(25_000)
      FakeSocket.all[0].receive('pong')
    }
    expect(FakeSocket.all).toHaveLength(1)
    expect(FakeSocket.all[0].closed).toBe(false)
    realtime.stop()
  })

  it('drops a connection that went silent and opens a new one', async () => {
    const { realtime, onStatus } = await started()
    // Pings go out, nothing comes back (the network changed under an open socket).
    await vi.advanceTimersByTimeAsync(75_000)
    expect(FakeSocket.all[0].closed).toBe(true)
    expect(onStatus).toHaveBeenLastCalledWith('connecting')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeSocket.all).toHaveLength(2)
    realtime.stop()
  })
})
