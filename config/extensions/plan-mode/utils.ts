import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish|init)/i,
	/\byarn\s+(add|remove|install|publish|init)/i,
	/\bpnpm\s+(add|remove|install|publish|init)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade|tap|untap)/i,
	/\bnix-env\s+-i/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone|clean)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\s/i,
	/\bdocker\s+(rm|rmi|stop|kill|prune|system\s+prune)/i,
	/\bkubectl\s+(delete|apply|create|patch|replace|scale)/i,
	/\bcurl\s+.*(-X\s*(POST|PUT|PATCH|DELETE)|--data|--upload|-[dF]\b|--form)/i,
];

const SAFE_NOOP_REDIRECTS = [/2>\s*\/dev\/null/g, />\s*\/dev\/null/g, /2>&1/g];

function stripSafeNoOps(s: string): string {
	let out = s;
	for (const re of SAFE_NOOP_REDIRECTS) out = out.replace(re, "");
	return out;
}

function splitOnLogicalOps(s: string): string[] {
	return s
		.split(/&&|\|\||;/)
		.map((c) => c.trim())
		.filter(Boolean);
}

export function isSafeCommand(command: string): boolean {
	const cleaned = stripSafeNoOps(command);
	const clauses = splitOnLogicalOps(cleaned);
	if (clauses.length === 0) return false;
	for (const clause of clauses) {
		if (DESTRUCTIVE_PATTERNS.some((p) => p.test(clause))) return false;
	}
	return true;
}

export function generatePlanSlug(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `plan-${date}-${time}`;
}

export function getPlanDir(cwd: string): string {
	return join(cwd, ".pi", "plans");
}

export function ensurePlanDir(cwd: string): string {
	const dir = getPlanDir(cwd);
	mkdirSync(dir, { recursive: true });
	return dir;
}
