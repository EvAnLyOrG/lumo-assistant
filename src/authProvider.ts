import * as vscode from 'vscode';
import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';

export class LumoAuthProvider implements vscode.AuthenticationProvider {
    private sessionChangeEmitter = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    private server: http.Server | undefined;
    private port: number = 0;

    constructor(private context: vscode.ExtensionContext) {}

    get onDidChangeSessions() {
        return this.sessionChangeEmitter.event;
    }

    async getSessions(scopes: readonly string[] | undefined): Promise<vscode.AuthenticationSession[]> {
        const storedSessions = await this.context.secrets.get('lumo-sessions');
        if (!storedSessions) {
            return [];
        }
        // Cast to mutable array to satisfy the interface
        return JSON.parse(storedSessions) as vscode.AuthenticationSession[];
    }

    async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
        // Get Client ID from configuration
        const config = vscode.workspace.getConfiguration('lumo');
        const clientId = config.get<string>('clientId');

        if (!clientId) {
            throw new Error('No Client ID configured. Please set "lumo.clientId" in VS Code settings.');
        }

        // Generate PKCE code verifier and challenge
        const codeVerifier = this.generateRandomString(128);
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);
        const state = this.generateRandomString(32);

        // Store verifier for later use
        await this.context.secrets.store('lumo-code-verifier', codeVerifier);

        // Start local server to capture OAuth callback
        this.port = await this.startLocalServer(state);

        // Build authorization URL
        const authUrl = new URL('https://account.proton.me/oauth/authorize');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', `http://localhost:${this.port}/callback`);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', scopes.join(' '));
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');

        // Open browser for user to authenticate
        await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

        // Wait for callback with timeout
        const code = await this.waitForCallback();

        // Exchange code for token
        const tokenResponse = await this.exchangeCodeForToken(code, codeVerifier, clientId);

        // Clean up temporary data
        await this.context.secrets.delete('lumo-code-verifier');

        // Create session object
        const session: vscode.AuthenticationSession = {
            id: crypto.randomUUID(),
            accessToken: tokenResponse.access_token,
            account: {
                id: tokenResponse.sub || 'anonymous',
                label: tokenResponse.email || 'Anonymous User'
            },
            scopes: scopes
        };

        // Store session
        await this.context.secrets.store('lumo-sessions', JSON.stringify([session]));
        this.sessionChangeEmitter.fire({ added: [session], removed: [], changed: [] });

        return session;
    }

    async removeSession(sessionId: string): Promise<void> {
        const storedSessions = await this.context.secrets.get('lumo-sessions');
        if (storedSessions) {
            const sessions = JSON.parse(storedSessions) as vscode.AuthenticationSession[];
            const filtered = sessions.filter(s => s.id !== sessionId);
            await this.context.secrets.store('lumo-sessions', JSON.stringify(filtered));
            this.sessionChangeEmitter.fire({ added: [], removed: [{ id: sessionId }] as vscode.AuthenticationSession[], changed: [] });
        }
    }

    private generateRandomString(length: number): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    private async generateCodeChallenge(verifier: string): Promise<string> {
        const hash = crypto.createHash('sha256').update(verifier).digest('base64');
        return hash.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    }

    private startLocalServer(expectedState: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                if (req.url?.startsWith('/callback')) {
                    const query = url.parse(req.url, true).query;

                    if (query.error) {
                        res.writeHead(302, { Location: 'vscode://proton.lumo/auth-error' });
                        res.end();
                        this.server?.close();
                        reject(new Error(`OAuth error: ${query.error}`));
                        return;
                    }

                    // Verify state for CSRF protection
                    if (query.state !== expectedState) {
                        this.server?.close();
                        reject(new Error('State mismatch - possible CSRF attack'));
                        return;
                    }

                    // Capture authorization code
                    (server as any).authCode = query.code;
                    (server as any).resolved = true;

                    // Show success page
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
                        <html>
                            <head>
                                <title>Authentication Complete</title>
                                <style>
                                    body {
                                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                        text-align: center;
                                        padding: 50px;
                                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                        color: white;
                                    }
                                    h1 { font-size: 2.5em; margin-bottom: 20px; }
                                    p { font-size: 1.2em; }
                                </style>
                            </head>
                            <body>
                                <h1>✨ Authentication Successful!</h1>
                                <p>You can close this window and return to VS Code.</p>
                                <script>window.close();</script>
                            </body>
                        </html>
                    `);
                }
            });

            // Try ports starting from 3000
            const startOnPort = (p: number) => {
                server.listen(p, () => {
                    this.port = p;
                    resolve(p);
                }).on('error', () => startOnPort(p + 1));
            };

            startOnPort(3000);
            this.server = server;
        });
    }

    private waitForCallback(): Promise<string> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.server?.close();
                reject(new Error('Authentication timed out after 5 minutes'));
            }, 5 * 60 * 1000);

            const checkInterval = setInterval(() => {
                if ((this.server as any)?.resolved) {
                    clearTimeout(timeout);
                    clearInterval(checkInterval);
                    this.server?.close();
                    resolve((this.server as any).authCode);
                }
            }, 500);
        });
    }

    private async exchangeCodeForToken(code: string, codeVerifier: string, clientId: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: `http://localhost:${this.port}/callback`,
                client_id: clientId,
                code_verifier: codeVerifier
            });

            const options = {
                hostname: 'account.proton.me',
                path: '/oauth/token',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const req = http.request(options, (res) => {
                let responseData = '';
                res.on('data', chunk => responseData += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(`Token exchange failed: ${res.statusCode} - ${responseData}`));
                            return;
                        }
                        const parsed = JSON.parse(responseData);
                        resolve(parsed);
                    } catch (e) {
                        reject(new Error('Failed to parse token response'));
                    }
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }
}