$ErrorActionPreference = 'Stop'

$baseUrl = $env:API_PUBLIC_URL
if (-not $baseUrl) { $baseUrl = 'https://college-o.onrender.com' }

$result = [ordered]@{
  authMeStatus = 0
  streamStatus = 0
  notes = @()
}

try {
  $meResponse = Invoke-WebRequest -Uri "$baseUrl/api/auth/me" -Method GET -TimeoutSec 10 -ErrorAction Stop
  $result.authMeStatus = [int]$meResponse.StatusCode
  $result.notes += 'auth/me reachable'
} catch {
  if ($_.Exception.Response) {
    $result.authMeStatus = [int]$_.Exception.Response.StatusCode
  }
  $result.notes += 'auth/me requires session (expected when not logged in)'
}

try {
  $streamResponse = Invoke-WebRequest -Uri "$baseUrl/api/notifications/stream" -Method GET -TimeoutSec 5 -ErrorAction Stop
  $result.streamStatus = [int]$streamResponse.StatusCode
} catch {
  if ($_.Exception.Response) {
    $result.streamStatus = [int]$_.Exception.Response.StatusCode
  }
}

$result | ConvertTo-Json -Depth 10
