param(
  [string]$Installer = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'desktop\release\BioanalysWorkbench-Setup-0.1.0.exe'),
  [string]$OutFile = 'D:\00.AIagent\codespace\AI辅助生信分析流程工作台\.tmp\installer-wizard.png'
)

Add-Type -AssemblyName System.Drawing

$sig = @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
$null = Add-Type -MemberDefinition $sig -Name Win32Rect -Namespace Bioworkbench
$type = [Bioworkbench.Win32Rect]

$process = Start-Process -FilePath $Installer -PassThru
Start-Sleep -Seconds 6
$process.Refresh()

if ($process.HasExited) {
  Write-Output "installer exited early, code=$($process.ExitCode)"
  exit 1
}

$null = $type::SetForegroundWindow($process.MainWindowHandle)
Start-Sleep -Milliseconds 800

$rect = New-Object Bioworkbench.Win32Rect+RECT
$null = $type::GetWindowRect($process.MainWindowHandle, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
Write-Output "window rect: left=$($rect.Left) top=$($rect.Top) width=$width height=$height title=$($process.MainWindowTitle)"

if ($width -le 0 -or $height -le 0) {
  Write-Output 'invalid window rect, abort capture'
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  exit 1
}

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
$graphics.Dispose()

New-Item -ItemType Directory -Force -Path (Split-Path $OutFile -Parent) | Out-Null
$bitmap.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
Write-Output "saved: $OutFile"

Get-Process -Id $process.Id -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output 'installer probe closed'
