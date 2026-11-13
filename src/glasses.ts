// Sends PageSpecs to the glasses. Full rebuilds only when the layout changes;
// otherwise flicker-free in-place text updates for the boxes that changed.
import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import { call, isReal } from './bridge'
import { structureKey, type PageSpec, type TextBox } from './view'

let started = false
let nextStartTry = 0
let lastKey = ''
const lastText = new Map<string, string>()
let rendering = false
let pending: PageSpec | null = null

/** Latest spec, mirrored into the phone-side preview. */
export let lastSpec: PageSpec | null = null

function textProp(b: TextBox, capture: boolean): TextContainerProperty {
  const p: Partial<TextContainerProperty> = {
    xPosition: b.x,
    yPosition: b.y,
    width: b.w,
    height: b.h,
    borderWidth: b.border ?? 0,
    borderColor: b.borderColor ?? 0,
    borderRadius: b.radius ?? 0,
    paddingLength: b.pad ?? 0,
    containerID: b.id,
    containerName: b.name,
    isEventCapture: capture ? 1 : 0,
    content: (b.text || ' ').slice(0, 999),
  }
  if (b.dim !== undefined) p.textColor = b.dim
  return new TextContainerProperty(p)
}

function toPayload(spec: PageSpec) {
  const hasListCapture = !!spec.list
  const textObject = spec.texts.map(b => textProp(b, !hasListCapture && !!b.capture))
  const listObject = spec.list
    ? [
        new ListContainerProperty({
          xPosition: spec.list.x,
          yPosition: spec.list.y,
          width: spec.list.w,
          height: spec.list.h,
          borderWidth: 0,
          borderColor: 0,
          borderRadius: 0,
          paddingLength: 4,
          containerID: spec.list.id,
          containerName: spec.list.name,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: spec.list.items.length,
            itemWidth: 0,
            isItemSelectBorderEn: 1,
            itemName: spec.list.items.map(i => i.slice(0, 63)),
          }),
        }),
      ]
    : undefined
  return {
    containerTotalNum: textObject.length + (listObject?.length ?? 0),
    textObject,
    ...(listObject ? { listObject } : {}),
  }
}

/** Force the next render to rebuild the page (e.g. after coming back to the foreground). */
export function invalidate(): void {
  lastKey = ''
  lastText.clear()
}

export async function render(spec: PageSpec): Promise<void> {
  lastSpec = spec
  if (!isReal()) return
  if (rendering) {
    pending = spec
    return
  }
  rendering = true
  try {
    await renderNow(spec)
    while (pending) {
      const next = pending
      pending = null
      await renderNow(next)
    }
  } finally {
    rendering = false
  }
}

async function renderNow(spec: PageSpec): Promise<void> {
  const key = structureKey(spec)
  if (!started) {
    // Outside the Even app the bridge exists but nothing answers: back off instead of spamming.
    if (Date.now() < nextStartTry) return
    nextStartTry = Date.now() + 15_000
    const res = (await call(b => b.createStartUpPageContainer(new CreateStartUpPageContainer(toPayload(spec))), -1 as never)) as number
    if (res === 0) {
      started = true
    } else {
      // Already started in this session (e.g. page reloaded after Spotify login): rebuild instead.
      const ok = await call(b => b.rebuildPageContainer(new RebuildPageContainer(toPayload(spec))), false)
      started = ok
      if (!ok) console.warn('[hq] glasses not reachable (startup result', res, ')')
    }
    if (!started) return
    lastKey = key
    lastText.clear()
    spec.texts.forEach(b => lastText.set(b.name, b.text))
    return
  }
  if (key !== lastKey) {
    await call(b => b.rebuildPageContainer(new RebuildPageContainer(toPayload(spec))), false)
    lastKey = key
    lastText.clear()
    spec.texts.forEach(b => lastText.set(b.name, b.text))
    return
  }
  for (const b of spec.texts) {
    const text = b.text || ' '
    if (lastText.get(b.name) === text) continue
    lastText.set(b.name, text)
    await call(
      br =>
        br.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: b.id,
            containerName: b.name,
            contentOffset: 0,
            contentLength: 0,
            content: text.slice(0, 1999),
          }),
        ),
      false,
    )
  }
}

export function isStarted(): boolean {
  return started
}
