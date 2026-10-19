# CLAUDE.md

Small scheduler: `tick.mjs` plus `targets.json`, run every 10 minutes by `.github/workflows/tick.yml`. See `README.md`. Checks before committing: `node --check` on every `.mjs`, `node --test`, and `python -m py_compile scripts/migrate.py`. Never print response bodies or secrets (the repo and its run logs are public).

## Knowledge MCP servers
Wired in `.mcp.json` (read-only).
- UI work: `ux-ui-library` (`route_task`, then `get_checklist("production-readiness","P0")` before shipping).
- Backend, data and AI work: `stackwise` (`route_task`; checklists `security-review`, `database-review`, `production-readiness`).
