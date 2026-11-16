@echo off
set "PI_CODING_AGENT_DIR=%~dp0agent"
node "%~dp0node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" %*
