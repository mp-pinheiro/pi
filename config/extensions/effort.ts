/**
 * /effort — get or set the thinking-effort level.
 *
 * Wraps pi.setThinkingLevel / pi.getThinkingLevel so the user doesn't have
 * to remember the --thinking CLI flag or the model `:thinking` suffix.
 *
 * Usage:
 *   /effort               -> interactive picker (UI) or print current level (no-UI)
 *   /effort high          -> sets to high
 *   /effort off|minimal|low|medium|high|xhigh
 *
 * Pi clamps the level to model capabilities (per docs: non-reasoning models
 * always use "off"), so setting xhigh on a model that doesn't support it
 * degrades gracefully.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_FG: Record<Level, "thinkingOff" | "thinkingMinimal" | "thinkingLow" | "thinkingMedium" | "thinkingHigh" | "thinkingXhigh"> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
};

const isLevel = (s: string): s is Level => (LEVELS as readonly string[]).includes(s);

function applyAndNotify(target: Level, pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	pi.setThinkingLevel(target);
	const actual = pi.getThinkingLevel();
	if (actual !== target) {
		ctx.ui.notify(`Effort set to ${target}; clamped to ${actual} for current model.`, "warning");
	} else {
		ctx.ui.notify(`Effort: ${actual}`, "info");
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("effort", {
		description: "Get or set thinking effort (off|minimal|low|medium|high|xhigh)",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim().toLowerCase();

			// Direct level argument
			if (arg) {
				if (!isLevel(arg)) {
					ctx.ui.notify(`Unknown level "${arg}". Valid: ${LEVELS.join(", ")}`, "error");
					return;
				}
				applyAndNotify(arg, pi, ctx);
				return;
			}

			// No argument, no UI — text fallback
			if (!ctx.hasUI) {
				const current = pi.getThinkingLevel();
				ctx.ui.notify(`Current effort: ${current}\nLevels: ${LEVELS.join(", ")}`, "info");
				return;
			}

			// No argument, with UI — inline slider picker
			const currentLevel = pi.getThinkingLevel();
			const initialIndex = Math.max(0, LEVELS.indexOf(currentLevel as Level));

			const result = await ctx.ui.custom<Level | null>((tui, theme, _kb, done) => {
				let selected = initialIndex;
				let cachedWidth: number | undefined;
				let cachedLines: string[] | undefined;

				const count = LEVELS.length;

				return {
					render(width: number): string[] {
						if (cachedLines && cachedWidth === width) return cachedLines;

						const contentWidth = Math.min(width - 2, 56);
						const pad = Math.max(0, Math.floor((width - contentWidth) / 2));
						const padStr = " ".repeat(pad);
						const step = count > 1 ? (contentWidth - 1) / (count - 1) : 0;
						const col = (i: number) => Math.round(i * step);

						const lines: string[] = [];

						// Axis labels
						const speedW = 5;
						const intelW = 12;
						const axisGap = Math.max(1, contentWidth - speedW - intelW);
						lines.push(
							truncateToWidth(
								padStr +
									theme.fg("dim", "Speed") +
									" ".repeat(axisGap) +
									theme.fg("dim", "Intelligence"),
								width,
							),
						);

						// Slider line with ▲ marker
						const mx = col(selected);
						const before = "─".repeat(mx);
						const after = "─".repeat(Math.max(0, contentWidth - mx - 1));
						lines.push(
							truncateToWidth(
								padStr +
									theme.fg("borderMuted", before) +
									theme.fg("accent", "▲") +
									theme.fg("borderMuted", after),
								width,
							),
						);

						// Level labels
						let labelRow = padStr;
						let cursor = 0;
						for (let i = 0; i < count; i++) {
							const label = LEVELS[i];
							const center = col(i);
							const start = center - Math.floor(label.length / 2);
							if (start > cursor) labelRow += " ".repeat(start - cursor);
							labelRow +=
								i === selected
									? theme.fg(LEVEL_FG[label], label)
									: theme.fg("dim", label);
							cursor = start + label.length;
						}
						lines.push(truncateToWidth(labelRow, width));

						// Help text
						lines.push(
							truncateToWidth(
								padStr +
									theme.fg("dim", "←/→ change effort · Enter confirm · Esc cancel"),
								width,
							),
						);

						cachedWidth = width;
						cachedLines = lines;
						return lines;
					},
					invalidate() {
						cachedWidth = undefined;
						cachedLines = undefined;
					},
					handleInput(data: string) {
						if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) {
							selected = Math.max(0, selected - 1);
						} else if (matchesKey(data, Key.right) || matchesKey(data, Key.down)) {
							selected = Math.min(count - 1, selected + 1);
						} else if (matchesKey(data, Key.enter)) {
							done(LEVELS[selected]);
							return;
						} else if (matchesKey(data, Key.escape)) {
							done(null);
							return;
						} else {
							return;
						}
						cachedWidth = undefined;
						cachedLines = undefined;
						tui.requestRender();
					},
				};
			});

			if (result) {
				applyAndNotify(result, pi, ctx);
			}
		},
	});
}
