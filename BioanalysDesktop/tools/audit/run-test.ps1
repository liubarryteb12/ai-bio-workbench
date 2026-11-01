New-Item -ItemType Directory -Force -Path "$PWD/.tmp/tmpfix" | Out-Null
$env:TMP = "$PWD\.tmp\tmpfix"
$env:TEMP = $env:TMP
$env:TMPDIR = $env:TMP
node --test --test-concurrency=1 tests/*.test.js > .tmp/f4-proper.log 2>&1
$exitCode = $LASTEXITCODE
Write-Output "EXIT_CODE=$exitCode"
