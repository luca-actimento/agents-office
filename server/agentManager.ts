import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import pty from 'node-pty';
import type { AgentState, Broadcaster, PersistedAgent } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer } from './timerManager.js';
import { startFileWatching, readNewLines, ensureProjectScan } from './fileWatcher.js';
import { JSONL_POLL_INTERVAL_MS, TERMINAL_NAME_PREFIX, AGENTS_FILE } from './constants.js';

const AGENTS_FILE_PATH = path.join(os.homedir(), AGENTS_FILE);

export function getProjectDirPath(cwd: string): string {
	const dirName = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
	return path.join(os.homedir(), '.claude', 'projects', dirName);
}

export function persistAgents(agents: Map<number, AgentState>): void {
	const persisted: PersistedAgent[] = [];
	for (const agent of agents.values()) {
		persisted.push({ id: agent.id, terminalName: agent.terminalName, jsonlFile: agent.jsonlFile, projectDir: agent.projectDir, folderName: agent.folderName });
	}
	try {
		fs.mkdirSync(path.dirname(AGENTS_FILE_PATH), { recursive: true });
		fs.writeFileSync(AGENTS_FILE_PATH, JSON.stringify(persisted, null, 2), 'utf-8');
	} catch { /* ignore */ }
}

export function removeAgent(
	agentId: number,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	doPersist: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;
	const jpTimer = jsonlPollTimers.get(agentId);
	if (jpTimer) clearInterval(jpTimer);
	jsonlPollTimers.delete(agentId);
	fileWatchers.get(agentId)?.close(); fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId); if (pt) clearInterval(pt); pollingTimers.delete(agentId);
	try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }
	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);
	if (agent.ptyProcess) { try { agent.ptyProcess.kill(); } catch { /* ignore */ } }
	agents.delete(agentId);
	doPersist();
}

export type TerminalDataHandler = (agentId: number, data: string) => void;

export async function launchNewTerminal(
	nextAgentIdRef: { current: number },
	nextTerminalIndexRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	broadcaster: Broadcaster | undefined,
	onTerminalData: TerminalDataHandler,
	doPersist: () => void,
	folderPath?: string,
	model?: string,
): Promise<void> {
	const cwd = folderPath || os.homedir();
	const idx = nextTerminalIndexRef.current++;
	const terminalName = `${TERMINAL_NAME_PREFIX} #${idx}`;
	const sessionId = crypto.randomUUID();
	const modelFlag = model ? ` --model ${model}` : '';

	const shell = process.env.SHELL || '/bin/bash';
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { CLAUDECODE: _cc, ...childEnv } = process.env as Record<string, string>;
	const ptyProcess = pty.spawn(shell, [], {
		name: 'xterm-256color',
		cols: 220,
		rows: 50,
		cwd,
		env: childEnv,
	});

	const projectDir = getProjectDirPath(cwd);
	const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
	knownJsonlFiles.add(expectedFile);

	const id = nextAgentIdRef.current++;
	const folderName = path.basename(cwd);
	const agent: AgentState = {
		id, ptyProcess, projectDir, jsonlFile: expectedFile,
		fileOffset: 0, lineBuffer: '',
		activeToolIds: new Set(), activeToolStatuses: new Map(), activeToolNames: new Map(),
		activeSubagentToolIds: new Map(), activeSubagentToolNames: new Map(),
		isWaiting: false, permissionSent: false, hadToolsInTurn: false,
		lastActivityTime: Date.now(), folderName, terminalName,
	};

	agents.set(id, agent);
	activeAgentIdRef.current = id;
	doPersist();

	console.log(`[Server] Agent ${id}: spawned PTY in ${cwd}`);
	broadcaster?.postMessage({ type: 'agentCreated', id, folderName, projectDir });
	broadcaster?.postMessage({ type: 'agentTerminalReady', id });

	ptyProcess.onData((data: string) => onTerminalData(id, data));

	ptyProcess.onExit(() => {
		console.log(`[Server] Agent ${id}: PTY exited`);
		if (activeAgentIdRef.current === id) activeAgentIdRef.current = null;
		removeAgent(id, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, doPersist);
		broadcaster?.postMessage({ type: 'agentGoingHome', id });
	});

	// Small delay so shell is ready before sending the command
	setTimeout(() => ptyProcess.write(`claude${modelFlag} --session-id ${sessionId}\r`), 300);

	ensureProjectScan(projectDir, knownJsonlFiles, projectScanTimerRef, activeAgentIdRef, nextAgentIdRef, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, broadcaster, doPersist);

	const pollTimer = setInterval(() => {
		try {
			if (fs.existsSync(agent.jsonlFile)) {
				clearInterval(pollTimer); jsonlPollTimers.delete(id);
				startFileWatching(id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, broadcaster);
				readNewLines(id, agents, waitingTimers, permissionTimers, broadcaster);
			}
		} catch { /* file may not exist yet */ }
	}, JSONL_POLL_INTERVAL_MS);
	jsonlPollTimers.set(id, pollTimer);
}

export function sendExistingAgents(
	agents: Map<number, AgentState>,
	agentSeats: Record<string, { palette?: number; hueShift?: number; seatId?: string }>,
	broadcaster: Broadcaster | undefined,
): void {
	if (!broadcaster) return;
	const agentIds: number[] = [];
	for (const id of agents.keys()) agentIds.push(id);
	agentIds.sort((a, b) => a - b);

	const folderNames: Record<number, string> = {};
	const projectDirs: Record<number, string> = {};
	const hasTerminal: Record<number, boolean> = {};
	for (const [id, agent] of agents) {
		if (agent.folderName) folderNames[id] = agent.folderName;
		projectDirs[id] = agent.projectDir;
		hasTerminal[id] = agent.ptyProcess !== null;
	}
	broadcaster.postMessage({ type: 'existingAgents', agents: agentIds, agentMeta: agentSeats, folderNames, projectDirs, hasTerminal });

	for (const [agentId, agent] of agents) {
		for (const [toolId, status] of agent.activeToolStatuses) {
			broadcaster.postMessage({ type: 'agentToolStart', id: agentId, toolId, status });
		}
		if (agent.isWaiting) broadcaster.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
		else if (agent.activeToolStatuses.size > 0) broadcaster.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
	}
}
