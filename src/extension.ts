import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { applyNameTemplate, ensureExtension, expandHome, hasPathSeparator, isAllowedFile } from './notesLogic';
import { NoteItem, NotesProvider } from './notesTree';
import { NoteSync } from './noteSync';

const RECENT_KEY = 'noteflow.recentNotes';
const RECENT_LIMIT = 50;

function cfg<T>(key: string, fallback: T): T {
	return vscode.workspace.getConfiguration('noteflow').get<T>(key, fallback);
}

function getMyNotesFolder(): string | undefined {
	const raw = cfg('folder', '').trim();
	return raw ? expandHome(raw, os.homedir()) : undefined;
}

function getProjectNotesFolder(): string | undefined {
	const ws = vscode.workspace.workspaceFolders?.[0];
	if (!ws) {
		return undefined;
	}
	const raw = cfg('projectFolder', '.notes').trim() || '.notes';
	return path.isAbsolute(raw) ? raw : path.join(ws.uri.fsPath, raw);
}

function folderIsDirectory(folder: string | undefined): boolean {
	if (!folder) {
		return false;
	}
	try {
		return fs.statSync(folder).isDirectory();
	} catch {
		return false;
	}
}

function folderIsEmpty(folder: string): boolean {
	try {
		return fs.readdirSync(folder).filter(name => !name.startsWith('.')).length === 0;
	} catch {
		return true;
	}
}

function isAllowedFileFn(name: string): boolean {
	return isAllowedFile(name, cfg('fileTypes', '*'));
}

export function activate(context: vscode.ExtensionContext): void {
	const myNotes = new NotesProvider('noteflow.myNotes', getMyNotesFolder, () => cfg('fileTypes', '*'),
		() => cfg('sort', 'name'), () => cfg('refreshSeconds', 5));
	const projectNotes = new NotesProvider('noteflow.projectNotes', getProjectNotesFolder, () => cfg('fileTypes', '*'),
		() => cfg('sort', 'name'), () => cfg('refreshSeconds', 5));
	context.subscriptions.push(myNotes, projectNotes);

	const myNotesView = vscode.window.createTreeView('noteflow.myNotes', { treeDataProvider: myNotes, canSelectMany: true, dragAndDropController: makeDragAndDrop() });
	const projectNotesView = vscode.window.createTreeView('noteflow.projectNotes', { treeDataProvider: projectNotes, canSelectMany: true, dragAndDropController: makeDragAndDrop() });
	context.subscriptions.push(myNotesView, projectNotesView);
	myNotesView.onDidChangeVisibility(e => myNotes.setVisible(e.visible));
	projectNotesView.onDidChangeVisibility(e => projectNotes.setVisible(e.visible));

	const providers = [myNotes, projectNotes];

	function refreshAll(): void {
		myNotes.refresh();
		projectNotes.refresh();
		updateContextKeys();
	}

	function updateContextKeys(): void {
		const my = getMyNotesFolder();
		const myState = !my ? 'unset' : !folderIsDirectory(my) ? 'missing' : folderIsEmpty(my) ? 'empty' : 'ready';
		vscode.commands.executeCommand('setContext', 'noteflow.myNotesState', myState);

		const project = getProjectNotesFolder();
		const hasProject = !!project && folderIsDirectory(project);
		vscode.commands.executeCommand('setContext', 'noteflow.hasProjectNotes', hasProject);
		vscode.commands.executeCommand('setContext', 'noteflow.projectNotesState', hasProject && project && folderIsEmpty(project) ? 'empty' : 'ready');
	}
	updateContextKeys();

	// --- recently opened notes ---
	function getRecent(): string[] {
		return context.globalState.get<string[]>(RECENT_KEY, []);
	}
	function setRecent(list: string[]): Thenable<void> {
		return context.globalState.update(RECENT_KEY, list.slice(0, RECENT_LIMIT));
	}
	function locationOf(file: string): { root: string, relative: string } | undefined {
		for (const provider of providers) {
			const root = provider.root();
			if (root) {
				const rel = path.relative(root, file);
				if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
					return { root, relative: rel.split(path.sep).join('/') };
				}
			}
		}
		return undefined;
	}
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		const file = editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
		if (file && locationOf(file)) {
			const recent = getRecent();
			void setRecent([file, ...recent.filter(p => p !== file)]);
		}
	}));

	// --- sync ---
	const noteSync = new NoteSync(
		context.globalState as vscode.Memento & { setKeysForSync(keys: readonly string[]): void },
		() => getMyNotesFolder() ?? '',
		isAllowedFileFn,
		refreshAll);
	context.subscriptions.push(noteSync);
	setTimeout(() => noteSync.schedule(0), 2000);

	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => {
		if (doc.uri.scheme === 'file' && locationOf(doc.uri.fsPath)?.root === getMyNotesFolder()) {
			noteSync.schedule();
		}
	}));
	context.subscriptions.push(vscode.window.onDidChangeWindowState(state => {
		if (state.focused) {
			noteSync.schedule();
			checkOnboarding();
		}
	}));

	// --- onboarding for a new/empty machine ---
	let onboardingShown = false;
	async function checkOnboarding(): Promise<void> {
		if (onboardingShown || noteSync.syncedCount() === 0) {
			return;
		}
		const my = getMyNotesFolder();
		if (!my) {
			onboardingShown = true;
			const choice = await vscode.window.showInformationMessage(
				`${noteSync.syncedCount()} synced notes from your other VS Code are ready.`, 'Use ~/Noteflow', 'Choose Folder');
			if (choice === 'Use ~/Noteflow') {
				const folder = path.join(os.homedir(), 'Noteflow');
				await fs.promises.mkdir(folder, { recursive: true });
				await vscode.workspace.getConfiguration('noteflow').update('folder', folder, vscode.ConfigurationTarget.Global);
			} else if (choice === 'Choose Folder') {
				await vscode.commands.executeCommand('noteflow.chooseFolder');
			}
		} else if (!folderIsDirectory(my)) {
			onboardingShown = true;
			const choice = await vscode.window.showInformationMessage(
				`${noteSync.syncedCount()} synced notes from your other VS Code are ready.`, 'Restore Notes');
			if (choice === 'Restore Notes') {
				await fs.promises.mkdir(my, { recursive: true });
				noteSync.schedule(0);
			}
		}
	}
	setTimeout(checkOnboarding, 3000);

	// --- config changes ---
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('noteflow.folder')) {
			myNotes.watch();
			noteSync.schedule(0);
		}
		if (e.affectsConfiguration('noteflow.projectFolder')) {
			projectNotes.watch();
		}
		if (e.affectsConfiguration('noteflow.sync')) {
			noteSync.schedule(0);
		}
		if (e.affectsConfiguration('noteflow')) {
			refreshAll();
		}
	}));

	// --- helpers shared by commands ---
	async function pickTargetRoot(item?: NoteItem, viewId?: string): Promise<{ root: string, relative: string } | undefined> {
		if (item) {
			return item.isFolder
				? { root: item.rootLocation, relative: item.relativePath }
				: { root: item.rootLocation, relative: path.dirname(item.relativePath) === '.' ? '' : path.dirname(item.relativePath) };
		}
		if (viewId) {
			const provider = providers.find(p => p.viewId === viewId);
			const root = provider?.root();
			return root ? { root, relative: '' } : undefined;
		}
		const available = providers.filter(p => p.root());
		if (available.length === 0) {
			void vscode.window.showErrorMessage('No notes folder is set up.');
			return undefined;
		}
		if (available.length === 1) {
			return { root: available[0].root()!, relative: '' };
		}
		const choice = await vscode.window.showQuickPick(
			available.map(p => ({ label: p.viewId === 'noteflow.myNotes' ? 'My Notes' : 'Project Notes', provider: p })),
			{ placeHolder: 'Create in which notes folder?' });
		return choice ? { root: choice.provider.root()!, relative: '' } : undefined;
	}

	async function promptName(prompt: string, prefill: string): Promise<string | undefined> {
		return vscode.window.showInputBox({
			prompt, value: prefill,
			validateInput: value => {
				if (!value.trim()) {
					return 'Name is required';
				}
				if (hasPathSeparator(value)) {
					return 'Name cannot contain a path separator';
				}
				return undefined;
			}
		});
	}

	// --- commands ---
	context.subscriptions.push(
		vscode.commands.registerCommand('noteflow.newNote', async (item?: NoteItem, _selection?: NoteItem[], viewId?: string) => {
			const target = await pickTargetRoot(item, viewId);
			if (!target) {
				return;
			}
			const prefill = applyNameTemplate(cfg('newNoteName', ''), new Date());
			const name = await promptName('Note name', prefill);
			if (!name) {
				return;
			}
			const fileName = ensureExtension(name.trim(), cfg('defaultExtension', 'md'));
			const full = path.join(target.root, target.relative, fileName);
			if (fs.existsSync(full)) {
				void vscode.window.showErrorMessage(`"${fileName}" already exists.`);
				return;
			}
			await fs.promises.mkdir(path.dirname(full), { recursive: true });
			await fs.promises.writeFile(full, '', 'utf8');
			refreshAll();
			noteSync.schedule();
			await vscode.window.showTextDocument(vscode.Uri.file(full));
		}),

		vscode.commands.registerCommand('noteflow.newFolder', async (item?: NoteItem, _selection?: NoteItem[], viewId?: string) => {
			const target = await pickTargetRoot(item, viewId);
			if (!target) {
				return;
			}
			const name = await promptName('Folder name', '');
			if (!name) {
				return;
			}
			const full = path.join(target.root, target.relative, name.trim());
			if (fs.existsSync(full)) {
				void vscode.window.showErrorMessage(`"${name}" already exists.`);
				return;
			}
			await fs.promises.mkdir(full, { recursive: true });
			refreshAll();
			noteSync.schedule();
		}),

		vscode.commands.registerCommand('noteflow.rename', async (item: NoteItem) => {
			if (!item) {
				return;
			}
			const ext = item.isFolder ? '' : path.extname(item.fullPath);
			const current = path.basename(item.fullPath);
			const base = ext ? current.slice(0, -ext.length) : current;
			const name = await vscode.window.showInputBox({
				prompt: 'New name', value: current, valueSelection: [0, base.length],
				validateInput: value => hasPathSeparator(value) ? 'Name cannot contain a path separator' : undefined
			});
			if (!name || name === current) {
				return;
			}
			const target = path.join(path.dirname(item.fullPath), name);
			await fs.promises.rename(item.fullPath, target);
			const recent = getRecent().map(p => (p === item.fullPath || p.startsWith(item.fullPath + path.sep))
				? target + p.slice(item.fullPath.length) : p);
			await setRecent(recent);
			refreshAll();
			noteSync.schedule();
		}),

		vscode.commands.registerCommand('noteflow.delete', async (item: NoteItem, selection?: NoteItem[]) => {
			const items = selection && selection.length > 0 ? selection : [item];
			if (items.length === 0 || !items[0]) {
				return;
			}
			const names = items.map(i => path.basename(i.fullPath)).join(', ');
			const confirm = await vscode.window.showWarningMessage(
				`Delete ${names}?`, { modal: true }, 'Delete');
			if (confirm !== 'Delete') {
				return;
			}
			for (const i of items) {
				for (const tab of vscode.window.tabGroups.all.flatMap(g => g.tabs)) {
					const input = tab.input;
					if (input instanceof vscode.TabInputText && input.uri.fsPath.startsWith(i.fullPath)) {
						await vscode.window.tabGroups.close(tab);
					}
				}
				await vscode.workspace.fs.delete(vscode.Uri.file(i.fullPath), { recursive: true, useTrash: true });
			}
			const deleted = new Set(items.map(i => i.fullPath));
			await setRecent(getRecent().filter(p => ![...deleted].some(d => p === d || p.startsWith(d + path.sep))));
			refreshAll();
			noteSync.schedule();
		}),

		vscode.commands.registerCommand('noteflow.moveTo', async (item: NoteItem, selection?: NoteItem[]) => {
			const items = selection && selection.length > 0 ? selection : [item];
			if (items.length === 0 || !items[0]) {
				return;
			}
			const folders: { label: string, description: string, full: string }[] = [];
			for (const provider of providers) {
				const root = provider.root();
				if (!root) {
					continue;
				}
				folders.push({ label: provider.viewId === 'noteflow.myNotes' ? 'My Notes' : 'Project Notes', description: '/', full: root });
				for (const entry of await provider.allEntries()) {
					if (entry.isFolder) {
						folders.push({ label: path.basename(entry.fullPath), description: entry.relativePath, full: entry.fullPath });
					}
				}
			}
			const movedPaths = new Set(items.map(i => i.fullPath));
			const choice = await vscode.window.showQuickPick(
				folders.filter(f => ![...movedPaths].some(m => f.full === m || f.full.startsWith(m + path.sep))),
				{ placeHolder: 'Move to...' });
			if (!choice) {
				return;
			}
			for (const i of items) {
				const target = path.join(choice.full, path.basename(i.fullPath));
				if (fs.existsSync(target)) {
					void vscode.window.showErrorMessage(`"${path.basename(i.fullPath)}" already exists there.`);
					continue;
				}
				await fs.promises.rename(i.fullPath, target);
				const recent = getRecent().map(p => (p === i.fullPath || p.startsWith(i.fullPath + path.sep))
					? target + p.slice(i.fullPath.length) : p);
				await setRecent(recent);
			}
			refreshAll();
			noteSync.schedule();
		}),

		vscode.commands.registerCommand('noteflow.search', async (item?: NoteItem) => {
			const include: string[] = [];
			if (item) {
				include.push(item.fullPath);
			} else {
				for (const provider of providers) {
					const root = provider.root();
					if (root) {
						include.push(root);
					}
				}
			}
			await vscode.commands.executeCommand('workbench.action.findInFiles', {
				filesToInclude: include.join(', ')
			});
		}),

		vscode.commands.registerCommand('noteflow.sortBy', async () => {
			const choice = await vscode.window.showQuickPick([
				{ label: 'Name (A to Z)', value: 'name' },
				{ label: 'Name (Z to A)', value: 'name-desc' },
				{ label: 'Last Modified', value: 'modified' },
				{ label: 'Date Created', value: 'created' }
			], { placeHolder: 'Sort notes by' });
			if (choice) {
				await vscode.workspace.getConfiguration('noteflow').update('sort', choice.value, vscode.ConfigurationTarget.Global);
			}
		}),

		vscode.commands.registerCommand('noteflow.refresh', () => refreshAll()),

		vscode.commands.registerCommand('noteflow.openPreview', (item: NoteItem) => {
			if (item) {
				void vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(item.fullPath));
			}
		}),

		vscode.commands.registerCommand('noteflow.revealInOS', (item: NoteItem) => {
			if (item) {
				void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.fullPath));
			}
		}),

		vscode.commands.registerCommand('noteflow.chooseFolder', async () => {
			const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Choose Notes Folder' });
			if (picked?.[0]) {
				await vscode.workspace.getConfiguration('noteflow').update('folder', picked[0].fsPath, vscode.ConfigurationTarget.Global);
			}
		}),

		vscode.commands.registerCommand('noteflow.createFolder', async () => {
			const folder = getMyNotesFolder();
			if (folder) {
				await fs.promises.mkdir(folder, { recursive: true });
				refreshAll();
			}
		}),

		vscode.commands.registerCommand('noteflow.setupProjectNotes', async () => {
			const folder = getProjectNotesFolder();
			if (!folder) {
				void vscode.window.showErrorMessage('Open a workspace folder first.');
				return;
			}
			await fs.promises.mkdir(folder, { recursive: true });
			refreshAll();
		}),

		vscode.commands.registerCommand('noteflow.syncNow', async () => {
			await noteSync.sync();
			void vscode.window.setStatusBarMessage('Noteflow: synced', 3000);
		}),

		vscode.commands.registerCommand('noteflow.clearRecent', async () => {
			await setRecent([]);
		}),

		vscode.commands.registerCommand('noteflow.quickOpen', async () => {
			const recent = getRecent();
			const all: { fullPath: string, relativePath: string, root: string }[] = [];
			for (const provider of providers) {
				const root = provider.root();
				if (!root) {
					continue;
				}
				for (const entry of await provider.allEntries()) {
					if (!entry.isFolder) {
						all.push({ fullPath: entry.fullPath, relativePath: entry.relativePath, root });
					}
				}
			}
			const sort = cfg('sort', 'name');
			const byRecency = (p: string) => recent.indexOf(p);
			all.sort((a, b) => {
				const ra = byRecency(a.fullPath), rb = byRecency(b.fullPath);
				if (ra !== -1 || rb !== -1) {
					return (ra === -1 ? Infinity : ra) - (rb === -1 ? Infinity : rb);
				}
				return a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' });
			});
			void sort;
			const items = all.map(entry => ({
				label: path.basename(entry.fullPath),
				description: path.dirname(entry.relativePath) === '.' ? '' : path.dirname(entry.relativePath),
				entry
			}));
			const quickPick = vscode.window.createQuickPick<typeof items[number]>();
			quickPick.items = items;
			quickPick.placeholder = 'Search notes, or type a new name to create one';
			quickPick.onDidAccept(async () => {
				const selected = quickPick.selectedItems[0];
				quickPick.hide();
				if (selected) {
					await vscode.window.showTextDocument(vscode.Uri.file(selected.entry.fullPath));
					return;
				}
				const typed = quickPick.value.trim();
				const matches = items.some(i => i.label === typed);
				const myRoot = getMyNotesFolder();
				if (typed && !matches && myRoot) {
					const fileName = ensureExtension(typed, cfg('defaultExtension', 'md'));
					const full = path.join(myRoot, fileName);
					if (!fs.existsSync(full)) {
						await fs.promises.mkdir(path.dirname(full), { recursive: true });
						await fs.promises.writeFile(full, '', 'utf8');
						refreshAll();
						noteSync.schedule();
					}
					await vscode.window.showTextDocument(vscode.Uri.file(full));
				}
			});
			quickPick.show();
		})
	);
}

function makeDragAndDrop(): vscode.TreeDragAndDropController<NoteItem> {
	const mime = 'application/vnd.code.tree.noteflow';
	return {
		dropMimeTypes: [mime],
		dragMimeTypes: [mime],
		handleDrag(source, data) {
			data.set(mime, new vscode.DataTransferItem(source));
		},
		async handleDrop(target, data) {
			const transfer = data.get(mime);
			const dragged = (await transfer?.asString()) ? undefined : (transfer?.value as NoteItem[] | undefined);
			if (!dragged || !target) {
				return;
			}
			const destFolder = target.isFolder ? target.fullPath : path.dirname(target.fullPath);
			for (const item of dragged) {
				const dest = path.join(destFolder, path.basename(item.fullPath));
				if (dest === item.fullPath || dest.startsWith(item.fullPath + path.sep)) {
					continue;
				}
				if (!fs.existsSync(dest)) {
					await fs.promises.rename(item.fullPath, dest);
				}
			}
			await vscode.commands.executeCommand('noteflow.refresh');
		}
	};
}

export function deactivate(): void {
	// nothing to clean up: all disposables are in context.subscriptions
}
