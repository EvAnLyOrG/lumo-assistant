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

1. Download the `lumo-assistant-0.6.0.vsix` file.
2. Open VS Code.
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac).
4. Type **"Extensions: Install from VSIX..."** and select it.
5. Choose the downloaded `.vsix` file.
6. Reload VS Code when prompted.

### From Source

bash

`git clone https://github.com/EvAnLyOrG/lumo-assistant.git`<br>
`cd lumo-assistant`<br>
`npm install`<br>
`npm run compile`<br>

Press F5 in VS Code to launch the extension in development mode.

## ⚙️ Configuration

### Setting Up Authentication

1. Open VS Code Settings (`Ctrl+,`).
2. Search for **"Lumo"**.
3. Enter your **Session ID** in the `lumo.sessionId` field.

**How to get your Session ID:**

1. Go to [lumo.proton.me](https://lumo.proton.me) in your browser.
2. Log in to your Proton account.
3. Press `F12` → **Application** → **Cookies**.
4. Find the `Session-Id` cookie and copy its value.
5. Paste it into the VS Code setting.

> **Note:** Lumo Pro subscribers get unlimited usage. Free tier users have weekly quotas.

---

## 🎮 Usage

### Chat Interface

1. Click the **Lumo icon** in the Activity Bar (left sidebar).
2. Type your message and press **Enter** or click **Send**.
3. Your conversation history is automatically saved and restored.

### Code Suggestions

1. Open a code file.
2. Type a partial line (e.g., `const x =`).
3. Press `Ctrl+Shift+P` → **"Lumo: Suggest Code"**.
4. The AI will insert a context-aware suggestion at your cursor.

### Clear Chat History

Click the **"Clear Chat"** button in the chat header to erase all conversation history.

---

## ⌨️ Keyboard Shortcuts

| Command | Shortcut | Description |
| :--- | :--- | :--- |
| `lumo.suggest` | `Alt+/` | Generate code suggestion at cursor |

> To customize: Open Keyboard Shortcuts (`Ctrl+K Ctrl+S`) and search for "Lumo".

---

## 🛠️ Commands

| Command | Description |
| :--- | :--- |
| `Lumo: Sign in` | Authenticate with your Proton account |
| `Lumo: Sign out` | Clear your authentication session |
| `Lumo: Suggest Code` | Generate AI code suggestion |

---

## 📋 Requirements

- VS Code `1.85.0` or higher
- A Proton account (for Lumo access)
- Internet connection

---

## 🔒 Privacy & Security

This extension uses Proton's Lumo API, which features:
- End-to-end encryption for all messages
- Zero-access encryption (Proton cannot read your chats)
- No data sold to third parties

Your Session ID is stored locally in VS Code's secure settings and never transmitted elsewhere.

---

## 🐛 Known Issues

- Code completion may take 2-5 seconds due to API latency
- Session IDs expire periodically and need to be refreshed
- Inline completion (ghost text) is not yet supported

---

## 🗺️ Roadmap

- [ ] Native OAuth authentication flow
- [ ] Inline code completion (ghost text)
- [ ] Multiple conversation threads
- [ ] Custom system prompts
- [ ] Streaming text display

---

## 📄 License

This project is licensed under the MIT License — see the [license](license.txt) file for details.

---

## 🙏 Acknowledgments

- **Proton** for the Lumo AI platform
- **VS Code Team** for the excellent extension API
- The open-source community for inspiration

---

<div align="center">

**Made with 💜 by Evanly**

</div>
