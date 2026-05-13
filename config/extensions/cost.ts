/**
 * /cost — show token usage and spend for the current session.
 *
 * Walks ctx.sessionManager.getBranch() and sums per-message Usage from each
 * AssistantMessage. Breaks down by model so mid-session /model switches are
 * visible.
 */

import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const fmtTok = (n: number) =>
	n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(2)}M`;

const fmtCost = (n: number) => `$${n.toFixed(4)}`;

interface Bucket {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

const emptyBucket = (): Bucket => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	turns: 0,
});

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cost", {
		description: "Show token usage and spend for this session",
		handler: async (_args, ctx) => {
			const totals = emptyBucket();
			const byModel = new Map<string, Bucket>();

			// Recompute cost from the live registry so historical sessions
			// (created before models.json fixes) reflect current prices.
			// Fall back to persisted usage.cost.total when the model isn't
			// in the registry (e.g. dated variants like
			// `kimi-k2-thinking-20251106` returned via OpenRouter's
			// responseModel field).
			const priceFor = (m: AssistantMessage): Model<any> | undefined =>
				ctx.modelRegistry.find(m.provider, m.responseModel ?? m.model) ??
				ctx.modelRegistry.find(m.provider, m.model);

			const computeCost = (m: AssistantMessage): number => {
				const model = priceFor(m);
				if (!model) return m.usage.cost.total;
				const c = model.cost;
				return (
					(c.input * m.usage.input +
						c.output * m.usage.output +
						c.cacheRead * m.usage.cacheRead +
						c.cacheWrite * m.usage.cacheWrite) /
					1_000_000
				);
			};

			for (const e of ctx.sessionManager.getBranch()) {
				if (e.type !== "message" || e.message.role !== "assistant") continue;
				const m = e.message as AssistantMessage;
				const u = m.usage;
				const cost = computeCost(m);
				const modelKey = `${m.provider}/${m.responseModel ?? m.model}`;
				const b = byModel.get(modelKey) ?? emptyBucket();
				b.input += u.input;
				b.output += u.output;
				b.cacheRead += u.cacheRead;
				b.cacheWrite += u.cacheWrite;
				b.cost += cost;
				b.turns += 1;
				byModel.set(modelKey, b);

				totals.input += u.input;
				totals.output += u.output;
				totals.cacheRead += u.cacheRead;
				totals.cacheWrite += u.cacheWrite;
				totals.cost += cost;
				totals.turns += 1;
			}

			const ctxUsage = ctx.getContextUsage();
			const lines: string[] = [];
			lines.push(`Session totals (${totals.turns} assistant turns):`);
			lines.push(`  ↑ input:    ${fmtTok(totals.input)} tokens`);
			lines.push(`  ↓ output:   ${fmtTok(totals.output)} tokens`);
			if (totals.cacheRead || totals.cacheWrite) {
				lines.push(`  ⌘ cache:    r=${fmtTok(totals.cacheRead)} w=${fmtTok(totals.cacheWrite)}`);
			}
			lines.push(`  $ cost:     ${fmtCost(totals.cost)}`);
			if (ctxUsage) {
				const max = (ctxUsage as any).max ?? (ctxUsage as any).contextWindow ?? 0;
				const tokens = (ctxUsage as any).tokens ?? 0;
				const pct = max > 0 ? ((tokens / max) * 100).toFixed(0) : "?";
				lines.push(`  ctx now:    ${fmtTok(tokens)} / ${fmtTok(max)} (${pct}%)`);
			}

			if (byModel.size > 1) {
				lines.push("");
				lines.push("By model:");
				for (const [model, b] of byModel) {
					lines.push(`  ${model}: ↑${fmtTok(b.input)} ↓${fmtTok(b.output)} ${fmtCost(b.cost)} (${b.turns})`);
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
