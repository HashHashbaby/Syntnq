"""Error codes and user-facing messages (docs/ANALYSIS.md section 13)."""

from __future__ import annotations

from enum import StrEnum


class ErrorCode(StrEnum):
    E_FORMAT = "E_FORMAT"
    E_SIZE = "E_SIZE"
    E_DECODE = "E_DECODE"
    E_TOO_SHORT = "E_TOO_SHORT"
    E_TOO_LONG = "E_TOO_LONG"
    E_SILENT = "E_SILENT"
    E_INTERNAL = "E_INTERNAL"


USER_MESSAGES: dict[ErrorCode, str] = {
    ErrorCode.E_FORMAT: "This file type isn't supported. Try MP3, M4A, WAV, FLAC or OGG.",
    ErrorCode.E_SIZE: "This file is larger than 100 MB.",
    ErrorCode.E_DECODE: "We couldn't read this audio file.",
    ErrorCode.E_TOO_SHORT: "Songs need to be at least 20 seconds long.",
    ErrorCode.E_TOO_LONG: "Songs longer than 12 minutes aren't supported yet.",
    ErrorCode.E_SILENT: "This file seems to be silent.",
    ErrorCode.E_INTERNAL: "Something went wrong. Please try again.",
}


class SynError(Exception):
    """Pipeline error carrying a stable code and a user-facing message."""

    def __init__(self, code: ErrorCode, detail: str | None = None) -> None:
        self.code = code
        self.user_message = USER_MESSAGES[code]
        self.detail = detail
        super().__init__(f"{code.value}: {detail or self.user_message}")
