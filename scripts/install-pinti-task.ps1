# PİNTİ'nin yerel sunucusunu kullanıcı oturum açtığında arka planda başlatır.
# Bu betiği proje kökünde PowerShell ile bir kez çalıştırın.
$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'pinti-service.cmd'
$taskName = 'PINTI Local Collector'

if (-not (Test-Path -LiteralPath $runner)) {
    throw "Başlatıcı dosya bulunamadı: $runner"
}

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 365)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'PİNTİ Amazon tarama ve alarm servisi' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "PİNTİ başlatıldı: http://localhost:3001"
