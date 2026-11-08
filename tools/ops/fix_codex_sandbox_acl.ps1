param(
    [Parameter(Mandatory = $true)]
    [string[]]$Paths
)

$ErrorActionPreference = 'Stop'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

foreach ($path in $Paths) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        Write-Output "skip=$path reason=not_found"
        continue
    }

    takeown /F $path /A /D Y | Out-Null
    icacls $path /grant "${user}:F" | Out-Null
    Write-Output "fixed=$path user=$user"
}

Write-Output "acl_fix_completed=1"
