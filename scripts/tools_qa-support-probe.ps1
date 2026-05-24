$ErrorActionPreference = 'Stop'

$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$baseUrl = $env:API_PUBLIC_URL
if (-not $baseUrl) { $baseUrl = 'https://college-o.onrender.com' }

$c = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/auth/captcha/challenge" -WebSession $s

$body = @{
  email = 'qa.student1@collegeos.test'
  password = 'QaPass#123'
  captcha = @{
    answer = ([int]$c.captcha.a + [int]$c.captcha.b)
    a = $c.captcha.a
    b = $c.captcha.b
    expiresAt = $c.captcha.expiresAt
    nonce = $c.captcha.nonce
    signature = $c.captcha.signature
  }
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/login" -WebSession $s -ContentType 'application/json' -Body $body | Out-Null

$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  Invoke-RestMethod -Method Get -Uri "$baseUrl/api/support/requests?limit=1" -WebSession $s -TimeoutSec 30 | Out-Null
  Write-Output ('requests_ok_ms=' + $sw.ElapsedMilliseconds)
} catch {
  Write-Output ('requests_error_ms=' + $sw.ElapsedMilliseconds)
  Write-Output $_.Exception.Message
}
