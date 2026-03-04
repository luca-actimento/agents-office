import { useState, useEffect } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { TILE_SIZE } from '../constants.js'
import { CHEFZIMMER_LABEL_COL, CHEFZIMMER_LABEL_ROW, CHEFZIMMER_BUTTON_COL, CHEFZIMMER_BUTTON_ROW } from '../constants.js'
import { vscode } from '../vscodeApi.js'

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
  const [hovered, setHovered] = useState(false)

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
  const buttonPos = tileToScreen(CHEFZIMMER_BUTTON_COL, CHEFZIMMER_BUTTON_ROW, zoom, panRef, canvasW, canvasH, mapW, mapH, dpr)

  const handleOpusClick = () => {
    vscode.postMessage({ type: 'openClaude', model: 'opus' })
  }


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

      {/* Opus Button over green table */}
      <button
        onClick={handleOpusClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'absolute',
          left: buttonPos.x,
          top: buttonPos.y,
          transform: 'translate(-50%, -50%)',
          zIndex: 36,
          cursor: 'pointer',
          fontSize: '18px',
          padding: '3px 10px',
          color: '#fff',
          background: hovered
            ? 'rgba(180, 80, 220, 0.95)'
            : 'rgba(140, 50, 180, 0.85)',
          border: '2px solid rgba(200, 120, 255, 0.8)',
          borderRadius: 0,
          boxShadow: hovered
            ? '0 0 8px rgba(180, 80, 255, 0.6)'
            : '2px 2px 0px #0a0a14',
          whiteSpace: 'nowrap',
          letterSpacing: '0.5px',
          transition: 'background 0.15s, box-shadow 0.15s',
        }}
        title="Start Opus terminal in Chefzimmer"
      >
        + Opus
      </button>
    </>
  )
}
