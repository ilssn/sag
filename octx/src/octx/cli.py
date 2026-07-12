from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from typing import Any

import yaml

from octx._paths import is_concept_path
from octx.creation import create_octx
from octx.errors import OctxError, OctxValidationError
from octx.package import open_octx
from octx.unpack import unpack_octx
from octx.validation import validate_octx


def _declarations(values: list[str] | None) -> dict[str, str] | None:
    if values is None:
        return None
    result: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"declaration must use NAME=VERSION: {value}")
        name, version = value.split("=", 1)
        if not name or not version:
            raise ValueError(f"declaration must use NAME=VERSION: {value}")
        result[name] = version
    return result


class _ArgumentParser(argparse.ArgumentParser):
    def __init__(self, *args: Any, json_errors: bool = False, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.json_errors = json_errors

    def error(self, message: str) -> None:
        if self.json_errors:
            print(
                json.dumps(
                    {"error": {"code": "OCTX_USAGE_ERROR", "message": message}},
                    ensure_ascii=False,
                    indent=2,
                )
            )
            raise SystemExit(2)
        super().error(message)


def _parser(*, json_errors: bool = False) -> argparse.ArgumentParser:
    parser = _ArgumentParser(
        prog="octx",
        description="Open Context reference tooling",
        json_errors=json_errors,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="create an immutable .octx Package", json_errors=json_errors)
    create.add_argument("workspace")
    create.add_argument("--from", dest="source")
    create.add_argument("--derive", action="store_true", help="create a new Asset from an expanded external Package")
    create.add_argument("--name")
    create.add_argument("--version")
    create.add_argument("--capability", action="append", metavar="NAME=VERSION")
    create.add_argument("-o", "--output", required=True)
    create.add_argument("--json", action="store_true")

    inspect = subparsers.add_parser("inspect", help="inspect a Package without validating it", json_errors=json_errors)
    inspect.add_argument("source")
    inspect.add_argument("--json", action="store_true")

    validate = subparsers.add_parser("validate", help="fully validate a Package", json_errors=json_errors)
    validate.add_argument("source")
    validate.add_argument("--json", action="store_true")

    unpack = subparsers.add_parser("unpack", help="validate and safely unpack a Package", json_errors=json_errors)
    unpack.add_argument("source")
    unpack.add_argument("destination")
    unpack.add_argument("--json", action="store_true")
    return parser


def _create(args: argparse.Namespace) -> int:
    options = {
        "workspace": args.workspace,
        "source": args.source,
        "derive": args.derive,
        "name": args.name,
        "version": args.version,
        "capabilities": _declarations(args.capability),
        "output": args.output,
    }
    result = create_octx(**options)
    if args.json:
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    else:
        print(f"created {result.output}")
        print(f"asset: {result.asset_id}")
        print(f"release: {result.version} ({result.package_digest})")
    return 0


def _inspection(source: str) -> dict[str, Any]:
    with open_octx(source) as package:
        manifest = package.manifest
        asset = manifest.get("asset")
        release = manifest.get("release")
        capabilities = manifest.get("capabilities")
        return {
            "format": manifest.get("format"),
            "format_version": manifest.get("format_version"),
            "asset": asset if isinstance(asset, dict) else {},
            "release": release if isinstance(release, dict) else {},
            "capabilities": capabilities if isinstance(capabilities, dict) else {},
            "files": len(package.files),
            "documents": sum(1 for path in package.files if is_concept_path(path)),
            "validation_performed": False,
        }


def _inspect(args: argparse.Namespace) -> int:
    result = _inspection(args.source)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        asset = result.get("asset") or {}
        release = result.get("release") or {}
        print(f"{asset.get('name', 'Unnamed asset')} ({asset.get('id', '?')})")
        print(f"release: {release.get('version', '?')}")
        print(f"files: {result['files']}; documents: {result['documents']}")
        print("validation: not performed")
    return 0


def _validate(args: argparse.Namespace) -> int:
    report = validate_octx(args.source)
    if args.json:
        print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))
    elif report.valid:
        suffix = "" if report.fully_validated else " (unknown optional layers were not validated)"
        print(f"valid{suffix}")
    else:
        print("invalid")
        for issue in report.issues:
            location = f" [{issue.path}]" if issue.path else ""
            print(f"- {issue.code}{location}: {issue.message}")
    return 0 if report.valid else 1


def _unpack(args: argparse.Namespace) -> int:
    destination = unpack_octx(args.source, args.destination)
    if args.json:
        print(json.dumps({"status": "unpacked", "destination": str(destination)}, ensure_ascii=False, indent=2))
    else:
        print(f"unpacked to {destination}")
    return 0


def _json_error(error: Exception) -> dict[str, Any]:
    if isinstance(error, OSError):
        default_code = "OCTX_IO_ERROR"
    elif isinstance(error, yaml.YAMLError):
        default_code = "OCTX_FORMAT_ERROR"
    else:
        default_code = "OCTX_USAGE_ERROR"
    detail: dict[str, Any] = {
        "code": getattr(error, "code", default_code),
        "message": str(error),
    }
    path = getattr(error, "path", None)
    if path is not None:
        detail["path"] = path
    result: dict[str, Any] = {"error": detail}
    if isinstance(error, OctxValidationError):
        result["validation"] = error.report.to_dict()
    return result


def _print_error(args: argparse.Namespace, error: Exception) -> None:
    if getattr(args, "json", False):
        print(json.dumps(_json_error(error), ensure_ascii=False, indent=2))
    else:
        print(str(error), file=sys.stderr)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(argv) if argv is not None else sys.argv[1:]
    parser = _parser(json_errors="--json" in arguments)
    args = parser.parse_args(arguments)
    try:
        if args.command == "create":
            return _create(args)
        if args.command == "inspect":
            return _inspect(args)
        if args.command == "validate":
            return _validate(args)
        if args.command == "unpack":
            return _unpack(args)
    except OctxValidationError as error:
        _print_error(args, error)
        return 1
    except (OctxError, OSError, ValueError, TypeError, yaml.YAMLError) as error:
        _print_error(args, error)
        return 2
    parser.error("unknown command")
    return 2
