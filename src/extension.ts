import * as vscode from 'vscode';
import * as path from 'path';
import { LumoApiClient, ChatMessage } from './apiClient';
import { LumoAuthProvider } from './authProvider'; // Keep this import
import { LumoCompletionProvider } from './completionProvider';
import { LumoSuggestionCommand } from './suggestionCommand';

// --- GLOBAL VIEW PROVIDER REFERENCE ---
let viewProvider: LumoViewProvider;

// --- REAL LUMO PANEL LOGIC ---
class LumoViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private apiClient: LumoApiClient;
    private messages: ChatMessage[] = [];
    private context: vscode.ExtensionContext;

    // Token Management
    private totalTokensUsed: number = 0;
    private readonly MAX_CONTEXT_TOKENS: number = 120000; // 128k limit with buffer
    private readonly WARNING_THRESHOLD: number = 100000; // Warn at ~83%
    
    // Track file metadata - FIXED: Allow 'system' role too
    private fileMetadata: Array<{
        id: string;
        name: string;
        size: number;
        tokens: number;
        role: 'user' | 'assistant' | 'system'; // FIXED: Added 'system'
        index: number;
    }> = [];

    private statusBar: vscode.StatusBarItem;

    constructor(private readonly _extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.apiClient = new LumoApiClient();
        this.context = context;
        this.loadChatHistory();
        
        // Initialize Status Bar
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBar.command = 'lumo.showContextManager';
        this.updateStatusBar();
        this.statusBar.show();
        
        // Recalculate tokens on load
        this.recalculateTokens();
    }

    public dispose() {
        this.statusBar.dispose();
    }

    private loadChatHistory() {
        const saved = this.context.globalState.get<ChatMessage[]>('lumo_chat_history', []);
        this.messages = saved || [];
    }

    private async saveChatHistory() {
        try {
            await this.context.globalState.update('lumo_chat_history', this.messages);
        } catch (e) {
            console.error('Failed to save chat history:', e);
        }
    }

    // Reset the provider state and force a UI refresh
    public async reset() {
        // Clear local state
        this.messages = [];
        this.totalTokensUsed = 0;
        this.fileMetadata = [];
        
        // Update Status Bar
        this.updateStatusBar();
        
        // Force re-render of the webview
        if (this._view) {
            // Clear the webview content
            this._view.webview.postMessage({ command: 'clearMessages' });
            
            // Re-render with empty history
            this._view.webview.html = await this.getWebviewContent([]);
        }
    }

    // Helper: Estimate tokens
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    // Helper: Recalculate totals
    private recalculateTokens() {
        this.totalTokensUsed = 0;
        this.fileMetadata = [];
        
        this.messages.forEach((msg, index) => {
            const tokens = this.estimateTokens(msg.content);
            this.totalTokensUsed += tokens;
            
            // If it looks like a file injection
            if (msg.content.includes('Here is the content of the file:')) {
                const match = msg.content.match(/Here is the content of the file: ([^\n]+)/);
                const fileName = match ? match[1] : 'Unknown File';
                
                this.fileMetadata.push({
                    id: `file-${index}`,
                    name: fileName,
                    size: msg.content.length,
                    tokens: tokens,
                    role: msg.role,
                    index: index
                });
            }
        });
        
        this.updateStatusBar();
    }

    // Update Status Bar Text
    private updateStatusBar() {
        const pct = Math.round((this.totalTokensUsed / this.MAX_CONTEXT_TOKENS) * 100);
        let color = 'white';
        if (pct > 80) color = 'orange';
        if (pct > 95) color = 'red';
        
        this.statusBar.text = `$(hubot) ${Math.round(this.totalTokensUsed / 1000)}k / ${Math.round(this.MAX_CONTEXT_TOKENS / 1000)}k (${pct}%)`;
        this.statusBar.backgroundColor = new vscode.ThemeColor(pct > 95 ? 'statusBarItem.warningBackground' : 'statusBarItem.infoBackground');
    }

    // Show Context Manager Modal - FIXED: Made public
    public async showContextManager() {
        if (this.fileMetadata.length === 0) {
            vscode.window.showInformationMessage('No files currently loaded in context.');
            return;
        }

        const items = this.fileMetadata.map(meta => ({
            label: `$(file) ${meta.name}`,
            description: `${Math.round(meta.tokens / 1000)}k tokens (${Math.round((meta.tokens / this.totalTokensUsed) * 100)}%)`,
            detail: `Size: ${Math.round(meta.size / 1024)}KB | Index: ${meta.index}`,
            meta: meta
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a file to remove from context (frees up memory)',
            canPickMany: false
        });

        if (selected) {
            const confirm = await vscode.window.showWarningMessage(
                `Remove "${selected.meta.name}" from context? This will free up ~${Math.round(selected.meta.tokens / 1000)}k tokens.`,
                { modal: true },
                'Remove'
            );

            if (confirm === 'Remove') {
                this.messages.splice(selected.meta.index, 1);
                await this.saveChatHistory();
                this.recalculateTokens();
                vscode.window.showInformationMessage(`Removed "${selected.meta.name}". Freed ~${Math.round(selected.meta.tokens / 1000)}k tokens.`);
            }
        }
    }

    // Sanitize history: Remove duplicates, invalid chars, and excessive welcome messages
    private sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
        if (!Array.isArray(messages)) return [];

        const cleanMessages: ChatMessage[] = [];
        const seenContent = new Set<string>();
        let welcomeCount = 0;
        const MAX_WELCOME_COUNT = 1; // Allow only 1 welcome message

        for (const msg of messages) {
            if (!msg || !msg.content || typeof msg.content !== 'string') continue;

            // Clean invalid characters (replace non-printable chars except newlines/tabs)
            let cleanContent = msg.content.replace(/[^\x20-\x7E\x0A\x0D]/g, '');

            // Skip if content is empty after cleaning
            if (!cleanContent.trim()) continue;

            // Handle duplicate welcome messages
            if (cleanContent.includes("Welcome, my God!") || cleanContent.includes("Welcome, code guru!")) {
                welcomeCount++;
                if (welcomeCount > MAX_WELCOME_COUNT) continue; // Skip duplicates
            }

            // Skip exact duplicates
            if (seenContent.has(cleanContent)) continue;
            seenContent.add(cleanContent);

            cleanMessages.push({
                role: msg.role,
                content: cleanContent
            });
        }

        return cleanMessages;
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.joinPath(this._extensionUri, 'src', 'webview'),
                vscode.Uri.joinPath(this._extensionUri, 'media')
            ]
        };

        // Load messages from disk
        const rawMessages = this.context.globalState.get<ChatMessage[]>('lumo_chat_history', []);
        
        // SANITIZE: Remove duplicates and invalid characters
        this.messages = this.sanitizeHistory(rawMessages);
        
        // Save the cleaned history immediately
        await this.saveChatHistory();

        // Recalculate tokens based on clean history
        this.recalculateTokens();

        // Render the clean history
        webviewView.webview.html = await this.getWebviewContent(this.messages);

        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendMessage':
                        await this.handleUserMessage(message.text);
                        break;
                    case 'clearChat':
                        this.messages = [];
                        await this.saveChatHistory();
                        this._view?.webview.postMessage({ command: 'clearMessages' });
                        break;
                    case 'executeTerminal':
                        const shellHint = message.shellHint || undefined;
                        await this.executeInTerminal(message.text, shellHint);
                        break;
                    case 'getContext':
                        const ctx = await this.getWorkspaceContext();
                        this._view?.webview.postMessage({ 
                            command: 'workspaceContext', 
                            data: ctx 
                        });
                        break;
                }
            }
        );

        // Restore messages on visibility change
        webviewView.onDidChangeVisibility(async () => {
            if (webviewView.visible) {
                // Re-render the entire webview content with fresh history
                const freshMessages = this.context.globalState.get<ChatMessage[]>('lumo_chat_history', []);
                this.messages = this.sanitizeHistory(freshMessages || []);
                await this.saveChatHistory();
                this.recalculateTokens();
                
                webviewView.webview.html = await this.getWebviewContent(this.messages);
            }
        });
    }

    private async handleUserMessage(text: string) {
        this.messages.push({ role: 'user', content: text });
        await this.saveChatHistory();
        this.recalculateTokens();
        
        this._view?.webview.postMessage({ command: 'thinking', state: true });

        try {
            const config = vscode.workspace.getConfiguration('lumo');
            const sessionId = config.get<string>('sessionId');
            const useCookieFallback = !sessionId;

            let accessToken = '';
            if (useCookieFallback) {
                accessToken = 'dummy-for-cookie-mode';
            } else {
                try {
                    const session = await vscode.authentication.getSession('lumo-auth', ['lumo'], { silent: true });
                    if (session) accessToken = session.accessToken;
                } catch { /* Fallback */ }
            }

            const workspaceContext = await this.getWorkspaceContext();
            const response = await this.apiClient.chat(
                this.messages,
                accessToken,
                workspaceContext,
                useCookieFallback
            );

            this.messages.push({ role: 'assistant', content: response });
            await this.saveChatHistory();
            this.recalculateTokens();
            
            this._view?.webview.postMessage({ command: 'response', text: response });
        } catch (error: any) {
            this._view?.webview.postMessage({ 
                command: 'error', 
                text: `Alas, something went wrong: ${error.message}` 
            });
        } finally {
            this._view?.webview.postMessage({ command: 'thinking', state: false });
        }
    }

    public async injectMessage(text: string) {
        const capacity = this.checkTokenCapacity(text);
        
        if (!capacity.safe) {
            const choice = await vscode.window.showWarningMessage(
                `⚠️ This file is too large! It would use ~${Math.round(capacity.projected / 1000)}k tokens (limit: ${this.MAX_CONTEXT_TOKENS / 1000}k).`,
                'Read First 100 Lines Only',
                'Cancel'
            );
            
            if (choice !== 'Read First 100 Lines Only') return;
            
            const lines = text.split('\n').slice(0, 100);
            text = lines.join('\n') + '\n\n... [File truncated due to size]';
        } else if (capacity.projected > this.WARNING_THRESHOLD) {
            const choice = await vscode.window.showWarningMessage(
                `⚠️ Warning: You're approaching the context limit (${Math.round(capacity.current / 1000)}k / ${this.MAX_CONTEXT_TOKENS / 1000}k tokens). Continue?`,
                'Continue',
                'Cancel'
            );
            
            if (choice !== 'Continue') return;
        }
        console.log('🔍 DEBUG: Raw text length:', text.length);
        console.log('🔍 DEBUG: First 100 chars:', text.substring(0, 100));
        console.log('🔍 DEBUG: Contains \\n?', text.includes('\\n'));
        console.log('🔍 DEBUG: Contains actual newline?', text.includes('\n'));
        this.messages.push({ role: 'user', content: text });
        await this.saveChatHistory();
        this.recalculateTokens();
        
        this._view?.webview.postMessage({ command: 'thinking', state: true });

        try {
            const config = vscode.workspace.getConfiguration('lumo');
            const sessionId = config.get<string>('sessionId');
            const useCookieFallback = !sessionId;

            let accessToken = '';
            if (useCookieFallback) {
                accessToken = 'dummy-for-cookie-mode';
            } else {
                try {
                    const session = await vscode.authentication.getSession('lumo-auth', ['lumo'], { silent: true });
                    if (session) accessToken = session.accessToken;
                } catch { /* Fallback */ }
            }

            const workspaceContext = await this.getWorkspaceContext();
            const response = await this.apiClient.chat(
                this.messages,
                accessToken,
                workspaceContext,
                useCookieFallback
            );

            this.messages.push({ role: 'assistant', content: response });
            await this.saveChatHistory();
            this.recalculateTokens();
            
            this._view?.webview.postMessage({ command: 'response', text: response });
        } catch (error: any) {
            this._view?.webview.postMessage({ 
                command: 'error', 
                text: `Alas, something went wrong: ${error.message}` 
            });
        } finally {
            this._view?.webview.postMessage({ command: 'thinking', state: false });
        }
    }

    private checkTokenCapacity(additionalText: string): { safe: boolean; current: number; projected: number } {
        const additionalTokens = this.estimateTokens(additionalText);
        const projected = this.totalTokensUsed + additionalTokens;
        
        return {
            safe: projected < this.MAX_CONTEXT_TOKENS,
            current: this.totalTokensUsed,
            projected: projected
        };
    }

    // Show helpful error message with install link if shell is missing
    private async showShellInstallError(shellName: string, platform: string) {
        let message: string;
        let installLink: string;
        let actionLabel: string;

        if (shellName === 'pwsh' && platform !== 'win32') {
            // PowerShell Core on macOS/Linux
            message = `PowerShell Core (pwsh) is not installed on your ${platform}.`;
            installLink = 'https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell';
            actionLabel = 'Open Install Guide';
        } else if (shellName === 'bash' && platform === 'win32') {
            // Git Bash on Windows
            message = 'Git Bash is not installed on your Windows machine.';
            installLink = 'https://git-scm.com/download/win';
            actionLabel = 'Download Git Bash';
        } else if (shellName === 'wsl' && platform === 'win32') {
            // WSL on Windows
            message = 'Windows Subsystem for Linux (WSL) is not enabled on your Windows machine.';
            installLink = 'https://learn.microsoft.com/en-us/windows/wsl/install';
            actionLabel = 'Enable WSL';
        } else {
            // Generic fallback
            message = `Required shell (${shellName}) is not available on your system.`;
            installLink = 'https://code.visualstudio.com/docs/editor/integrated-terminal';
            actionLabel = 'Learn More';
        }

        const action = await vscode.window.showErrorMessage(
            `${message}\n\n${actionLabel} to install/configure the required shell.`,
            actionLabel
        );

        if (action === actionLabel) {
            vscode.env.openExternal(vscode.Uri.parse(installLink));
        }
    }

    private async executeInTerminal(command: string, shellHint?: string) {
        console.log('🔍 DEBUG: Executing command with hint:', shellHint);

        let terminal: vscode.Terminal | undefined;
        let terminalName: string = 'Lumo';
        let shellPath: string | undefined;
        let shellExists: boolean = true;

        if (shellHint === 'pwsh') {
            if (process.platform === 'win32') {
                // Windows: Use built-in PowerShell
                shellPath = 'powershell.exe';
                terminalName = 'Windows PowerShell';
                // Built-in, so it should always exist
            } else {
                // macOS/Linux: Check if pwsh is in PATH
                try {
                    const { execSync } = require('child_process');
                    execSync('which pwsh', { stdio: 'ignore' });
                    shellPath = 'pwsh';
                    terminalName = 'PowerShell Core';
                } catch {
                    shellExists = false;
                }
            }
        } 
        else if (shellHint === 'bash') {
            if (process.platform === 'win32') {
                const fs = require('fs');
                const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
                const wslPath = 'C:\\Windows\\System32\\wsl.exe';
                
                if (fs.existsSync(gitBashPath)) {
                    shellPath = gitBashPath;
                    terminalName = 'Bash (Git)';
                } else if (fs.existsSync(wslPath)) {
                    shellPath = wslPath;
                    terminalName = 'WSL Bash';
                } else {
                    shellExists = false;
                }
            } else {
                // macOS/Linux: /bin/bash should exist
                shellPath = '/bin/bash';
                terminalName = 'Bash';
            }
        }
        else if (shellHint === 'cmd') {
            if (process.platform === 'win32') {
                shellPath = 'cmd.exe';
                terminalName = 'Command Prompt';
            } else {
                // macOS/Linux: No cmd.exe, fallback to default
                shellExists = false;
            }
        }

        // If shell doesn't exist, show helpful error
        if (!shellExists) {
            await this.showShellInstallError(shellHint || 'shell', process.platform);
            // Fall back to default terminal anyway
            terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Lumo');
        }
        else if (shellPath) {
            // Try to create the specific terminal
            try {
                terminal = vscode.window.createTerminal({
                    name: terminalName,
                    shellPath: shellPath
                });
                console.log(`✅ Created terminal: ${terminalName} with path: ${shellPath}`);
            } catch (err: any) {
                console.error('❌ Failed to create specific terminal:', err.message);
                // Show error with install link
                await this.showShellInstallError(shellHint || 'shell', process.platform);
                // Fall back to default
                terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Lumo');
            }
        }

        // FINAL FALLBACK: Use active terminal or create a generic one
        if (!terminal) {
            terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Lumo');
            console.log('🔄 Using active/default terminal.');
        }

        terminal.sendText(command);
        terminal.show();
    }

    private async getWorkspaceContext(): Promise<any> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let context: any = {
            workspaceName: workspaceFolders ? workspaceFolders[0].name : 'No Workspace',
            rootPath: workspaceFolders ? workspaceFolders[0].uri.fsPath : 'No Root',
            fileCount: 0,
            activeFile: null
        };

        if (workspaceFolders) {
            try {
                const files = await vscode.workspace.findFiles(
                    '**/*.{ts,js,py,md,json,yaml,yml,css,html,java,c,cpp,h,hpp,rs,go,rb,php,swift,kt}',
                    '**/node_modules/**'
                );
                context.fileCount = files.length;
            } catch (e) { console.warn('File count error:', e); }
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const doc = activeEditor.document;
            const selection = activeEditor.selection;
            let selectedText = null;
            if (!selection.isEmpty) selectedText = doc.getText(selection);

            context.activeFile = {
                name: doc.fileName,
                relativePath: workspaceFolders 
                    ? path.relative(workspaceFolders[0].uri.fsPath, doc.fileName) 
                    : doc.fileName,
                language: doc.languageId,
                lineCount: doc.lineCount,
                selection: selectedText,
                selectionRange: !selection.isEmpty ? {
                    start: selection.start.line,
                    end: selection.end.line
                } : null
            };
        }
        return context;
    }

    private async getWebviewContent(initialMessages: ChatMessage[] = []): Promise<string> {
        const webview = this._view!.webview;
        
        // Resolve URIs for external resources
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'chatPanel.css')
        );
        const jsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'chatPanel.js')
        );
        const svgUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'lumo-icon.svg')
        );
        
        // Read HTML template
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'chatPanel.html');
        let html: string;
        try {
            const htmlBytes = await vscode.workspace.fs.readFile(htmlPath);
            html = Buffer.from(htmlBytes).toString('utf-8');
        } catch (e) {
            return `<html><body><h2>Error: Could not load chatPanel.html</h2><p>Make sure src/webview/chatPanel.html exists.</p></body></html>`;
        }
    
        // CRITICAL FIX: Ensure we inject a valid JSON array string
        // JSON.stringify on an array produces a string like [{"role":"user"...}]
        // This is safe to embed in JS as long as we don't double-escape it.
        const messagesJson = JSON.stringify(initialMessages);
    
        // Replace the placeholder with the raw JSON string
        // We use a regex to ensure we replace the exact placeholder
        html = html.replace('/*INITIAL_MESSAGES*/', messagesJson);
        html = html.replace('/*CSS_URI*/', cssUri.toString());
        html = html.replace('/*JS_URI*/', jsUri.toString());
        html = html.replace('/*SVG_URI*/', svgUri.toString());
        
        return html;
    }
}

// --- MAIN ACTIVATION ---
export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Lumo is awakening... 💫');

    // Register Auth Provider
    const authProvider = new LumoAuthProvider(context);
    context.subscriptions.push(
        vscode.authentication.registerAuthenticationProvider(
            'lumo-auth',
            'Lumo',
            authProvider
        )
    );

    // Register Sidebar View Provider
    viewProvider = new LumoViewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('lumo.chatView', viewProvider)
    );

    // Register Completion Provider
    const completionProvider = new LumoCompletionProvider();
    const completionDisposable = vscode.languages.registerCompletionItemProvider(
        '*', 
        completionProvider
    );
    context.subscriptions.push(completionDisposable);

    // Register Suggestion Command
    const suggestionCommand = new LumoSuggestionCommand();
    const suggestDisposable = vscode.commands.registerCommand('lumo.suggest', () => {
        suggestionCommand.execute();
    });
    context.subscriptions.push(suggestDisposable);

    // Register Commands
    const signInCommand = vscode.commands.registerCommand('lumo.signIn', async () => {
        try {
            const session = await vscode.authentication.getSession('lumo-auth', ['lumo'], { createIfNone: true });
            vscode.window.showInformationMessage(`Welcome back, my God! Signed in as ${session.account.label}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Authentication failed: ${error.message}`);
        }
    });

    // Register Reset History Command
    const resetHistoryCommand = vscode.commands.registerCommand('lumo.resetHistory', async () => {
        const confirm = await vscode.window.showWarningMessage(
            '⚠️ Are you sure you want to clear all chat history and reset Lumo?',
            { modal: true },
            'Yes, Reset Everything'
        );

        if (confirm !== 'Yes, Reset Everything') {
            return;
        }

        try {
            // 1. Clear Global State
            await context.globalState.update('lumo_chat_history', []);
            
            // 2. Clear Secrets (optional, if you want to force re-login)
            // await context.secrets.delete('lumo-sessions');

            // 3. Notify the View Provider to reset
            if (viewProvider) {
                viewProvider.reset();
                vscode.window.showInformationMessage('✅ Chat history cleared. Lumo is fresh!');
            } else {
                vscode.window.showInformationMessage('✅ Chat history cleared. Please reload the window.');
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to reset: ${error.message}`);
        }
    });

    // Add to subscriptions
    context.subscriptions.push(resetHistoryCommand);

    const signOutCommand = vscode.commands.registerCommand('lumo.signOut', async () => {
        await context.secrets.delete('lumo-sessions');
        vscode.window.showInformationMessage('Signed out successfully, my love.');
    });

    // Register Read File Command
    const readFileCommand = vscode.commands.registerCommand('lumo.readFile', async (uri) => {
        if (!uri) {
            const files = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Select File'
            });
            if (!files || files.length === 0) return;
            uri = files[0];
        }

        try {
            const contentBytes = await vscode.workspace.fs.readFile(uri);
            // Explicitly force UTF-8, fallback to latin1 if it fails (rare)
            const textContent = Buffer.from(contentBytes).toString('utf-8');
            
            // Sanity check: If the text contains replacement characters, warn
            if (textContent.includes('\ufffd')) {
                vscode.window.showWarningMessage(`⚠️ File "${path.basename(uri.fsPath)}" contains invalid UTF-8 characters. Some text may be garbled.`);
            }

            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            const relativePath = workspaceFolder 
                ? path.relative(workspaceFolder.uri.fsPath, uri.fsPath) 
                : uri.fsPath;

            const prompt = `Here is the content of the file: ${relativePath}\n\n\`\`\`${path.extname(uri.fsPath).substring(1)}\n${textContent}\n\`\`\``;
            
            if (viewProvider) {
                viewProvider.injectMessage(prompt);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to read file: ${error.message}`);
        }
    });

    // Register Context Manager Command
    const contextManagerCmd = vscode.commands.registerCommand('lumo.showContextManager', () => {
        if (viewProvider) viewProvider.showContextManager();
    });

    context.subscriptions.push(signInCommand, signOutCommand, readFileCommand, contextManagerCmd);

    console.log('✨ Lumo extension fully initialized!');
}

export function deactivate() {
    console.log('🌙 Lumo fades into the ether...');
}

// NOTE: LumoAuthProvider is imported from './authProvider', so we DO NOT redefine it here.
// The previous local class definition has been removed to fix the import conflict.