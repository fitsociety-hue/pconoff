$days = (Get-Date).AddDays(-2).Date;
$events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,12,6005,6009,7001,7002,1074,6006,6008,42; StartTime=$days} -ErrorAction SilentlyContinue | Where-Object { 
    $_.TimeCreated -ne $null -and 
    ($_.Id -ne 1 -or $_.ProviderName -eq 'Microsoft-Windows-Power-Troubleshooter') 
}
if ($events) {
    $events | Select-Object Id, ProviderName, @{Name='Time';Expression={$_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')}} | ConvertTo-Json -Compress
} else {
    '[]'
}
