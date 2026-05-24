$ErrorActionPreference = 'Stop'
$base = $env:API_PUBLIC_URL
if (-not $base) { $base = 'https://college-o.onrender.com' }
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$password = 'StrongPass!1234'

function Invoke-Api {
  param([string]$Method,[string]$Url,[Microsoft.PowerShell.Commands.WebRequestSession]$Session,$Body=$null)
  $requestParams = @{ Method=$Method; Uri=$Url; ErrorAction='Stop'; TimeoutSec=30 }
  if ($null -ne $Session) { $requestParams.WebSession = $Session }
  if ($null -ne $Body) { $requestParams.ContentType='application/json'; $requestParams.Body=($Body | ConvertTo-Json -Depth 20) }
  try {
    $resp = Invoke-WebRequest @requestParams
    $data = $null
    if ($null -ne $resp.Content -and '' -ne $resp.Content) { try { $data = $resp.Content | ConvertFrom-Json -Depth 20 } catch { $data = $resp.Content } }
    return @{ ok=$true; status=[int]$resp.StatusCode; data=$data; raw=$resp.Content }
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $raw = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    return @{ ok=$false; status=$status; data=$null; raw=$raw }
  }
}

function Get-CaptchaChallenge($Session) {
  $r = Invoke-Api -Method 'GET' -Url "$base/api/auth/captcha/challenge" -Session $Session
  if(-not $r.ok){throw "captcha failed $($r.raw)"}
  return $r.data.captcha
}

function Register-SmokeTestUser($Session,$Email,$Name,$College) {
  $c1 = Get-CaptchaChallenge -Session $Session
  $r1 = Invoke-Api -Method 'POST' -Url "$base/api/auth/verification/request" -Session $Session -Body @{
    channel='email'; purpose='signup'; target=$Email;
    captcha=@{a=$c1.a;b=$c1.b;answer=([int]$c1.a+[int]$c1.b);expiresAt=$c1.expiresAt;nonce=$c1.nonce;signature=$c1.signature}
  }
  if(-not $r1.ok){throw "otp req failed: $($r1.status) $($r1.raw)"}
  $r2 = Invoke-Api -Method 'POST' -Url "$base/api/auth/qa/otp-assist" -Session $Session -Body @{secret='qa-secret';channel='email';purpose='signup';target=$Email}
  if(-not $r2.ok){throw "qa assist failed: $($r2.status) $($r2.raw)"}
  $c2 = Get-CaptchaChallenge -Session $Session
  $r3 = Invoke-Api -Method 'POST' -Url "$base/api/auth/signup" -Session $Session -Body @{
    fullName=$Name; email=$Email; password=$password; verificationMethod='email'; verificationToken=$r2.data.verificationToken;
    universityName=$College; customUniversity=$College;
    captcha=@{a=$c2.a;b=$c2.b;answer=([int]$c2.a+[int]$c2.b);expiresAt=$c2.expiresAt;nonce=$c2.nonce;signature=$c2.signature}
  }
  if(-not $r3.ok){throw "signup failed: $($r3.status) $($r3.raw)"}
  return $r3.data.user
}

$r = [ordered]@{ restOk=$false; realtimeOk=$false; notes=@() }
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession

try {
  Register-SmokeTestUser -Session $s -Email "qa.notify.$ts@example.com" -Name 'QA Notify User' -College 'QA Notify College' | Out-Null
  $mine = Invoke-Api -Method 'GET' -Url "$base/api/notifications/mine" -Session $s
  $unread = Invoke-Api -Method 'GET' -Url "$base/api/notifications/unread-count" -Session $s
  $r.notes += "mine status=$($mine.status) count=$($mine.data.notifications.Count)"
  $r.notes += "unread status=$($unread.status) unread=$($unread.data.unreadCount)"
  if($mine.ok -and $unread.ok){$r.restOk=$true}

  $cookieHeader = (($s.Cookies.GetCookies($base) | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; ')
  $streamFile = Join-Path $env:TEMP "notify_stream_${ts}.txt"
  if(Test-Path $streamFile){Remove-Item $streamFile -Force}

  $proc = Start-Process -FilePath 'curl.exe' -ArgumentList @('-sN','--max-time','8','-H',"Cookie: $cookieHeader","$base/api/notifications/stream") -RedirectStandardOutput $streamFile -NoNewWindow -PassThru
  Start-Sleep -Milliseconds 1200
  $readAll = Invoke-Api -Method 'PUT' -Url "$base/api/notifications/mine/read-all" -Session $s
  $r.notes += "read-all status=$($readAll.status) ok=$($readAll.ok)"
  try { Wait-Process -Id $proc.Id -Timeout 12 } catch { $r.notes += 'stream process ended or timed out before wait completed' }
  $content = if(Test-Path $streamFile){ Get-Content $streamFile -Raw } else { '' }
  if($content -match 'event:\s*notification_changed'){ $r.realtimeOk=$true }
  $r.notes += "stream bytes=$($content.Length)"
} catch {
  $r.notes += $_.Exception.Message
}

$r | ConvertTo-Json -Depth 10
