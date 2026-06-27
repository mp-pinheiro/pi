import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { exec } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const fmt = (n: number) =>
	n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(2)}M`;

// render() runs on every repaint, so it must not spawn subprocesses inline:
// that blocks the event loop and shows up as input lag (worse under sandbox-exec,
// which re-sandboxes every spawn). State refreshes async; render() reads the cache.

interface GitStatus {
	branch: string;
	status: string;
}

interface ProviderStatus {
	status: "online" | "offline" | "unknown";
	timestamp: number;
}

interface StatusCache {
	openrouter: ProviderStatus;
}

let gitCache: GitStatus = { branch: "no-git", status: "" };
let gitRefreshing = false;
let gitRefreshedAt = 0;
const GIT_TTL = 2000;

let providerCache: ProviderStatus = { status: "unknown", timestamp: 0 };
let providerRefreshing = false;
const PROVIDER_TTL = 300000;

// One async spawn (vs three sync ones) gathers branch + dirty + unpushed; \x1f
// (unit separator) delimits the fields so they can't collide with branch names.
function refreshGitStatus(onDone: () => void): void {
	const now = Date.now();
	if (gitRefreshing || now - gitRefreshedAt < GIT_TTL) return;
	gitRefreshing = true;
	const cmd =
		'b=$(git branch --show-current 2>/dev/null); ' +
		'c=$(git status --porcelain 2>/dev/null); ' +
		'u=$(git log @{u}..HEAD --oneline 2>/dev/null); ' +
		'printf "%s\\037%s\\037%s" "$b" "${c:+1}" "${u:+1}"';
	exec(cmd, { encoding: "utf8", timeout: 5000 }, (err, stdout) => {
		gitRefreshing = false;
		gitRefreshedAt = Date.now();
		const [branch, hasChanges, hasUnpushed] = String(stdout || "").split("\x1f");
		if (err || !branch) {
			gitCache = { branch: "no-git", status: "" };
		} else {
			let status = "";
			if (hasChanges) status += "*";
			if (hasUnpushed) status += "↑";
			if (!hasChanges && !hasUnpushed) status = "✓";
			gitCache = { branch, status };
		}
		onDone();
	});
}

function refreshProviderStatus(onDone: () => void): void {
	const now = Date.now();
	if (providerRefreshing || now - providerCache.timestamp < PROVIDER_TTL) return;
	providerRefreshing = true;

	const cacheDir = join(process.env.HOME || "", ".cache", "pi-status");
	const cacheFile = join(cacheDir, "status.json");

	// Warm the in-memory cache from disk first so a fresh session skips the probe.
	try {
		const disk = JSON.parse(readFileSync(cacheFile, "utf8")) as StatusCache;
		if (disk.openrouter && now - disk.openrouter.timestamp < PROVIDER_TTL) {
			providerCache = disk.openrouter;
			providerRefreshing = false;
			return;
		}
	} catch (e) {}

	const cmd = "curl -sI --connect-timeout 2 --max-time 3 https://openrouter.ai 2>/dev/null | head -1";
	exec(cmd, { encoding: "utf8", timeout: 5000 }, (err, stdout) => {
		providerRefreshing = false;
		let status: ProviderStatus["status"] = "unknown";
		const result = String(stdout || "").trim();
		if (!err) {
			if (result.includes("200") || result.includes("301") || result.includes("302")) {
				status = "online";
			} else if (result.includes("5")) {
				status = "offline";
			}
		}
		providerCache = { status, timestamp: Date.now() };
		try {
			mkdirSync(cacheDir, { recursive: true });
			const toWrite: StatusCache = { openrouter: providerCache };
			writeFileSync(cacheFile, JSON.stringify(toWrite, null, 2));
		} catch (e) {}
		onDone();
	});
}

export default function (pi: ExtensionAPI) {
	const install = (ctx: any) => {
		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			const unsub = footerData.onBranchChange(() => {
				gitRefreshedAt = 0; // a branch change should refresh status immediately
				tui.requestRender();
			});
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					// Kick throttled background refreshes; their callbacks repaint when done.
					refreshGitStatus(() => tui.requestRender());
					refreshProviderStatus(() => tui.requestRender());

					let input = 0,
						output = 0,
						cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							input += m.usage.input;
							output += m.usage.output;
							const model =
								ctx.modelRegistry.find(m.provider, m.responseModel ?? m.model) ??
								ctx.modelRegistry.find(m.provider, m.model);
							if (model) {
								const c = model.cost;
								cost +=
									(c.input * m.usage.input +
										c.output * m.usage.output +
										c.cacheRead * m.usage.cacheRead +
										c.cacheWrite * m.usage.cacheWrite) /
									1_000_000;
							} else {
								cost += m.usage.cost.total;
							}
						}
					}

					const ctxUsage = ctx.getContextUsage?.() as any;
					const ctxMax = ctxUsage?.max ?? ctxUsage?.contextWindow ?? 0;
					const ctxTokens = ctxUsage?.tokens ?? 0;
					const ctxPct = ctxMax > 0 ? Math.round((ctxTokens / ctxMax) * 100) : 0;

					const branch = footerData.getGitBranch() || gitCache.branch;
					const gitStatus = gitCache.status;

					const statusColor = providerCache.status === "online" ? "success" :
										providerCache.status === "offline" ? "error" : "text";
					const sicon = theme.fg(statusColor, "●");

					let branchDisplay = branch;
					if (branch !== "no-git" && gitStatus) {
						const gitStatusColor = gitStatus === "✓" ? "success" :
											gitStatus.includes("*") ? "warning" : "accent";
						branchDisplay = `${branch} (${theme.fg(gitStatusColor, gitStatus)})`;
					}
					const gitPart = theme.fg("accent", `⎇ ${branchDisplay}`);

					const ctxPart = theme.fg("borderAccent", `📊 ${ctxPct}%`);

					const modelId = ctx.model?.id || "no-model";
					const effort = pi.getThinkingLevel();
					const modelPart = theme.fg("warning", `🤖 ${modelId.split('/').pop()} [${effort}]`);

					const line1 = `${sicon} ${gitPart} | ${ctxPart} | ${modelPart}`;

					const costText = theme.fg("dim", `↑${fmt(input)} ↓${fmt(output)} $${cost.toFixed(3)}`);
					const extParts: string[] = [];
					for (const value of footerData.getExtensionStatuses().values()) {
						if (value) extParts.push(value);
					}
					const leftPart = extParts.join(" | ");
					const padding = Math.max(1, width - visibleWidth(leftPart) - visibleWidth(costText));
					const line2 = leftPart + " ".repeat(padding) + costText;

					const cwd = process.cwd();
					const dirPart = theme.fg("success", `📂 ${cwd}`);
					const line1WithDir = `${line1} | ${dirPart}`;

					return [
						truncateToWidth(line1WithDir, width),
						truncateToWidth(line2, width),
					];
				},
			};
		});
	};

	pi.on("session_start", async (_event, ctx) => install(ctx));
}
