import type * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { PERMISSION_TIMER_DELAY_MS } from './constants.js';
import { debugLog } from './debugLog.js';

export function clearAgentActivity(
	agent: AgentState | undefined,
	agentId: number,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	if (!agent) return;
	agent.activeToolIds.clear();
	agent.activeToolStatuses.clear();
	agent.activeToolNames.clear();
	agent.activeSubagentToolIds.clear();
	agent.activeSubagentToolNames.clear();
	agent.isWaiting = false;
	agent.permissionSent = false;
	cancelPermissionTimer(agentId, permissionTimers);
	webview?.postMessage({ type: 'agentToolsClear', id: agentId });
	webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
}

export function cancelWaitingTimer(
	agentId: number,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
	const timer = waitingTimers.get(agentId);
	if (timer) {
		clearTimeout(timer);
		waitingTimers.delete(agentId);
	}
}

export function startWaitingTimer(
	agentId: number,
	delayMs: number,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: vscode.Webview | undefined,
): void {
	cancelWaitingTimer(agentId, waitingTimers);
	const timer = setTimeout(() => {
		waitingTimers.delete(agentId);
		const agent = agents.get(agentId);
		if (agent) {
			agent.isWaiting = true;
		}
		debugLog(`agent ${agentId}: TEXT_IDLE timer fired → waiting (delay=${delayMs}ms)`);
		webview?.postMessage({
			type: 'agentStatus',
			id: agentId,
			status: 'waiting',
		});
	}, delayMs);
	waitingTimers.set(agentId, timer);
}

export function cancelPermissionTimer(
	agentId: number,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
	const timer = permissionTimers.get(agentId);
	if (timer) {
		clearTimeout(timer);
		permissionTimers.delete(agentId);
	}
}

export function startPermissionTimer(
	agentId: number,
	agents: Map<number, AgentState>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionRequiringTools: Set<string>,
	webview: vscode.Webview | undefined,
): void {
	cancelPermissionTimer(agentId, permissionTimers);
	const timer = setTimeout(() => {
		permissionTimers.delete(agentId);
		const agent = agents.get(agentId);
		if (!agent) return;

		// Only flag if a permission-requiring tool is still active (not yet completed)
		let hasStuckTool = false;
		for (const toolId of agent.activeToolIds) {
			const toolName = agent.activeToolNames.get(toolId);
			if (permissionRequiringTools.has(toolName || '')) {
				hasStuckTool = true;
				break;
			}
		}

		if (hasStuckTool) {
			agent.permissionSent = true;
			console.log(`[Agents Office] Agent ${agentId}: possible permission wait detected`);
			webview?.postMessage({
				type: 'agentToolPermission',
				id: agentId,
			});
		}
	}, PERMISSION_TIMER_DELAY_MS);
	permissionTimers.set(agentId, timer);
}
