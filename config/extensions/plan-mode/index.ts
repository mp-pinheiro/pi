import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
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
	executionStarted: boolean;
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let state: PlanState = "normal";
	let planFile: string | null = null;
	let executionStarted = false;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function persistState(): void {
		pi.appendEntry("plan-mode", { state, planFile, executionStarted } satisfies PersistedPlanState);
	}

	function restoreAllTools(): void {
		pi.setActiveTools(pi.getAllTools().map((t) => t.name));
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
	}

	function enterPlanMode(ctx: ExtensionContext): void {
		try {
			const dir = ensurePlanDir(ctx.cwd);
			const slug = generatePlanSlug();
			planFile = join(dir, `${slug}.md`);
		} catch (err) {
			ctx.ui.notify(`Failed to create plan directory: ${err instanceof Error ? err.message : err}`);
			return;
		}
		state = "planning";
		executionStarted = false;
		pi.setActiveTools(PLAN_MODE_TOOLS);
		persistState();
		updateStatus(ctx);
		ctx.ui.notify(`Plan mode enabled. Plan file: ${planFile}`);
	}

	function exitToNormal(ctx: ExtensionContext, message: string): void {
		state = "normal";
		planFile = null;
		executionStarted = false;
		restoreAllTools();
		persistState();
		updateStatus(ctx);
		ctx.ui.notify(message);
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		if (state === "normal") {
			enterPlanMode(ctx);
		} else {
			exitToNormal(ctx, state === "executing"
				? "Execution aborted. Full access restored."
				: "Plan mode disabled. Full access restored.");
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
			const input = event.input as Record<string, unknown>;
			const filePath = String(input.file_path ?? input.filePath ?? input.path ?? "");
			if (planFile && filePath === planFile) return;
			return {
				block: true,
				reason: `Plan mode: file writes blocked. Only the plan file is writable: ${planFile ?? "(none)"}`,
			};
		}
	});

	const STALE_PLAN_CUSTOM_TYPES = new Set([
		"plan-mode-context",
		"plan-execution-context",
		"plan-mode-execute",
		"plan-complete",
		"plan-review",
		"plan-refinement",
	]);
	const STALE_PLAN_MARKERS = ["[PLAN MODE ACTIVE]", "[EXECUTING PLAN]"];

	const DEDUP_TYPES = new Set(["plan-mode-context", "plan-review", "plan-refinement"]);

	pi.on("context", async (event) => {
		if (state === "normal") {
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
		}

		if (state === "planning" || state === "reviewing") {
			const messages = event.messages as (AgentMessage & { customType?: string })[];
			const lastIndexOf = new Map<string, number>();
			for (let i = 0; i < messages.length; i++) {
				const ct = messages[i].customType ?? "";
				if (DEDUP_TYPES.has(ct)) lastIndexOf.set(ct, i);
			}
			if (lastIndexOf.size === 0) return;
			return {
				messages: messages.filter((m, i) => {
					const ct = m.customType ?? "";
					if (!DEDUP_TYPES.has(ct)) return true;
					return lastIndexOf.get(ct) === i;
				}),
			};
		}
	});

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
			if (!executionStarted) {
				executionStarted = true;
				persistState();
				const prompt = loadPrompt("plan-mode-execute").replace(/\{planFilePath\}/g, planFile);
				return {
					message: {
						customType: "plan-execution-context",
						content: `[EXECUTING PLAN]\n\n${prompt}`,
						display: false,
					},
				};
			}
			// Subsequent turns: short reminder only — model already has the plan context
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN]\n\nContinue executing the plan at \`${planFile}\`. Pick up where you left off. Full tool access is available.`,
					display: false,
				},
			};
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		// During execution: stay in executing state. The user exits via /plan
		// when satisfied, or sends another message to continue if the model
		// stopped early (token limit, clarifying question, etc).
		if (state === "executing") return;

		if (state !== "planning" || !planFile || !ctx.hasUI) return;
		if (!existsSync(planFile)) return;

		state = "reviewing";
		persistState();

		let planContent = "";
		try {
			planContent = readFileSync(planFile, "utf-8");
		} catch { /* file disappeared between existsSync and read */ }

		if (planContent.trim()) {
			pi.sendMessage({
				customType: "plan-review",
				content: planContent,
				display: true,
			});
		}

		const choices = [
			"Execute the plan",
			"Refine the plan",
			"Stay in plan mode",
		] as const;

		const choice = await ctx.ui.select("Plan ready — what next?", [...choices]);

		if (choice === choices[0]) {
			state = "executing";
			executionStarted = false;
			restoreAllTools();
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
			let currentContent = "";
			try {
				currentContent = readFileSync(planFile, "utf-8");
			} catch { /* file may have been deleted between check and read */ }
			const refinement = await ctx.ui.editor("Refine the plan:", currentContent);
			if (refinement?.trim()) {
				pi.sendMessage(
					{
						customType: "plan-refinement",
						content: `Revise the plan based on this feedback. Update the plan file at \`${planFile}\`.\n\nFeedback:\n${refinement.trim()}`,
						display: true,
					},
					{ triggerTurn: true },
				);
			} else {
				ctx.ui.notify("No refinement provided. Still in plan mode.");
			}
			updateStatus(ctx);
		} else {
			state = "planning";
			persistState();
			updateStatus(ctx);
			ctx.ui.notify("Staying in plan mode. Continue investigating or refine your request.");
		}
	});

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
			executionStarted = planModeEntry.data.executionStarted ?? false;

			if (planFile && !existsSync(planFile)) {
				state = "normal";
				planFile = null;
				executionStarted = false;
			}
		}

		if (state === "planning" || state === "reviewing") {
			pi.setActiveTools(PLAN_MODE_TOOLS);
		}
		updateStatus(ctx);
	});
}
