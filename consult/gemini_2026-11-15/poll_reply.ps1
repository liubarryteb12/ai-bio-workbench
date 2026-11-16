param(
    [int]$TimeoutSec = 240,
    [string]$UserMessageHint = '',
    [string]$Screenshot = ''
)

$ErrorActionPreference = 'Stop'
$ChromeTexts = @(
    'Gemini Hydrogen',
    'Gemini Argon',
    'Gemini 是一款 AI 工具，其回答未必正确无误。',
    '答得好',
    '答得不好',
    '分享',
    '复制',
    '更多选项',
    '听回答',
    '下一步做什么？',
    '聊天',
    '任务'
)

function Get-MainTexts {
    & adb shell uiautomator dump /sdcard/gemini_poll.xml 2>$null | Out-Null
    $raw = (& adb exec-out cat /sdcard/gemini_poll.xml) -join "`n"
    if ($raw -notmatch '<hierarchy') { return @() }
    $doc = [xml]$raw
    $texts = @()
    foreach ($node in $doc.SelectNodes('//node')) {
        $text = [string]$node.text
        if (-not $text -or $ChromeTexts -contains $text.Trim()) { continue }
        if ($node.class -eq 'android.widget.EditText') { continue }
        $b = [string]$node.bounds
        if ($b -match '\[(\d+),(\d+)\]\[(\d+),(\d+)\]') {
            $y = [int]$matches[2]
            if ($y -gt 250 -and $y -lt 2100) { $texts += $text.Trim() }
        }
    }
    return $texts
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$previous = ''
$stable = 0
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $texts = @(Get-MainTexts)
    if ($texts.Count -eq 0) { continue }
    $candidate = $texts -join "`n"
    if ($candidate -eq $previous -and $candidate.Length -gt 20) {
        $stable++
        if ($stable -ge 2) {
            if ($Screenshot) { & adb exec-out screencap -p > $Screenshot }
            Write-Output $candidate
            exit 0
        }
    } else {
        $stable = 0
    }
    $previous = $candidate
}

if ($Screenshot) { & adb exec-out screencap -p > $Screenshot }
Write-Output '(timeout: no stable reply captured)'
exit 1
