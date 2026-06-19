import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Freeze the "Working..." spinner to a static, non-animated indicator.
//
// pi-tui renders inline (no alt-screen) and animates the working spinner every
// 80ms. Each tick re-renders; once pi's output is taller than the tmux pane the
// terminal has scrolled, so the differential renderer can't reach the old
// spinner line with relative cursor moves and falls back to a full-screen
// redraw (\x1b[2J\x1b[H\x1b[3J). On tmux < 3.7 that repaints the whole window,
// stranding stale spinner frames in scrollback and corrupting other panes that
// share the window.
//
// A single-frame indicator makes Loader skip its interval timer
// (restartAnimation() bails when frames.length <= 1), removing the 80ms redraw
// storm. ctx.ui.setWorkingIndicator is available since pi 0.75.x.
export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx: any) => {
		ctx.ui?.setWorkingIndicator?.({ frames: ["•"] });
	});
}
