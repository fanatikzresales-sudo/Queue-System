"""Tests for self-update staging logic."""

import os
import tempfile
import unittest
from unittest.mock import patch

import updater


class TestUpdaterStaging(unittest.TestCase):
    def test_staging_file_ready_false_when_missing(self):
        with patch.object(updater, "_staging_path", return_value="/nonexistent/path.new.exe"):
            self.assertFalse(updater.staging_file_ready())

    def test_staging_file_ready_true_for_nonempty_file(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(b"x" * 200_000)
            path = tmp.name
        try:
            with patch.object(updater, "_staging_path", return_value=path):
                self.assertTrue(updater.staging_file_ready())
        finally:
            os.remove(path)

    def test_sync_staged_flag_reflects_disk(self):
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(b"x" * 200_000)
            path = tmp.name
        try:
            with patch.object(updater, "_staging_path", return_value=path):
                updater._sync_staged_flag()
                self.assertTrue(updater.update_state["staged"])
        finally:
            os.remove(path)


if __name__ == "__main__":
    unittest.main()
