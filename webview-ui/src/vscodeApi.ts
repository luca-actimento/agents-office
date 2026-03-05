declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

/** true when running as standalone browser app (not inside VS Code) */
export const isBrowserMode: boolean = typeof (globalThis as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi !== 'function';

/** Shared WebSocket instance for browser mode (null in VS Code mode) */
export let wsInstance: WebSocket | null = null;

function createBridge(): { postMessage(msg: unknown): void } {
	if (!isBrowserMode) {
		// Running inside VS Code webview
		return acquireVsCodeApi();
	}

	// Browser mode — connect to the agents-office server via WebSocket
	const ws = new WebSocket(`ws://${location.host}`);
	wsInstance = ws;

	ws.onopen = () => {
		console.log('[Bridge] WebSocket connected');
	};

	ws.onmessage = (e) => {
		try {
			const msg = JSON.parse(e.data as string) as Record<string, unknown>;
			// terminalData is handled directly by TerminalPanel via wsInstance
			if (msg.type === 'terminalData' || msg.type === 'terminalReplayDone') return;
			// Dispatch as window message so useExtensionMessages works unchanged
			window.dispatchEvent(new MessageEvent('message', { data: msg }));
		} catch { /* ignore malformed messages */ }
	};

	ws.onclose = () => {
		console.log('[Bridge] WebSocket disconnected — will not auto-reconnect');
	};

	ws.onerror = (e) => {
		console.error('[Bridge] WebSocket error:', e);
	};

	const pendingQueue: string[] = [];
	ws.addEventListener('open', () => {
		for (const msg of pendingQueue) ws.send(msg);
		pendingQueue.length = 0;
	}, { once: true });

	return {
		postMessage(msg: unknown): void {
			const json = JSON.stringify(msg);
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(json);
			} else if (ws.readyState === WebSocket.CONNECTING) {
				pendingQueue.push(json);
			}
		},
	};
}

export const vscode = createBridge();
