param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
(Get-Item -LiteralPath $Executable).VersionInfo.ProductVersion
