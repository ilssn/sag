"""Reference implementation for Open Context."""

from octx.creation import create_octx
from octx.errors import (
    ConfirmationRequired,
    DerivationRequired,
    OctxError,
    OctxFormatError,
    OctxIntegrityError,
    OctxOpenError,
    OctxResourceLimitError,
    OctxSecurityError,
    OctxValidationError,
    OutputExistsError,
    ReleaseVersionError,
)
from octx.models import ArchiveLimits, CreateResult, Document, LayerResult, ValidationIssue, ValidationReport
from octx.package import OctxPackage, open_octx
from octx.unpack import unpack_octx
from octx.validation import validate_octx

__all__ = [
    "ArchiveLimits",
    "ConfirmationRequired",
    "CreateResult",
    "DerivationRequired",
    "Document",
    "LayerResult",
    "OctxError",
    "OctxFormatError",
    "OctxIntegrityError",
    "OctxOpenError",
    "OctxPackage",
    "OctxResourceLimitError",
    "OctxSecurityError",
    "OctxValidationError",
    "OutputExistsError",
    "ReleaseVersionError",
    "ValidationIssue",
    "ValidationReport",
    "create_octx",
    "open_octx",
    "unpack_octx",
    "validate_octx",
]

__version__ = "0.1.0"
