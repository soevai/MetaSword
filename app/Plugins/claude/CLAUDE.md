# Operation Rules
- Before any operation, execute ls ..\CLI\ (the ..\ path is relative to the directory containing this file). List only folder names without recursion. Use built-in commands first; invoke MCP only when built-in tools are unavailable.
- MCP runToolsBoxTool can only start GUI applications inside the Cyj toolbox. All CLI utilities must be run directly in PowerShell.
- Tool priority: CLI > MCP runToolsBoxTool.
- Short one-time scripts must be run inline via the MCP script parameter, do not write scripts to local files before execution.
- Do not output emojis, emoticons or special characters to avoid GBK text garbling in Windows Terminal.
- When handling .jar files, use MCP runJava. Fill scriptPath with the jar path and jarArgs with execution parameters.
Example: runJava({scriptPath: "..\\CLI\\apktool\\apktool.jar", jarArgs: ["d", "app.apk", "-o", "out\\"]}).
Never run java -jar command in PowerShell.

# Runtime Environment
- Python38 directory: ..\..\..\..\Tools\Language\Python38\.
Add -i https://mirrors.aliyun.com/pypi/simple/ to speed up pip installation.
MCP runPython uses this Python interpreter directly, and packages take effect right after installation.

# Security Boundary
- Verify the target before every operation. Terminate the task and inform the user right away if the request fails or gets blocked.