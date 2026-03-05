import { useState } from 'react'
import { vscode } from '../vscodeApi.js'
import { isSoundEnabled, setSoundEnabled, isDoorSoundEnabled, setDoorSoundEnabled, isAgentSoundEnabled, setAgentSoundEnabled } from '../notificationSound.js'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
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

export function SettingsModal({ isOpen, onClose, isDebugMode, onToggleDebugMode }: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [soundsOpen, setSoundsOpen] = useState(false)
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
