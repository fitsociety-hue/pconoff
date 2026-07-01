$days = (Get-Date).AddDays(-3).Date;
$events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,12,6005,6009,7001,7002,1074,6006,6008,42; StartTime=$days} -ErrorAction SilentlyContinue | Select-Object TimeCreated, Id;
if ($events) { $events | ConvertTo-Json -Compress } else { '[]' }
