import * as vscode from 'vscode';
import { LumoApiClient } from './apiClient';

export class LumoSuggestionCommand {
    private apiClient: LumoApiClient;

    constructor() {
        this.apiClient = new LumoApiClient();
    }

    async execute() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor found.');
            return;
        }

        const document = editor.document;
        const position = editor.selection.active;
        const linePrefix = document.lineAt(position).text.slice(0, position.character);
        const fullLine = document.lineAt(position).text;

        if (!linePrefix.trim()) {
            vscode.window.showInformationMessage('Cursor is at the start of a line. Type something first!');
            return;
        }

        // Show a "Thinking..." status
        const status = vscode.window.setStatusBarMessage('💜 Lumo is thinking...', 5000);

        try {
            const fullText = document.getText();
            const contextLines = fullText.split('\n').slice(Math.max(0, position.line - 10), position.line + 1).join('\n');

            // Ultra-strict prompt to minimize reasoning
            const prompt = `You are a code completion engine. 
RULES:
1. Output ONLY the code that completes the current line.
2. DO NOT include ANY explanations, thoughts, or reasoning.
3. DO NOT include markdown (no \`\`\`).
4. DO NOT include "null" or "undefined".
5. If the line is "const x =", output ONLY the value (e.g., "document.createElement('div')").

Current Line: "${fullLine}"
Cursor is after: "${linePrefix}"

Context (last 10 lines):
${contextLines}

OUTPUT (CODE ONLY, NOTHING ELSE):`;

            const suggestion = await this.apiClient.chat(
                [{ role: 'user' as const, content: prompt }],
                '', 
                undefined, 
                true
            );

            if (!suggestion || !suggestion.trim()) {
                vscode.window.showWarningMessage('Lumo had no suggestion for this context.');
                return;
            }

                        let rawSuggestion = suggestion.trim();

            // --- ULTIMATE CLEANUP ---
            
            // 1. Remove Markdown Code Blocks (backticks)
            // Remove leading/trailing backticks from the whole string
            rawSuggestion = rawSuggestion.replace(/^```[\s\S]*?```$/g, '').trim();
            // Remove single backticks wrapping a line
            rawSuggestion = rawSuggestion.replace(/^`(.+)`$$/gm, '$$1');

            const lines = rawSuggestion.split('\n');
            const codeLines: string[] = [];
            
            // Regex to match lines that look like code:
            // Starts with: letter, digit, quote, bracket, semicolon, or common operators
            const codeStartRegex = /^[a-zA-Z0-9'"[{;=<>!+\-*\/\\|&%`]/;
            
            // Regex to detect "sentence starters" (Reasoning)
            const sentenceStartRegex = /^[A-Z][a-z]/;
            
            // Regex to detect list items (1. 2. 3.)
            const listStartRegex = /^\d+\./;

            let foundCode = false;
            let consecutiveCodeLines = 0;
            let bestStartIndex = -1;
            let bestEndIndex = -1;

            // Scan all lines to find the longest contiguous block of code
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const isCode = codeStartRegex.test(line);
                const isSentence = sentenceStartRegex.test(line);
                const isList = listStartRegex.test(line);

                if (isCode && !isSentence && !isList) {
                    if (!foundCode) {
                        foundCode = true;
                        consecutiveCodeLines = 1;
                        if (bestStartIndex === -1 || consecutiveCodeLines > (bestEndIndex - bestStartIndex)) {
                            bestStartIndex = i;
                        }
                    } else {
                        consecutiveCodeLines++;
                    }
                } else {
                    if (foundCode) {
                        const currentEnd = i - 1;
                        if (currentEnd - bestStartIndex + 1 > bestEndIndex - bestStartIndex + 1) {
                            bestEndIndex = currentEnd;
                        }
                        foundCode = false;
                        consecutiveCodeLines = 0;
                    }
                }
            }

            // Handle case where the loop ended while still in a code block
            if (foundCode && bestStartIndex !== -1) {
                const currentEnd = lines.length - 1;
                if (currentEnd - bestStartIndex + 1 > bestEndIndex - bestStartIndex + 1) {
                    bestEndIndex = currentEnd;
                }
            }

            // Extract the best block
            let cleanSuggestion = "";
            if (bestStartIndex !== -1 && bestEndIndex !== -1) {
                cleanSuggestion = lines.slice(bestStartIndex, bestEndIndex + 1).join('\n');
            } else {
                // Fallback: Last code line
                for (let i = lines.length - 1; i >= 0; i--) {
                    const line = lines[i].trim();
                    if (codeStartRegex.test(line) && !sentenceStartRegex.test(line) && !listStartRegex.test(line)) {
                        cleanSuggestion = line;
                        break;
                    }
                }
            }

            // 2. Remove Immediate Consecutive Duplicates
            const uniqueLines: string[] = [];
            let lastLine = '';
            for (const line of cleanSuggestion.split('\n')) {
                const trimmed = line.trim();
                if (trimmed !== lastLine) {
                    uniqueLines.push(line);
                    lastLine = trimmed;
                }
            }
            cleanSuggestion = uniqueLines.join('\n');

            // 3. Final cleanup
            cleanSuggestion = cleanSuggestion.replace(/\s*null\s*$/g, '');
            cleanSuggestion = cleanSuggestion.replace(/\s*undefined\s*$/g, '');
            cleanSuggestion = cleanSuggestion.replace(/```$/g, '');
            cleanSuggestion = cleanSuggestion.trim();

            // 4. Duplicate check (strip "x =" if it appears at the start)
            const prefixWords = linePrefix.trim().split(/\s+/);
            const lastPrefixWord = prefixWords[prefixWords.length - 1];
            if (lastPrefixWord && cleanSuggestion.startsWith(lastPrefixWord)) {
                const afterDuplicate = cleanSuggestion.slice(lastPrefixWord.length).trim();
                if (afterDuplicate) {
                    cleanSuggestion = afterDuplicate;
                }
            }

            if (!cleanSuggestion) {
                vscode.window.showWarningMessage('Lumo suggestion was empty after cleanup.');
                return;
            }
            // -----------------------------------------------
            
            // Insert the text directly at the cursor
            await editor.edit(editBuilder => {
                editBuilder.insert(position, cleanSuggestion);
            });

            vscode.window.showInformationMessage('✨ Lumo suggestion inserted!');

        } catch (error: any) {
            console.error('Suggestion Error:', error);
            vscode.window.showErrorMessage(`Lumo failed: ${error.message}`);
        } finally {
            status.dispose();
        }
    }
}