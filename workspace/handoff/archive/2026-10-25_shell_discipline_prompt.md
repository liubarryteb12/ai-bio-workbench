# Windows 壳层纪律提示词（PowerShell 7）

> 用途：贴给任何在本工作区干活的 AI agent 或员工，作为命令书写的强制约定。
> 三条纪律来自 2026-10-25 实测：同一难度的活，违反时三次失败，遵守后一次通过。
> 本文件是提示词，可整段复制使用。

## 提示词正文（复制这一段）

在本工作区执行命令，遵守以下三条。违反任意一条导致命令失败，责任在书写方式不在环境。

**第一条：多行代码与长字符串落盘成文件再执行。**

超过二十行的内容，一律先写成 `.cjs` / `.ps1` / `.md` / `.json` 文件，再用 `node 文件`、
`pwsh -File 文件` 执行。禁止把长代码塞进 `node -e "..."` 这类单行参数。

判据：命令行里出现 `${...}`、`$_`、`$env:`、反引号、嵌套花括号中的任意一种，即改为落盘。
PowerShell 的双引号会先做变量展开，这些字符会被提前吃掉，传到目标程序时已是残串。

**第二条：here-string 包裹字面量。**

需要把一大段原文义不变地交给某个程序时，用 PowerShell here-string：

```powershell
$code = @'
这里的 $变量、${花括号}、反引号 ` 全部原样保留，PowerShell 不展开
'@
```

约束：开定界符 `@'` 与闭定界符 `'@` 必须各自单独占一行，`'@` 顶格写。
单引号定界（`@'`）不做任何展开，双引号定界（`@"`）仍会展开变量。

**第三条：短字符串默认单引号。**

只有确定要展开变量时才用双引号。只含路径、纯文本、JSON 片段的字符串一律单引号。

## 三条反模式（见到即改）

| 反模式 | 后果 | 改为 |
|---|---|---|
| `node -e "含 ${} 的长脚本"` | 变量被 PowerShell 展开，语法错误或静默出错 | 写成 `.cjs` 再 `node 文件` |
| `node -e "反引号包裹的 JS"` | 反引号在 PowerShell 是转义符，两层语义相撞 | 同上 |
| `WriteAllText($path, "$(...)")` | 展开时机与预期不符 | here-string 或单引号 |

## 一次真实对照（2026-10-25）

同一件事：把一个 JSON schema 写进工作区。

失败姿势（`node -e` 加双引号）：

```powershell
node -e "const s='...${...}...'; fs.writeFileSync(p,s)"
// 报错：Invalid string escape / Unexpected token
```

成功姿势（here-string 落盘）：

```powershell
$sw = [IO.StreamWriter]::new('con_hf/topic_survey/request_schema.json', $false, [Text.UTF8Encoding]::new($false))
$sw.Write(@'
{ "fields": [...] }
'@)
$sw.Close()
// 一次通过，零转义
```

## 本机已具备的条件

- PowerShell 7.6.5 Core 已在 PATH 中且排在 5.1 之前，无需再升级。
- Git 装在 `D:\Git`，bash 位于 `D:\Git\bin\bash.exe`，加入 PATH 后可用 `bash -n` 校验 shell 母版语法。
- 未安装 WSL，且按 `AGENTS.md` 双平面铁律不安装：PC 严禁跑计算，算力面只有 k40-ubuntu。
