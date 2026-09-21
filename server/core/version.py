"""Build identity embedded by the desktop release process."""

import json
import sys
from pathlib import Path


APP_VERSION = '1.1.3'
BUILD_ID = 'dev'


def _load_embedded_identity():
    candidates = []
    frozen_root = getattr(sys, '_MEIPASS', None)
    if frozen_root:
        candidates.append(Path(frozen_root) / 'build-identity.json')
    if getattr(sys, 'executable', None):
        candidates.append(Path(sys.executable).resolve().parent / 'build-identity.json')
    candidates.append(Path(__file__).resolve().parents[2] / 'desktop' / 'build-identity.json')
    for candidate in candidates:
        try:
            data = json.loads(candidate.read_text(encoding='utf-8'))
            version = str(data.get('version') or '').strip()
            build_id = str(data.get('buildId') or '').strip()
            if version and build_id:
                return version, build_id
        except (OSError, ValueError, TypeError):
            continue
    return APP_VERSION, BUILD_ID


APP_VERSION, BUILD_ID = _load_embedded_identity()
