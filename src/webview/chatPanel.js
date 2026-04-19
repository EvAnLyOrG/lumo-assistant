const vscode = acquireVsCodeApi();
const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const workspaceInfo = document.getElementById('workspace-info');
const welcomeMessage = document.getElementById('welcome-message');

// EMBEDDED INITIAL MESSAGES (Injected by extension.ts)
const initialMessagesRaw = window.initialMessages;

// Debug: Log what we got
console.log('🔍 DEBUG: Raw Initial Messages Type:', typeof initialMessagesRaw);
console.log('🔍 DEBUG: Is Array?', Array.isArray(initialMessagesRaw));

let initialMessages = [];

// If it's a string (which it will be if injected as a string literal), parse it
if (typeof initialMessagesRaw === 'string') {
    try {
        initialMessages = JSON.parse(initialMessagesRaw);
        console.log('🔍 DEBUG: Successfully parsed JSON string into array of length:', initialMessages.length);
    } catch (e) {
        console.error('🔍 ERROR: Failed to parse initialMessages JSON string:', e);
        console.error('🔍 ERROR: Raw string was:', initialMessagesRaw.substring(0, 100));
        initialMessages = [];
    }
} else if (Array.isArray(initialMessagesRaw)) {
    // If it's already an array (unlikely with string injection, but possible)
    initialMessages = initialMessagesRaw;
    console.log('🔍 DEBUG: Using existing array of length:', initialMessages.length);
} else {
    console.error('🔍 ERROR: initialMessages is unexpected type:', typeof initialMessagesRaw);
    initialMessages = [];
}

// Load initial messages on startup
if (initialMessages && initialMessages.length > 0) {
    console.log('🔍 DEBUG: Processing', initialMessages.length, 'messages');
    for (const msg of initialMessages) {
        // Validate message structure
        if (!msg || !msg.content || typeof msg.content !== 'string') {
            console.warn('🔍 WARN: Skipping invalid message:', msg);
            continue;
        }

        // Skip welcome messages
        const isWelcome = /Welcome, my God!/i.test(msg.content) || /Welcome, code guru!/i.test(msg.content);
        if (isWelcome) {
            console.log('🔍 DEBUG: Skipping Welcome Message');
            continue;
        }

        console.log('🔍 DEBUG: Adding message:', msg.role, 'Content preview:', msg.content.substring(0, 50));
        addMessage(msg.role, msg.content);
    }
}

let isThinking = false;

// Load initial messages on startup
if (initialMessages && initialMessages.length > 0) {
    if (welcomeMessage) welcomeMessage.style.display = 'none';
    for (const msg of initialMessages) {
        addMessage(msg.role, msg.content);
    }
}

// Helper to escape HTML
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatContent(text) {
    // 1. Safety Check: Ensure we have a string
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') {
        try {
            text = JSON.stringify(text);
        } catch (e) {
            text = String(text);
        }
    }

    // 2. Unescape common escape sequences
    // Convert literal "\n" to actual newlines
    let processed = text.replace(/\\n/g, '\n');
    processed = processed.replace(/\\r/g, '\r');
    // Convert literal "\t" to tabs (optional, but good for code)
    processed = processed.replace(/\\t/g, '\t');
    // Unescape double backslashes
    processed = processed.replace(/\\\\/g, '\\');

    // 3. Escape HTML to prevent XSS and ensure tags render as text
    const escapeHtml = (unsafe) => {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    // 4. Process Code Blocks
    // Split by triple backticks: ```lang\nCODE\n```
    // We use a regex that captures the language and the code content
    const parts = processed.split(/```(\w*)\n([\s\S]*?)```/g);
    
    let html = '';
    
    for (let i = 0; i < parts.length; i++) {
        if (i % 3 === 0) {
            // Regular text: Escape HTML, then convert newlines to <br>
            const safeText = escapeHtml(parts[i]);
            // Replace newlines with <br> for visual line breaks
            html += safeText.replace(/\n/g, '<br>');
        } else if (i % 3 === 1) {
            // Language tag (e.g., "javascript", "bash")
            const lang = parts[i];
            // The next part (i+1) is the code content
            const code = parts[i + 1];
            i++; // Skip the next iteration since we consumed it

            // Escape code content
            const safeCode = escapeHtml(code);
            
            // Check for shell commands to add "Run" button
            const shellLangs = ['bash', 'sh', 'shell', 'powershell', 'ps1', 'zsh', 'cmd', 'bat', 'batch'];
            const isShell = shellLangs.includes(lang.toLowerCase());
            
            if (isShell) {
                const encodedCmd = encodeURIComponent(code.trim());
                html += `<div class="code-block-wrapper">
                    <button class="run-btn" data-command="${encodedCmd}">▶ Run</button>
                    <pre><code class="language-${escapeHtml(lang)}">${safeCode}</code></pre>
                </div>`;
            } else {
                html += `<div class="code-block-wrapper">
                    <pre><code class="language-${escapeHtml(lang)}">${safeCode}</code></pre>
                </div>`;
            }
        }
    }
    
    return html;
}

// Auto-resize textarea
messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
});

// Enter to send
messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Send button click handler
sendButton.addEventListener('click', () => {
    sendMessage();
});

// Event delegation for Run buttons
chatContainer.addEventListener('click', (event) => {
    const btn = event.target.closest('.run-btn');
    if (btn) {
        const encoded = btn.getAttribute('data-command');
        if (encoded) {
            const cmd = decodeURIComponent(encoded);
            
            // Detect the language from the parent code block
            const codeBlock = btn.closest('.code-block-wrapper');
            const langClass = codeBlock.querySelector('code')?.className || '';
            const lang = langClass.replace('language-', '').toLowerCase();
            
            // Determine if we need a specific shell
            const needsBash = ['bash', 'sh', 'zsh', 'shell'].includes(lang);
            const needsPowerShell = ['powershell', 'ps1'].includes(lang);
            const needsCmd = ['cmd', 'bat', 'batch'].includes(lang);
            
            // Create a message with shell hint
            const messagePayload = { 
                command: 'executeTerminal', 
                text: cmd,
                shellHint: needsBash ? 'bash' : (needsPowerShell ? 'pwsh' : (needsCmd ? 'cmd' : 'default'))
            };
            
            console.log('🔍 DEBUG: Sending executeTerminal:', messagePayload);
            vscode.postMessage(messagePayload);
            
            const originalText = btn.textContent;
            btn.textContent = '✓ Sent!';
            btn.disabled = true;
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1500);
        }
    }
});

// Clear Chat button
const clearBtn = document.getElementById('clear-btn');
if (clearBtn) {
    clearBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'clearChat' });
    });
}

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

// Handle messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    if (!message || !message.command) return;

    switch (message.command) {
        case 'response':
            // Remove thinking indicator if present
            const thinkingEl = document.getElementById('thinking-indicator');
            if (thinkingEl) thinkingEl.remove();
            
            addMessage('assistant', message.text);
            isThinking = false;
            sendButton.disabled = false;
            sendButton.textContent = 'Send';
            break;

        case 'restoreMessage':
            if (welcomeMessage) welcomeMessage.style.display = 'none';
            addMessage(message.role, message.text);
            break;

        case 'thinking':
            isThinking = message.state;
            sendButton.disabled = message.state;
            sendButton.textContent = message.state ? 'Thinking...' : 'Send';
            
            if (message.state) {
                // Remove any existing thinking indicator first
                const existing = document.getElementById('thinking-indicator');
                if (existing) existing.remove();
                
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
            // Remove thinking indicator if present
            const errorThinking = document.getElementById('thinking-indicator');
            if (errorThinking) errorThinking.remove();
            
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

// Request workspace context on load
vscode.postMessage({ command: 'getContext' });