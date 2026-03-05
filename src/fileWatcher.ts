import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS, STALE_ACTIVITY_TIMEOUT_MS } from './constants.js';
import { debugLog } from './debugLog.js';

export function startFileWatching(
	agentId: number,
	filePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	// Primary: fs.watch (unreliable on macOS — may miss events)
	try {
		const watcher = fs.watch(filePath, () => {
			readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
		});
		fileWatchers.set(agentId, watcher);
	} catch (e) {
		console.log(`[Agents Office] fs.watch failed for agent ${agentId}: ${e}`);
	}

	// Secondary: fs.watchFile (stat-based polling, reliable on macOS)
	try {
		fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => {
			readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
		});
	} catch (e) {
		console.log(`[Agents Office] fs.watchFile failed for agent ${agentId}: ${e}`);
	}

	// Tertiary: manual poll as last resort
	const interval = setInterval(() => {
		if (!agents.has(agentId)) {
			clearInterval(interval);
			try { fs.unwatchFile(filePath); } catch { /* ignore */ }
			return;
		}
		readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
	}, FILE_WATCHER_POLL_INTERVAL_MS);
	pollingTimers.set(agentId, interval);
}

export function readNewLines(
	agentId: number,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;
	try {
		const stat = fs.statSync(agent.jsonlFile);
		if (stat.size <= agent.fileOffset) {
			// No new data — check if agent is stuck active (e.g. killed with ESC)
			if (!agent.isWaiting) {
				const staleSecs = Math.round((Date.now() - agent.lastActivityTime) / 1000);
				if (staleSecs > 0 && staleSecs % 5 === 0) {
					debugLog(`agent ${agentId}: no new JSONL for ${staleSecs}s (isWaiting=false, hadTools=${agent.hadToolsInTurn}, activeTools=${agent.activeToolIds.size})`);
				}
				// Only force-wait if no tools are actively tracked. If activeToolIds is non-empty,
				// a long-running tool (e.g. npm install, long bash) is still executing — don't
				// interrupt it. Use a much longer timeout for the stuck-mid-tool edge case.
				const timeoutMs = agent.activeToolIds.size > 0
					? STALE_ACTIVITY_TIMEOUT_MS * 20  // 5 min: agent killed mid-tool
					: STALE_ACTIVITY_TIMEOUT_MS;       // 15 s: agent killed between tools
				if (Date.now() - agent.lastActivityTime > timeoutMs) {
					debugLog(`agent ${agentId}: STALE → forcing waiting (no JSONL for ${staleSecs}s, activeTools=${agent.activeToolIds.size})`);
					agent.isWaiting = true;
					agent.activeToolIds.clear();
					agent.activeToolStatuses.clear();
					agent.activeToolNames.clear();
					agent.hadToolsInTurn = false;
					webview?.postMessage({ type: 'agentToolsClear', id: agentId });
					webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
				}
			}
			return;
		}

		const buf = Buffer.alloc(stat.size - agent.fileOffset);
		const fd = fs.openSync(agent.jsonlFile, 'r');
		fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
		fs.closeSync(fd);
		agent.fileOffset = stat.size;

		const text = agent.lineBuffer + buf.toString('utf-8');
		const lines = text.split('\n');
		agent.lineBuffer = lines.pop() || '';

		const hasLines = lines.some(l => l.trim());
		if (hasLines) {
			// New data arriving — update activity time, cancel timers
			debugLog(`agent ${agentId}: new JSONL data (${lines.filter(l => l.trim()).length} lines, offset ${agent.fileOffset})`);
			agent.lastActivityTime = Date.now();
			cancelWaitingTimer(agentId, waitingTimers);
			cancelPermissionTimer(agentId, permissionTimers);
			if (agent.permissionSent) {
				agent.permissionSent = false;
				webview?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
			}
		}

		for (const line of lines) {
			if (!line.trim()) continue;
			processTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview, (parentToolId, subagentExternalId) => {
				const agent = agents.get(agentId);
				if (!agent) return;
				// Construct path: ~/.claude/projects/HASH/SESSION/subagents/agent-ID.jsonl
				const sessionDir = agent.jsonlFile.replace(/\.jsonl$/, '');
				const subagentJSONL = path.join(sessionDir, 'subagents', `agent-${subagentExternalId}.jsonl`);
				watchBackgroundSubagentCompletion(agentId, parentToolId, subagentJSONL, webview);
			});
		}
	} catch (e) {
		console.log(`[Agents Office] Read error for agent ${agentId}: ${e}`);
	}
}

export function ensureProjectScan(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	activeAgentIdRef: { current: number | null },
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	if (projectScanTimerRef.current) return;
	// Seed with all existing JSONL files so we only react to truly new ones
	try {
		const files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
		for (const f of files) {
			knownJsonlFiles.add(f);
		}
	} catch { /* dir may not exist yet */ }

	projectScanTimerRef.current = setInterval(() => {
		scanForNewJsonlFiles(
			projectDir, knownJsonlFiles, activeAgentIdRef, nextAgentIdRef,
			agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			webview, persistAgents,
		);
	}, PROJECT_SCAN_INTERVAL_MS);
}

function scanForNewJsonlFiles(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	activeAgentIdRef: { current: number | null },
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	let files: string[];
	try {
		files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
	} catch { return; }

	for (const file of files) {
		if (!knownJsonlFiles.has(file)) {
			knownJsonlFiles.add(file);
			if (activeAgentIdRef.current !== null) {
				// Active agent focused → /clear reassignment
				console.log(`[Agents Office] New JSONL detected: ${path.basename(file)}, reassigning to agent ${activeAgentIdRef.current}`);
				reassignAgentToFile(
					activeAgentIdRef.current, file,
					agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
					webview, persistAgents,
				);
			} else {
				// No active agent → try to adopt the focused terminal
				const activeTerminal = vscode.window.activeTerminal;
				if (activeTerminal) {
					let owned = false;
					for (const agent of agents.values()) {
						if (agent.terminalRef === activeTerminal) {
							owned = true;
							break;
						}
					}
					if (!owned) {
						adoptTerminalForFile(
							activeTerminal, file, projectDir,
							nextAgentIdRef, agents, activeAgentIdRef,
							fileWatchers, pollingTimers, waitingTimers, permissionTimers,
							webview, persistAgents,
						);
					}
				}
			}
		}
	}
}

function adoptTerminalForFile(
	terminal: vscode.Terminal,
	jsonlFile: string,
	projectDir: string,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	const id = nextAgentIdRef.current++;
	const agent: AgentState = {
		id,
		terminalRef: terminal,
		projectDir,
		jsonlFile,
		fileOffset: 0,
		lineBuffer: '',
		activeToolIds: new Set(),
		activeToolStatuses: new Map(),
		activeToolNames: new Map(),
		activeSubagentToolIds: new Map(),
		activeSubagentToolNames: new Map(),
		isWaiting: false,
		permissionSent: false,
		hadToolsInTurn: false,
		lastActivityTime: Date.now(),
	};

	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();

	console.log(`[Agents Office] Agent ${id}: adopted terminal "${terminal.name}" for ${path.basename(jsonlFile)}`);
	webview?.postMessage({ type: 'agentCreated', id, projectDir });

	startFileWatching(id, jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
	readNewLines(id, agents, waitingTimers, permissionTimers, webview);
}

export function reassignAgentToFile(
	agentId: number,
	newFilePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	// Stop old file watching
	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) { clearInterval(pt); }
	pollingTimers.delete(agentId);
	try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }

	// Clear activity
	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);
	clearAgentActivity(agent, agentId, permissionTimers, webview);

	// Swap to new file
	agent.jsonlFile = newFilePath;
	agent.fileOffset = 0;
	agent.lineBuffer = '';
	persistAgents();

	// Start watching new file
	startFileWatching(agentId, newFilePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
	readNewLines(agentId, agents, waitingTimers, permissionTimers, webview);
}

/**
 * Watches a background subagent's JSONL file for completion (turn_duration).
 * Sends subagentClear to the webview when the subagent finishes or times out.
 */
export function watchBackgroundSubagentCompletion(
	parentAgentId: number,
	parentToolId: string,
	subagentJSONLPath: string,
	webview: vscode.Webview | undefined,
	maxWaitMs = 30 * 60 * 1000,
): void {
	const startTime = Date.now();
	let fileOffset = 0;
	let lineBuffer = '';
	let done = false;
	let pollTimer: ReturnType<typeof setTimeout>;

	const finish = () => {
		if (done) return;
		done = true;
		clearTimeout(pollTimer);
		webview?.postMessage({ type: 'subagentClear', id: parentAgentId, parentToolId });
		console.log(`[Agents Office] Background subagent done: parent=${parentAgentId}, toolId=${parentToolId}`);
	};

	const poll = () => {
		if (done) return;
		if (Date.now() - startTime > maxWaitMs) {
			finish();
			return;
		}
		try {
			const stat = fs.statSync(subagentJSONLPath);
			if (stat.size > fileOffset) {
				const buf = Buffer.alloc(stat.size - fileOffset);
				const fd = fs.openSync(subagentJSONLPath, 'r');
				fs.readSync(fd, buf, 0, buf.length, fileOffset);
				fs.closeSync(fd);
				fileOffset = stat.size;
				const text = lineBuffer + buf.toString('utf-8');
				const lines = text.split('\n');
				lineBuffer = lines.pop() || '';
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const record = JSON.parse(line) as Record<string, unknown>;
						if (record.type === 'system' && (record as Record<string, unknown>).subtype === 'turn_duration') {
							finish();
							return;
						}
					} catch { /* ignore malformed lines */ }
				}
			}
		} catch { /* file doesn't exist yet — keep polling */ }
		pollTimer = setTimeout(poll, 2000);
	};

	console.log(`[Agents Office] Watching background subagent JSONL: ${path.basename(subagentJSONLPath)}`);
	pollTimer = setTimeout(poll, 2000);
}
