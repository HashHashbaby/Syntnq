# SYNESTHESIA developer commands. Keep in sync with the "Commands" list in CLAUDE.md.
# Requires uv (https://docs.astral.sh/uv/). Targets for later milestones fail with a clear message.

.PHONY: setup lint test test-determinism analyze render preview calibrate compare-sizes api-dev web-dev web-test

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
	uv run syn preview $(SONG_ID) --seconds $(SECONDS)

calibrate:
	@echo "make calibrate arrives in M2 (scripts/calibrate.py)" && exit 1

compare-sizes:
	@echo "make compare-sizes arrives in M2 (scripts/compare_sizes.py)" && exit 1

api-dev:
	@echo "make api-dev arrives in M6 (FastAPI service)" && exit 1

web-dev:
	@echo "make web-dev arrives in M7 (web app)" && exit 1

web-test:
	@echo "make web-test arrives in M7 (web app)" && exit 1
