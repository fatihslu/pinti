# Yönetici izni gerektirmeden PİNTİ'yi kullanıcı oturumu açıldığında başlatır.
$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'pinti-service.cmd'
$startupFolder = [Environment]::GetFolderPath('Startup')
$startupFile = Join-Path $startupFolder 'PINTI Local Collector.cmd'

if (-not (Test-Path -LiteralPath $runner)) {
    throw "Başlatıcı dosya bulunamadı: $runner"
}

$content = "@echo off`r`ncall `"$runner`"`r`n"
[System.IO.File]::WriteAllText($startupFile, $content, [System.Text.Encoding]::ASCII)
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', ('"' + $runner + '"') -WindowStyle Hidden
Write-Host "PİNTİ başlatıldı: http://localhost:3001"
