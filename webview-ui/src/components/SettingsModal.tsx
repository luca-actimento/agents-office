import { useState } from 'react'
import { vscode } from '../vscodeApi.js'
import { isSoundEnabled, setSoundEnabled, isDoorSoundEnabled, setDoorSoundEnabled, isAgentSoundEnabled, setAgentSoundEnabled } from '../notificationSound.js'

import type { LayoutEntry } from '../hooks/useExtensionMessages.js'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  layouts: { builtin: LayoutEntry[]; user: LayoutEntry[] }
  onRequestLayouts: () => void
  onLoadLayout: (filename: string) => void
  onSaveLayoutAs: (name: string) => void
}

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '6px 10px',
  fontSize: '24px',
  color: 'rgba(255, 255, 255, 0.8)',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'left',
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      style={{
        width: 14,
        height: 14,
        border: '2px solid rgba(255, 255, 255, 0.5)',
        borderRadius: 0,
        background: checked ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        lineHeight: 1,
        color: '#fff',
      }}
    >
      {checked ? 'X' : ''}
    </span>
  )
}

export function SettingsModal({ isOpen, onClose, isDebugMode, onToggleDebugMode, layouts, onRequestLayouts, onLoadLayout, onSaveLayoutAs }: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [soundsOpen, setSoundsOpen] = useState(false)
  const [layoutsOpen, setLayoutsOpen] = useState(false)
  const [saveNameInput, setSaveNameInput] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [notifLocal, setNotifLocal] = useState(isSoundEnabled)
  const [doorSoundLocal, setDoorSoundLocal] = useState(isDoorSoundEnabled)
  const [agentSoundLocal, setAgentSoundLocal] = useState(isAgentSoundEnabled)

  if (!isOpen) return null

  const anySoundOn = notifLocal || doorSoundLocal || agentSoundLocal

  return (
    <>
      {/* Dark backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0, 0, 0, 0.5)', zIndex: 49,
        }}
      />
      {/* Modal */}
      <div
        style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)', zIndex: 50,
          background: 'var(--pixel-bg)', border: '2px solid var(--pixel-border)',
          borderRadius: 0, padding: '4px', boxShadow: 'var(--pixel-shadow)', minWidth: 220,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 10px', borderBottom: '1px solid var(--pixel-border)', marginBottom: '4px',
        }}>
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>Settings</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none', borderRadius: 0, color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '24px', cursor: 'pointer', padding: '0 4px', lineHeight: 1,
            }}
          >X</button>
        </div>

        {/* Open Sessions Folder */}
        <button
          onClick={() => { vscode.postMessage({ type: 'openSessionsFolder' }); onClose() }}
          onMouseEnter={() => setHovered('sessions')}
          onMouseLeave={() => setHovered(null)}
          style={{ ...menuItemBase, background: hovered === 'sessions' ? 'rgba(255, 255, 255, 0.08)' : 'transparent' }}
        >Open Sessions Folder</button>

        {/* Export Layout */}
        <button
          onClick={() => { vscode.postMessage({ type: 'exportLayout' }); onClose() }}
          onMouseEnter={() => setHovered('export')}
          onMouseLeave={() => setHovered(null)}
          style={{ ...menuItemBase, background: hovered === 'export' ? 'rgba(255, 255, 255, 0.08)' : 'transparent' }}
        >Export Layout</button>

        {/* Import Layout */}
        <button
          onClick={() => { vscode.postMessage({ type: 'importLayout' }); onClose() }}
          onMouseEnter={() => setHovered('import')}
          onMouseLeave={() => setHovered(null)}
          style={{ ...menuItemBase, background: hovered === 'import' ? 'rgba(255, 255, 255, 0.08)' : 'transparent' }}
        >Import Layout</button>

        {/* Sounds — expandable section */}
        <button
          onClick={() => setSoundsOpen((v) => !v)}
          onMouseEnter={() => setHovered('sounds')}
          onMouseLeave={() => setHovered(null)}
          style={{ ...menuItemBase, background: hovered === 'sounds' ? 'rgba(255, 255, 255, 0.08)' : 'transparent' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '18px', opacity: 0.6 }}>{soundsOpen ? '▼' : '▶'}</span>
            Sounds
          </span>
          {!soundsOpen && <Checkbox checked={anySoundOn} />}
        </button>

        {soundsOpen && (
          <div style={{ borderLeft: '2px solid rgba(255,255,255,0.12)', marginLeft: 14, marginBottom: 2 }}>
            {/* Notifications (done + approval) */}
            <button
              onClick={() => {
                const v = !isSoundEnabled()
                setSoundEnabled(v)
                setNotifLocal(v)
                vscode.postMessage({ type: 'setSoundEnabled', enabled: v })
              }}
              onMouseEnter={() => setHovered('notif')}
              onMouseLeave={() => setHovered(null)}
              style={{ ...menuItemBase, fontSize: '22px', padding: '5px 10px', background: hovered === 'notif' ? 'rgba(255, 255, 255, 0.08)' : 'transparent' }}
            >
              <span>Notifications</span>
              <Checkbox checked={notifLocal} />
            </button>

            {/* Door Sound */}
            <button
              onClick={() => {
                const v = !isDoorSoundEnabled()
                setDoorSoundEnabled(v)
                setDoorSoundLocal(v)
                vscode.postMessage({ type: 'setDoorSoundEnabled', enabled: v })
              }}
              onMouseEnter={() => setHovered('door')}
              onMouseLeave={() => setHovered(null)}
              style={{ ...menuItemBase, fontSize: '22px', padding: '5px 10px', background: hovered === 'door' ? 'rgba(255, 255, 255, 0.08)' : 'transparent' }}
            >
              <span>Door Sound</span>
              <Checkbox checked={doorSoundLocal} />
            </button>

            {/* Agent Sounds */}
            <button
              onClick={() => {
                const v = !isAgentSoundEnabled()
                setAgentSoundEnabled(v)
                setAgentSoundLocal(v)
                vscode.postMessage({ type: 'setAgentSoundEnabled', enabled: v })
              }}
              onMouseEnter={() => setHovered('agent')}
              onMouseLeave={() => setHovered(null)}
              style={{ ...menuItemBase, fontSize: '22px', padding: '5px 10px', background: hovered === 'agent' ? 'rgba(255, 255, 255, 0.08)' : 'transparent' }}
            >
              <span>Agent Sounds</span>
              <Checkbox checked={agentSoundLocal} />
            </button>
          </div>
        )}

        {/* Layouts — expandable section */}
        <button
          onClick={() => { setLayoutsOpen(v => !v); if (!layoutsOpen) onRequestLayouts() }}
          onMouseEnter={() => setHovered('layouts')}
          onMouseLeave={() => setHovered(null)}
          style={{ ...menuItemBase, background: hovered === 'layouts' ? 'rgba(255, 255, 255, 0.08)' : 'transparent' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '18px', opacity: 0.6 }}>{layoutsOpen ? '▼' : '▶'}</span>
            Layouts
          </span>
        </button>

        {layoutsOpen && (
          <div style={{ borderLeft: '2px solid rgba(255,255,255,0.12)', marginLeft: 14, marginBottom: 2 }}>
            {[...layouts.builtin, ...layouts.user].map(l => (
              <div key={l.filename} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px' }}>
                <span style={{ fontSize: '20px', color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {l.name}
                  {l.filename === '__builtin__' && <span style={{ fontSize: '16px', opacity: 0.5, marginLeft: 4 }}>(built-in)</span>}
                </span>
                <button
                  onClick={() => { onLoadLayout(l.filename); onClose() }}
                  onMouseEnter={() => setHovered('load-' + l.filename)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ ...menuItemBase, fontSize: '18px', padding: '2px 8px', flex: '0 0 auto', background: hovered === 'load-' + l.filename ? 'rgba(90,140,255,0.2)' : 'rgba(90,140,255,0.1)', color: 'rgba(120,160,255,0.9)' }}
                >Load</button>
              </div>
            ))}
            {!showSaveInput ? (
              <button
                onClick={() => setShowSaveInput(true)}
                onMouseEnter={() => setHovered('save-as')}
                onMouseLeave={() => setHovered(null)}
                style={{ ...menuItemBase, fontSize: '20px', padding: '5px 10px', background: hovered === 'save-as' ? 'rgba(255, 255, 255, 0.08)' : 'transparent', color: 'rgba(255,255,255,0.6)' }}
              >+ Save current as...</button>
            ) : (
              <div style={{ display: 'flex', gap: 4, padding: '4px 10px' }}>
                <input
                  autoFocus
                  value={saveNameInput}
                  onChange={e => setSaveNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && saveNameInput.trim()) { onSaveLayoutAs(saveNameInput.trim()); setSaveNameInput(''); setShowSaveInput(false) } else if (e.key === 'Escape') { setShowSaveInput(false); setSaveNameInput('') } }}
                  placeholder="Layout name..."
                  style={{ flex: 1, fontSize: '20px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '2px 6px', outline: 'none', borderRadius: 0 }}
                />
                <button
                  onClick={() => { if (saveNameInput.trim()) { onSaveLayoutAs(saveNameInput.trim()); setSaveNameInput(''); setShowSaveInput(false) } }}
                  style={{ ...menuItemBase, padding: '2px 8px', fontSize: '18px', flex: '0 0 auto', background: 'rgba(90,140,255,0.15)', color: 'rgba(120,160,255,0.9)' }}
                >Save</button>
              </div>
            )}
          </div>
        )}

        {/* Debug View */}
        <button
          onClick={onToggleDebugMode}
          onMouseEnter={() => setHovered('debug')}
          onMouseLeave={() => setHovered(null)}
          style={{ ...menuItemBase, background: hovered === 'debug' ? 'rgba(255, 255, 255, 0.08)' : 'transparent' }}
        >
          <span>Debug View</span>
          {isDebugMode && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(90, 140, 255, 0.8)', flexShrink: 0 }} />
          )}
        </button>
      </div>
    </>
  )
}
