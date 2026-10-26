# Run from an Administrator PowerShell. Re-run after the WSL/LAN IP changes.
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Open PowerShell as Administrator and run .\setup-wifi.ps1' }
$statePath = Join-Path $PSScriptRoot 'data\mqtt-lan.json'
$ruleName = 'IceMaker2-MQTT-LAN'
$previous = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
if ($Remove) {
    if ($previous.listenAddress) {
        & netsh interface portproxy delete v4tov4 listenaddress=$($previous.listenAddress) listenport=$($previous.port) | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not remove the saved forwarding entry.' }
    }
    Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    Write-Output 'IceMaker2 Wi-Fi forwarding removed.'
    return
}
$settings = Get-Content -LiteralPath (Join-Path $PSScriptRoot '.env')
$hostLine = $settings | Where-Object { $_ -match '^MQTT_ADVERTISED_HOST=' } | Select-Object -First 1
$portLine = $settings | Where-Object { $_ -match '^MQTT_PORT=' } | Select-Object -First 1
$lanAddress = ($hostLine -replace '^MQTT_ADVERTISED_HOST=', '').Trim()
$portText = ($portLine -replace '^MQTT_PORT=', '').Trim()
$parsedAddress = $null
if (-not [Net.IPAddress]::TryParse($lanAddress, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Set MQTT_ADVERTISED_HOST to this PC''s LAN IPv4 address in .env.' }
if ($portText -notmatch '^\d+$' -or [int]$portText -lt 1 -or [int]$portText -gt 65535) { throw 'Invalid MQTT_PORT in .env.' }
$mqttPort = [int]$portText
$localAddress = Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $lanAddress
if (-not $localAddress) { throw 'MQTT_ADVERTISED_HOST does not belong to this computer.' }
$wslOutput = & wsl -d Ubuntu -- hostname -I
if ($LASTEXITCODE -ne 0 -or -not $wslOutput) { throw 'Could not read the Ubuntu WSL address. Start the project first.' }
$wslAddress = ($wslOutput.Trim() -split '\s+')[0]
$parsedWsl = $null
if (-not [Net.IPAddress]::TryParse($wslAddress, [ref]$parsedWsl)) { throw 'Invalid WSL address.' }
$entries = (& netsh interface portproxy show v4tov4) -join "`n"
$listenExists = $entries -match ('(?m)^\s*' + [regex]::Escape($lanAddress) + '\s+' + $mqttPort + '\s+')
if ($listenExists -and ($previous.listenAddress -ne $lanAddress -or $previous.port -ne $mqttPort)) { throw 'An existing forwarding rule owns this endpoint. It was left unchanged.' }
if ($previous.listenAddress -and ($previous.listenAddress -ne $lanAddress -or $previous.port -ne $mqttPort)) {
    & netsh interface portproxy delete v4tov4 listenaddress=$($previous.listenAddress) listenport=$($previous.port) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove the old project forwarding entry.' }
}
& netsh interface portproxy add v4tov4 listenaddress=$lanAddress listenport=$mqttPort connectaddress=$wslAddress connectport=$mqttPort | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not configure MQTT forwarding.' }
Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name $ruleName -DisplayName 'IceMaker2 MQTT from private local network' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $mqttPort -LocalAddress $lanAddress -RemoteAddress LocalSubnet -Profile Private | Out-Null
New-Item -ItemType Directory -Path (Split-Path $statePath) -Force | Out-Null
@{ listenAddress = $lanAddress; port = $mqttPort; wslAddress = $wslAddress } | ConvertTo-Json | Set-Content -LiteralPath $statePath
Write-Output "MQTT Wi-Fi endpoint: ${lanAddress}:$mqttPort (private local network only)"
