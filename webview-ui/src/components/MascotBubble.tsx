import { useState, useEffect } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { TILE_SIZE, CharacterState } from '../office/types.js'
import { CHARACTER_SITTING_OFFSET_PX, BUBBLE_FADE_DURATION_SEC } from '../constants.js'

interface MascotBubbleProps {
  officeState: OfficeState
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
}

export function MascotBubble({ officeState, containerRef, zoom, panRef }: MascotBubbleProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    let rafId = 0
    const tick = () => { setTick((n) => n + 1); rafId = requestAnimationFrame(tick) }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const el = containerRef.current
  if (!el) return null

  const mascot = officeState.characters.get(-999)
  if (!mascot || !mascot.bubbleType || !mascot.bubbleText) return null

  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)
  const layout = officeState.getLayout()
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

  const sittingOff = mascot.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
  const screenX = (deviceOffsetX + mascot.x * zoom) / dpr
  const screenY = (deviceOffsetY + (mascot.y + sittingOff) * zoom) / dpr

  // Fade out in last 0.5s
  const alpha = mascot.bubbleTimer < BUBBLE_FADE_DURATION_SEC
    ? Math.max(0, mascot.bubbleTimer / BUBBLE_FADE_DURATION_SEC)
    : 1

  return (
    <div
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        transform: 'translate(-50%, -100%)',
        zIndex: 60,
        pointerEvents: 'none',
        opacity: alpha,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginTop: `-${Math.round(16 * zoom / dpr)}px`,
      }}
    >
      {/* Bubble box */}
      <div style={{
        background: '#EEEEFF',
        border: '1.5px solid #555566',
        borderRadius: 4,
        padding: '3px 7px',
        fontSize: Math.max(8, Math.round(16 * zoom / dpr / 3)),
        color: '#333344',
        maxWidth: Math.round(16 * zoom / dpr * 5),
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        lineHeight: 1.3,
      }}>
        {mascot.bubbleText}
      </div>
      {/* Tail */}
      <div style={{
        width: 0,
        height: 0,
        borderLeft: '5px solid transparent',
        borderRight: '5px solid transparent',
        borderTop: '6px solid #555566',
        marginTop: -1,
      }} />
      <div style={{
        width: 0,
        height: 0,
        borderLeft: '4px solid transparent',
        borderRight: '4px solid transparent',
        borderTop: '5px solid #EEEEFF',
        marginTop: -10,
      }} />
    </div>
  )
}
