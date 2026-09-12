import os
import tempfile
import time
from unittest import skipUnless
from unittest.mock import patch

from django.test import SimpleTestCase
from core.services.terminal_manager import TerminalManager, HAS_WINPTY


class TerminalEnvironmentTests(SimpleTestCase):
    def test_project_shell_does_not_inherit_backend_context(self):
        with patch.dict(os.environ, {'DJANGO_SETTINGS_MODULE': 'config.settings',
                                    'SQLITE_PATH': 'private.sqlite3',
                                    'PYTHONHOME': 'bundled-python', '_PYI_PARENT_PROCESS_LEVEL': '1'}):
            env = TerminalManager()._build_venv_env(None)
        for key in ('DJANGO_SETTINGS_MODULE', 'SQLITE_PATH', 'PYTHONHOME', '_PYI_PARENT_PROCESS_LEVEL'):
            self.assertNotIn(key, env)

    def test_empty_cmd_directory_uses_project(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(TerminalManager()._resolve_cmd_cwd('', folder), folder)


@skipUnless(os.name == 'nt' and HAS_WINPTY, 'Windows terminal runtime required')
class WindowsTerminalTests(SimpleTestCase):
    def wait_output(self, session, marker):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            output = session.read_since(0)[1]
            if marker in output:
                return
            time.sleep(0.05)
        self.fail('Terminal did not produce expected output: ' + session.read_since(0)[1])

    def test_cmd_input_resize_and_batch_path_with_spaces(self):
        manager = TerminalManager()
        with tempfile.TemporaryDirectory(prefix='SoloDev terminal ') as folder:
            session = manager.create_cmd(owner_id='test', project_id='test', project_title='Test',
                                         directory='', fallback_directory=folder)
            try:
                session.resize(90, 24)
                session.write('echo SOLODEV_%COMSPEC%\r')
                self.wait_output(session, 'cmd.exe')
            finally:
                session.kill()
            script = os.path.join(folder, 'test script.cmd')
            with open(script, 'w') as file:
                file.write('@echo off\necho SCRIPT_READY_%~1\n')
            session = manager.create_script(owner_id='test', project_id='test', project_title='Test',
                                            script_path=script, run_args=['hello world'])
            try:
                self.wait_output(session, 'SCRIPT_READY_hello world')
                self.assertTrue(session.is_alive())
            finally:
                session.kill()
