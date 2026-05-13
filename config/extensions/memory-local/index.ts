/**
 * memory-local — vendored + patched long-term memory extension.
 *
 * Based on @samfp/pi-memory with dotfiles-specific changes:
 * - Faster consolidation defaults
 * - Optional consolidate-on-switch (default off)
 * - Stronger status lifecycle (always cleared)
 * - Configurable model/timeout/thinking for consolidation
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { MemoryStore } from "./store.js";
import { buildContextBlock, type InjectorConfig } from "./injector.js";
import {
	buildConsolidationPrompt,
	parseConsolidationResponse,
	applyExtracted,
	type ConsolidationInput,
} from "./consolidator.js";

const DEFAULT_MEMORY_DIR = join(homedir(), ".pi", "memory");
const DEFAULT_DB_PATH = join(DEFAULT_MEMORY_DIR, "memory.db");
const GLOBAL_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface MemoryRuntimeConfig extends InjectorConfig {
	consolidateOnSwitch: boolean;
	consolidateOnShutdown: boolean;
	consolidationModel: string;
	consolidationThinking: ThinkingLevel;
	consolidationTimeoutMs: number;
	consolidationMinUserMessages: number;
	statusClearMs: number;
}

const DEFAULTS: MemoryRuntimeConfig = {
	lessonInjection: "selective",
	consolidateOnSwitch: false,
	consolidateOnShutdown: true,
	consolidationModel: "zai/glm-5-turbo",
	consolidationThinking: "off",
	consolidationTimeoutMs: 15_000,
	consolidationMinUserMessages: 3,
	statusClearMs: 1_500,
};

function ok(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

function stripQuotes<T>(v: T): T {
	if (typeof v !== "string") return v;
	const s = v.trim();
	if (s.length >= 2) {
		const first = s[0];
		const last = s[s.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			try {
				if (first === '"') return JSON.parse(s) as unknown as T;
			} catch {
				// fall through
			}
			return s.slice(1, -1) as unknown as T;
		}
	}
	return v;
}

function readJson(path: string): any | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return undefined;
	}
}

function normalizeThinking(value: unknown): ThinkingLevel {
	const v = typeof value === "string" ? value.toLowerCase() : "";
	if (v === "off" || v === "minimal" || v === "low" || v === "medium" || v === "high" || v === "xhigh") {
		return v;
	}
	return DEFAULTS.consolidationThinking;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || Number.isNaN(value)) return fallback;
	return Math.max(min, Math.min(max, value));
}

/**
 * Resolve the memory DB path for a given working directory.
 *
 * Priority (highest first):
 * 1. "pi-memory".localPath in {cwd}/.pi/settings.json -> {localPath}/memory.db
 * 2. "pi-total-recall".localPath cascade -> {localPath}/memory/memory.db
 * 3. Global default: ~/.pi/memory/memory.db
 */
function resolveDbPath(cwd: string): string {
	const local = readJson(join(cwd, ".pi", "settings.json"));
	const piMemory = local?.["pi-memory"];
	if (piMemory && typeof piMemory === "object" && typeof piMemory.localPath === "string" && piMemory.localPath) {
		return join(piMemory.localPath, "memory.db");
	}
	const totalRecall = local?.["pi-total-recall"];
	if (totalRecall && typeof totalRecall === "object" && typeof totalRecall.localPath === "string" && totalRecall.localPath) {
		return join(totalRecall.localPath, "memory", "memory.db");
	}
	return DEFAULT_DB_PATH;
}

function readRuntimeConfig(cwd?: string): MemoryRuntimeConfig {
	const out: MemoryRuntimeConfig = { ...DEFAULTS };

	const globalSettings = readJson(GLOBAL_SETTINGS_PATH);
	const globalMemory = globalSettings?.memory;
	if (globalMemory && typeof globalMemory === "object") {
		if (globalMemory.lessonInjection === "all" || globalMemory.lessonInjection === "selective") {
			out.lessonInjection = globalMemory.lessonInjection;
		}
		if (typeof globalMemory.consolidateOnSwitch === "boolean") out.consolidateOnSwitch = globalMemory.consolidateOnSwitch;
		if (typeof globalMemory.consolidateOnShutdown === "boolean") out.consolidateOnShutdown = globalMemory.consolidateOnShutdown;
		if (typeof globalMemory.consolidationModel === "string" && globalMemory.consolidationModel.trim()) {
			out.consolidationModel = globalMemory.consolidationModel.trim();
		}
		out.consolidationThinking = normalizeThinking(globalMemory.consolidationThinking);
		out.consolidationTimeoutMs = normalizeNumber(globalMemory.consolidationTimeoutMs, out.consolidationTimeoutMs, 3_000, 120_000);
		out.consolidationMinUserMessages = normalizeNumber(globalMemory.consolidationMinUserMessages, out.consolidationMinUserMessages, 1, 50);
		out.statusClearMs = normalizeNumber(globalMemory.statusClearMs, out.statusClearMs, 250, 15_000);
	}

	if (!cwd) return out;

	const localSettings = readJson(join(cwd, ".pi", "settings.json"));
	const localMemory = localSettings?.memory ?? localSettings?.["pi-memory"];
	if (localMemory && typeof localMemory === "object") {
		if (localMemory.lessonInjection === "all" || localMemory.lessonInjection === "selective") {
			out.lessonInjection = localMemory.lessonInjection;
		}
		if (typeof localMemory.consolidateOnSwitch === "boolean") out.consolidateOnSwitch = localMemory.consolidateOnSwitch;
		if (typeof localMemory.consolidateOnShutdown === "boolean") out.consolidateOnShutdown = localMemory.consolidateOnShutdown;
		if (typeof localMemory.consolidationModel === "string" && localMemory.consolidationModel.trim()) {
			out.consolidationModel = localMemory.consolidationModel.trim();
		}
		out.consolidationThinking = normalizeThinking(localMemory.consolidationThinking ?? out.consolidationThinking);
		out.consolidationTimeoutMs = normalizeNumber(localMemory.consolidationTimeoutMs, out.consolidationTimeoutMs, 3_000, 120_000);
		out.consolidationMinUserMessages = normalizeNumber(localMemory.consolidationMinUserMessages, out.consolidationMinUserMessages, 1, 50);
		out.statusClearMs = normalizeNumber(localMemory.statusClearMs, out.statusClearMs, 250, 15_000);
	}

	return out;
}

export default function memoryLocal(pi: ExtensionAPI) {
	let store: MemoryStore | null = null;
	let pendingUserMessages: string[] = [];
	let pendingAssistantMessages: string[] = [];
	let sessionCwd = "";
	let sessionId: string | undefined;
	let dbPath = DEFAULT_DB_PATH;
	let cfg: MemoryRuntimeConfig = { ...DEFAULTS };
	let statusTimer: ReturnType<typeof setTimeout> | null = null;

	function setStatus(ctx: any, text: string, clearAfterMs?: number) {
		try {
			ctx.ui.setStatus("pi-memory", text);
		} catch {
			return;
		}
		if (statusTimer) {
			clearTimeout(statusTimer);
			statusTimer = null;
		}
		if (clearAfterMs && clearAfterMs > 0) {
			statusTimer = setTimeout(() => {
				try {
					ctx.ui.setStatus("pi-memory", "");
				} catch {
					// stale ctx
				}
				statusTimer = null;
			}, clearAfterMs);
		}
	}

	function clearStatus(ctx: any) {
		if (statusTimer) {
			clearTimeout(statusTimer);
			statusTimer = null;
		}
		try {
			ctx.ui.setStatus("pi-memory", "");
		} catch {
			// stale ctx
		}
	}

	function resetPending() {
		pendingUserMessages = [];
		pendingAssistantMessages = [];
	}

	function seedFromBranch(ctx: any) {
		resetPending();
		try {
			const branch = ctx.sessionManager.getBranch();
			for (const entry of branch) {
				if (entry.type !== "message") continue;
				const msg = (entry as any).message;
				if (!msg) continue;
				if (msg.role === "user") {
					const text = extractText(msg.content);
					if (text) pendingUserMessages.push(text);
				} else if (msg.role === "assistant") {
					const text = extractText(msg.content);
					if (text) pendingAssistantMessages.push(text);
				}
			}
		} catch {
			// empty/new session
		}
	}

	function enoughToConsolidate() {
		return pendingUserMessages.length >= cfg.consolidationMinUserMessages;
	}

	async function consolidateSession(ctx: any, reason: "switch" | "shutdown" | "manual") {
		if (!store) return { semantic: 0, lessons: 0, skipped: "store" as const };
		if (!enoughToConsolidate()) {
			return { semantic: 0, lessons: 0, skipped: "min_messages" as const };
		}

		setStatus(ctx, `🧠 Consolidating memory (${reason}: prepare)…`);
		const input: ConsolidationInput = {
			userMessages: pendingUserMessages,
			assistantMessages: pendingAssistantMessages,
			cwd: sessionCwd,
			sessionId,
		};
		const currentFacts = store.listSemantic(undefined, 200).map((f) => ({ key: f.key, value: f.value }));
		const currentLessons = store.listLessons(undefined, 100).map((l) => ({ rule: l.rule, category: l.category }));
		const prompt = buildConsolidationPrompt(input, currentFacts, currentLessons);

		setStatus(ctx, `🧠 Consolidating memory (${reason}: LLM)…`);
		const args = [
			"-p",
			prompt,
			"--print",
			"--no-session",
			"--no-extensions",
			"--model",
			cfg.consolidationModel,
			"--thinking",
			cfg.consolidationThinking,
		];

		const result = await pi.exec("pi", args, {
			timeout: cfg.consolidationTimeoutMs,
			cwd: sessionCwd,
		});

		if (result.code !== 0 || !result.stdout?.trim()) {
			const reasonText = result.stderr?.trim() ? `: ${result.stderr.trim().slice(0, 120)}` : "";
			throw new Error(`consolidation subprocess failed (code ${result.code})${reasonText}`);
		}

		setStatus(ctx, `🧠 Consolidating memory (${reason}: apply)…`);
		const extracted = parseConsolidationResponse(result.stdout);
		const applied = applyExtracted(store, extracted, `session:${sessionId ?? "unknown"}`);
		return { ...applied, skipped: null as const };
	}

	pi.on("session_start", async (_event, ctx) => {
		clearStatus(ctx);
		try {
			sessionCwd = ctx.cwd;
			sessionId = (ctx as any).sessionId ?? (ctx as any).session?.id;
			dbPath = resolveDbPath(sessionCwd);
			cfg = readRuntimeConfig(sessionCwd);
			store = new MemoryStore(dbPath);
			seedFromBranch(ctx);
			const stats = store.stats();
			if (stats.semantic + stats.lessons > 0) {
				setStatus(ctx, `🧠 ${stats.semantic} facts, ${stats.lessons} lessons`, cfg.statusClearMs);
			}
		} catch (err: any) {
			ctx.ui.notify(`memory-local: failed to open store: ${err?.message ?? "unknown error"}`, "warning");
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!store) return;
		const { text } = buildContextBlock(store, ctx.cwd, event.prompt, cfg);
		if (!text) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${text}` };
	});

	pi.on("agent_end", async (event) => {
		for (const msg of event.messages) {
			if (msg.role === "user" && "content" in msg) {
				const text = extractText(msg.content);
				if (text) {
					pendingUserMessages.push(text);
					if (pendingUserMessages.length > 60) pendingUserMessages.shift();
				}
			} else if (msg.role === "assistant" && "content" in msg) {
				const text = extractText(msg.content);
				if (text) {
					pendingAssistantMessages.push(text);
					if (pendingAssistantMessages.length > 60) pendingAssistantMessages.shift();
				}
			}
		}
	});

	pi.on("session_before_switch", async (_event, ctx) => {
		if (!store) return;
		if (!cfg.consolidateOnSwitch) {
			resetPending();
			return;
		}

		try {
			const applied = await consolidateSession(ctx, "switch");
			if (!applied.skipped && applied.semantic + applied.lessons > 0) {
				setStatus(ctx, `🧠 Memory updated (+${applied.semantic} facts, +${applied.lessons} lessons)`, cfg.statusClearMs);
			} else if (!applied.skipped) {
				setStatus(ctx, "🧠 Memory checked (no new durable items)", cfg.statusClearMs);
			}
		} catch (err: any) {
			ctx.ui.notify(`memory-local: consolidation failed on switch: ${err?.message ?? "unknown error"}`, "warning");
		} finally {
			clearStatus(ctx);
			resetPending();
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!store) return;
		try {
			if (cfg.consolidateOnShutdown) {
				await consolidateSession(ctx, "shutdown");
			}
		} catch {
			// best-effort during shutdown
		} finally {
			clearStatus(ctx);
			store.close();
			store = null;
			resetPending();
		}
	});

	pi.registerTool({
		name: "memory_search",
		label: "Memory Search",
		description: "Search persistent memory for facts, preferences, and project patterns the user has established across sessions.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
		}),
		async execute(_id, params) {
			if (!store) return ok("Memory store not initialized");
			const results = store.searchSemantic(params.query, params.limit ?? 10);
			if (results.length === 0) return ok("No matching memories found.");
			const text = results
				.map((r) => `${r.key}: ${r.value} (confidence: ${r.confidence}, source: ${r.source})`)
				.join("\n");
			return ok(text);
		},
	});

	pi.registerTool({
		name: "memory_remember",
		label: "Memory Remember",
		description:
			"Store a fact, preference, or lesson in persistent memory. Use dotted keys like pref.editor, project.rosie.lang, tool.sed.usage. For corrections, use type='lesson'.",
		parameters: Type.Object({
			type: Type.String({ description: "'fact' for key-value, 'lesson' for a correction" }),
			key: Type.Optional(Type.String({ description: "Dotted key for facts (e.g. pref.commit_style)" })),
			value: Type.Optional(Type.String({ description: "Value for facts" })),
			rule: Type.Optional(Type.String({ description: "Rule text for lessons" })),
			category: Type.Optional(Type.String({ description: "Category for lessons (default: general)" })),
			negative: Type.Optional(Type.Boolean({ description: "True if this is something to AVOID" })),
		}),
		async execute(_id, params) {
			if (!store) return ok("Memory store not initialized");
			params = {
				...params,
				type: stripQuotes(params.type),
				key: stripQuotes(params.key),
				value: stripQuotes(params.value),
				rule: stripQuotes(params.rule),
				category: stripQuotes(params.category),
			};

			if (params.type !== "fact" && params.type !== "lesson") {
				return ok(`Invalid type: ${params.type}. Must be 'fact' or 'lesson'.`);
			}
			if (params.type === "fact") {
				if (!params.key || !params.value) return ok("Both key and value required for facts");
				store.setSemantic(params.key, params.value, 0.95, "user");
				return ok(`Remembered: ${params.key} = ${params.value}`);
			}
			if (!params.rule) return ok("Rule text required for lessons");
			const result = store.addLesson(params.rule, params.category ?? "general", "user", params.negative ?? false);
			if (result.success) return ok(`Lesson learned: ${params.rule}`);
			return ok(`Already known (${result.reason}): ${params.rule}`);
		},
	});

	pi.registerTool({
		name: "memory_forget",
		label: "Memory Forget",
		description: "Remove a fact or lesson from persistent memory.",
		parameters: Type.Object({
			type: Type.String(),
			key: Type.Optional(Type.String({ description: "Key for facts" })),
			id: Type.Optional(Type.String({ description: "ID for lessons" })),
		}),
		async execute(_id, params) {
			if (!store) return ok("Memory store not initialized");
			params = {
				...params,
				type: stripQuotes(params.type),
				key: stripQuotes(params.key),
				id: stripQuotes(params.id),
			};
			if (params.type !== "fact" && params.type !== "lesson") {
				return ok(`Invalid type: ${params.type}. Must be 'fact' or 'lesson'.`);
			}
			if (params.type === "fact" && params.key) {
				const deleted = store.deleteSemantic(params.key);
				return ok(deleted ? `Forgot: ${params.key}` : `Not found: ${params.key}`);
			}
			if (params.type === "lesson" && params.id) {
				const deleted = store.deleteLesson(params.id);
				return ok(deleted ? `Forgot lesson ${params.id}` : `Not found: ${params.id}`);
			}
			return ok("Provide key (for facts) or id (for lessons)");
		},
	});

	pi.registerTool({
		name: "memory_lessons",
		label: "Memory Lessons",
		description: "List learned corrections and lessons from past sessions.",
		parameters: Type.Object({
			category: Type.Optional(Type.String({ description: "Filter by category" })),
			limit: Type.Optional(Type.Number({ description: "Max results (default 50)" })),
		}),
		async execute(_id, params) {
			if (!store) return ok("Memory store not initialized");
			const lessons = store.listLessons(params.category, params.limit ?? 50);
			if (lessons.length === 0) return ok("No lessons learned yet.");
			const text = lessons
				.map((l) => `${l.negative ? "❌" : "✅"} [${l.category}] ${l.rule} (id: ${l.id.slice(0, 8)})`)
				.join("\n");
			return ok(text);
		},
	});

	pi.registerTool({
		name: "memory_stats",
		label: "Memory Stats",
		description: "Show memory statistics — how many facts, lessons, and events are stored.",
		parameters: Type.Object({}),
		async execute() {
			if (!store) return ok("Memory store not initialized");
			const stats = store.stats();
			return ok(`Memory: ${stats.semantic} semantic facts, ${stats.lessons} active lessons, ${stats.events} events logged\nDB: ${dbPath}`);
		},
	});

	pi.registerCommand("memory-consolidate", {
		description: "Manually trigger memory consolidation for the current session",
		async handler(_args, ctx) {
			if (!store) {
				ctx.ui.notify("Memory store not initialized", "warning");
				return;
			}
			if (pendingUserMessages.length < 2) {
				ctx.ui.notify("Not enough conversation to consolidate (need at least 2 user messages)", "warning");
				return;
			}
			try {
				const applied = await consolidateSession(ctx, "manual");
				if (applied.skipped) {
					ctx.ui.notify("Consolidation skipped: not enough qualifying messages", "warning");
					return;
				}
				ctx.ui.notify(`Memory updated: +${applied.semantic} facts, +${applied.lessons} lessons`, "info");
			} catch (err: any) {
				ctx.ui.notify(`Consolidation failed: ${err?.message ?? "unknown error"}`, "error");
			} finally {
				clearStatus(ctx);
			}
		},
	});
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c: any) => c.type === "text" && typeof c.text === "string")
			.map((c: any) => c.text)
			.join("\n");
	}
	return "";
}
