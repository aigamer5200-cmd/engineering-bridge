#!/usr/bin/env python3
"""Safely harden the published @waishnav/devspace 1.0.8 process session module.

The command operates on an explicitly supplied ``dist/process-sessions.js``
path.  It accepts only the known 1.0.8 source shape, writes a create-only
timestamped backup before changing the target, and verifies the exact bytes
after the write.  It never discovers or starts a DevSpace installation.

Usage:
    python ops/devspace_session_hardening.py TARGET
    python ops/devspace_session_hardening.py --dry-run TARGET
    python ops/devspace_session_hardening.py --verify TARGET
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import os
from pathlib import Path
import stat
import sys
import tempfile
from typing import Literal


TARGET_NAME = "process-sessions.js"
ORIGINAL_TTL_LINE = "const COMPLETED_SESSION_TTL_MS = 5 * 60 * 1_000;"
PATCHED_TTL_LINE = "const COMPLETED_SESSION_TTL_MS = 60 * 60 * 1_000;"
REMOVE_AFTER_CONSUME = (
    "        if (!session.running)\n"
    "            this.removeSession(session.id);\n"
)
ORIGINAL_CONSUME = (
    "    consume(session, maxOutputTokens) {\n"
    "        const limit = boundedInteger(maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS, 100_000);\n"
    "        const maxCharacters = Math.max(256, limit * 4);\n"
    "        const buffered = session.buffer.drain(maxCharacters);\n"
    "        return {\n"
    "            sessionId: session.running ? session.id : undefined,\n"
    "            output: buffered.output,\n"
    "            outputTruncated: buffered.truncated,\n"
    "            running: session.running,\n"
    "            exitCode: session.exitCode,\n"
    "            signal: session.signal,\n"
    "            wallTimeMs: Date.now() - session.startedAt,\n"
    "        };\n"
    "    }"
)
PATCHED_CONSUME = (
    "    consume(session, maxOutputTokens) {\n"
    "        if (!session.running && session.completedSnapshot)\n"
    "            return session.completedSnapshot;\n"
    "        const limit = boundedInteger(maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS, 100_000);\n"
    "        const maxCharacters = Math.max(256, limit * 4);\n"
    "        const buffered = session.buffer.drain(maxCharacters);\n"
    "        const snapshot = {\n"
    "            sessionId: session.running ? session.id : undefined,\n"
    "            output: buffered.output,\n"
    "            outputTruncated: buffered.truncated,\n"
    "            running: session.running,\n"
    "            exitCode: session.exitCode,\n"
    "            signal: session.signal,\n"
    "            wallTimeMs: Date.now() - session.startedAt,\n"
    "        };\n"
    "        if (!session.running)\n"
    "            session.completedSnapshot = snapshot;\n"
    "        return snapshot;\n"
    "    }"
)

SourceState = Literal["original", "patched"]


class HardeningError(RuntimeError):
    """A fail-closed validation or mutation error."""


@dataclass(frozen=True)
class OperationResult:
    target: Path
    mode: Literal["applied", "already-patched", "dry-run", "verified"]
    backup: Path | None = None


def _read_target(path: Path) -> tuple[bytes, str, str]:
    if path.name != TARGET_NAME:
        raise HardeningError(f"target must be named {TARGET_NAME}")
    if path.is_symlink():
        raise HardeningError("refusing to patch a symlink target")
    if not path.exists():
        raise HardeningError(f"target does not exist: {path}")
    if not path.is_file():
        raise HardeningError(f"target is not a regular file: {path}")
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise HardeningError("target is not strict UTF-8") from error
    if text.startswith("\ufeff"):
        raise HardeningError("target must not contain a UTF-8 BOM")
    normalized = text.replace("\r\n", "\n")
    if "\r" in normalized:
        raise HardeningError("target contains mixed or unsupported line endings")
    newline = "\r\n" if "\r\n" in text else "\n"
    return raw, normalized, newline


def _single_marker(source: str, marker: str, description: str) -> None:
    count = source.count(marker)
    if count != 1:
        raise HardeningError(
            f"unexpected source shape: {description} occurs {count} times, expected once"
        )


def _write_method(source: str) -> str:
    start_marker = "    async write(input) {"
    end_marker = "\n    terminate(workspaceId, sessionId) {"
    _single_marker(source, start_marker, "write method")
    _single_marker(source, end_marker, "terminate method")
    start = source.index(start_marker)
    end = source.index(end_marker, start)
    if end <= start:
        raise HardeningError("unexpected source shape: write method boundary")
    return source[start:end]


def _validate_common_shape(source: str) -> None:
    for marker, description in (
        ("export class ProcessSessionManager {", "process session manager"),
        ("    async start(input) {", "start method"),
        ("    finish(session, exitCode, signal) {", "finish method"),
        ("    getOwnedSession(workspaceId, sessionId) {", "ownership method"),
        ("    removeSession(sessionId) {", "remove method"),
        (
            "        session.cleanupTimer = setTimeout(() => this.sessions.delete(session.id), this.completedSessionTtlMs);\n",
            "completed-session TTL cleanup",
        ),
    ):
        _single_marker(source, marker, description)
    if source.count("        const snapshot = this.consume(session, input.maxOutputTokens);\n") != 2:
        raise HardeningError(
            "unexpected source shape: expected exactly two terminal snapshot consumers"
        )

    write_method = _write_method(source)
    if write_method.count("        const snapshot = this.consume(session, input.maxOutputTokens);\n") != 1:
        raise HardeningError("unexpected source shape: write method consumer is not unique")
    if "        return snapshot;\n" not in write_method:
        raise HardeningError("unexpected source shape: write method return is missing")


def classify_source(source: str) -> SourceState:
    """Return the only accepted source state, or fail closed."""

    _validate_common_shape(source)
    original_ttl = source.count(ORIGINAL_TTL_LINE)
    patched_ttl = source.count(PATCHED_TTL_LINE)
    original_consume = source.count(ORIGINAL_CONSUME)
    patched_consume = source.count(PATCHED_CONSUME)
    write_method = _write_method(source)
    write_remove_count = write_method.count(REMOVE_AFTER_CONSUME)
    all_remove_count = source.count(REMOVE_AFTER_CONSUME)

    if (
        original_ttl == 1
        and patched_ttl == 0
        and original_consume == 1
        and patched_consume == 0
        and write_remove_count == 1
        and all_remove_count == 2
        and "session.completedSnapshot" not in source
    ):
        return "original"

    if (
        original_ttl == 0
        and patched_ttl == 1
        and original_consume == 0
        and patched_consume == 1
        and write_remove_count == 0
        and all_remove_count == 1
        and source.count("session.completedSnapshot") == 3
    ):
        return "patched"

    raise HardeningError(
        "unexpected process-sessions.js source shape; refusing partial or unknown transform"
    )


def transform_source(source: str) -> str:
    """Transform one validated LF-normalized 1.0.8 source body."""

    if classify_source(source) != "original":
        raise HardeningError("transform requires the original 1.0.8 source shape")

    transformed = source.replace(ORIGINAL_TTL_LINE, PATCHED_TTL_LINE, 1)
    transformed = transformed.replace(ORIGINAL_CONSUME, PATCHED_CONSUME, 1)
    write_method = _write_method(transformed)
    if write_method.count(REMOVE_AFTER_CONSUME) != 1:
        raise HardeningError("unexpected source shape while locating write terminal cleanup")
    write_start = transformed.index("    async write(input) {")
    write_end = transformed.index("\n    terminate(workspaceId, sessionId) {", write_start)
    transformed = (
        transformed[:write_start]
        + transformed[write_start:write_end].replace(REMOVE_AFTER_CONSUME, "", 1)
        + transformed[write_end:]
    )
    if classify_source(transformed) != "patched":
        raise HardeningError("generated source did not satisfy the patched source shape")
    return transformed


def _create_backup(target: Path, original: bytes) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    base = target.with_name(f"{target.name}.bak.{timestamp}")
    for suffix in range(1000):
        candidate = base if suffix == 0 else target.with_name(f"{base.name}.{suffix}")
        try:
            fd = os.open(
                candidate,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                stat.S_IRUSR | stat.S_IWUSR,
            )
        except FileExistsError:
            continue
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(original)
                handle.flush()
                os.fsync(handle.fileno())
        except BaseException:
            try:
                candidate.unlink()
            except FileNotFoundError:
                pass
            raise
        return candidate
    raise HardeningError("could not create a unique timestamped backup without overwriting")


def _atomic_replace(target: Path, content: bytes) -> None:
    mode = stat.S_IMODE(target.stat().st_mode)
    temporary_name: str | None = None
    try:
        fd, temporary_name = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".tmp", dir=target.parent
        )
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_name, mode)
        os.replace(temporary_name, target)
        temporary_name = None
    finally:
        if temporary_name is not None:
            try:
                Path(temporary_name).unlink()
            except FileNotFoundError:
                pass


def operate(target: os.PathLike[str] | str, mode: Literal["apply", "dry-run", "verify"] = "apply") -> OperationResult:
    """Apply, preview, or verify the hardening for one explicit target."""

    path = Path(target)
    original_bytes, source, newline = _read_target(path)
    state = classify_source(source)

    if mode == "verify":
        if state != "patched":
            raise HardeningError("verification failed: target is not patched")
        return OperationResult(path, "verified")

    if mode == "dry-run":
        return OperationResult(path, "dry-run")

    if state == "patched":
        return OperationResult(path, "already-patched")

    transformed = transform_source(source)
    expected_bytes = transformed.replace("\n", newline).encode("utf-8")
    backup = _create_backup(path, original_bytes)
    _atomic_replace(path, expected_bytes)
    reread = path.read_bytes()
    if reread != expected_bytes:
        raise HardeningError("exact reread verification failed after target replacement")
    _, reread_source, _ = _read_target(path)
    if classify_source(reread_source) != "patched":
        raise HardeningError("post-write source-shape verification failed")
    return OperationResult(path, "applied", backup)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Patch one explicitly supplied @waishnav/devspace 1.0.8 process-sessions.js path."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--apply",
        action="store_true",
        help="apply the patch (the default), with a create-only timestamped backup",
    )
    mode.add_argument("--dry-run", action="store_true", help="validate and preview without writing")
    mode.add_argument("--verify", action="store_true", help="verify that the target is already patched")
    parser.add_argument("target", type=Path, help="explicit path to dist/process-sessions.js")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    mode: Literal["apply", "dry-run", "verify"] = (
        "verify" if args.verify else "dry-run" if args.dry_run else "apply"
    )
    try:
        result = operate(args.target, mode)
    except (OSError, HardeningError) as error:
        print(f"FAIL_CLOSED: {error}", file=sys.stderr)
        return 2

    if result.mode == "applied":
        print(f"APPLY_PASS target={result.target} backup={result.backup}")
    elif result.mode == "already-patched":
        print(f"NOOP_ALREADY_PATCHED target={result.target}")
    elif result.mode == "verified":
        print(f"VERIFY_PASS target={result.target}")
    else:
        print(f"DRY_RUN_PASS target={result.target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
