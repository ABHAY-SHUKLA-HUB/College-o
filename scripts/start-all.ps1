Set-Location $PSScriptRoot

function Stop-PortProcess {
	param(
		[Parameter(Mandatory = $true)]
		[int]$Port
	)

	$connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
	if ($connections) {
		$portPids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
		foreach ($procId in $portPids) {
			try {
				Stop-Process -Id $procId -Force -ErrorAction Stop
				Write-Host "Stopped process $procId on port $Port"
			} catch {
				Write-Host "Could not stop process $procId on port $Port"
			}
		}
		Start-Sleep -Milliseconds 400
	}
}

Stop-PortProcess -Port 3000

Write-Host "Starting Node server..."
npm run dev