#!/usr/bin/env python3
"""Offline integrity guard. Does not call Last.app, Supabase or messaging APIs."""
import hashlib
import json
import stat
import sys
from pathlib import Path


def object_hash(kind: str, content: bytes) -> str:
    header = f"{kind} {len(content)}\0".encode("ascii")
    return hashlib.sha1(header + content).hexdigest()


def blob_hash(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Expected a regular file: {path}")
    return object_hash("blob", path.read_bytes())


def tree_hash(path: Path) -> str:
    if path.is_symlink() or not path.is_dir():
        raise ValueError(f"Expected a directory: {path}")
    entries = []
    for child in path.iterdir():
        if child.is_symlink():
            raise ValueError(f"Unexpected symlink: {child}")
        name = child.name.encode("utf-8")
        if child.is_dir():
            mode, digest, key = b"40000", tree_hash(child), name + b"/"
        elif child.is_file():
            mode = b"100755" if child.stat().st_mode & stat.S_IXUSR else b"100644"
            digest, key = blob_hash(child), name
        else:
            raise ValueError(f"Unsupported entry: {child}")
        entries.append((key, mode + b" " + name + b"\0" + bytes.fromhex(digest)))
    return object_hash("tree", b"".join(entry for _, entry in sorted(entries)))


def verify(root: Path) -> list[str]:
    lock = json.loads((root / "integrations/lastapp/preservation-lock.json").read_text(encoding="utf-8"))
    errors = []
    for group, calculate in (("protected_blobs", blob_hash), ("protected_trees", tree_hash)):
        for relative, expected in lock[group].items():
            path = root / relative
            if path.is_absolute() and not path.resolve().is_relative_to(root.resolve()):
                errors.append(f"Invalid protected path: {relative}")
                continue
            try:
                actual = calculate(path)
                if actual != expected:
                    errors.append(f"Changed protected source: {relative}")
            except (OSError, ValueError) as exc:
                errors.append(f"Cannot verify {relative}: {exc}")
    functions = root / "supabase/functions"
    actual_functions = sorted(p.name for p in functions.iterdir()) if functions.is_dir() else []
    if actual_functions != sorted(lock["cleanup_function_allowlist"]):
        errors.append("Cleanup must contain exactly the two retained Last.app function directories")
    return errors


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    try:
        errors = verify(root)
    except (OSError, ValueError, KeyError) as exc:
        print(f"Integrity check could not run: {exc}", file=sys.stderr)
        return 1
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("PASS: Last.app sources and complete SQL history are byte-for-byte preserved.")
    print("This is an offline integrity check, NOT a live integration or deployment test.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
