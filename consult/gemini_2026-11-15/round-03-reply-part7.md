防护维度 硬限额阈值 拦截动作与防攻击目标
条目类型 (header.type) 仅允许 'file' 与 'directory' 遇到 'symlink', 'link' (hardlink), 'fifo', 'character-device', 'block-device' 立即 abort()（彻底封死通过软硬链接逃逸出解包目录读写宿主机文件）
路径结构与字符集 深度 ≤ 4 层；仅允许 ^[a-zA-Z0-9_.\-/]+$ 拒绝任何 ..、前导 /、Windows 盘符 :、反斜杠 \、控制字符及 Unicode 同形异义字
最大条目总数 ≤ 64 个条目（含目录） 契约规定 5 个固定角色各 1 文件 + other 最多 5 个 + references 最多 5 个 + 2 个 JSON，正常包绝不超过 25 个条目；超 64 即判定为 Inode 耗尽攻击
单文件解压后大小 ≤ 5,368,709,120 Bytes (5 GiB) 同时校验 header.size 声明值与实际写出字节流 bytesWritten（防止伪造 tar header 小尺寸绕过检查）
整包解压累计总字节 ≤ 12,884,901,888 Bytes (12 GiB) 保护桌面端 .sync_cache 与 data/workspace/inbox 所在磁盘分区
压缩膨胀率（防炸弹） 累计 uncompressed_bytes > 10MB 后，uncompressed / compressed_read ≤ 25 实时拦截全零填充的 .tar.gz 压缩炸弹（正常生信矩阵 gzip 压缩比在 3x–10x 之间）
