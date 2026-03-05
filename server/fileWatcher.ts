import * as fs from 'fs';
import * as path from 'path';
import type { AgentState, Broadcaster } from './types.js';
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
	broadcaster: Broadcaster | undefined,
): void {
	try {
		const watcher = fs.watch(filePath, () => readNewLines(agentId, agents, waitingTimers, permissionTimers, broadcaster));
		fileWatchers.set(agentId, watcher);
	} catch (e) { console.log(`[Server] fs.watch failed for agent ${agentId}: ${e}`); }

	try {
		fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => readNewLines(agentId, agents, waitingTimers, permissionTimers, broadcaster));
	} catch (e) { console.log(`[Server] fs.watchFile failed for agent ${agentId}: ${e}`); }

	const interval = setInterval(() => {
		if (!agents.has(agentId)) {
			clearInterval(interval);
			try { fs.unwatchFile(filePath); } catch { /* ignore */ }
			return;
		}
		readNewLines(agentId, agents, waitingTimers, permissionTimers, broadcaster);
	}, FILE_WATCHER_POLL_INTERVAL_MS);
	pollingTimers.set(agentId, interval);
}

export function readNewLines(
	agentId: number,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	broadcaster: Broadcaster | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;
	try {
		const stat = fs.statSync(agent.jsonlFile);
		if (stat.size <= agent.fileOffset) {
			if (!agent.isWaiting) {
				const staleSecs = Math.round((Date.now() - agent.lastActivityTime) / 1000);
				if (staleSecs > 0 && staleSecs % 5 === 0) debugLog(`agent ${agentId}: no new JSONL for ${staleSecs}s`);
				const timeoutMs = agent.activeToolIds.size > 0 ? STALE_ACTIVITY_TIMEOUT_MS * 20 : STALE_ACTIVITY_TIMEOUT_MS;
				if (Date.now() - agent.lastActivityTime > timeoutMs) {
					agent.isWaiting = true;
					agent.activeToolIds.clear(); agent.activeToolStatuses.clear(); agent.activeToolNames.clear(); agent.hadToolsInTurn = false;
					broadcaster?.postMessage({ type: 'agentToolsClear', id: agentId });
					broadcaster?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
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
		if (lines.some(l => l.trim())) {
			agent.lastActivityTime = Date.now();
			cancelWaitingTimer(agentId, waitingTimers);
			cancelPermissionTimer(agentId, permissionTimers);
			if (agent.permissionSent) {
				agent.permissionSent = false;
				broadcaster?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
			}
		}
		for (const line of lines) {
			if (!line.trim()) continue;
			processTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, broadcaster);
		}
	} catch (e) { console.log(`[Server] Read error for agent ${agentId}: ${e}`); }
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
	broadcaster: Broadcaster | undefined,
	persistAgents: () => void,
): void {
	if (projectScanTimerRef.current) return;
	try {
		for (const f of fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))) {
			knownJsonlFiles.add(path.join(projectDir, f));
		}
	} catch { /* dir may not exist yet */ }
	projectScanTimerRef.current = setInterval(() => {
		scanForNewJsonlFiles(projectDir, knownJsonlFiles, activeAgentIdRef, nextAgentIdRef, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, broadcaster, persistAgents);
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
	broadcaster: Broadcaster | undefined,
	persistAgents: () => void,
): void {
	let files: string[];
	try { files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl')).map(f => path.join(projectDir, f)); }
	catch { return; }
	for (const file of files) {
		if (!knownJsonlFiles.has(file)) {
			knownJsonlFiles.add(file);
			if (activeAgentIdRef.current !== null) {
				reassignAgentToFile(activeAgentIdRef.current, file, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, broadcaster, persistAgents);
			} else {
				createMonitorAgent(file, projectDir, nextAgentIdRef, agents, activeAgentIdRef, fileWatchers, pollingTimers, waitingTimers, permissionTimers, broadcaster, persistAgents);
			}
		}
	}
}

function createMonitorAgent(
	jsonlFile: string,
	projectDir: string,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	broadcaster: Broadcaster | undefined,
	persistAgents: () => void,
): void {
	const id = nextAgentIdRef.current++;
	const folderName = path.basename(projectDir);
	const agent: AgentState = {
		id, ptyProcess: null, projectDir, jsonlFile, fileOffset: 0, lineBuffer: '',
		activeToolIds: new Set(), activeToolStatuses: new Map(), activeToolNames: new Map(),
		activeSubagentToolIds: new Map(), activeSubagentToolNames: new Map(),
		isWaiting: false, permissionSent: false, hadToolsInTurn: false,
		lastActivityTime: Date.now(), folderName, terminalName: `Claude Code #${id}`,
	};
	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();
	console.log(`[Server] Agent ${id}: monitor agent for ${path.basename(jsonlFile)}`);
	broadcaster?.postMessage({ type: 'agentCreated', id, folderName, projectDir });
	startFileWatching(id, jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, broadcaster);
	readNewLines(id, agents, waitingTimers, permissionTimers, broadcaster);
}

export function reassignAgentToFile(
	agentId: number,
	newFilePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	broadcaster: Broadcaster | undefined,
	persistAgents: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;
	fileWatchers.get(agentId)?.close(); fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId); if (pt) clearInterval(pt); pollingTimers.delete(agentId);
	try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }
	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);
	clearAgentActivity(agent, agentId, permissionTimers, broadcaster);
	agent.jsonlFile = newFilePath; agent.fileOffset = 0; agent.lineBuffer = '';
	persistAgents();
	startFileWatching(agentId, newFilePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, broadcaster);
	readNewLines(agentId, agents, waitingTimers, permissionTimers, broadcaster);
}
