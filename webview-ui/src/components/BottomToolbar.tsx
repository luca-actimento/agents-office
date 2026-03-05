import { useState, useEffect, useRef, useCallback } from 'react'
import { SettingsModal } from './SettingsModal.js'
import type { WorkspaceFolder, ProjectEntry, LayoutEntry } from '../hooks/useExtensionMessages.js'
import { vscode } from '../vscodeApi.js'

interface BottomToolbarProps {
  isEditMode: boolean
  onToggleEditMode: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  workspaceFolders: WorkspaceFolder[]
  projects: ProjectEntry[]
  layouts: { builtin: LayoutEntry[]; user: LayoutEntry[] }
  projectIdentities: Record<string, { palette: number; hueShift: number }>
  isCatalogOpen?: boolean
  onToggleCatalog?: () => void
  isTerminalOpen?: boolean
  onToggleTerminal?: () => void
  onOpenInBrowser?: () => void
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: 10,
  zIndex: 'var(--pixel-controls-z)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: 'var(--pixel-shadow)',
}

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '24px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--pixel-active-bg)',
  border: '2px solid var(--pixel-accent)',
}

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  left: 0,
  marginBottom: 4,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  boxShadow: 'var(--pixel-shadow)',
  minWidth: 200,
  maxHeight: 320,
  overflowY: 'auto',
  zIndex: 'var(--pixel-controls-z)',
}

function projectDisplayName(name: string): string {
  return name.replace(/[-_]/g, ' ')
}

interface ProjectDropdownProps {
  projects: ProjectEntry[]
  workspaceFolders: WorkspaceFolder[]
  model: string
  onClose: () => void
}

function ProjectDropdown({ projects, workspaceFolders, model, onClose }: ProjectDropdownProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  const handleSelect = (p: { name: string; path: string }) => {
    onClose()
    vscode.postMessage({ type: 'openClaude', folderPath: p.path, model })
  }

  const handleBrowse = () => {
    onClose()
    vscode.postMessage({ type: 'pickFolderAndOpenClaude', model })
  }

  const itemStyle = (key: string): React.CSSProperties => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 10px',
    fontSize: '22px',
    color: 'var(--pixel-text)',
    background: hovered === key ? 'var(--pixel-btn-hover-bg)' : 'transparent',
    border: 'none',
    borderRadius: 0,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  // Combine workspace folders (at top) + discovered projects, deduped by path
  const wsPaths = new Set(workspaceFolders.map(f => f.path))
  const filteredProjects = projects.filter(p => !wsPaths.has(p.path))

  return (
    <div style={dropdownStyle}>
      {workspaceFolders.length > 0 && (
        <>
          <div style={{ padding: '3px 10px', fontSize: '18px', color: 'var(--pixel-text-dim)', opacity: 0.6 }}>
            Workspace
          </div>
          {workspaceFolders.map(f => (
            <button
              key={f.path}
              onClick={() => handleSelect(f)}
              onMouseEnter={() => setHovered(f.path)}
              onMouseLeave={() => setHovered(null)}
              style={itemStyle(f.path)}
            >
              {f.name}
            </button>
          ))}
          {filteredProjects.length > 0 && (
            <div style={{ borderTop: '1px solid var(--pixel-border)', margin: '2px 0' }} />
          )}
        </>
      )}
      {filteredProjects.length > 0 && (
        <>
          <div style={{ padding: '3px 10px', fontSize: '18px', color: 'var(--pixel-text-dim)', opacity: 0.6 }}>
            Projekte
          </div>
          {filteredProjects.map(p => (
            <button
              key={p.path}
              onClick={() => handleSelect(p)}
              onMouseEnter={() => setHovered(p.path)}
              onMouseLeave={() => setHovered(null)}
              style={itemStyle(p.path)}
            >
              {projectDisplayName(p.name)}
            </button>
          ))}
        </>
      )}
      <div style={{ borderTop: '1px solid var(--pixel-border)', margin: '2px 0' }} />
      <button
        onClick={handleBrowse}
        onMouseEnter={() => setHovered('__browse__')}
        onMouseLeave={() => setHovered(null)}
        style={itemStyle('__browse__')}
      >
        Browse...
      </button>
    </div>
  )
}


interface SplitAgentButtonProps {
  label: string
  model: string
  projects: ProjectEntry[]
  workspaceFolders: WorkspaceFolder[]
  mainStyle: React.CSSProperties
  mainHoverStyle: React.CSSProperties
  arrowActiveStyle: React.CSSProperties
}

function SplitAgentButton({ label, model, projects, workspaceFolders, mainStyle, mainHoverStyle, arrowActiveStyle }: SplitAgentButtonProps) {
  const [hoveredPart, setHoveredPart] = useState<'main' | 'arrow' | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [isOpen, handleOutsideClick])

  const isHoverMain = hoveredPart === 'main'
  const isHoverArrow = hoveredPart === 'arrow' || isOpen

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex' }}>
      <button
        onClick={() => vscode.postMessage({ type: 'openClaude', model })}
        onMouseEnter={() => setHoveredPart('main')}
        onMouseLeave={() => setHoveredPart(null)}
        style={{ ...mainStyle, ...(isHoverMain ? mainHoverStyle : {}), borderRight: 'none' }}
        title={`${label} im aktuellen Workspace starten`}
      >
        {label}
      </button>
      <button
        onClick={() => setIsOpen((v) => !v)}
        onMouseEnter={() => setHoveredPart('arrow')}
        onMouseLeave={() => setHoveredPart(null)}
        style={{ ...mainStyle, ...(isHoverArrow ? arrowActiveStyle : {}), padding: '5px 6px', fontSize: '13px' }}
        title="Projekt auswählen"
      >
        ▾
      </button>
      {isOpen && (
        <ProjectDropdown
          projects={projects}
          workspaceFolders={workspaceFolders}
          model={model}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  )
}

export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isDebugMode,
  onToggleDebugMode,
  workspaceFolders,
  projects,
  layouts,
  projectIdentities,
  isCatalogOpen,
  onToggleCatalog,
  isTerminalOpen,
  onToggleTerminal,
  onOpenInBrowser,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isProjectsOpen, setIsProjectsOpen] = useState(false)
  const projectsRef = useRef<HTMLDivElement>(null)

  // Close projects dropdown on outside click
  useEffect(() => {
    if (!isProjectsOpen) return
    const handleClick = (e: MouseEvent) => {
      if (projectsRef.current && !projectsRef.current.contains(e.target as Node)) {
        setIsProjectsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isProjectsOpen])

  return (
    <div style={panelStyle}>
      <SplitAgentButton
        label="+ Agent"
        model="sonnet"
        projects={projects}
        workspaceFolders={workspaceFolders}
        mainStyle={{ ...btnBase, padding: '5px 12px', background: 'var(--pixel-agent-bg)', border: '2px solid var(--pixel-agent-border)', color: 'var(--pixel-agent-text)' }}
        mainHoverStyle={{ background: 'var(--pixel-agent-hover-bg)' }}
        arrowActiveStyle={{ background: 'var(--pixel-agent-hover-bg)' }}
      />
      <SplitAgentButton
        label="+ Opus"
        model="opus"
        projects={projects}
        workspaceFolders={workspaceFolders}
        mainStyle={{ ...btnBase, padding: '5px 12px', background: 'rgba(140, 50, 180, 0.85)', border: '2px solid rgba(200, 120, 255, 0.8)', color: '#fff' }}
        mainHoverStyle={{ background: 'rgba(180, 80, 220, 0.95)', boxShadow: '0 0 8px rgba(180, 80, 255, 0.6)' }}
        arrowActiveStyle={{ background: 'rgba(180, 80, 220, 0.95)', boxShadow: '0 0 8px rgba(180, 80, 255, 0.6)' }}
      />

      {onToggleTerminal && (
        <button
          onClick={onToggleTerminal}
          onMouseEnter={() => setHovered('terminal')}
          onMouseLeave={() => setHovered(null)}
          style={
            isTerminalOpen
              ? { ...btnActive }
              : {
                  ...btnBase,
                  background: hovered === 'terminal' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
                }
          }
          title="Toggle terminal panel"
        >
          Terminal
        </button>
      )}

      {onOpenInBrowser && (
        <button
          onClick={onOpenInBrowser}
          onMouseEnter={() => setHovered('browser')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            background: hovered === 'browser' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
          }}
          title="Open in Browser (starts local server)"
        >
          🌐
        </button>
      )}

      <button
        onClick={onToggleEditMode}
        onMouseEnter={() => setHovered('edit')}
        onMouseLeave={() => setHovered(null)}
        style={
          isEditMode
            ? { ...btnActive }
            : {
                ...btnBase,
                background: hovered === 'edit' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
              }
        }
        title="Edit office layout"
      >
        Layout
      </button>
      {onToggleCatalog && (
        <button
          onClick={onToggleCatalog}
          onMouseEnter={() => setHovered('furniture')}
          onMouseLeave={() => setHovered(null)}
          style={
            isCatalogOpen
              ? { ...btnActive }
              : {
                  ...btnBase,
                  background: hovered === 'furniture' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
                }
          }
          title="Furniture catalog"
        >
          Furniture
        </button>
      )}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsSettingsOpen((v) => !v)}
          onMouseEnter={() => setHovered('settings')}
          onMouseLeave={() => setHovered(null)}
          style={
            isSettingsOpen
              ? { ...btnActive }
              : {
                  ...btnBase,
                  background: hovered === 'settings' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
                }
          }
          title="Settings"
        >
          Settings
        </button>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          isDebugMode={isDebugMode}
          onToggleDebugMode={onToggleDebugMode}
          layouts={layouts}
          onRequestLayouts={() => vscode.postMessage({ type: 'listLayouts' })}
          onLoadLayout={(filename) => vscode.postMessage({ type: 'loadLayout', filename })}
          onSaveLayoutAs={(name) => vscode.postMessage({ type: 'saveLayoutAs', name })}
          projectIdentities={projectIdentities}
          onSaveProjectIdentities={(identities) => vscode.postMessage({ type: 'saveProjectIdentities', identities })}
        />
      </div>

      {/* Projects-Picker: rechts von Settings */}
      <div ref={projectsRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setIsProjectsOpen((v) => !v)}
          onMouseEnter={() => setHovered('projects')}
          onMouseLeave={() => setHovered(null)}
          style={
            isProjectsOpen
              ? { ...btnActive }
              : {
                  ...btnBase,
                  background: hovered === 'projects' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
                }
          }
          title="Projekt öffnen"
        >
          Projects
        </button>
        {isProjectsOpen && (
          <ProjectDropdown
            projects={projects}
            workspaceFolders={workspaceFolders}
            model="sonnet"
            onClose={() => setIsProjectsOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
