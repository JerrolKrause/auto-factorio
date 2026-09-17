# Open an independent interactive console; -Preview makes no process changes.
[CmdletBinding()]
param(
    [ValidatePattern('^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$')]
    [string]$SessionId,
    [ValidatePattern('^gpt-[a-z0-9.-]+$')]
    [string]$Model,
    [ValidateSet('low', 'medium', 'high', 'xhigh', 'max')]
    [string]$Effort,
    [string]$PromptFile,
    [switch]$Preview
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$codexCommand = Get-Command codex.exe -CommandType Application -ErrorAction Stop
$shellPath = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $shellPath)) {
    $shellPath = Join-Path $PSHOME 'pwsh.exe'
}
if (-not (Test-Path -LiteralPath $shellPath)) { throw 'PowerShell executable not found.' }

# Encode the child command so spaces/apostrophes in paths never become shell syntax.
$quotedRoot = "'" + $projectRoot.Replace("'", "''") + "'"
$quotedCodex = "'" + $codexCommand.Source.Replace("'", "''") + "'"
$quotedPrompt = if ($PromptFile) {
    $resolvedPrompt = (Resolve-Path -LiteralPath $PromptFile).Path
    "'" + (Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedPrompt).Replace("'", "''") + "'"
} else { $null }
$modelArguments = if ($Model) { "--model '$Model'" } else { '' }
$effortArguments = if ($Effort) { "--config 'model_reasoning_effort=`"$Effort`"'" } else { '' }
$promptArgument = if ($quotedPrompt) { $quotedPrompt } else { '' }
$resumeArguments = if ($SessionId) { "resume '$SessionId' --no-alt-screen" } else { "--no-alt-screen $modelArguments $effortArguments $promptArgument" }
$childCommand = @"
Set-Location -LiteralPath $quotedRoot
& $quotedCodex $resumeArguments
"@
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCommand))
$launchArguments = @('-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', $encodedCommand)

if ($Preview) {
    [pscustomobject]@{
        Shell = $shellPath
        WorkingDirectory = $projectRoot
        SessionId = $SessionId
        Model = $Model
        Effort = $Effort
        PromptFile = $PromptFile
        Command = $childCommand
        Arguments = $launchArguments
    } | ConvertTo-Json -Depth 3
    return
}

# Explicitly invoked by the user to open an interactive window. Never stop sessions here.
Start-Process -FilePath $shellPath -ArgumentList $launchArguments `
    -WorkingDirectory $projectRoot -WindowStyle Normal | Out-Null
