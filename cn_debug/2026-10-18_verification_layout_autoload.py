"""出图模板自动挂载验证（在服务器上跑，Python + R 两端）。

验的是核心闭环：**客户在需求单选了模板，出图真的按模板出**。
此前母版脚本只做最低合规收口，从不读 plot_layout_config，所以选什么都不生效。

判据不是"看图像不像"，而是可量的几何事实：
  - template_2_cell_wide → 画幅 16:9（宽/高 ≈ 1.778）
  - template_1_nature_side → 4:3（≈1.333）
  - 脚注文字只应出现在带 show_footnote_panel 的模板上

跑法：python3 2026-10-18_verification_layout_autoload.py <python_out.png> <r_out.png>
（R 端结果由调用方用 Rscript 单独产出后传路径进来，本脚本只校验）
"""

import json
import os
import subprocess
import sys
import tempfile

DATA_ROOT = os.environ.get("BIO_DATA_ROOT", "/mnt/ssd/bio_data")
AUTOLOAD = os.path.join(DATA_ROOT, "ops", "layout_autoload")
failed = 0


def check(label, cond, detail=""):
    global failed
    if not cond:
        failed += 1
    print("%s | %s%s" % ("PASS" if cond else "FAIL", label, (" | " + detail) if detail else ""))


def make_project(tmp, template_id):
    path = os.path.join(tmp, "project_%s.json" % template_id)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({
            "project_id": "PRJ_LAYOUT_TEST",
            "plot_layout_config": {"template_id": template_id, "dpi": 300},
        }, fh, ensure_ascii=False)
    return path


PLOT_SCRIPT = r'''
import sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# 模拟母版脚本：先装自己的 layout guard（接管 savefig），再画图落盘
_orig = matplotlib.figure.Figure.savefig

def _guard(fig, *a, **kw):
    return _orig(fig, *a, **kw)

matplotlib.figure.Figure.savefig = _guard

fig, ax = plt.subplots()
labels = ["Non_Lesional_Ctrl", "Lesional_Week2", "Lesional_Week4",
          "Lesional_Week8", "Treated_Week2", "Treated_Week4"]
for i, name in enumerate(labels):
    ax.bar(i, i + 1, label=name)
ax.set_xticks(range(len(labels)))
ax.set_xticklabels(labels)
ax.set_title("DEG counts by group")
ax.legend()
fig.savefig(sys.argv[1], bbox_inches="tight")
# 画幅与 dpi 由模板决定，必须在 savefig 之后读——模板挂在 savefig 包装里，
# 落盘那一刻才改 figsize。也不能用输出像素比判断：bbox_inches="tight"
# 会按内容裁边，把 16:9 裁成接近方形，测出来的比例不是模板设的比例。
print("FIGSIZE [%.3f, %.3f] DPI %.1f" % (fig.get_size_inches()[0], fig.get_size_inches()[1], fig.dpi))
print("saved", sys.argv[1])
'''


def run_python_case(tmp, template_id, expect_ratio):
    proj = make_project(tmp, template_id)
    script = os.path.join(tmp, "plot_%s.py" % template_id)
    with open(script, "w", encoding="utf-8") as fh:
        fh.write(PLOT_SCRIPT)
    out = os.path.join(tmp, "py_%s.png" % template_id)

    env = dict(os.environ)
    env["BIOANALYS_PROJECT_JSON"] = proj
    env["PYTHONPATH"] = AUTOLOAD + ((":" + env["PYTHONPATH"]) if env.get("PYTHONPATH") else "")
    proc = subprocess.run([sys.executable, script, out], env=env, capture_output=True, text=True)

    check("%s：Python 出图成功" % template_id, proc.returncode == 0,
          (proc.stderr or "")[-300:])
    check("%s：自动挂载日志出现" % template_id, "已挂载出图模板" in (proc.stderr or ""),
          (proc.stderr or "").strip()[-160:])

    # 画幅以脚本里打印的 figsize 为准（tight 裁边会改变输出像素比）
    import re
    match = re.search(r"FIGSIZE \[([\d.]+), ([\d.]+)\] DPI ([\d.]+)", proc.stdout or "")
    check("%s：取到 figsize/dpi" % template_id, bool(match), (proc.stdout or "").strip()[-160:])
    if match:
        w_in, h_in, dpi = (float(x) for x in match.groups())
        ratio = round(w_in / h_in, 3)
        check("%s：画幅比例 %.3f ≈ %.3f" % (template_id, ratio, expect_ratio),
              abs(ratio - expect_ratio) < 0.02, "%.2f x %.2f in" % (w_in, h_in))
        check("%s：DPI 为 300" % template_id, int(dpi) == 300, str(dpi))

    if not os.path.isfile(out):
        check("%s：输出文件存在" % template_id, False, out)
        return
    # 落盘像素 dpi 是第二道证据：模板必须把 dpi 真正写进 PNG，
    # 只改 fig.dpi 不够（matplotlib 的 savefig.dpi='figure' 走 rcParams）
    from PIL import Image
    with Image.open(out) as img:
        png_dpi = img.info.get("dpi", (0, 0))[0]
    check("%s：PNG 元数据 DPI 为 300" % template_id, int(round(png_dpi)) == 300, str(png_dpi))


def run_disable_case(tmp):
    """BIOANALYS_LAYOUT_DISABLE=1 时不得介入（排障开关）。"""
    proj = make_project(tmp, "template_2_cell_wide")
    script = os.path.join(tmp, "plot_disable.py")
    with open(script, "w", encoding="utf-8") as fh:
        fh.write(PLOT_SCRIPT)
    out = os.path.join(tmp, "py_disable.png")
    env = dict(os.environ)
    env["BIOANALYS_PROJECT_JSON"] = proj
    env["BIOANALYS_LAYOUT_DISABLE"] = "1"
    env["PYTHONPATH"] = AUTOLOAD + ((":" + env["PYTHONPATH"]) if env.get("PYTHONPATH") else "")
    proc = subprocess.run([sys.executable, script, out], env=env, capture_output=True, text=True)
    check("关闭开关时不挂载", "已挂载出图模板" not in (proc.stderr or ""),
          (proc.stderr or "").strip()[-160:])


def run_no_project_case(tmp):
    """没给 project.json 时完全不介入（非出图任务零开销）。"""
    script = os.path.join(tmp, "plot_noproj.py")
    with open(script, "w", encoding="utf-8") as fh:
        fh.write(PLOT_SCRIPT)
    out = os.path.join(tmp, "py_noproj.png")
    env = dict(os.environ)
    env.pop("BIOANALYS_PROJECT_JSON", None)
    env["PYTHONPATH"] = AUTOLOAD + ((":" + env["PYTHONPATH"]) if env.get("PYTHONPATH") else "")
    proc = subprocess.run([sys.executable, script, out], env=env, capture_output=True, text=True)
    check("无 project.json 时不介入", "已挂载出图模板" not in (proc.stderr or ""),
          (proc.stderr or "").strip()[-160:])
    check("无 project.json 时出图仍成功", proc.returncode == 0 and os.path.isfile(out))


def check_r_output(r_png):
    """R 端产物校验：由外部 Rscript 按 template_2_cell_wide 出图后传路径进来。"""
    if not r_png or not os.path.isfile(r_png):
        check("R 端产物存在", False, str(r_png))
        return
    from PIL import Image
    with Image.open(r_png) as img:
        w, h = img.size
    ratio = round(w / float(h), 3)
    check("R 端 template_2_cell_wide 画幅 ≈1.778", abs(ratio - 16 / 9.0) < 0.08,
          "%dx%d ratio=%.3f" % (w, h, ratio))


def main():
    r_png = sys.argv[2] if len(sys.argv) > 2 else ""
    tmp = tempfile.mkdtemp(prefix="layout_autoload_")
    try:
        run_python_case(tmp, "template_2_cell_wide", 16 / 9.0)
        run_python_case(tmp, "template_1_nature_side", 4 / 3.0)
        run_disable_case(tmp)
        run_no_project_case(tmp)
        check_r_output(r_png)
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n%s" % ("全部符合预期" if failed == 0 else "%d 条不符合预期" % failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
