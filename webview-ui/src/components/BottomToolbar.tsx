import { useState, useEffect, useRef } from 'react'
import { SettingsModal } from './SettingsModal.js'
import type { WorkspaceFolder, ProjectEntry } from '../hooks/useExtensionMessages.js'
import { vscode } from '../vscodeApi.js'

interface BottomToolbarProps {
  isEditMode: boolean
  onToggleEditMode: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  workspaceFolders: WorkspaceFolder[]
  projects: ProjectEntry[]
  isCatalogOpen?: boolean
  onToggleCatalog?: () => void
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


export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isDebugMode,
  onToggleDebugMode,
  workspaceFolders,
  projects,
  isCatalogOpen,
  onToggleCatalog,
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

  const handleAgentClick = () => {
    vscode.postMessage({ type: 'openClaude', model: 'sonnet' })
  }

  return (
    <div style={panelStyle}>
      {/* +Agent: direkt öffnen, kein Dropdown */}
      <button
        onClick={handleAgentClick}
        onMouseEnter={() => setHovered('agent')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          padding: '5px 12px',
          background: hovered === 'agent' ? 'var(--pixel-agent-hover-bg)' : 'var(--pixel-agent-bg)',
          border: '2px solid var(--pixel-agent-border)',
          color: 'var(--pixel-agent-text)',
        }}
      >
        + Agent
      </button>

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
