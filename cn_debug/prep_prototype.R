#!/usr/bin/env Rscript
# 原型：验证 series matrix + GPL 解析逻辑，输出到 /tmp，不碰正式数据面
library(data.table)

raw <- "/mnt/ssd/bio_data/line1_bulk/raw_data"
sm <- file.path(raw, "GSE277173_series_matrix.txt.gz")
gpl <- file.path(raw, "GPL11532-32230.txt")

lines <- readLines(gzfile(sm))
begin <- grep("^!series_matrix_table_begin$", lines)
end <- grep("^!series_matrix_table_end$", lines)
cat("begin_line=", begin, " end_line=", end, " data_rows=", end - begin - 1, "\n")

col_names <- strsplit(gsub('"', '', lines[begin + 1]), "\t")[[1]]
cat("ncol=", length(col_names), " first=", col_names[1], " last=", col_names[length(col_names)], "\n")

data_lines <- lines[(begin + 2):(end - 1)]
expr <- fread(text = paste(c(paste(col_names, collapse = "\t"), data_lines), collapse = "\n"), sep = "\t")
cat("expr dim=", dim(expr), "\n")

# 元数据行：title 与 characteristics
title_line <- lines[grep("^!Sample_title", lines)]
title_vals <- strsplit(gsub('"', '', title_line), "\t")[[1]][-1]
cat("titles=", paste(title_vals, collapse = ","), "\n")

char_line <- lines[grep("^!Sample_characteristics_ch1", lines)]
char_vals <- strsplit(gsub('"', '', char_line), "\t")[[1]][-1]
cat("chars=", paste(char_vals, collapse = " | "), "\n")

# GPL 注释
gpl_dt <- fread(gpl, sep = "\t", select = c("ID", "gene_assignment"), nThread = 1)
cat("gpl rows=", nrow(gpl_dt), " cols=", paste(names(gpl_dt), collapse = ","), "\n")

extract_symbol <- function(ga) {
  if (is.na(ga) || ga == "" || ga == "---") return(NA_character_)
  entries <- strsplit(ga, " /// ", fixed = TRUE)[[1]]
  first <- strsplit(entries[1], " // ", fixed = TRUE)[[1]]
  if (length(first) >= 2) first[2] else NA_character_
}
count_entries <- function(ga) {
  if (is.na(ga) || ga == "" || ga == "---") return(0L)
  length(strsplit(ga, " /// ", fixed = TRUE)[[1]])
}

gpl_dt[, gene := vapply(gene_assignment, extract_symbol, character(1))]
gpl_dt[, n_entries := vapply(gene_assignment, count_entries, integer(1))]
cat("annotated=", sum(!is.na(gpl_dt$gene)), " unannotated=", sum(is.na(gpl_dt$gene)),
    " multi_gene_probes=", sum(gpl_dt$n_entries > 1), "\n")
cat("sample symbols=", paste(head(na.omit(gpl_dt$gene), 10), collapse = ","), "\n")

# 合并 + 同基因多探针取均值
expr_dt <- as.data.table(expr)
gene_map <- gpl_dt[, .(ID_REF = ID, gene)]
merged <- merge(expr_dt, gene_map, by = "ID_REF")
merged <- merged[!is.na(gene)]
num_cols <- setdiff(names(merged), c("ID_REF", "gene"))
agg <- merged[, lapply(.SD, mean), by = gene, .SDcols = num_cols]
cat("genes=", nrow(agg), " samples=", length(num_cols), "\n")
cat("any_na=", any(is.na(agg[, .SD, .SDcols = num_cols])), "\n")
cat("value_range=", range(unlist(agg[, .SD, .SDcols = num_cols])), "\n")

# 分组派生
groups <- ifelse(grepl("lesion", char_vals) & !grepl("peri", char_vals, ignore.case = TRUE), "LS",
          ifelse(grepl("perilesional", char_vals, ignore.case = TRUE), "NLS", NA))
cat("groups=", paste(groups, collapse = ","), " table=", paste(table(groups), collapse = "/"), "\n")
