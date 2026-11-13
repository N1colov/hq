// Thin wrapper over the Even Hub bridge:
// - every call is serialised (the BLE link does not like concurrent calls)
// - every call has a timeout (a flaky hop can otherwise hang ~30 s)
// - outside the Even app we fall back to a mock so the phone UI still works
import {
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'

export type HubEventHandler = (e: EvenHubEvent) => void

let real: EvenAppBridge | null = null
let chain: Promise<unknown> = Promise.resolve()

export const isReal = () => real !== null

export async function connect(timeoutMs = 4000): Promise<boolean> {
  try {
    real = (await Promise.race([
      waitForEvenAppBridge(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('no bridge')), timeoutMs)),
    ])) as EvenAppBridge
    return true
  } catch {
    real = null
    return false
  }
}

export function bridge(): EvenAppBridge | null {
  return real
}

/** Queue a bridge call behind all previous ones, with a timeout. */
export function call<T>(fn: (b: EvenAppBridge) => Promise<T>, fallback: T, timeoutMs = 6000): Promise<T> {
  const run = async (): Promise<T> => {
    if (!real) return fallback
    try {
      return (await Promise.race([
        fn(real),
        new Promise<T>(res => setTimeout(() => res(fallback), timeoutMs)),
      ])) as T
    } catch (err) {
      console.warn('[hq] bridge call failed', err)
      return fallback
    }
  }
  const p = chain.then(run, run)
  chain = p.catch(() => undefined)
  return p
}

// ---------------------------------------------------------------- storage

const LS_PREFIX = 'hq:'

export async function storageGet(key: string): Promise<string> {
  const fromBridge = await call(b => b.getLocalStorage(key), '')
  if (fromBridge) return fromBridge
  try {
    return window.localStorage.getItem(LS_PREFIX + key) ?? ''
  } catch {
    return ''
  }
}

export async function storageSet(key: string, value: string): Promise<void> {
  try {
    window.localStorage.setItem(LS_PREFIX + key, value)
  } catch {
    /* storage can throw in some webviews */
  }
  await call(b => b.setLocalStorage(key, value), false)
}
