import { useState, useEffect, useRef } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { TILE_SIZE } from '../constants.js'
import { CHEFZIMMER_LABEL_COL, CHEFZIMMER_LABEL_ROW, CHEFZIMMER_BUTTON_COL, CHEFZIMMER_BUTTON_ROW } from '../constants.js'
import { vscode } from '../vscodeApi.js'
import type { ProjectEntry, WorkspaceFolder } from '../hooks/useExtensionMessages.js'

interface ChefzimmerOverlayProps {
  officeState: OfficeState
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  isEditMode: boolean
  projects: ProjectEntry[]
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

function projectDisplayName(name: string): string {
  return name.replace(/[-_]/g, ' ')
}

interface OpusPickerProps {
  projects: ProjectEntry[]
  workspaceFolders: WorkspaceFolder[]
  onClose: () => void
  anchorX: number
  anchorY: number
}

function OpusPicker({ projects, workspaceFolders, onClose, anchorX, anchorY }: OpusPickerProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const handleSelect = (p: { name: string; path: string }) => {
    onClose()
    vscode.postMessage({ type: 'openClaude', folderPath: p.path, model: 'opus' })
  }

  const handleDirect = () => {
    onClose()
    vscode.postMessage({ type: 'openClaude', model: 'opus' })
  }

  const handleBrowse = () => {
    onClose()
    vscode.postMessage({ type: 'pickFolderAndOpenClaude', model: 'opus' })
  }

  const itemStyle = (key: string): React.CSSProperties => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 10px',
    fontSize: '20px',
    color: '#fff',
    background: hovered === key ? 'rgba(180, 80, 220, 0.4)' : 'transparent',
    border: 'none',
    borderRadius: 0,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  const wsPaths = new Set(workspaceFolders.map(f => f.path))
  const filteredProjects = projects.filter(p => !wsPaths.has(p.path))

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: anchorX,
        top: anchorY,
        transform: 'translate(-50%, -100%)',
        background: 'rgba(20, 10, 35, 0.97)',
        border: '2px solid rgba(200, 120, 255, 0.8)',
        borderRadius: 0,
        boxShadow: '0 0 12px rgba(180, 80, 255, 0.4)',
        minWidth: 200,
        maxHeight: 300,
        overflowY: 'auto',
        zIndex: 50,
      }}
    >
      {/* Direkt im aktuellen Workspace öffnen */}
      <button
        onClick={handleDirect}
        onMouseEnter={() => setHovered('__direct__')}
        onMouseLeave={() => setHovered(null)}
        style={{ ...itemStyle('__direct__'), fontWeight: 'bold' }}
      >
        ★ Aktueller Workspace
      </button>
      {(workspaceFolders.length > 0 || filteredProjects.length > 0) && (
        <div style={{ borderTop: '1px solid rgba(200,120,255,0.3)', margin: '2px 0' }} />
      )}
      {workspaceFolders.length > 0 && (
        <>
          <div style={{ padding: '3px 10px', fontSize: '16px', color: 'rgba(200,120,255,0.6)' }}>Workspace</div>
          {workspaceFolders.map(f => (
            <button key={f.path} onClick={() => handleSelect(f)} onMouseEnter={() => setHovered(f.path)} onMouseLeave={() => setHovered(null)} style={itemStyle(f.path)}>
              {f.name}
            </button>
          ))}
        </>
      )}
      {filteredProjects.length > 0 && (
        <>
          <div style={{ padding: '3px 10px', fontSize: '16px', color: 'rgba(200,120,255,0.6)' }}>Projekte</div>
          {filteredProjects.map(p => (
            <button key={p.path} onClick={() => handleSelect(p)} onMouseEnter={() => setHovered(p.path)} onMouseLeave={() => setHovered(null)} style={itemStyle(p.path)}>
              {projectDisplayName(p.name)}
            </button>
          ))}
        </>
      )}
      <div style={{ borderTop: '1px solid rgba(200,120,255,0.3)', margin: '2px 0' }} />
      <button onClick={handleBrowse} onMouseEnter={() => setHovered('__browse__')} onMouseLeave={() => setHovered(null)} style={itemStyle('__browse__')}>
        Browse...
      </button>
    </div>
  )
}

export function ChefzimmerOverlay({
  officeState,
  containerRef,
  zoom,
  panRef,
  isEditMode,
  projects,
}: ChefzimmerOverlayProps) {
  const [, setTick] = useState(0)
  const [hovered, setHovered] = useState<'opus' | 'arrow' | null>(null)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [pickerAnchor, setPickerAnchor] = useState({ x: 0, y: 0 })

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

  const handleArrowClick = (e: React.MouseEvent) => {
    const groupEl = (e.currentTarget as HTMLElement).closest('[data-opus-group]') as HTMLElement
    const rect = groupEl ? groupEl.getBoundingClientRect() : (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPickerAnchor({ x: rect.left + rect.width / 2, y: rect.top - 4 })
    setIsPickerOpen((v) => !v)
  }

  // Workspace folders not available here, Projects button in toolbar covers that
  const workspaceFolders: WorkspaceFolder[] = []

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

      {/* Opus Button + Picker-Arrow nebeneinander */}
      <div
        data-opus-group="1"
        style={{
          position: 'absolute',
          left: buttonPos.x,
          top: buttonPos.y,
          transform: 'translate(-50%, -50%)',
          zIndex: 36,
          display: 'flex',
          alignItems: 'stretch',
        }}
      >
        <button
          onClick={handleOpusClick}
          onMouseEnter={() => setHovered('opus')}
          onMouseLeave={() => setHovered(null)}
          style={{
            cursor: 'pointer',
            fontSize: '18px',
            padding: '3px 10px',
            color: '#fff',
            background: hovered === 'opus'
              ? 'rgba(180, 80, 220, 0.95)'
              : 'rgba(140, 50, 180, 0.85)',
            border: '2px solid rgba(200, 120, 255, 0.8)',
            borderRight: 'none',
            borderRadius: 0,
            boxShadow: hovered === 'opus' ? '0 0 8px rgba(180, 80, 255, 0.6)' : 'none',
            whiteSpace: 'nowrap',
            letterSpacing: '0.5px',
            transition: 'background 0.15s',
          }}
          title="Opus-Agent im aktuellen Workspace starten"
        >
          + Opus
        </button>
        <button
          onClick={handleArrowClick}
          onMouseEnter={() => setHovered('arrow')}
          onMouseLeave={() => setHovered(null)}
          style={{
            cursor: 'pointer',
            fontSize: '13px',
            padding: '3px 5px',
            color: '#fff',
            background: hovered === 'arrow' || isPickerOpen
              ? 'rgba(180, 80, 220, 0.95)'
              : 'rgba(140, 50, 180, 0.85)',
            border: '2px solid rgba(200, 120, 255, 0.8)',
            borderRadius: 0,
            boxShadow: hovered === 'arrow' || isPickerOpen ? '0 0 8px rgba(180, 80, 255, 0.6)' : 'none',
            transition: 'background 0.15s',
          }}
          title="Projekt auswählen"
        >
          ▾
        </button>
      </div>

      {isPickerOpen && (
        <OpusPicker
          projects={projects}
          workspaceFolders={workspaceFolders}
          onClose={() => setIsPickerOpen(false)}
          anchorX={pickerAnchor.x}
          anchorY={pickerAnchor.y}
        />
      )}
    </>
  )
}
