"""
atomic_write.py —— Python 侧双语原子落盘保护（4 Argon 第 74 轮 Q2/Phase 2 契约）
统一先写同目录隐藏临时文件 .tmp.<filename>.<pid>.<uuid>，写完原子 replace 到目标文件。
"""
import os
import uuid
from typing import Union

def atomic_write(filepath: str, content: Union[str, bytes], mode: str = "w", encoding: str = "utf-8"):
    directory = os.path.dirname(filepath)
    if directory:
        os.makedirs(directory, exist_ok=True)
    basename = os.path.basename(filepath)
    tmp_path = os.path.join(directory, f".tmp.{basename}.{os.getpid()}.{uuid.uuid4().hex[:6]}")
    try:
        if "b" in mode:
            with open(tmp_path, mode) as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
        else:
            with open(tmp_path, mode, encoding=encoding) as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
        os.replace(tmp_path, filepath)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
        raise
