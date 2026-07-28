# Clipboard Saver

Auto-save the contents of your system clipboard (with a timestamp) to the currently open Markdown note.

## Features

- **Desktop (Windows / macOS / Linux):** once enabled, any newly copied text is **automatically** appended to the end of the active note.
- **Mobile (Android / iOS):** Obsidian mobile has no system-level clipboard monitoring, so saving is **manual** — run the command "保存当前剪贴板内容" (Save current clipboard) to write the current clipboard into the note.
- Output format: separator → timestamp → content → separator. The separator and timestamp toggle are adjustable in settings.

## Usage

1. Enable **Clipboard Saver** in Obsidian Settings → Community plugins.
2. **Desktop:** auto-monitor is on by default; just copy any text. You can turn it off in settings.
3. **Mobile:** open a note, open the command palette, and run "保存当前剪贴板内容". The first run asks for clipboard permission.

## Commands

- `保存当前剪贴板内容` (Save current clipboard): read the clipboard and append it to the current note (desktop + mobile).
- `切换剪贴板自动监听（桌面端）` (Toggle auto-monitor, desktop): turn desktop auto-monitoring on/off.

## Settings

- **自动监听（仅桌面端） / Auto-monitor (desktop only):** append on copy. Not available on mobile.
- **写入时间戳 / Include timestamp:** prepend the current time above the content.
- **分隔符 / Separator:** text used to wrap the clipboard content.

## How it works

- Desktop uses Obsidian's Electron `clipboard` module to listen for the global `text-changed` event.
- Mobile uses the browser `navigator.clipboard.readText()`, which requires a user tap and permission.
- The plugin is `isDesktopOnly = false`: one plugin for both, manual on mobile.

## Development

```bash
npm install
npm run build      # type-check + esbuild bundle, outputs main.js
```

Place the built `main.js` and `manifest.json` into your vault's `.obsidian/plugins/clipboard-saver/` folder.

## License

MIT

---

# 中文说明

把系统剪贴板的内容（附带时间戳）保存到当前打开的 Markdown 笔记里。

- **桌面端**：开启后复制新文本即自动追加到当前笔记末尾。
- **移动端**：无系统级剪贴板监听，用命令「保存当前剪贴板内容」手动保存（需点击并授权）。
- 设置可调整分隔符与是否写入时间戳。
