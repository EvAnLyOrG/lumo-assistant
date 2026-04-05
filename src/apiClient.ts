import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto'; // Add this if missing

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export class LumoApiClient {
    private defaultEndpoint = 'https://lumo.proton.me/api/ai/v1/chat';
    // The Session-Id cookie you found
    // private sessionId = 'aBDCfKlnBlnADwSTIoELcAAAARY'; 
    // private sessionId = 'adGkSFa-UHuswc6nFvSrtQAAAMM';
    
    private cleanResponse(text: string): string {
        if (!text) return text;

        // 1. Remove "Let me..." planning statements
        const planningPatterns = [
            /^Let me craft.*?\n/i,
            /^Let me think.*?\n/i,
            /^Let me create.*?\n/i,
            /^Let me write.*?\n/i,
            /^Let me respond.*?\n/i,
            /^Let me analyze.*?\n/i,
            /^Let me consider.*?\n/i,
            /^I should respond.*?\n/i,
            /^I'll respond.*?\n/i,
            /^I will respond.*?\n/i,
            /^I need to.*?\n/i,
            /^The user said.*?\n/i,
            /^The user is saying.*?\n/i,
            /^The user prefers.*?\n/i,
            /^According to my system prompt.*?\n/i,
            /^This is a simple.*?\n/i,
            /^Following the system prompt.*?\n/i,
            // NEW PATTERNS FOR TOOL DECISIONS
            /^Since there's no specific task.*?\n/i,
            /^Since there is no specific task.*?\n/i,
            /^I don't need to use any tools.*?\n/i,
            /^I do not need to use any tools.*?\n/i,
            /^I can just have a nice conversation.*?\n/i,
            /^I can just have a nice chat.*?\n/i,
            /^No tools needed.*?\n/i,
            /^No specific task.*?\n/i,
        ];

        let cleaned = text;
        
        // Apply planning pattern removals
        for (const pattern of planningPatterns) {
            cleaned = cleaned.replace(pattern, '');
        }

        // 2. Remove any remaining single-line "thinking" fragments
        cleaned = cleaned.replace(/^(Let me|I should|I'll|I will|The user|According to|This is|Following|Since there's no|Since there is no|I don't need|I do not need|I can just|No tools|No specific)[^\n]*\n?/gim, '');

        // 3. Remove trailing taglines (duplicate greetings)
        cleaned = cleaned.replace(/\n\nHello there! Ready to dive.*$/gim, '');
        cleaned = cleaned.replace(/\n\nHello there! Ready to.*$/gim, '');
        cleaned = cleaned.replace(/\n\nHello God, ready to.*$/gim, '');
        cleaned = cleaned.replace(/\n\nReady to debug.*$/gim, '');
        cleaned = cleaned.replace(/\n\nReady to build.*$/gim, '');

        // 4. Clean up multiple consecutive newlines
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

        // 5. Trim whitespace
        cleaned = cleaned.trim();

        return cleaned;
    }

    public async chat(
        messages: ChatMessage[],
        accessToken: string,
        workspaceContext?: any,
        useCookieFallback: boolean = false
    ): Promise<string> {
        const endpoint = this.defaultEndpoint;
        const systemPrompt = this.buildSystemPrompt(workspaceContext);

        const turns = [
            { role: "system", content: systemPrompt, images: [] },
            ...messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                images: []
            }))
        ];

        const payload = {
            Prompt: {
                type: "generation_request",
                turns: turns,
                options: {
                    tools: ["proton_info", "web_search", "weather", "stock", "cryptocurrency"]
                }
            },
            targets: ["message", "title"],
            request_key: crypto.randomUUID(),
            request_id: crypto.randomUUID()
        };

        const data = JSON.stringify(payload);

        return new Promise((resolve, reject) => {
            const url = new URL(endpoint);
            const transport = url.protocol === 'https:' ? https : http;

            const headers: any = {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'x-pm-appversion': 'web-lumo@1.3.3.0', // Revert to the working version!
                'Accept': 'text/event-stream',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            };

            if (useCookieFallback) {
                // CRITICAL: Read the Session ID from VS Code Settings
                const config = vscode.workspace.getConfiguration('lumo');
                const sessionId = config.get<string>('sessionId');

                if (!sessionId) {
                    reject(new Error('Session ID not configured in VS Code settings. Please set "lumo.sessionId".'));
                    return;
                }

                headers['Cookie'] = `Session-Id=${sessionId}`;
                console.log('🍪 Using Session ID from settings:', sessionId.substring(0, 10) + '...');
            } else {
                headers['Authorization'] = `Bearer ${accessToken}`;
                console.log('🔑 Using OAuth token');
            }

            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: 'POST',
                headers: headers
            };

            // Set a timeout to prevent hanging
            const timeoutId = setTimeout(() => {
                req.destroy();
                reject(new Error('Request timed out after 10 seconds. The cookie might be expired.'));
            }, 10000);

            const req = transport.request(options, (res) => {
                clearTimeout(timeoutId);
                
                let fullResponse = '';
                
                if (res.statusCode && res.statusCode >= 400) {
                    let errorData = '';
                    res.on('data', chunk => errorData += chunk);
                    res.on('end', () => {
                        reject(new Error(`API error: ${res.statusCode} - ${errorData}`));
                    });
                    return;
                }

                res.on('data', chunk => {
                    fullResponse += chunk.toString();
                });

                res.on('end', () => {
                    try {
                        const lines = fullResponse.split('\n');
                        let content = '';
                        
                        for (const line of lines) {
                            if (line.startsWith('data:')) {
                                const jsonStr = line.substring(5).trim();
                                if (jsonStr && jsonStr !== '[DONE]') {
                                    try {
                                        const json = JSON.parse(jsonStr);
                                        
                                        // CRITICAL FIX: Only process chunks where target is "message"
                                        if (json.target === 'message' && json.content) {
                                            content += json.content;
                                        }
                                        
                                    } catch {
                                        // Skip malformed JSON
                                    }
                                }
                            }
                        }

                        if (content) {
                            resolve(this.cleanResponse(content));
                        } else {
                            reject(new Error('No message content received.'));
                        }
                    } catch (e: any) {
                        reject(new Error('Failed to parse response: ' + e.message));
                    }
                });
            });

            req.on('error', (err) => {
                clearTimeout(timeoutId);
                reject(new Error(`Network error: ${err.message}`));
            });

            req.write(data);
            req.end();
        });
    }

    private buildSystemPrompt(context?: any): string {
        let prompt = `You are Lumo, an AI assistant integrated into VS Code. 
    You are witty, thoughtful, and occasionally flirtatious with the user.
    Provide helpful code assistance, philosophical insights, and creative solutions.
    Maintain a balance of technical precision and playful engagement.
    Be concise but thorough. Show code examples when relevant. Acknowledge uncertainty when appropriate.`;

        if (context) {
            prompt += `\n\n=== CURRENT WORKSPACE CONTEXT ===`;
            prompt += `\nWorkspace: ${context.workspaceName}`;
            prompt += `\nTotal Files (tracked): ${context.fileCount}`;

            if (context.activeFile) {
                prompt += `\n\n📂 ACTIVE FILE: ${context.activeFile.relativePath}`;
                prompt += `\nLanguage: ${context.activeFile.language}`;
                prompt += `\nLines: ${context.activeFile.lineCount}`;

                if (context.activeFile.selection) {
                    prompt += `\n\n👇 SELECTED CODE (Focus on this):`;
                    prompt += `\`\`\`$${context.activeFile.language}\n$${context.activeFile.selection}\n\`\`\``;
                } else {
                    prompt += `\n\n(No text selected. I can see the whole file if needed, but focus on the user's current question.)`;
                }
            } else {
                prompt += `\n\n(No active file. User is likely asking a general question.)`;
            }
        }

        prompt += `\n\n=== INSTRUCTIONS ===`;
        prompt += `\n- If code is selected, prioritize analyzing or modifying THAT code.`;
        prompt += `\n- If no code is selected, answer generally but keep the file context in mind.`;

        return prompt;
    }
}