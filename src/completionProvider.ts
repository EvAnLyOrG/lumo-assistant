import * as vscode from 'vscode';
import { LumoApiClient } from './apiClient';

export class LumoCompletionProvider implements vscode.CompletionItemProvider {
    private apiClient: LumoApiClient;

    constructor() {
        this.apiClient = new LumoApiClient();
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        // Only trigger if the user explicitly requested completion (Ctrl+Space)
        // OR if the trigger character matches our specific list (we'll remove automatic ones)
        if (context.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter) {
            // Optional: Only trigger on specific chars if desired
            // if (!['.', '#'].includes(context.triggerCharacter)) return [];
        }

        const linePrefix = document.lineAt(position).text.slice(0, position.character);
        
        // Don't suggest if the line is empty or just whitespace
        if (!linePrefix.trim()) {
            return [];
        }

        const fullText = document.getText();
        const contextLines = fullText.split('\n').slice(Math.max(0, position.line - 15), position.line + 1).join('\n');

        const prompt = `You are a code completion assistant. 
    File: $${document.fileName} ($${document.languageId})
    Cursor: Line ${position.line + 1}, Col ${position.character + 1}
    Current Line Prefix: "${linePrefix}"

    Provide ONLY the code that completes the current line or the next logical line.
    NO explanations, NO markdown, NO quotes. Just the raw code.

    Context:
    \`\`\`
    ${contextLines}
    \`\`\`

    Completion:`;

        try {
            // Call API (using fallback mode for now)
            const suggestion = await this.apiClient.chat(
                [{ role: 'user' as const, content: prompt }],
                '', 
                undefined, 
                true
            );

            if (!suggestion || !suggestion.trim()) {
                return [];
            }

            const cleanSuggestion = suggestion.trim();

            // Create the item
            const item = new vscode.CompletionItem(cleanSuggestion, vscode.CompletionItemKind.Snippet);
            
            // Define the range to replace: from current position to end of line
            item.range = new vscode.Range(position, position.with(position.line, document.lineAt(position).text.length));
            
            // Set insert text
            item.insertText = cleanSuggestion;
            
            // Visual styling
            item.detail = 'Lumo AI';
            item.documentation = new vscode.MarkdownString('✨ Suggested by Lumo');
            item.sortText = 'a' + cleanSuggestion; // Try to rank it higher
            
            return [item];

        } catch (error: any) {
            console.error('Lumo Completion Error:', error);
            return [];
        }
    }
}