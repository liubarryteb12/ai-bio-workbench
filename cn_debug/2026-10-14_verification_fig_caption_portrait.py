import pathlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = pathlib.Path(r"d:/00.AIagent/codespace/AI辅助生信分析流程工作台/cn_debug/fig_caption_check")

plt.rcParams.update({"savefig.bbox": "tight", "figure.autolayout": True,
                     "figure.dpi": 150, "savefig.dpi": 150})


def caption(fig, *parts):
    parts = [str(p) for p in parts if p not in (None, "")]
    if not parts:
        return
    w, h = fig.get_size_inches()
    if w >= h:
        fig.text(0.5, -0.02, "   |   ".join(parts),
                 ha="center", va="top", fontsize=8)
    else:
        fig.text(1.02, 1.0, "\n".join(parts),
                 ha="left", va="top", fontsize=8, linespacing=1.5)


for name, size in [("landscape", (8, 5)), ("portrait", (5, 8))]:
    fig, ax = plt.subplots(figsize=size)
    ax.plot([0, 1, 2], [0, 1, 4])
    ax.set_xlabel("x")
    ax.set_ylabel("y")
    caption(fig, "demo: caption part 1", "part 2", "part 3")
    fig.savefig(OUT / ("caption_%s.png" % name))
    plt.close(fig)
    print("wrote", name)
