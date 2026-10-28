param(
  [Parameter(Mandatory = $true)]
  [int]$Port,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedPattern,
  [string]$ConnectionsJson,
  [string]$ProcessesJson
)

$ErrorActionPreference = 'Stop'

function Read-FixtureArray([string]$Json, [string]$Name) {
  if ($null -eq $Json) { return $null }
  $parsed = $Json | ConvertFrom-Json
  if ($null -eq $parsed) { return @() }
  if ($parsed -isnot [System.Array]) { $parsed = @($parsed) }
  return @($parsed)
}

try {
  $hasConnectionFixture = $PSBoundParameters.ContainsKey('ConnectionsJson')
  $hasProcessFixture = $PSBoundParameters.ContainsKey('ProcessesJson')
  $connections = if ($hasConnectionFixture) {
    Read-FixtureArray $ConnectionsJson 'ConnectionsJson'
  } else {
    @(Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue)
  }

  if ($connections.Count -eq 0) {
    [pscustomobject]@{
      port = $Port
      status = 'free'
      safe_to_stop = $true
      owners = @()
    } | ConvertTo-Json -Depth 5 -Compress
    exit 0
  }

  $ownerPids = @($connections | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
  $processes = if ($hasProcessFixture) {
    Read-FixtureArray $ProcessesJson 'ProcessesJson'
  } else {
    $items = foreach ($ownerPid in $ownerPids) {
      Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction SilentlyContinue |
        Select-Object ProcessId, Name, CommandLine
    }
    @($items)
  }
  $processById = @{}
  foreach ($process in $processes) {
    if ($null -ne $process.ProcessId) {
      $processById[[int]$process.ProcessId] = $process
    }
  }

  $owners = foreach ($ownerPid in $ownerPids) {
    $process = $processById[$ownerPid]
    $name = if ($process) { [string]$process.Name } else { 'unknown' }
    $commandLine = if ($process) { [string]$process.CommandLine } else { '' }
    $states = @(
      $connections |
        Where-Object { [int]$_.OwningProcess -eq $ownerPid } |
        ForEach-Object { [string]$_.State } |
        Sort-Object -Unique
    )
    $matchesExpected = $false
    if ($commandLine) {
      $matchesExpected = [bool]($commandLine -match $ExpectedPattern)
    } elseif ($name) {
      $matchesExpected = [bool]($name -match $ExpectedPattern)
    }
    [pscustomobject]@{
      pid = $ownerPid
      process_name = $name
      states = $states
      matches_expected = $matchesExpected
    }
  }

  # System Idle Process (pid 0) shows up on TIME_WAIT sockets; it never owns
  # a live listener, so exclude it from the foreign verdict.
  $realOwners = @($owners | Where-Object { $_.pid -gt 0 })
  $allExpected = @($realOwners).Count -gt 0 -and @($realOwners | Where-Object { -not $_.matches_expected }).Count -eq 0
  $status = if ($allExpected) { 'expected' } else { 'foreign' }
  [pscustomobject]@{
    port = $Port
    status = $status
    safe_to_stop = $allExpected
    owners = @($owners)
  } | ConvertTo-Json -Depth 5 -Compress
  if ($allExpected) { exit 10 }
  exit 20
} catch {
  [pscustomobject]@{
    port = $Port
    status = 'error'
    safe_to_stop = $false
    error = $_.Exception.Message
    owners = @()
  } | ConvertTo-Json -Depth 5 -Compress
  exit 2
}
