# TODO: MCP Extension Install Methods Need Iteration

**Date:** 2026-03-26
**Status:** Parked — manual config works, extension methods need revisiting

## What works now

- **Claude Desktop manual config** (`claude_desktop_config.json`) — working. Requires absolute paths because Claude Desktop runs commands from `C:\Windows\System32`.
- **Claude Code `.mcp.json`** — working. Relative paths OK since Claude Code runs from the project directory.

## What doesn't work yet

### Desktop extension (.mcpb) install UX

We built a `.mcpb` bundle (manifest.json + bundled server/index.js) that Docker builds into `/soupnet.mcpb`. The bundle itself is valid, but the install experience has friction:

- **Double-click**: Windows doesn't associate `.mcpb` files with Claude Desktop. Nothing happens.
- **Drag-and-drop**: Dragging onto Claude Desktop just adds it as a chat attachment. No install trigger.
- **Settings > Extensions > Advanced > Install Extension...**: This is the documented path per [Anthropic's guide](https://support.claude.com/en/articles/12922929-building-desktop-extensions-with-mcpb), but hasn't been tested successfully yet.

### Possible next steps

1. Test the Settings > Extensions > Advanced install path explicitly
2. Check if Claude Desktop registers a file handler on macOS (may work there but not Windows)
3. Consider a `claude://` URL scheme if one exists for triggering installs
4. Watch for Anthropic updates to the extension install UX — this is likely to improve

### Absolute path requirement

Claude Desktop launches MCP server processes from `C:\Windows\System32` (Windows). Relative paths like `apps/mcp-server/src/index.ts` resolve to `C:\Windows\System32\apps\mcp-server\...` which doesn't exist. All paths in `claude_desktop_config.json` must be absolute. This is documented in `/docs/mcp-setup` but easy to miss.

### APPDATA env var

On some Windows setups, `npx` fails because `%APPDATA%` isn't expanded in the env. The workaround is adding `"APPDATA": "C:\\Users\\USERNAME\\AppData\\Roaming"` to the config's env block. Documented in the setup page.
