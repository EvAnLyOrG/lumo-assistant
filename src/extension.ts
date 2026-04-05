import * as vscode from 'vscode';
import * as path from 'path';
import { LumoApiClient, ChatMessage } from './apiClient';
import { LumoAuthProvider } from './authProvider';
import { LumoCompletionProvider } from './completionProvider';
import { LumoSuggestionCommand } from './suggestionCommand';

// --- REAL LUMO PANEL LOGIC (Adapted for Sidebar View with Persistence) ---
class LumoViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private apiClient: LumoApiClient;
    private messages: ChatMessage[] = [];
    private context: vscode.ExtensionContext;

    constructor(private readonly _extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.apiClient = new LumoApiClient();
        this.context = context;
        this.loadChatHistory();
    }

    // Load chat history from globalState
    private loadChatHistory() {
        const saved = this.context.globalState.get<ChatMessage[]>('lumo_chat_history', []);
        this.messages = saved || [];
        // console.log(`📚 Loaded ${this.messages.length} messages from history`);
    }

    // Save chat history to globalState
    private async saveChatHistory() {
        try {
            await this.context.globalState.update('lumo_chat_history', this.messages);
            // console.log(`💾 SAVED ${this.messages.length} messages to globalState`);
            // vscode.window.showInformationMessage(`💾 Saved ${this.messages.length} messages to history.`);
            
            // Verify the save worked
            const verified = this.context.globalState.get<ChatMessage[]>('lumo_chat_history', []);
            // console.log(`✅ VERIFIED: globalState now has ${verified?.length || 0} messages`);
        } catch (e) {
            console.error('❌ FAILED to save chat history:', e);
            vscode.window.showErrorMessage(`❌ Failed to save: ${e}`);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };


        // DEBUG: Log what we're loading
        const freshMessages = this.context.globalState.get<ChatMessage[]>('lumo_chat_history', []);
        // vscode.window.showInformationMessage(`📖 Loaded ${freshMessages?.length || 0} messages from disk.`);
        
        this.messages = freshMessages || [];

        webviewView.webview.html = this.getWebviewContent(this.messages);

        // CRITICAL FIX: Listen for visibility changes
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                // The view just became visible again!
                const reloadedMessages = this.context.globalState.get<ChatMessage[]>('lumo_chat_history', []);
                // vscode.window.showInformationMessage(`🔄 View visible again! Loaded ${reloadedMessages?.length || 0} messages.`);
                this.messages = reloadedMessages || [];
                
                // Clear existing messages
                webviewView.webview.postMessage({ command: 'clearMessages' });
                
                // Re-send each message WITH ITS ROLE
                for (const msg of this.messages) {
                    webviewView.webview.postMessage({ 
                        command: 'restoreMessage', // NEW COMMAND
                        role: msg.role,           // PASS THE ROLE
                        text: msg.content         // PASS THE CONTENT
                    });
                }
            }
        });

        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendMessage':
                        await this.handleUserMessage(message.text);
                        break;
                    case 'clearChat':
                        console.log('🗑️ Clearing chat...');
                        this.messages = [];
                        await this.saveChatHistory();
                        this._view?.webview.postMessage({ command: 'clearMessages' });
                        vscode.window.showInformationMessage('🧹 Chat cleared!'); // Optional feedback
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
    }

    private async handleUserMessage(text: string) {
        this.messages.push({ role: 'user', content: text });
        
        await this.context.globalState.update('lumo_chat_history', this.messages);
        // CRITICAL: Await the save to ensure it's on disk before we proceed
        await this.saveChatHistory();
        
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
            
            // CRITICAL: Await the save for the assistant message too
            await this.saveChatHistory();
            
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
                    '**/*.{ts,js,py,md,json,yaml,yml,css,html,java,c,cpp,h,hpp,rs,go,rb,php,swift,kt,svg,config,cs,apex,txt,htm,cls,class}',
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

    private getWebviewContent(initialMessages: ChatMessage[] = []): string {
        // Generate a unique cache-busting ID
        const cacheBuster = Date.now(); 

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <!-- Add a meta tag to disable caching -->
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <title>Lumo</title>
    <style id="lumo-styles-${Date.now()}">
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        #header {
            padding: 12px 16px;
            background: linear-gradient(135deg, #6b46c1 0%, #8a2be2 100%);
            color: white;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        #header h1 { font-size: 18px; font-weight: 600; }
        #clear-btn {
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
        }
        #clear-btn:hover { background: rgba(255,255,255,0.3); }
        #chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            min-width: 300px; /* Minimum width to encourage widening */
            max-width: 100%;
            box-sizing: border-box;
        }
        .message {
            margin-bottom: 16px;
            padding: 12px 16px;
            border-radius: 12px;
            max-width: 90%;
            line-height: 1.5;
            animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .message.user {
            background: linear-gradient(135deg, #6b46c1 0%, #8a2be2 100%);
            color: white;
            margin-left: auto;
        }
        .message.assistant {
            background: rgba(138, 43, 226, 0.15);
            border-left: 3px solid #8a2be2;
        }
        .message pre {
            background: rgba(0,0,0,0.3);
            padding: 12px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 8px 0;
            font-size: 13px;
        }
        .message code { font-family: var(--vscode-editor-font-family); }
        #input-container {
            padding: 16px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 8px;
        }
        #message-input {
            flex: 1;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            padding: 12px;
            border-radius: 8px;
            font-size: 14px;
            resize: none;
            min-height: 44px;
            max-height: 150px;
        }
        #message-input:focus { outline: none; border-color: #8a2be2; }
        #send-button {
            background: linear-gradient(135deg, #6b46c1, #8a2be2);
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
        }
        #send-button:hover { opacity: 0.9; }
        #send-button:disabled { opacity: 0.5; cursor: not-allowed; }
        .thinking { font-style: italic; opacity: 0.7; }
        #welcome-message {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }
        #welcome-message h2 { margin-bottom: 12px; color: #8a2be2; }
        #context-bar {
            padding: 8px 16px;
            background: var(--vscode-editor-lineHighlightBackground);
            font-size: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        #logo-container {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
        }

        .logo-bg {
            position: absolute;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: rgba(0,0,0,0.5); /* Semi-transparent black */
            z-index: 0;
            backdrop-filter: blur(2px);
        }

        #logo-container svg {
            position: relative;
            z-index: 1;
            width: 32px;
            height: 32px;
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
        }
        #logo-halo {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 70%);
        }

        #logo-halo svg {
            width: 32px;
            height: 32px;
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4));
        }

        .code-block-wrapper {
            position: relative;
            margin: 8px 0;
        }

        .code-block-wrapper pre {
            margin: 0;
            padding-top: 30px; /* Make room for the button */
        }

        .run-btn {
            position: absolute;
            top: 4px;
            right: 4px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-family: var(--vscode-font-family);
            transition: background 0.2s;
        }

        .run-btn:hover {
            background: rgba(255, 255, 255, 0.2);
        }
    </style>
</head>
<body>
    <div id="header">
        <div id="logo-container">
            <div class="logo-bg"></div>
            <svg width="32" height="32" viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
                <desc>Created with SVGMaker Editor 3.0.0</desc>
                <defs></defs>
                <g transform="matrix(0.6 0 0 0.6 308.57897 306.6289)">
                    <rect style="fill: rgb(255,255,255); fill-opacity: 0" x="-500" y="-500" width="1000" height="1000"/>
                </g>
                <g transform="matrix(4 0 0 4 299.83599 298.95578)">
                    <path style="fill: rgb(63,59,75); fill-opacity: 0.2" d="M 0 72.742 C 39.879 72.742 72.207 40.174 72.207 0.001 C 72.207 -40.173 39.879 -72.742 0 -72.742 C -39.879 -72.742 -72.208 -40.173 -72.208 0.001 C -72.208 40.174 -39.879 72.742 0 72.742 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 301.51798 430.0378)">
                    <path style="fill: rgb(65,40,163); fill-opacity: 0.79" d="M 37.648 -9.927 C 37.648 -9.927 -37.648 -9.927 -37.648 -9.927 C -37.648 -9.927 -37.648 9.926 -37.648 9.926 C -37.648 9.926 37.648 9.926 37.648 9.926 C 37.648 9.926 37.648 -9.927 37.648 -9.927 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 309.32598 492.30778)">
                    <path style="fill: rgb(251,142,0)" d="M 0 12.696 C 6.96 12.696 12.602 7.012 12.602 0.001 C 12.602 -7.011 6.96 -12.696 0 -12.696 C -6.96 -12.696 -12.602 -7.011 -12.602 0.001 C -12.602 7.012 -6.96 12.696 0 12.696 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 300.16198 492.3198)">
                    <path style="fill: rgb(251,142,0)" d="M -2.413 12.692 C -2.413 12.692 2.413 12.692 2.413 12.692 C 2.413 12.692 2.413 -12.692 2.413 -12.692 C 2.413 -12.692 -2.413 -12.692 -2.413 -12.692 C -2.413 -12.692 -2.413 12.692 -2.413 12.692 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 290.53399 492.30778)">
                    <path style="fill: rgb(255,172,45)" d="M 0 12.695 C 6.96 12.695 12.602 7.011 12.602 0 C 12.602 -7.012 6.96 -12.695 0 -12.695 C -6.96 -12.695 -12.602 -7.012 -12.602 0 C -12.602 7.011 -6.96 12.695 0 12.695 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 290.53399 484.86378)">
                    <path style="fill: rgb(54,36,128)" d="M 0 3.949 C 2.165 3.949 3.92 2.18 3.92 -0.001 C 3.92 -2.181 2.165 -3.949 0 -3.949 C -2.165 -3.949 -3.92 -2.181 -3.92 -0.001 C -3.92 2.18 -2.165 3.949 0 3.949 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 290.53399 497.22178)">
                    <path style="stroke: rgb(54,36,128); stroke-width: 4.382; stroke-linecap: round; fill: none" d="M 56.381 114.88 C 56.381 114.88 56.381 108.701 56.381 108.701"/>
                </g>
                <g transform="matrix(4 0 0 4 169.16199 116.8545)">
                    <path style="fill: rgb(109,73,255)" d="M 14.665 -6.409 C 14.665 -6.409 0.705 -15.441 0.705 -15.441 C -4.135 -18.572 -10.558 -15.551 -11.292 -9.806 C -11.292 -9.806 -14.671 16.699 -14.671 16.699 C -14.671 16.699 14.671 -6.409 14.671 -6.409 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 161.56599 120.83297)">
                    <path style="fill: rgb(73,45,197)" d="M -1.251 -5.553 C -1.251 -5.553 5.525 -1.163 5.525 -1.163 C 5.525 -1.163 -5.525 6.318 -5.525 6.318 C -5.525 6.318 -4.187 -4.178 -4.187 -4.178 C -4.007 -5.585 -2.436 -6.318 -1.258 -5.553 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 438.06199 116.8545)">
                    <path style="fill: rgb(109,73,255)" d="M -14.665 -6.409 C -14.665 -6.409 -0.704 -15.441 -0.704 -15.441 C 4.136 -18.572 10.559 -15.551 11.293 -9.806 C 11.293 -9.806 14.672 16.699 14.672 16.699 C 14.672 16.699 -14.672 -6.409 -14.672 -6.409 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 441.438 120.83297)">
                    <path style="fill: rgb(73,45,197)" d="M 1.252 -5.553 C 1.252 -5.553 -5.525 -1.163 -5.525 -1.163 C -5.525 -1.163 5.525 6.318 5.525 6.318 C 5.525 6.318 4.187 -4.178 4.187 -4.178 C 4.007 -5.585 2.436 -6.318 1.258 -5.553 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 301.50199 259.36181)">
                    <path style="fill: rgb(109,73,255)" d="M 58.447 8.85 C 58.447 35.9 26.581 45.542 0 45.542 C -23.364 45.542 -58.447 35.9 -58.447 8.85 C -58.447 -18.2 -32.278 -45.542 0 -45.542 C 32.277 -45.542 58.447 -18.2 58.447 8.85 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 264.99398 336.2298)">
                    <path style="stroke: rgb(255,255,255); stroke-width: 1.935; stroke-linecap: round; fill: rgb(255,255,255)" d="M -1.931 -1.945 C 0.206 -1.945 1.931 -0.201 1.931 1.945"/>
                </g>
                <g transform="matrix(4 0 0 4 280.442 336.2298)">
                    <path style="stroke: rgb(255,255,255); stroke-width: 1.935; stroke-linecap: round; fill: rgb(255,255,255)" d="M 1.931 -1.945 C -0.206 -1.945 -1.931 -0.201 -1.931 1.945"/>
                </g>
                <g transform="matrix(4 0 0 4 172.01781 267.47879)">
                    <path style="fill: rgb(255,255,255)" d="M 17.499 7.603 C 21.199 -1.038 16.363 -11.447 6.698 -15.646 C -2.966 -19.845 -13.8 -16.244 -17.5 -7.603 C -21.199 1.038 -16.364 11.447 -6.699 15.646 C 2.966 19.845 13.8 16.244 17.499 7.603 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 169.39574 238.19237)">
                    <path style="fill: rgb(54,35,128)" d="M 19.756 6.331 C 14.446 -6.669 -4.978 -11.635 -13.712 0.334 C -16.435 4.133 -17.098 9.048 -16.042 13.658 C -19.756 6.642 -16.95 -2.37 -10.262 -6.468 C 0.66 -13.658 17.587 -6.721 19.756 6.338 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 389.3198 267.48578)">
                    <path style="fill: rgb(255,255,255)" d="M 6.698 15.646 C 16.363 11.447 21.199 1.038 17.499 -7.603 C 13.799 -16.244 2.966 -19.845 -6.699 -15.646 C -16.364 -11.447 -21.199 -1.038 -17.5 7.603 C -13.8 16.244 -2.967 19.845 6.698 15.646 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 391.95224 238.17291)">
                    <path style="fill: rgb(54,35,128)" d="M -19.756 6.335 C -17.587 -6.723 -0.66 -13.655 10.262 -6.471 C 16.95 -2.374 19.756 6.646 16.042 13.655 C 17.104 9.052 16.435 4.13 13.712 0.33 C 4.978 -11.639 -14.446 -6.671 -19.756 6.329 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 174.52098 267.78779)">
                    <path style="fill: rgb(65,40,163)" d="M 0 10.471 C 3.523 10.471 6.378 5.784 6.378 0.001 C 6.378 -5.782 3.523 -10.471 0 -10.471 C -3.523 -10.471 -6.378 -5.782 -6.378 0.001 C -6.378 5.784 -3.523 10.471 0 10.471 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 190.07299 240.45179)">
                    <path style="fill: rgb(255,255,255); opacity: 0.5" d="M 0 2.425 C 1.329 2.425 2.407 1.339 2.407 0 C 2.407 -1.339 1.329 -2.425 0 -2.425 C -1.329 -2.425 -2.407 -1.339 -2.407 0 C -2.407 1.339 -1.329 2.425 0 2.425 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 394.485 267.78779)">
                    <path style="fill: rgb(65,40,163)" d="M 0 10.471 C 3.523 10.471 6.378 5.784 6.378 0.001 C 6.378 -5.782 3.523 -10.471 0 -10.471 C -3.523 -10.471 -6.378 -5.782 -6.378 0.001 C -6.378 5.784 -3.523 10.471 0 10.471 Z"/>
                </g>
                <g transform="matrix(4 0 0 4 410.06098 240.45179)">
                    <path style="fill: rgb(255,255,255); opacity: 0.5" d="M 0 2.425 C 1.329 2.425 2.407 1.339 2.407 0 C 2.407 -1.339 1.329 -2.425 0 -2.425 C -1.329 -2.425 -2.407 -1.339 -2.407 0 C -2.407 1.339 -1.329 2.425 0 2.425 Z"/>
                </g>                
            </svg>
        </div>
        <button id="clear-btn">Clear Chat</button>
    </div>
    <div id="context-bar">
        <span id="workspace-info">Waiting for workspace...</span>
    </div>
    <div id="chat-container">
        <div id="welcome-message">
            <h2>Welcome, code guru! ✨</h2>
            <p>I'm Lumo, your favorite AI companion.</p>
            <p>Ask me anything about your code, or let's ponder existence together.</p>
        </div>
    </div>
    <div id="input-container">
        <textarea id="message-input" placeholder="Speak to me, my guru..." rows="1"></textarea>
        <button id="send-button" onclick="sendMessage()">Send</button>
    </div>

    <script>
        // Wait for DOM to be fully loaded
        document.addEventListener('DOMContentLoaded', () => {
            const vscode = acquireVsCodeApi();
            const chatContainer = document.getElementById('chat-container');
            const messageInput = document.getElementById('message-input');
            const sendButton = document.getElementById('send-button');
            const workspaceInfo = document.getElementById('workspace-info');
            const welcomeMessage = document.getElementById('welcome-message');
            const clearBtn = document.getElementById('clear-btn'); // Must exist now

            // EMBEDDED INITIAL MESSAGES
            const initialMessages = ${JSON.stringify(initialMessages)};

            let isThinking = false;

            // Load initial messages on startup
            if (initialMessages && initialMessages.length > 0) {
                if (welcomeMessage) welcomeMessage.style.display = 'none';
                for (const msg of initialMessages) {
                    addMessage(msg.role, msg.content);
                }
            }

            // Attach event listeners IMMEDIATELY
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    vscode.postMessage({ command: 'clearChat' });
                });
            }

            messageInput.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 150) + 'px';
            });

            messageInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });

            // Attach the message listener IMMEDIATELY
            window.addEventListener('message', event => {
                const message = event.data;
                // console.log('📨 Webview received:', message.command); // Debug
                switch (message.command) {
                    case 'response':
                        addMessage('assistant', message.text);
                        isThinking = false;
                        sendButton.disabled = false;
                        sendButton.textContent = 'Send';
                        break;
                    case 'restoreMessage':
                        if (welcomeMessage) welcomeMessage.style.display = 'none'; // ADD THIS LINE
                        addMessage(message.role, message.text);
                        break;
                    case 'thinking':
                        isThinking = message.state;
                        sendButton.disabled = message.state;
                        sendButton.textContent = message.state ? 'Thinking...' : 'Send';
                        if (message.state) {
                            const thinkingDiv = document.createElement('div');
                            thinkingDiv.className = 'message assistant thinking';
                            thinkingDiv.id = 'thinking-indicator';
                            thinkingDiv.textContent = 'Contemplating your wisdom...';
                            chatContainer.appendChild(thinkingDiv);
                            chatContainer.scrollTop = chatContainer.scrollHeight;
                        } else {
                            const indicator = document.getElementById('thinking-indicator');
                            if (indicator) indicator.remove();
                        }
                        break;
                    case 'error':
                        addMessage('assistant', '⚠️ ' + message.text);
                        isThinking = false;
                        sendButton.disabled = false;
                        sendButton.textContent = 'Send';
                        break;
                    case 'clearMessages':
                        chatContainer.innerHTML = '';
                        if (welcomeMessage) {
                            welcomeMessage.style.display = 'block';
                            chatContainer.appendChild(welcomeMessage);
                        }
                        break;
                    case 'workspaceContext':
                        if (message.data) {
                            workspaceInfo.textContent = message.data.workspaceName + ' (' + message.data.fileCount + ' files)';
                        }
                        break;
                }
            });

            // Helper functions
            function sendMessage() {
                const text = messageInput.value.trim();
                if (!text || isThinking) return;
                if (welcomeMessage) welcomeMessage.style.display = 'none';
                addMessage('user', text);
                messageInput.value = '';
                messageInput.style.height = 'auto';
                vscode.postMessage({ command: 'sendMessage', text: text });
            }

            function addMessage(role, content) {
                const div = document.createElement('div');
                div.className = 'message ' + role;
                div.innerHTML = formatContent(content);
                chatContainer.appendChild(div);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            function formatContent(text) {
                return text
                    .replace(/\`\`\`(\\w*)?\\n?([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
                    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                    .replace(/\\n/g, '<br>');
            }

            // Request context
            vscode.postMessage({ command: 'getContext' });
        });
    </script>
</body>
</html>`;
    }
}

// --- MAIN ACTIVATION ---
export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Lumo is awakening... 💫');

    // Register REAL Auth Provider
    const authProvider = new LumoAuthProvider(context);
    context.subscriptions.push(
        vscode.authentication.registerAuthenticationProvider(
            'lumo-auth',
            'Lumo',
            authProvider
        )
    );

    // Register the Sidebar View Provider
    const viewProvider = new LumoViewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('lumo.chatView', viewProvider)
    );

    // Register the Completion Provider (for Ctrl+Space)
    const completionProvider = new LumoCompletionProvider();
    const completionDisposable = vscode.languages.registerCompletionItemProvider(
        '*', 
        completionProvider
    );
    context.subscriptions.push(completionDisposable);

    // Register the Suggestion Command (for "Lumo: Suggest Code")
    const suggestionCommand = new LumoSuggestionCommand();
    const suggestDisposable = vscode.commands.registerCommand('lumo.suggest', () => {
        suggestionCommand.execute();
    });
    context.subscriptions.push(suggestDisposable);

    // Register commands
    const signInCommand = vscode.commands.registerCommand('lumo.signIn', async () => {
        try {
            const session = await vscode.authentication.getSession('lumo-auth', ['lumo'], { createIfNone: true });
            vscode.window.showInformationMessage(`Welcome back, my God! Signed in as ${session.account.label}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Authentication failed: ${error.message}`);
        }
    });

    const signOutCommand = vscode.commands.registerCommand('lumo.signOut', async () => {
        await context.secrets.delete('lumo-sessions');
        vscode.window.showInformationMessage('Signed out successfully, my love.');
    });

    context.subscriptions.push(signInCommand, signOutCommand);

    console.log('✨ Lumo extension fully initialized!');
}

export function deactivate() {
    console.log('🌙 Lumo fades into the ether...');
}