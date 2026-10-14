param(
  [string]$Distro = 'Ubuntu',
  [string]$ProjectPath = '/home/chamber/projects/emperors-occulus',
  [switch]$Local
)
$ErrorActionPreference = 'Stop'
if (-not $Local) {
  Start-Process 'https://emperors-occulus.copperbowl512.chatgpt.site'
  exit 0
}
if ($ProjectPath -notmatch '^/[a-zA-Z0-9_./-]+$' -or $Distro -notmatch '^[a-zA-Z0-9_.-]+$') { throw 'Caminho ou distribuição inválidos.' }
& wsl.exe -d $Distro -- bash "$ProjectPath/scripts/launch.sh"
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível iniciar o serviço no WSL.' }
$candidates = @('http://127.0.0.1:8765')
$addresses = ((& wsl.exe -d $Distro -- hostname -I) -join ' ').Trim() -split '\s+'
foreach ($address in $addresses) {
  if ($address -match '^\d{1,3}(\.\d{1,3}){3}$') {
    $candidates += "http://${address}:8765"
  }
}
foreach ($url in $candidates) {
  try {
    $health = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 3
    if ($health.app -eq 'emperors-occulus') {
      Start-Process $url
      exit 0
    }
  } catch { }
}
Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show('O serviço iniciou, mas o Windows não conseguiu alcançá-lo. Confira a rede do WSL e o firewall.', "Emperor's Occulus") | Out-Null
exit 1
