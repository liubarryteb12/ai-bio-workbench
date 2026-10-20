"""S16 环境探针：确认本地 Python 侧图像/数值依赖可用（只读，不改任何产物）。"""
import sys

mods = {}
for name in ("PIL", "numpy", "matplotlib", "pandas"):
    try:
        m = __import__(name)
        mods[name] = getattr(m, "__version__", "?")
    except Exception as exc:  # noqa: BLE001
        mods[name] = "MISSING: %s" % exc

print("python", sys.version.split()[0])
for k, v in mods.items():
    print("%-12s %s" % (k, v))
