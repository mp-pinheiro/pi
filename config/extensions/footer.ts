import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const fmt = (n: number) =>
	n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(2)}M`;

interface ProviderStatus {
	status: "online" | "offline" | "unknown";
	timestamp: number;
}

interface StatusCache {
	openrouter: ProviderStatus;
}

function getCachedProviderStatus(): ProviderStatus {
	const cacheDir = join(process.env.HOME || "", ".cache", "pi-status");
	const cacheFile = join(cacheDir, "status.json");
	const now = Date.now();
	const ttl = 300000;

	try {
		mkdirSync(cacheDir, { recursive: true });
		const cache = JSON.parse(readFileSync(cacheFile, "utf8")) as StatusCache;
		const cached = cache.openrouter;
		if (cached && now - cached.timestamp < ttl) {
			return cached;
		}
	} catch (e) {
	}

	let status: ProviderStatus["status"] = "unknown";
	try {
		const cmd = "curl -sI --connect-timeout 2 --max-time 3 https://openrouter.ai 2>/dev/null | head -1";
		const result = execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim();
		if (result.includes("200") || result.includes("301") || result.includes("302")) {
			status = "online";
		} else if (result.includes("5")) {
			status = "offline";
		}
	} catch (e) {
	}

	const providerStatus: ProviderStatus = { status, timestamp: now };

	try {
		const cache: StatusCache = { openrouter: providerStatus };
		writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
	} catch (e) {
	}

	return providerStatus;
}

function getGitStatus(): { branch: string; status: string } {
	const result = { branch: "no-git", status: "" };

	try {
		result.branch = execSync("git branch --show-current 2>/dev/null || echo 'no-git'", {
			encoding: "utf8"
		}).trim();

		if (result.branch === "no-git") {
			return result;
		}

		const hasChanges = execSync("git status --porcelain 2>/dev/null || true", {
			encoding: "utf8"
		}).trim();

		const hasUnpushed = execSync("git log @{u}..HEAD --oneline 2>/dev/null || true", {
			encoding: "utf8"
		}).trim();

		if (hasChanges) {
			result.status += "*";
		}
		if (hasUnpushed) {
			result.status += "↑";
		}
		if (!hasChanges && !hasUnpushed) {
			result.status = "✓";
		}
	} catch (e) {
		result.branch = "no-git";
		result.status = "";
	}

	return result;
}

export default function (pi: ExtensionAPI) {
	const install = (ctx: any) => {
		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
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

					const git = getGitStatus();
					const branch = footerData.getGitBranch() || git.branch;

					const provider = getCachedProviderStatus();

					const statusColor = provider.status === "online" ? "success" :
										provider.status === "offline" ? "error" : "text";
					const sicon = theme.fg(statusColor, "●");

					let branchDisplay = branch;
					if (branch !== "no-git" && git.status) {
						const gitStatusColor = git.status === "✓" ? "success" :
											git.status.includes("*") ? "warning" : "accent";
						branchDisplay = `${branch} (${theme.fg(gitStatusColor, git.status)})`;
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

					return [
						truncateToWidth(line1, width),
						truncateToWidth(line2, width),
					];
				},
			};
		});
	};

	pi.on("session_start", async (_event, ctx) => install(ctx));
}
