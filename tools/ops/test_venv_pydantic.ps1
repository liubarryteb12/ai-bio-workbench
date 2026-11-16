$py = (Resolve-Path 'vendor\python-win32\pythoncore-3.15-64\python.exe').Path
$testVenv = Join-Path $env:TEMP 'bio-venv-test'
Remove-Item -LiteralPath $testVenv -Recurse -Force -ErrorAction SilentlyContinue

& $py -m venv $testVenv 2>&1 | Select-Object -First 3 | ForEach-Object { Write-Output "venv-create: $_" }
$venvPython = Join-Path $testVenv 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
  Write-Output 'venv python missing'
  exit 1
}

& $venvPython -m pip install --quiet --disable-pip-version-check -i https://pypi.tuna.tsinghua.edu.cn/simple pydantic 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Output "pip: $_" }
& $venvPython -c "import pydantic; print('pydantic', pydantic.__version__)"
