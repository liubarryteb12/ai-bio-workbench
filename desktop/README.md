# Bioanalys 工作台桌面壳

完整构建、打包、验收与排障说明见 `docs/DESKTOP_APP.md`。

快速命令：

```powershell
npm ci
npm run stage
npm run verify
npm run smoke
npm run dist
npm run verify:functions
```

形态裁定：只产出便携 zip 与 win-unpacked 目录，安装版（NSIS/portable exe）已移除。部署用 `tools\ops\deploy_bioworkbench.ps1`，说明见 `docs\DESKTOP_APP.md`。
