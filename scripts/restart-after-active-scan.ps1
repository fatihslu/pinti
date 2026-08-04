param(
    [int]$Port = 3001,
    [int]$MaxWaitMinutes = 180
)

$deadline = (Get-Date).AddMinutes($MaxWaitMinutes)
while ((Get-Date) -lt $deadline) {
    try {
        $scan = (Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/api/amazon/low-prices/scan-status" -TimeoutSec 8).Content | ConvertFrom-Json
        if ($scan.status -ne 'running') {
            $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($listener) { Stop-Process -Id $listener.OwningProcess }
            exit 0
        }
    } catch {
        # Sunucu geçici olarak erişilemezse bir sonraki kontrolü bekle.
    }
    Start-Sleep -Seconds 20
}

exit 1
