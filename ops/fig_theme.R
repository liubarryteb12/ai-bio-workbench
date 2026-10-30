# 出图主题层 · R 侧（仅 base R par；ggplot 走 SCI 模板，见 #192）
#
# 为什么只剩 bioanalys_par：
#   ggplot 图件的字号/spines/网格/图例规则**已经由 SCI 模板实现**——
#   bin/layout_helper.R 在 ggsave 挂载点后套 theme_classic() 完整主题，
#   并自设 axis.title=7 / axis.text=6.5 / legend=6.5 / plot.title=blank。
#   在同一个挂载点再垫一层主题会被整体重置
#   （2026-10-19 实测：主题开/关图件 md5 完全一致），所以 R ggplot 侧不建主题层（踩坑 #192）。
#
#   真正没被覆盖的是 base R `png()` 设备出的图（line1 的 l1_28~l1_31 来自 wgcna_modules）：
#   既不走 ggsave 也没有统一 par。母版脚本里显式调用（exists 守卫，没挂也不报错）：
#     if (exists("bioanalys_par", mode = "function")) bioanalys_par()
#
# 纪律：只在 BIOANALYS_PROJECT_JSON 存在时介入；BIOANALYS_LAYOUT_DISABLE=1 退出；
# 幂等；任何异常只 warning，不中断出图。

if (!nzchar(Sys.getenv("BIOANALYS_PROJECT_JSON", ""))) return(invisible(NULL))
if (identical(Sys.getenv("BIOANALYS_LAYOUT_DISABLE", ""), "1")) return(invisible(NULL))

# base R（png() 设备）图：默认 12 pt，cex=0.58 约 7 pt；单图标题留空
bioanalys_par <- function(...) {
  graphics::par(cex.axis = 0.58, cex.lab = 0.58, cex.main = 0, ...)
}

message("[fig_theme] base R par 已定义（由母版脚本显式调用 bioanalys_par()）")
invisible(NULL)
