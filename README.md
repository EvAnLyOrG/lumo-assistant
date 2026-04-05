# Lumo - AI Coding Companion

<div align="center">

**Your secure AI companion for coding, embedded directly in VS Code.**

[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue.svg)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## ✨ Features

- **💬 Persistent Chat Interface** — Beautiful sidebar chat with full conversation history that survives view switches and VS Code restarts.
- **🧠 Context-Aware Responses** — Automatically detects your active file, language, and selected code for intelligent assistance.
- **⚡ Code Completion** — Get AI-powered code suggestions via the command palette.
- **🔐 Privacy-First** — Powered by Proton's Lumo AI with end-to-end encryption.
- **🎨 Custom Branded UI** — Elegant purple gradient interface with custom mascot logo.

---

## 📦 Installation

### From VSIX File (Recommended for Personal Use)

1. Download the `lumo-assistant-0.1.0.vsix` file.
2. Open VS Code.
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac).
4. Type **"Extensions: Install from VSIX..."** and select it.
5. Choose the downloaded `.vsix` file.
6. Reload VS Code when prompted.

### From Source

bash
git clone https://github.com/EvAnLyOrG/lumo-assistant.git
cd lumo-assistant
npm install
npm run compile

Press F5 in VS Code to launch the extension in development mode.

⚙️ Configuration
Setting Up Authentication
Open VS Code Settings (Ctrl+,).
Search for "Lumo".
Enter your Session ID in the lumo.sessionId field.
How to get your Session ID:

Go to lumo.proton.me in your browser.
Log in to your Proton account.
Press F12 → Application → Cookies.
Find the Session-Id cookie and copy its value.
Paste it into the VS Code setting.
Note: Lumo Pro subscribers get unlimited usage. Free tier users have weekly quotas.

🎮 Usage
Chat Interface
Click the Lumo icon (💜) in the Activity Bar (left sidebar).
Type your message and press Enter or click Send.
Your conversation history is automatically saved and restored.
Code Suggestions
Open a code file.
Type a partial line (e.g., const x =).
Press Ctrl+Shift+P → "Lumo: Suggest Code".
The AI will insert a context-aware suggestion at your cursor.
Clear Chat History
Click the "Clear Chat" button in the chat header to erase all conversation history.

⌨️ Keyboard Shortcuts
Command	Shortcut	Description
lumo.suggest	Alt+/	Generate code suggestion at cursor
To customize: Open Keyboard Shortcuts (Ctrl+K Ctrl+S) and search for "Lumo".

🛠️ Commands
Command	Description
Lumo: Sign in	Authenticate with your Proton account
Lumo: Sign out	Clear your authentication session
Lumo: Suggest Code	Generate AI code suggestion
📋 Requirements
VS Code 1.85.0 or higher
A Proton account (for Lumo access)
Internet connection
🔒 Privacy & Security
This extension uses Proton's Lumo API, which features:

End-to-end encryption for all messages
Zero-access encryption (Proton cannot read your chats)
No data sold to third parties
Your Session ID is stored locally in VS Code's secure settings and never transmitted elsewhere.

🐛 Known Issues
Code completion may take 2-5 seconds due to API latency
Session IDs expire periodically and need to be refreshed
Inline completion (ghost text) is not yet supported
🗺️ Roadmap
 Native OAuth authentication flow
 Inline code completion (ghost text)
 Multiple conversation threads
 Custom system prompts
 Streaming text display
📄 License
This project is licensed under the MIT License — see the LICENSE file for details.

🙏 Acknowledgments
Proton for the Lumo AI platform
VS Code Team for the excellent extension API
The open-source community for inspiration
<div align="center">
Made with 💜 by Evanly

</div> ```
📄 LICENSE
MIT License

Copyright (c) 2026 Evanly

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
