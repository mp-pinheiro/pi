/**
 * /clear — alias for /new. Starts a fresh session, same as the built-in /new.
 *
 * Muscle memory from claude-code and shells: typing /clear should wipe the
 * conversation, not error out as an unknown command.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("clear", {
		description: "Start a new session (alias for /new)",
		handler: async (_args, ctx) => {
			await ctx.newSession();
		},
	});
}
