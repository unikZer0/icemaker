# Keep this terminal open: this machine's Docker engine lives inside WSL.
$ErrorActionPreference = 'Stop'
if ($PSScriptRoot -notmatch '^([a-zA-Z]):[\\/](.*)$') { throw 'Run this launcher from a local Windows drive.' }
$linuxProject = '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2].Replace('\', '/')
if ($linuxProject -notmatch '^/mnt/[a-z]/[a-zA-Z0-9_./ -]+$') { throw 'Unsupported project path; run Docker Compose directly in Ubuntu.' }
# No shell-built command or device credentials are passed on the command line.
wsl -d Ubuntu -- bash "$linuxProject/scripts/run-compose.sh"
exit $LASTEXITCODE
