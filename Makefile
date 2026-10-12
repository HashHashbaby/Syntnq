# SYNESTHESIA developer commands. Keep in sync with the "Commands" list in CLAUDE.md.
# Requires uv (https://docs.astral.sh/uv/). Targets for later milestones fail with a clear message.

.PHONY: setup lint test test-determinism analyze render preview sync-check blind-test blind-test-analyze calibrate fetch-corpus corpus-report compare-sizes api-dev web-dev web-fixtures web-samples web-fonts web-test

setup:
	uv sync
	uv run pre-commit install
	uv run python scripts/fetch_fonts.py

lint:
	uv run ruff check
	uv run ruff format --check
	uv run mypy

test:
	uv run pytest

test-determinism:
	uv run pytest -m determinism

analyze:
	uv run syn analyze $(SONG)

render:
	uv run syn render $(SONG_ID)

SECONDS ?= 20
preview:
	uv run syn preview $(or $(SONG),$(SONG_ID)) --seconds $(SECONDS) $(if $(AUDIO),--audio $(AUDIO))

sync-check:
	uv run python scripts/sync_check.py

blind-test:
	uv run python scripts/blind_test/build.py

blind-test-analyze:
	uv run python scripts/blind_test/analyze.py $(FOLDER)

calibrate:
	uv run python scripts/calibrate.py

fetch-corpus:
	uv run python scripts/fetch_manifest_tracks.py

corpus-report:
	uv run python scripts/corpus_report.py

compare-sizes:
	uv run python scripts/compare_sizes.py

api-dev:
	uv run uvicorn synesthesia.api.app:create_app --factory --host 127.0.0.1 --port 8000 --reload

web-fixtures:
	uv run python scripts/make_web_fixtures.py

web-samples:
	uv run python scripts/make_web_samples.py

web-fonts:
	uv run python scripts/fetch_fonts.py

web-dev:
	cd web && npm install --no-audit --no-fund && npx vite

web-test: web-fixtures
	cd web && npm install --no-audit --no-fund && npx tsc --noEmit && npx vitest run && npx playwright test
