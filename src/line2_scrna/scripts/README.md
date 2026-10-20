# scripts/ 与 checkpoint/ 占位说明
#
# 本目录当前为空：按用户指定顺序，先软件（链路/规范/台账/框架）后分析代码，
# 三条线的分析脚本在建好数据面（/mnt/ssd 挂载确认）之后再逐个补。
#
# 落这里的文件必须遵守：
#   1. 只用本线的 line_id 作路径与命名，不得出现另外两条线的字面量
#      （由 ops/02_check_isolation.ps1 在提交前强制校验）
#   2. 桥上检查点脚本命名 checkpoint_*.R / checkpoint_*.py，放 checkpoint/
#   3. 注释只解释为什么，不用 em dash，变量不用单字母
#
# 详见 docs/isolation.md 与 docs/directories.md。
