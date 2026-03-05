import { useState, useEffect } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { TILE_SIZE } from '../constants.js'
import { CHEFZIMMER_LABEL_COL, CHEFZIMMER_LABEL_ROW } from '../constants.js'

interface ChefzimmerOverlayProps {
  officeState: OfficeState
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  isEditMode: boolean
}

function tileToScreen(
  col: number,
  row: number,
  zoom: number,
  panRef: React.RefObject<{ x: number; y: number }>,
  canvasW: number,
  canvasH: number,
  mapW: number,
  mapH: number,
  dpr: number,
): { x: number; y: number } {
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)
  return {
    x: (deviceOffsetX + col * TILE_SIZE * zoom) / dpr,
    y: (deviceOffsetY + row * TILE_SIZE * zoom) / dpr,
  }
}

export function ChefzimmerOverlay({
  officeState,
  containerRef,
  zoom,
  panRef,
  isEditMode,
}: ChefzimmerOverlayProps) {
  const [, setTick] = useState(0)

  // Re-render each frame to track pan/zoom
  useEffect(() => {
    let rafId = 0
    const tick = () => {
      setTick((n) => n + 1)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const el = containerRef.current
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)
  const layout = officeState.getLayout()
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom

  const labelPos = tileToScreen(CHEFZIMMER_LABEL_COL, CHEFZIMMER_LABEL_ROW, zoom, panRef, canvasW, canvasH, mapW, mapH, dpr)

  return (
    <>
      {/* Chefzimmer Label – nur im Edit-Mode */}
      {isEditMode && (
        <div
          style={{
            position: 'absolute',
            left: labelPos.x,
            top: labelPos.y,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            zIndex: 35,
            fontSize: '18px',
            color: 'var(--pixel-text-dim)',
            background: 'rgba(30, 30, 46, 0.6)',
            padding: '1px 6px',
            border: '1px solid var(--pixel-border)',
            borderRadius: 0,
            whiteSpace: 'nowrap',
            letterSpacing: '1px',
          }}
        >
          Chefzimmer
        </div>
      )}
    </>
  )
}
