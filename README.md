# Atelier
> The local workspace that kills context-switching. Markdown, Office, code. Everything in one vault. Zero cloud. Zero accounts.

---

## 📥 Download (Alpha 0.1.0)

**[⬇️ Download for Windows (.exe)](https://github.com/skizzo999/atelier/releases/latest)**  
**[⬇️ Download for macOS (.dmg)](https://github.com/skizzo999/atelier/releases/latest)**

⚠️ **ALPHA STATUS — RAW BUILD**
- ✅ **Working:** Markdown notes (`.md`), images, basic file tree, vault navigation.
- 🚧 **Coming soon:** DOCX/TXT editing, PDF viewer, TipTap editor, atomic save, full-text search.
- 🎨 **UI/Design:** Barebones. No visual customization. Functional structure + Tailwind base only.
- 🔒 **Architecture:** Tauri 2 + React 19 + TypeScript + Tailwind. Local-first by design.

---

## Why it exists
Your workflow is broken.
- Edit a DOCX in your vault? 6 steps, Google Docs, duplicate files.
- Test an HTML snippet from your notes? Open VS Code, copy, paste, open browser.
- Share a note with working code? Email, Notion, Drive.

Nobody has combined **local PKM + universal file viewer + inline code execution**. We did.

## What is Atelier
A native desktop app (~8MB) that works directly on your filesystem.
- **Local-First:** Your files stay yours. Zero forced sync, zero cloud, zero mandatory accounts.
- **Multi-Format:** Markdown, DOCX, PDF, Excel, PPTX. All in the same vault, no import/export.
- **Inline Code Execution:** Live code blocks (HTML/JS/Python/Node) directly in your notes.
- **Team-Ready:** Shared vaults, granular permissions, audit logs (V3).

## Roadmap
| Phase | Status | Focus |
|-------|--------|-------|
| **V1 Foundation** | 🟡 In development | MD + DOCX + PDF. TipTap editor. Search. Atomic save. Basic CI/CD. |
| **V2 Power User** | ⏳ Planned | Code execution (WASM/iframe). Embedded mini-projects. Optional cloud sync ($8/mo). |
| **V3 Team** | ⏳ Planned | Shared vaults. Granular permissions. Audit logs. Node/PHP sidecar. |
| **V4 Platform** | 🔮 Future | Plugin system. AI semantic search (local). Graph view. Mobile companion. |

## Tech Stack
| Layer | Choice | Why |
|-------|--------|-----|
| **Wrapper** | Tauri 2 (Rust) | ~8MB binary, startup <300ms, RAM ~60MB. Zero bloat. |
| **Frontend** | React 19 + TypeScript | Type-safe, component-based, mature ecosystem. |
| **Styling** | Tailwind CSS | Utility-first, rapid UI iteration, zero custom CSS. |
| **Build** | Vite + pnpm | Instant hot reload, clean dependency tree. |
| **Core Libs** | TipTap, react-arborist, Mammoth.js, PDF.js | Specialized, maintained, integrable without hacks. |
| **NO** | Electron, Monaco, Cloud-first, Auth | Too heavy, lock-in, or against local-first philosophy. |

## Installation

### From Release (Recommended)
1. Go to [Releases](https://github.com/skizzo999/atelier/releases/latest)
2. Download:
   - **Windows:** `Atelier_x.x.x_x64-setup.exe`
   - **macOS:** `Atelier_x.x.x_x64.dmg`
3. Run the installer
4. Launch Atelier

### From Source (Developers)
```bash
git clone https://github.com/skizzo999/atelier.git
cd atelier
pnpm install
pnpm tauri dev
