import * as vscode from 'vscode';
import { AgentsOfficeViewProvider } from './AgentsOfficeViewProvider.js';
import { VIEW_ID, COMMAND_SHOW_PANEL, COMMAND_EXPORT_DEFAULT_LAYOUT, COMMAND_TEST_SUBAGENT } from './constants.js';
import { checkForUpdate } from './updateChecker.js';

let providerInstance: AgentsOfficeViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
	checkForUpdate(context);

	const provider = new AgentsOfficeViewProvider(context);
	providerInstance = provider;

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => {
			vscode.commands.executeCommand(`${VIEW_ID}.focus`);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
			provider.exportDefaultLayout();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_TEST_SUBAGENT, () => {
			provider.testSubagent();
		})
	);
}

export function deactivate() {
	providerInstance?.dispose();
}
