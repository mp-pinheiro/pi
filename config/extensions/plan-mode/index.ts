import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ensurePlanDir, generatePlanSlug, isSafeCommand } from "./utils.js";

const PROMPTS_DIR = join(homedir(), ".pi", "agent", "prompts");

function loadPrompt(name: string): string {
	try {
		return readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf-8").trim();
	} catch {
		throw new Error(`plan-mode prompt not found: ${name}.md`);
	}
}

const PLAN_MODE_TOOLS = [
	"read", "write", "edit", "bash", "grep", "find", "ls",
	"questionnaire",
	"web_search", "web_contents", "web_answer", "web_research",
];

type PlanState = "normal" | "planning" | "reviewing" | "executing";

interface PersistedPlanState {
	state: PlanState;
	planFile: string | null;
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let state: PlanState = "normal";
	let planFile: string | null = null;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function persistState(): void {
		pi.appendEntry("plan-mode", { state, planFile } satisfies PersistedPlanState);
	}

	function updateStatus(ctx: ExtensionContext): void {
		switch (state) {
			case "planning":
			case "reviewing":
				ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan mode"));
				break;
			case "executing":
				ctx.ui.setStatus(
					"plan-mode",
					ctx.ui.theme.fg("customMessageLabel", "⏩ executing plan") +
						(planFile ? ctx.ui.theme.fg("dim", ` • ${planFile.split("/").pop()}`) : ""),
				);
				break;
			default:
				ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("customMessageLabel", "⏩ normal mode"));
				break;
		}
		ctx.ui.setWidget("plan-todos", undefined);
	}

	function enterPlanMode(ctx: ExtensionContext): void {
		const dir = ensurePlanDir(ctx.cwd);
		const slug = generatePlanSlug();
		planFile = join(dir, `${slug}.md`);
		state = "planning";
		pi.setActiveTools(PLAN_MODE_TOOLS);
		persistState();
		updateStatus(ctx);
		ctx.ui.notify(`Plan mode enabled. Plan file: ${planFile}`);
	}

	function exitToNormal(ctx: ExtensionContext, message: string): void {
		state = "normal";
		planFile = null;
		pi.setActiveTools(pi.getAllTools().map((t) => t.name));
		persistState();
		updateStatus(ctx);
		ctx.ui.notify(message);
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		if (state === "normal") {
			enterPlanMode(ctx);
		} else {
			exitToNormal(ctx, state === "executing" ? "Execution aborted. Full access restored." : "Plan mode disabled. Full access restored.");
		}
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerShortcut("ctrl+\\", {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Tool safety gate during plan mode
	pi.on("tool_call", async (event) => {
		if (state !== "planning" && state !== "reviewing") return;

		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeCommand(command)) {
				return {
					block: true,
					reason: `Plan mode: destructive command blocked. Use /plan to exit plan mode first.\nCommand: ${command}`,
				};
			}
			return;
		}

		if (event.toolName === "write" || event.toolName === "edit") {
			const filePath = (event.input.file_path ?? event.input.filePath ?? "") as string;
			if (planFile && filePath === planFile) return;
			return {
				block: true,
				reason: `Plan mode: file writes blocked. Only the plan file is writable: ${planFile ?? "(none)"}`,
			};
		}
	});

	// Strip stale plan messages from context when in normal mode
	const STALE_PLAN_CUSTOM_TYPES = new Set([
		"plan-mode-context",
		"plan-execution-context",
		"plan-mode-execute",
		"plan-incomplete",
		"plan-complete",
	]);
	const STALE_PLAN_MARKERS = ["[PLAN MODE ACTIVE]", "[EXECUTING PLAN]"];

	pi.on("context", async (event) => {
		if (state !== "normal") return;
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (STALE_PLAN_CUSTOM_TYPES.has(msg.customType ?? "")) return false;
				if (msg.role !== "user") return true;
				const content = msg.content;
				if (typeof content === "string") {
					return !STALE_PLAN_MARKERS.some((marker) => content.includes(marker));
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && STALE_PLAN_MARKERS.some((marker) => (c as TextContent).text?.includes(marker)),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan mode prompt before each agent turn
	pi.on("before_agent_start", async () => {
		if (state === "planning" || state === "reviewing") {
			const prompt = loadPrompt("plan-mode-active").replace(/\{planFilePath\}/g, planFile ?? "<unknown>");
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]\n\n${prompt}`,
					display: false,
				},
			};
		}

		if (state === "executing" && planFile) {
			const prompt = loadPrompt("plan-mode-execute").replace(/\{planFilePath\}/g, planFile);
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN]\n\n${prompt}`,
					display: false,
				},
			};
		}
	});

	// After agent finishes in planning state — check for plan file and prompt user
	pi.on("agent_end", async (_event, ctx) => {
		if (state === "executing") {
			exitToNormal(ctx, "Plan execution complete.");
			pi.sendMessage(
				{ customType: "plan-complete", content: "**Plan execution complete.** Full access restored.", display: true },
				{ triggerTurn: false },
			);
			return;
		}

		if (state !== "planning" || !planFile || !ctx.hasUI) return;
		if (!existsSync(planFile)) return;

		state = "reviewing";
		persistState();

		const choices = [
			"Execute the plan",
			"Refine the plan",
			"Stay in plan mode",
		] as const;

		const choice = await ctx.ui.select("Plan ready — what next?", [...choices]);

		if (choice === choices[0]) {
			state = "executing";
			pi.setActiveTools(pi.getAllTools().map((t) => t.name));
			persistState();
			updateStatus(ctx);
			pi.sendMessage(
				{
					customType: "plan-mode-execute",
					content: `Execute the plan at \`${planFile}\`. Read it and implement all steps now.`,
					display: true,
				},
				{ triggerTurn: true },
			);
		} else if (choice === choices[1]) {
			state = "planning";
			persistState();
			const currentContent = readFileSync(planFile, "utf-8");
			const refinement = await ctx.ui.editor("Refine the plan:", currentContent);
			if (refinement?.trim()) {
				pi.sendUserMessage(`Revise the plan based on this feedback. Update the plan file at \`${planFile}\`.\n\nFeedback:\n${refinement.trim()}`);
			} else {
				ctx.ui.notify("No refinement provided. Still in plan mode.");
			}
			updateStatus(ctx);
		} else {
			// "Stay in plan mode" or dismissed (undefined)
			state = "planning";
			persistState();
			updateStatus(ctx);
			ctx.ui.notify("Staying in plan mode. Continue investigating or refine your request.");
		}
	});

	// Restore state on session resume
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			enterPlanMode(ctx);
			return;
		}

		const entries = ctx.sessionManager.getEntries();
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PersistedPlanState } | undefined;

		if (planModeEntry?.data) {
			state = planModeEntry.data.state ?? "normal";
			planFile = planModeEntry.data.planFile ?? null;

			if (planFile && !existsSync(planFile)) {
				state = "normal";
				planFile = null;
			}
		}

		if (state === "planning" || state === "reviewing") {
			pi.setActiveTools(PLAN_MODE_TOOLS);
		}
		updateStatus(ctx);
	});
}
