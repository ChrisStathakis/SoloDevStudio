# PyInstaller spec for the self-contained Windows backend.
from PyInstaller.utils.hooks import collect_data_files, collect_submodules


hiddenimports = (
    collect_submodules("core")
    + collect_submodules("config")
    + collect_submodules("rest_framework")
    + collect_submodules("rest_framework_simplejwt")
    + collect_submodules("django_filters")
    + collect_submodules("corsheaders")
)

datas = (
    collect_data_files("django")
    + collect_data_files("rest_framework")
    + collect_data_files("rest_framework_simplejwt")
    + collect_data_files("django_filters")
    + collect_data_files("corsheaders")
)


a = Analysis(
    ["server/desktop_backend.py"],
    pathex=["server"],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="solodev-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)
