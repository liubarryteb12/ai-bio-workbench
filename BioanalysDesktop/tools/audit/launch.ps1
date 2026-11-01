$ErrorActionPreference='Stop'
$app='D:\00.AIagent\codespace\AI辅助生信分析流程工作台\BioanalysDesktop'
Start-Process -FilePath (Get-Command node).Source -ArgumentList @('tools/audit/run-suite.mjs','tools/audit/baseline-02.log','tools/audit/baseline-02.code') -WorkingDirectory $app -WindowStyle Hidden
Write-Output 'launched'
