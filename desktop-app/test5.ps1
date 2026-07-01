$events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,12,6005,6009,7001,7002,1074,6006,6008,42} -ErrorAction SilentlyContinue | Where-Object { $_.TimeCreated -gt (Get-Date "2026-06-30 17:00:00") -and $_.TimeCreated -lt (Get-Date "2026-07-01 18:00:00") }
if ($events) {
    $events | Select-Object Id, ProviderName, @{Name="Time";Expression={$_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')}} | ConvertTo-Json -Compress
} else {
    '[]'
}
