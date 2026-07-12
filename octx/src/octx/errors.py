from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from octx.models import ValidationReport


class OctxError(Exception):
    """Base exception for OCTX operations."""

    code = "OCTX_ERROR"

    def __init__(self, message: str, *, path: str | None = None) -> None:
        super().__init__(message)
        self.path = path


class OctxOpenError(OctxError):
    code = "OCTX_OPEN_ERROR"


class OctxFormatError(OctxOpenError):
    code = "OCTX_FORMAT_ERROR"

    def __init__(
        self,
        message: str,
        *,
        path: str | None = None,
        line: int | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(message, path=path)
        self.line = line
        if code:
            self.code = code


class OctxSecurityError(OctxOpenError):
    code = "OCTX_SECURITY_ERROR"


class OctxResourceLimitError(OctxSecurityError):
    code = "OCTX_RESOURCE_LIMIT"


class OctxIntegrityError(OctxError):
    code = "OCTX_INTEGRITY_ERROR"


class OctxValidationError(OctxError):
    code = "OCTX_VALIDATION_ERROR"

    def __init__(self, message: str, report: ValidationReport) -> None:
        super().__init__(message)
        self.report = report


class ReleaseVersionError(OctxError):
    code = "OCTX_RELEASE_VERSION_REQUIRED"


class DerivationRequired(OctxError):
    code = "OCTX_DERIVATION_REQUIRED"


class OutputExistsError(OctxError):
    code = "OCTX_OUTPUT_EXISTS"


class ConfirmationRequired(OctxError):
    code = "OCTX_CONFIRMATION_REQUIRED"

    def __init__(self, message: str, changes: Sequence[str]) -> None:
        super().__init__(message)
        self.changes = tuple(changes)
