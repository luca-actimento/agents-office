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
  projectIdentities: Record<string, { palette: number; hueShift: number }>
  onSaveProjectIdentities: (identities: Record<string, { palette: number; hueShift: number }>) => void
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

export function SettingsModal({ isOpen, onClose, isDebugMode, onToggleDebugMode, layouts, onRequestLayouts, onLoadLayout, onSaveLayoutAs, projectIdentities, onSaveProjectIdentities }: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [soundsOpen, setSoundsOpen] = useState(false)
  const [layoutsOpen, setLayoutsOpen] = useState(false)
  const [identitiesOpen, setIdentitiesOpen] = useState(false)
  const [saveNameInput, setSaveNameInput] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [notifLocal, setNotifLocal] = useState(isSoundEnabled)
  const [doorSoundLocal, setDoorSoundLocal] = useState(isDoorSoundEnabled)
  const [agentSoundLocal, setAgentSoundLocal] = useState(isAgentSoundEnabled)
  const [localIdentities, setLocalIdentities] = useState(projectIdentities)
  const [newKey, setNewKey] = useState('')
  const [newPalette, setNewPalette] = useState(0)
  const [newHueShift, setNewHueShift] = useState(0)

  // Sync wenn sich projectIdentities von außen ändert
  const prevIdentitiesRef = useState(() => projectIdentities)[0]
  if (projectIdentities !== prevIdentitiesRef && JSON.stringify(projectIdentities) !== JSON.stringify(localIdentities)) {
    setLocalIdentities(projectIdentities)
  }

  const saveIdentities = (next: Record<string, { palette: number; hueShift: number }>) => {
    setLocalIdentities(next)
    onSaveProjectIdentities(next)
  }

  const removeIdentity = (key: string) => {
    const next = { ...localIdentities }
    delete next[key]
    saveIdentities(next)
  }

  const addIdentity = () => {
    const k = newKey.trim().toLowerCase()
    if (!k) return
    const next = { ...localIdentities, [k]: { palette: newPalette, hueShift: newHueShift } }
    saveIdentities(next)
    setNewKey('')
    setNewPalette(0)
    setNewHueShift(0)
  }

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

        {/* Agent Identities — expandable section */}
        <button
          onClick={() => setIdentitiesOpen((v) => !v)}
          onMouseEnter={() => setHovered('identities')}
          onMouseLeave={() => setHovered(null)}
          style={{ ...menuItemBase, background: hovered === 'identities' ? 'rgba(255, 255, 255, 0.08)' : 'transparent' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '18px', opacity: 0.6 }}>{identitiesOpen ? '▼' : '▶'}</span>
            Agent Identities
          </span>
        </button>

        {identitiesOpen && (
          <div style={{ borderLeft: '2px solid rgba(255,255,255,0.12)', marginLeft: 14, marginBottom: 2 }}>
            {/* Existing entries */}
            {Object.entries(localIdentities).map(([key, val]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px' }}>
                <span style={{ flex: 1, fontSize: '20px', color: 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {key}
                </span>
                <span style={{ fontSize: '17px', color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>
                  P{val.palette} H{val.hueShift}°
                </span>
                <button
                  onClick={() => removeIdentity(key)}
                  onMouseEnter={() => setHovered('del-' + key)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ background: hovered === 'del-' + key ? 'rgba(255,80,80,0.3)' : 'transparent', border: 'none', color: 'rgba(255,100,100,0.7)', cursor: 'pointer', fontSize: '18px', padding: '0 4px', borderRadius: 0, lineHeight: 1 }}
                  title="Entfernen"
                >✕</button>
              </div>
            ))}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '4px 0' }} />
            {/* Add new entry */}
            <div style={{ padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input
                value={newKey}
                onChange={e => setNewKey(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addIdentity() }}
                placeholder="Projekt-Schlüssel (z.B. meinprojekt)"
                style={{ fontSize: '18px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '2px 6px', outline: 'none', borderRadius: 0 }}
              />
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <label style={{ fontSize: '17px', color: 'rgba(255,255,255,0.5)' }}>Palette</label>
                <input
                  type="number" min={0} max={6} value={newPalette}
                  onChange={e => setNewPalette(Number(e.target.value))}
                  style={{ width: 40, fontSize: '18px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '2px 4px', outline: 'none', borderRadius: 0 }}
                />
                <label style={{ fontSize: '17px', color: 'rgba(255,255,255,0.5)' }}>Hue</label>
                <input
                  type="number" min={0} max={359} value={newHueShift}
                  onChange={e => setNewHueShift(Number(e.target.value))}
                  style={{ width: 50, fontSize: '18px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '2px 4px', outline: 'none', borderRadius: 0 }}
                />
                <button
                  onClick={addIdentity}
                  onMouseEnter={() => setHovered('add-identity')}
                  onMouseLeave={() => setHovered(null)}
                  style={{ fontSize: '18px', padding: '2px 10px', background: hovered === 'add-identity' ? 'rgba(90,200,90,0.3)' : 'rgba(90,200,90,0.15)', border: '1px solid rgba(90,200,90,0.4)', color: 'rgba(140,220,140,0.9)', cursor: 'pointer', borderRadius: 0 }}
                >+ Add</button>
              </div>
              <span style={{ fontSize: '15px', color: 'rgba(255,255,255,0.3)' }}>
                Palette 0–5 = Farb-Variante, 6 = Actimento-Sprite · Hue 0–359°
              </span>
            </div>
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
