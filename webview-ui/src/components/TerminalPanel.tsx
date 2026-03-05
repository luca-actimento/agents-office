import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { wsInstance } from '../vscodeApi.js'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
	selectedAgent: number | null
	agents: number[]
	isVisible: boolean
	onClose: () => void
}

// Keep terminals alive across re-renders / agent switches
const terminalMap = new Map<number, { term: Terminal; fitAddon: FitAddon }>()
const pendingData = new Map<number, string[]>()

function getOrCreateTerminal(agentId: number): { term: Terminal; fitAddon: FitAddon } {
	if (terminalMap.has(agentId)) return terminalMap.get(agentId)!
	const fitAddon = new FitAddon()
	const term = new Terminal({
		theme: {
			background: '#1e1e1e',
			foreground: '#d4d4d4',
			cursor: '#d4d4d4',
		},
		fontFamily: 'monospace',
		fontSize: 13,
		cursorBlink: true,
		scrollback: 5000,
	})
	term.loadAddon(fitAddon)
	terminalMap.set(agentId, { term, fitAddon })
	return { term, fitAddon }
}

function cleanupTerminal(agentId: number): void {
	const entry = terminalMap.get(agentId)
	if (entry) {
		entry.term.dispose()
		terminalMap.delete(agentId)
	}
}

export function TerminalPanel({ selectedAgent, agents, isVisible, onClose }: TerminalPanelProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const activeAgentRef = useRef<number | null>(null)
	const [panelHeight, setPanelHeight] = useState(320)
	const isDragging = useRef(false)
	const dragStartY = useRef(0)
	const dragStartH = useRef(0)

	// Clean up terminals for agents that are gone
	useEffect(() => {
		const agentSet = new Set(agents)
		for (const id of terminalMap.keys()) {
			if (!agentSet.has(id)) cleanupTerminal(id)
		}
	}, [agents])

	// Route incoming terminal data to the right xterm instance
	useEffect(() => {
		if (!wsInstance) return
		const handler = (e: MessageEvent) => {
			try {
				const msg = JSON.parse(e.data as string) as Record<string, unknown>
				if (msg.type === 'terminalData') {
					const id = msg.id as number
					const entry = terminalMap.get(id)
					if (entry) {
						entry.term.write(msg.data as string)
					} else {
						const buf = pendingData.get(id) ?? []
						buf.push(msg.data as string)
						pendingData.set(id, buf)
					}
				}
			} catch { /* ignore */ }
		}
		wsInstance.addEventListener('message', handler)
		return () => wsInstance?.removeEventListener('message', handler)
	}, [])

	// Mount/switch the active terminal into the container
	useEffect(() => {
		if (!isVisible || !containerRef.current || selectedAgent === null) return

		const container = containerRef.current

		// Detach previous terminal's DOM element (just hide, don't dispose)
		if (activeAgentRef.current !== null && activeAgentRef.current !== selectedAgent) {
			const el = container.querySelector(`[data-term-id="${activeAgentRef.current}"]`)
			if (el) (el as HTMLElement).style.display = 'none'
		}

		activeAgentRef.current = selectedAgent

		// Check if terminal is already mounted
		const existing = container.querySelector(`[data-term-id="${selectedAgent}"]`) as HTMLElement | null
		if (existing) {
			existing.style.display = 'block'
			terminalMap.get(selectedAgent)?.fitAddon.fit()
			return
		}

		// Mount new terminal
		const termEl = document.createElement('div')
		termEl.dataset.termId = String(selectedAgent)
		termEl.style.cssText = 'width:100%;height:100%;'
		container.appendChild(termEl)

		const { term, fitAddon } = getOrCreateTerminal(selectedAgent)
		term.open(termEl)
		fitAddon.fit()

		// Flush buffered data that arrived before this terminal was mounted
		const pending = pendingData.get(selectedAgent)
		if (pending) {
			for (const chunk of pending) term.write(chunk)
			pendingData.delete(selectedAgent)
		}

		// Route user input to server
		term.onData((data) => {
			wsInstance?.send(JSON.stringify({ type: 'terminalInput', id: selectedAgent, data }))
		})

		// Notify server of initial size
		wsInstance?.send(JSON.stringify({
			type: 'terminalResize',
			id: selectedAgent,
			cols: term.cols,
			rows: term.rows,
		}))

	}, [selectedAgent, isVisible])

	// Re-fit on panel height change
	useEffect(() => {
		if (selectedAgent !== null) {
			terminalMap.get(selectedAgent)?.fitAddon.fit()
		}
	}, [panelHeight, selectedAgent])

	// Resize handle drag
	const onDragStart = useCallback((e: React.MouseEvent) => {
		isDragging.current = true
		dragStartY.current = e.clientY
		dragStartH.current = panelHeight

		const onMove = (ev: MouseEvent) => {
			if (!isDragging.current) return
			const delta = dragStartY.current - ev.clientY
			const newH = Math.min(Math.max(dragStartH.current + delta, 100), window.innerHeight * 0.8)
			setPanelHeight(newH)
		}
		const onUp = () => {
			isDragging.current = false
			window.removeEventListener('mousemove', onMove)
			window.removeEventListener('mouseup', onUp)
		}
		window.addEventListener('mousemove', onMove)
		window.addEventListener('mouseup', onUp)
	}, [panelHeight])

	if (!isVisible) return null

	return (
		<div style={{
			position: 'absolute',
			bottom: 0,
			left: 0,
			right: 0,
			height: panelHeight,
			background: '#1e1e1e',
			borderTop: '2px solid var(--pixel-border)',
			display: 'flex',
			flexDirection: 'column',
			zIndex: 200,
		}}>
			{/* Drag handle */}
			<div
				onMouseDown={onDragStart}
				style={{
					height: 6,
					cursor: 'ns-resize',
					background: 'var(--pixel-border)',
					flexShrink: 0,
				}}
			/>
			{/* Header */}
			<div style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				padding: '2px 8px',
				background: '#2d2d2d',
				flexShrink: 0,
				fontSize: 13,
				color: '#ccc',
			}}>
				<span style={{ fontFamily: 'monospace' }}>
					Terminal{selectedAgent !== null ? ` — Agent #${selectedAgent}` : ''}
				</span>
				<button
					onClick={onClose}
					style={{
						background: 'none',
						border: 'none',
						color: '#999',
						cursor: 'pointer',
						fontSize: 18,
						lineHeight: 1,
						padding: '0 4px',
					}}
					title="Close terminal"
				>
					×
				</button>
			</div>
			{/* Terminal container */}
			<div
				ref={containerRef}
				style={{ flex: 1, overflow: 'hidden', padding: '2px 4px' }}
			/>
		</div>
	)
}
