param(
  [string]$OutFile = 'D:\00.AIagent\codespace\AI辅助生信分析流程工作台\.tmp\bioworkbench-foreground.png'
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$sig = @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
'@
$type = Add-Type -MemberDefinition $sig -Name Win32Foreground -Namespace Bioworkbench -PassThru

$procs = Get-Process BioanalysWorkbench -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if (-not $procs) {
  Write-Output 'no BioanalysWorkbench window with MainWindowHandle found'
  exit 1
}

$target = $procs | Select-Object -First 1
$null = $type::ShowWindow($target.MainWindowHandle, 9)
$null = $type::SetForegroundWindow($target.MainWindowHandle)
Start-Sleep -Milliseconds 1200

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$graphics.Dispose()

New-Item -ItemType Directory -Force -Path (Split-Path $OutFile -Parent) | Out-Null
$bitmap.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
Write-Output "saved: $OutFile"
