## bio_r_header.R：R 脚本级 7.5GB 防崩头部模板
## 在 R 脚本入口处 source("/mnt/ssd/bio_data/ops/bio_r_header.R")
## 或直接复制以下代码到脚本开头

# 无头渲染（杜绝 X11/GUI 内存泄漏）
options(bitmapType = "cairo", stringsAsFactors = FALSE)

# data.table 线程封顶
if (requireNamespace("data.table", quietly = TRUE)) {
    data.table::setDTthreads(3)
}

# future 并行计划（默认顺序，任务显式请求时再限流并行）
if (requireNamespace("future", quietly = TRUE)) {
    is_parallelly_worker <- any(grepl(
        "parallelly.parent=",
        commandArgs(trailingOnly = FALSE),
        fixed = TRUE
    ))
    future_workers <- suppressWarnings(as.integer(
        Sys.getenv("BIOANALYS_FUTURE_WORKERS", unset = "1")
    ))
    if (is.na(future_workers) || future_workers < 1L) future_workers <- 1L
    if (!is_parallelly_worker) {
        if (future_workers > 1L) {
            future::plan("multisession", workers = future_workers)
        } else {
            future::plan("sequential")
        }
    }
    options(future.globals.maxSize = 6.0 * 1024^3)
}

# 内存软提醒（R 无 RLIMIT_AS 等价物，用 gc() 周期性回收）
# 重度计算脚本可手动调用 gc() 防内存碎片堆积
