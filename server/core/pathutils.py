"""Path normalization helpers for project directories / scripts.

Project path fields (cmd_directory, script_path, directory_path) may be stored
with legacy JSON-style escaping (surrounding quotes + doubled backslashes, e.g.
``"D:\\projects\\app_task"``) or with stray quote characters. These helpers turn
such values into a clean, OS-usable path string.
"""

import json
import os
import re


def normalize_path(raw):
    """Return a clean filesystem path string, or '' if nothing usable.

    - strips surrounding whitespace
    - strips a single layer of surrounding single/double quotes
    - if the remainder looks like a JSON-encoded string, decodes it
    - collapses doubled backslashes into single ones
    """
    if not raw:
        return ''
    value = str(raw).strip()
    if not value:
        return ''

    # Strip one layer of surrounding quotes.
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        value = value[1:-1].strip()

    # If it still looks like a JSON string literal, decode it.
    if value.startswith('"') and value.endswith('"'):
        try:
            decoded = json.loads(value)
            if isinstance(decoded, str):
                value = decoded
        except (ValueError, TypeError):
            pass

    # Collapse doubled backslashes into single ones (Windows paths).
    value = value.replace('\\\\', '\\')

    return value.strip()


def resolve_venv(env_dir):
    """Resolve a virtualenv folder to (activate_bat, scripts_dir).

    Returns (None, None) if `env_dir` is empty, not a directory, or missing the
    expected ``Scripts\\activate.bat`` / ``Scripts\\`` layout (so callers can
    gracefully fall back to the plain terminal / inherited environment).
    """
    if not env_dir:
        return None, None
    env_dir = normalize_path(env_dir)
    if not env_dir or not os.path.isdir(env_dir):
        return None, None
    activate_bat = os.path.join(env_dir, 'Scripts', 'activate.bat')
    scripts_dir = os.path.join(env_dir, 'Scripts')
    if not (os.path.isfile(activate_bat) and os.path.isdir(scripts_dir)):
        return None, None
    return activate_bat, scripts_dir


_DRIVE_RE = re.compile(r'^[A-Za-z]:\\')


def remap_drive(path, new_drive):
    """Rewrite the leading drive letter of `path` to `new_drive` (e.g. 'D').

    Returns the path unchanged if `new_drive` is empty/invalid or the path has no
    drive-letter prefix (relative/UNC paths are left alone).
    """
    if not path or not new_drive:
        return path
    letter = str(new_drive).rstrip(':').upper()
    if not re.fullmatch(r'[A-Z]', letter):
        return path
    normalized = normalize_path(path)
    if not normalized:
        return path
    return _DRIVE_RE.sub(lambda _m: letter + ':\\', normalized, count=1)
