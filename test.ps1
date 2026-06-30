$events = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1074,6006,6008,42} -MaxEvents 5 -ErrorAction SilentlyContinue; if ($events) { $events | Select-Object TimeCreated, Id }
