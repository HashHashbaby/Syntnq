# SYNESTHESIA developer commands. Keep in sync with the "Commands" list in CLAUDE.md.
# Requires uv (https://docs.astral.sh/uv/). Targets for later milestones fail with a clear message.

.PHONY: setup lint test test-determinism analyze render preview sync-check blind-test blind-test-analyze calibrate fetch-corpus corpus-report compare-sizes api-dev web-dev web-test

setup:
	uv sync
	uv run pre-commit install

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
	@echo "make api-dev arrives in M6 (FastAPI service)" && exit 1

web-dev:
	@echo "make web-dev arrives in M7 (web app)" && exit 1

web-test:
	@echo "make web-test arrives in M7 (web app)" && exit 1
