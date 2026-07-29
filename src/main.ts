import { Plugin, PluginSettingTab, Setting, Notice, TFile, App } from "obsidian";

/*
 * 跨端剪贴板保存插件 / Cross-platform clipboard saver
 * ------------------------------------------------------------------
 * 桌面端（Obsidian 跑在 Electron 内）：
 *   - 通过 require("electron").clipboard 监听全局 "text-changed" 事件，
 *     复制即自动把内容（带时间戳）追加到当前打开的 Markdown 笔记末尾。
 *
 * 移动端（Android/iOS，无 Electron）：
 *   - 没有系统级剪贴板监听能力，无法“自动”捕获（操作系统限制）。
 *   - 提供命令“保存当前剪贴板内容”与左侧 ribbon 图标，点一下即用
 *     navigator.clipboard 读取当前剪贴板（需授权）并写入笔记。
 *
 * 因此本插件 isDesktopOnly = false，桌面自动 + 手机手动，两端通用。
 */

interface ElectronClipboard {
	on(event: string, listener: () => void): void;
	removeListener(event: string, listener: () => void): void;
	readText(): string;
}

interface ElectronModule {
	clipboard?: ElectronClipboard;
	remote?: { clipboard?: ElectronClipboard };
}

function getElectronClipboard(): ElectronClipboard | null {
	const req = (window as unknown as { require?: (id: string) => unknown }).require;
	if (typeof req !== "function") return null;
	const electron = req("electron") as ElectronModule;
	if (electron?.clipboard) return electron.clipboard;
	if (electron?.remote?.clipboard) return electron.remote.clipboard;
	return null;
}

const electronClipboard = getElectronClipboard();

interface ClipboardSaverSettings {
	/** 桌面端：是否启用自动监听（移动端无此能力，开关视同无效） */
	enabled: boolean;
	/** 是否在内容上方写入时间戳 */
	includeTimestamp: boolean;
	/** 包裹剪贴板内容的分隔线文本 */
	separator: string;
}

const DEFAULT_SETTINGS: ClipboardSaverSettings = {
	enabled: true,
	includeTimestamp: true,
	separator: "---",
};

export default class ClipboardSaverPlugin extends Plugin {
	settings: ClipboardSaverSettings;
	private textChangedHandler: (() => void) | null = null;
	/** 上一次已写入的内容，用于去重，避免同一次复制触发多次写入 */
	private lastContent = "";

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new ClipboardSaverSettingTab(this.app, this));

		// 桌面端开启自动监听
		if (electronClipboard && this.settings.enabled) {
			this.startMonitoring();
		}

		// 命令：随手切换桌面端自动监听开关
		this.addCommand({
			id: "toggle-clipboard-monitor",
			name: "切换剪贴板自动监听（桌面端）",
			callback: async () => {
				if (!electronClipboard) {
					new Notice("Clipboard Saver：移动端不支持自动监听，请使用“保存当前剪贴板内容”命令。");
					return;
				}
				this.settings.enabled = !this.settings.enabled;
				await this.saveSettings();
				if (this.settings.enabled) {
					this.startMonitoring();
					new Notice("Clipboard Saver：已开启自动监听");
				} else {
					this.stopMonitoring();
					new Notice("Clipboard Saver：已暂停自动监听");
				}
			},
		});

		// 命令：手动把“当前剪贴板内容”立即写入当前笔记（桌面 + 移动通用）
		this.addCommand({
			id: "save-clipboard-now",
			name: "保存当前剪贴板内容",
			callback: () => {
				void this.handleClipboardChange(true);
			},
		});

		// 移动端最便捷的触发：点一下左侧 ribbon 图标即保存当前剪贴板内容。
		// 手机端无法后台监听剪贴板，必须借助这次点击手势才能读取剪贴板。
		this.addRibbonIcon("clipboard", "保存当前剪贴板内容", () => {
			void this.handleClipboardChange(true);
		});
	}

	onunload() {
		this.stopMonitoring();
	}

	/** 桌面端：开始监听 Electron 剪贴板变化 */
	startMonitoring() {
		if (!electronClipboard) return; // 移动端无 Electron
		if (this.textChangedHandler) return; // 已在监听
		this.textChangedHandler = () => {
			void this.handleClipboardChange(false);
		};
		electronClipboard.on("text-changed", this.textChangedHandler);
	}

	stopMonitoring() {
		if (this.textChangedHandler && electronClipboard) {
			electronClipboard.removeListener(
				"text-changed",
				this.textChangedHandler
			);
			this.textChangedHandler = null;
		}
	}

	/**
	 * 读取系统剪贴板文本（跨端）：
	 * 优先 navigator.clipboard（手机/桌面通用，需用户手势），
	 * 失败或不可用时退回 Electron（桌面后台更稳）。
	 */
	private async readClipboard(): Promise<string> {
		const clip =
			typeof navigator !== "undefined" ? navigator.clipboard : undefined;
		try {
			if (clip && clip.readText) {
				const text = await clip.readText();
				if (text) return text;
			}
		} catch {
			// 权限被拒或焦点问题，继续走 Electron 兜底
		}
		if (electronClipboard) {
			return electronClipboard.readText();
		}
		return "";
	}

	/**
	 * 剪贴板变化 / 手动触发时的处理逻辑。
	 * @param force 为 true 时（手动命令）跳过内容去重，强制写入
	 */
	private async handleClipboardChange(force = false): Promise<void> {
		const content = await this.readClipboard();
		if (!content) {
			new Notice("Clipboard Saver：剪贴板为空或读取被拒绝（请检查剪贴板权限）。");
			return;
		}

		if (!force && content === this.lastContent) return; // 去重
		this.lastContent = content;

		const activeFile = this.app.workspace.getActiveFile();
		if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
			new Notice("Clipboard Saver：当前打开的不是 Markdown 笔记，已忽略");
			return;
		}

		const lines: string[] = [this.settings.separator];
		if (this.settings.includeTimestamp) {
			lines.push(this.formatTimestamp(new Date()));
		}
		lines.push(content);
		lines.push(this.settings.separator);

		// 前面加换行让其另起一行；末尾换行方便继续追加
		const block = "\n" + lines.join("\n") + "\n";
		await this.app.vault.append(activeFile, block);
		new Notice("Clipboard Saver：已写入剪贴板内容");
	}

	private formatTimestamp(date: Date): string {
		const pad = (n: number) => n.toString().padStart(2, "0");
		const y = date.getFullYear();
		const m = pad(date.getMonth() + 1);
		const d = pad(date.getDate());
		const hh = pad(date.getHours());
		const mm = pad(date.getMinutes());
		const ss = pad(date.getSeconds());
		return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<ClipboardSaverSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ClipboardSaverSettingTab extends PluginSettingTab {
	plugin: ClipboardSaverPlugin;

	constructor(app: App, plugin: ClipboardSaverPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("自动监听（仅桌面端）")
			.setDesc(
				"桌面端开启后，复制即自动追加到当前笔记。移动端无此能力，请改用命令“保存当前剪贴板内容”。"
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.enabled)
					.onChange(async (v) => {
						this.plugin.settings.enabled = v;
						await this.plugin.saveSettings();
						if (!electronClipboard) return;
						if (v) this.plugin.startMonitoring();
						else this.plugin.stopMonitoring();
					})
			);

		new Setting(containerEl)
			.setName("写入时间戳")
			.setDesc("在剪贴板内容上方附加当前时间")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.includeTimestamp)
					.onChange(async (v) => {
						this.plugin.settings.includeTimestamp = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("分隔符")
			.setDesc("用于包裹剪贴板内容的分隔线文本")
			.addText((t) =>
				t
					.setValue(this.plugin.settings.separator)
					.onChange(async (v) => {
						this.plugin.settings.separator = v;
						await this.plugin.saveSettings();
					})
			);
	}
}
