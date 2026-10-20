"""pyscenic CLI launcher：兼容补丁后转发到 pyscenic.cli.pyscenic.main。

背景：
- pyscenic 0.12.1 的 transform.py 使用 numpy 旧别名 np.object，numpy>=1.24 已移除，
  CLI ctx 路径会 TypeError；此处先补回别名再进 CLI。
- 不修改已安装包源码，补丁只在本进程内生效。
用法：python3 scenic_launcher.py <pyscenic 子命令与参数...>
"""
import sys

import numpy as np

if not hasattr(np, "object"):
    np.object = object

from pyscenic.cli.pyscenic import main

if __name__ == "__main__":
    sys.argv = ["pyscenic"] + sys.argv[1:]
    main()
