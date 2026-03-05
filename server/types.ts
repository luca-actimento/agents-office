import type { IPty } from 'node-pty';

export type Broadcaster = { postMessage(msg: unknown): void };

export interface AgentState {
	id: number;
	/** null for agents detected via JSONL scan (no interactive terminal) */
	ptyProcess: IPty | null;
	projectDir: string;
	jsonlFile: string;
	fileOffset: number;
	lineBuffer: string;
	activeToolIds: Set<string>;
	activeToolStatuses: Map<string, string>;
	activeToolNames: Map<string, string>;
	activeSubagentToolIds: Map<string, Set<string>>;
	activeSubagentToolNames: Map<string, Map<string, string>>;
	isWaiting: boolean;
	permissionSent: boolean;
	hadToolsInTurn: boolean;
	lastActivityTime: number;
	folderName?: string;
	terminalName: string;
}

export interface PersistedAgent {
	id: number;
	terminalName: string;
	jsonlFile: string;
	projectDir: string;
	folderName?: string;
}
