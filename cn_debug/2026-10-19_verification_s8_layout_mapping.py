#!/usr/bin/env python3
"""S8 探针（Python 端）：旧模板 id → 新两档 id 的映射等价性 + 语法检查。

验证目标（派发单 A1/A2）：
  1. 三个 py 文件 ast.parse 通过；
  2. normalize_layout_spec('template_2_cell_wide') == normalize_layout_spec('template_16x9')
     （dict 完全相等，逐字段相同）；
  3. normalize_layout_spec('template_1_nature_side') == normalize_layout_spec('template_4x3')；
  4. normalize_layout_spec('template_3_clinical_note') 映射到 template_4x3；
  5. 未知 id 仍回落 template_4x3；camelCase 形态与 theme_rules 覆盖行为不变。

用法（项目根）：
    python cn_debug/2026-10-19_verification_s8_layout_mapping.py
退出码 0 = 全部通过。
"""

import ast
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "ops"))

import layout_helper  # noqa: E402

PY_FILES = [
    os.path.join(ROOT, "ops", "layout_helper.py"),
    os.path.join(ROOT, "ops", "layout_autoload", "sitecustomize.py"),
    os.path.join(ROOT, "cn_debug", "2026-10-19_verification_s8_layout_mapping.py"),
]

failures = []


def check(label, condition, detail=""):
    if condition:
        print("PASS %s%s" % (label, (" | " + detail) if detail else ""))
    else:
        print("FAIL %s%s" % (label, (" | " + detail) if detail else ""))
        failures.append(label)


def main():
    # --- 1. 语法检查 ---
    for path in PY_FILES:
        with open(path, encoding="utf-8") as fh:
            ast.parse(fh.read())
        print("PASS ast.parse %s" % os.path.relpath(path, ROOT))

    # --- 2. 模板表只保留两档 ---
    check("TEMPLATES 键集合 = {template_4x3, template_16x9}",
          sorted(layout_helper.TEMPLATES) == ["template_16x9", "template_4x3"],
          str(sorted(layout_helper.TEMPLATES)))
    check("DEFAULT_TEMPLATE_ID = template_4x3",
          layout_helper.DEFAULT_TEMPLATE_ID == "template_4x3",
          layout_helper.DEFAULT_TEMPLATE_ID)

    # --- 3. 四组映射等价 ---
    pairs = [
        ("template_2_cell_wide", "template_16x9"),
        ("template_1_nature_side", "template_4x3"),
        ("template_3_clinical_note", "template_4x3"),
    ]
    for old_id, new_id in pairs:
        old_spec = layout_helper.normalize_layout_spec({"template_id": old_id})
        new_spec = layout_helper.normalize_layout_spec({"template_id": new_id})
        check("%s 与 %s 规格 dict 完全相等" % (old_id, new_id), old_spec == new_spec,
              "template_id=%s rules=%s" % (old_spec["template_id"], old_spec["theme_rules"]))

    # 第四组：显式断言旧 2 → 新 16:9 的 template_id 落位（上面已含），
    # 这里补旧 3 的落位与"新 id 自身不变"两条
    check("template_3_clinical_note 归一后 template_id = template_4x3",
          layout_helper.normalize_layout_spec(
              {"templateId": "template_3_clinical_note"})["template_id"] == "template_4x3")
    check("新 id 自身不偏移（16x9）",
          layout_helper.normalize_layout_spec(
              {"templateId": "template_16x9"})["template_id"] == "template_16x9")

    # --- 4. 回落与覆盖行为不变 ---
    for bad in (None, {}, {"templateId": "nope"}, {"templateId": "template_9_fake"}):
        spec = layout_helper.normalize_layout_spec(bad)
        check("非法输入回落默认模板 %r" % (bad,),
              spec["template_id"] == "template_4x3" and spec["dpi"] == 300)

    override = layout_helper.normalize_layout_spec({
        "templateId": "template_2_cell_wide",
        "theme_rules": {"aspect_ratio": "4:3", "bogus_key": 1},
    })
    check("theme_rules 覆盖仍只接受已知键",
          override["theme_rules"]["aspect_ratio"] == "4:3"
          and "bogus_key" not in override["theme_rules"])

    # --- 5. figsize_for 行为不变 ---
    check("figsize_for('4:3') = (7.2, 5.4)",
          layout_helper.figsize_for("4:3") == (7.2, 5.4),
          str(layout_helper.figsize_for("4:3")))
    check("figsize_for('16:9') = (7.2, 4.05)",
          layout_helper.figsize_for("16:9") == (7.2, 4.05),
          str(layout_helper.figsize_for("16:9")))

    print("")
    if failures:
        print("RESULT FAIL %d 项未过: %s" % (len(failures), ", ".join(failures)))
        return 1
    print("RESULT PASS 全部断言通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
