param(
  [string]$Distro = 'Ubuntu',
  [string]$ProjectPath = '/home/chamber/projects/emperors-occulus'
)
$ErrorActionPreference = 'Stop'
if ($ProjectPath -notmatch '^/[a-zA-Z0-9_./-]+$' -or $Distro -notmatch '^[a-zA-Z0-9_.-]+$') { throw 'Caminho ou distribuição inválidos.' }
$installDir = Join-Path $env:LOCALAPPDATA 'EmperorsOcculus'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$launcher = Join-Path $installDir 'launch.vbs'
$windowsScript = Join-Path $installDir 'launch-windows.ps1'
$scriptSource = "\\wsl.localhost\$Distro$($ProjectPath.Replace('/', '\'))\scripts\launch-windows.ps1"
Copy-Item -LiteralPath $scriptSource -Destination $windowsScript -Force
$command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $windowsScript + '" -Distro "' + $Distro + '" -ProjectPath "' + $ProjectPath + '"'
$escapedCommand = $command.Replace('"', '""')
$vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "$escapedCommand", 0, False
"@
Set-Content -Path $launcher -Value $vbs -Encoding Unicode
$iconSource = "\\wsl.localhost\$Distro$($ProjectPath.Replace('/', '\'))\occulus\static\icon.ico"
$icon = Join-Path $installDir 'icon.ico'
Copy-Item -LiteralPath $iconSource -Destination $icon -Force
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $desktop "Emperor's Occulus.lnk"))
$link.TargetPath = "$env:WINDIR\System32\wscript.exe"
$link.Arguments = '"' + $launcher + '"'
$link.IconLocation = $icon
$link.Description = 'Consultar análises da Phytobloom — somente leitura, imagens em memória'
$link.Save()
Write-Host "Atalho criado em: $desktop"
