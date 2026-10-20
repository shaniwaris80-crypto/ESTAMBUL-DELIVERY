import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/verify_lastapp_preservation.py"
spec = importlib.util.spec_from_file_location("preservation", SCRIPT)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class PreservationTests(unittest.TestCase):
    def test_empty_objects_match_git(self):
        self.assertEqual(guard.object_hash("blob", b""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391")
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(guard.tree_hash(Path(tmp)), "4b825dc642cb6eb9a060e54bf8d69288fbee4904")

    def test_tree_matches_git_and_detects_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "sql"
            folder.mkdir()
            (folder / "001.sql").write_bytes(b"select 1;\n")
            (folder / "a").mkdir()
            (folder / "a/child.sql").write_bytes(b"select 2;\n")
            (folder / "a.sql").write_bytes(b"select 3;\n")
            executable = folder / "run"
            executable.write_bytes(b"#!/bin/sh\nexit 0\n")
            executable.chmod(0o755)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "add", "sql"], check=True)
            tree = subprocess.check_output(["git", "-C", str(root), "write-tree"], text=True).strip()
            listing = subprocess.check_output(["git", "-C", str(root), "ls-tree", tree, "sql"], text=True)
            expected = listing.split()[2]
            self.assertEqual(guard.tree_hash(folder), expected)
            (folder / "001.sql").write_bytes(b"select 4;\n")
            self.assertNotEqual(guard.tree_hash(folder), expected)

    def test_missing_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                guard.blob_hash(Path(tmp) / "absent.sql")

    def test_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "source").write_bytes(b"ok")
            (root / "link").symlink_to(root / "source")
            with self.assertRaises(ValueError):
                guard.tree_hash(root)

    def test_verify_passes_then_rejects_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ("ed-last-webhook", "ed-last-auto-sync"):
                folder = root / "supabase/functions" / name
                folder.mkdir(parents=True)
                (folder / "index.ts").write_bytes(b"// test fixture\n")
            sql = root / "supabase/migrations"
            sql.mkdir()
            (sql / "001.sql").write_bytes(b"select 1;\n")
            relative = "supabase/functions/ed-last-webhook/index.ts"
            lock = {
                "protected_blobs": {relative: guard.blob_hash(root / relative)},
                "protected_trees": {"supabase/migrations": guard.tree_hash(sql)},
                "cleanup_function_allowlist": ["ed-last-webhook", "ed-last-auto-sync"],
            }
            (root / "integrations/lastapp").mkdir(parents=True)
            (root / "integrations/lastapp/preservation-lock.json").write_text(json.dumps(lock))
            self.assertEqual(guard.verify(root), [])
            (root / relative).write_bytes(b"// changed\n")
            self.assertTrue(guard.verify(root))


if __name__ == "__main__":
    unittest.main()
