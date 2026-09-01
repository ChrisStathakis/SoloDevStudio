# PyInstaller spec for the self-contained Windows backend.
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules


hiddenimports = (
    collect_submodules("core")
    + collect_submodules("config")
    + collect_submodules("rest_framework")
    + collect_submodules("rest_framework_simplejwt")
    + collect_submodules("django_filters")
    + collect_submodules("corsheaders")
    + collect_submodules("reportlab")
    # ``terminal_manager`` imports this inside a guarded try/except, so make
    # the dependency explicit for the frozen backend.
    + collect_submodules("winpty")
)

datas = (
    collect_data_files("django")
    + collect_data_files("rest_framework")
    + collect_data_files("rest_framework_simplejwt")
    + collect_data_files("django_filters")
    + collect_data_files("corsheaders")
    + collect_data_files("reportlab")
)

# pywinpty ships its ConPTY extension/DLLs as native binaries, which must be
# present alongside the frozen Python modules in the Electron application.
binaries = collect_dynamic_libs("winpty")


a = Analysis(
    # Paths in a spec file are resolved from this ``desktop`` directory.
    ["../server/desktop_backend.py"],
    pathex=["../server"],
    binaries=binaries,
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
