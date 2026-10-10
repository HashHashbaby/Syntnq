from __future__ import annotations

from synesthesia.errors import USER_MESSAGES, ErrorCode, SynError


def test_every_code_has_a_message() -> None:
    assert set(USER_MESSAGES) == set(ErrorCode)


def test_syn_error_carries_code_and_message() -> None:
    err = SynError(ErrorCode.E_SILENT, "integrated loudness -70 LUFS")
    assert err.code is ErrorCode.E_SILENT
    assert err.user_message == "This file seems to be silent."
    assert "E_SILENT" in str(err)
