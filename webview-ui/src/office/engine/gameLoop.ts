import { MAX_DELTA_TIME_SEC } from '../../constants.js'

export interface GameLoopCallbacks {
  update: (dt: number) => void
  render: (ctx: CanvasRenderingContext2D) => void
}

export function startGameLoop(
  canvas: HTMLCanvasElement,
  callbacks: GameLoopCallbacks,
): () => void {
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  let lastTime = 0
  let rafId = 0
  let stopped = false

  let errorCount = 0

  const frame = (time: number) => {
    if (stopped) return
    const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, MAX_DELTA_TIME_SEC)
    lastTime = time

    try {
      callbacks.update(dt)
      ctx.imageSmoothingEnabled = false
      callbacks.render(ctx)
    } catch (err) {
      errorCount++
      if (errorCount <= 3) {
        console.error('[GameLoop] render error:', err)
      }
    }

    rafId = requestAnimationFrame(frame)
  }

  rafId = requestAnimationFrame(frame)

  return () => {
    stopped = true
    cancelAnimationFrame(rafId)
  }
}
