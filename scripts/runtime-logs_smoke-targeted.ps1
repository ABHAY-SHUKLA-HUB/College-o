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

$result = [ordered]@{ steps=@(); bugs=@() }
$studentA = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$studentC = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$admin = New-Object Microsoft.PowerShell.Commands.WebRequestSession

try {
  $userA = Register-SmokeTestUser -Session $studentA -Email "qa.target.a.$ts@example.com" -Name 'QA Target A' -College 'QA Alpha College'
  $result.steps += "signup A ok userId=$($userA.id)"
  $userC = Register-SmokeTestUser -Session $studentC -Email "qa.target.c.$ts@example.com" -Name 'QA Target C' -College 'QA Beta College'
  $result.steps += "signup C ok userId=$($userC.id)"

  $adminEmail = if($env:ADMIN_EMAIL){$env:ADMIN_EMAIL}else{'admin@collegeos.in'}
  $adminPass = if($env:ADMIN_PASSWORD){$env:ADMIN_PASSWORD}else{'admin1234'}
  $ca = Get-CaptchaChallenge -Session $admin
  $alog = Invoke-Api -Method 'POST' -Url "$base/api/admin/login" -Session $admin -Body @{ email=$adminEmail; password=$adminPass; captcha=@{a=$ca.a;b=$ca.b;answer=([int]$ca.a+[int]$ca.b);expiresAt=$ca.expiresAt;nonce=$ca.nonce;signature=$ca.signature} }
  if(-not $alog.ok){throw "admin login failed: $($alog.status) $($alog.raw)"}
  $result.steps += 'admin login ok'

  $post = Invoke-Api -Method 'POST' -Url "$base/api/campus-feed/posts" -Session $studentA -Body @{ title="Target Post $ts"; description='target smoke'; postType='text'; category='latest'; tags=@('smoke') }
  if(-not $post.ok){throw "post create failed: $($post.status) $($post.raw)"}
  $postId = [int]$post.data.post.id
  $result.steps += "post create ok postId=$postId"

  $ap = Invoke-Api -Method 'POST' -Url "$base/api/admin/campus-feed/posts/$postId/moderate" -Session $admin -Body @{ action='approve'; reason='target' }
  if(-not $ap.ok){throw "approve failed: $($ap.status) $($ap.raw)"}
  $result.steps += 'approve ok'

  foreach($t in @('like','share','save')) {
    $e = Invoke-Api -Method 'POST' -Url "$base/api/campus-feed/posts/$postId/engagement" -Session $studentA -Body @{ type=$t }
    $result.steps += "engagement $t status=$($e.status) ok=$($e.ok)"
    if(-not $e.ok){$result.bugs += "engagement $t failed: $($e.status) $($e.raw)"}
  }
  $cm = Invoke-Api -Method 'POST' -Url "$base/api/campus-feed/posts/$postId/comments" -Session $studentA -Body @{ body='target comment' }
  $result.steps += "comment status=$($cm.status) ok=$($cm.ok)"
  if(-not $cm.ok){$result.bugs += "comment failed: $($cm.status) $($cm.raw)"}

  $feature = Invoke-Api -Method 'POST' -Url "$base/api/admin/campus-feed/posts/$postId/feature" -Session $admin -Body @{ isFeatured=$true }
  $result.steps += "feature status=$($feature.status) ok=$($feature.ok)"
  if(-not $feature.ok){$result.bugs += "feature failed: $($feature.status) $($feature.raw)"}

  $trust = Invoke-Api -Method 'POST' -Url "$base/api/admin/campus-feed/creators/$($userA.id)/trust" -Session $admin -Body @{ trustLevel='trusted'; campusRole='campus_reporter' }
  $result.steps += "trust status=$($trust.status) ok=$($trust.ok)"
  if(-not $trust.ok){$result.bugs += "trust failed: $($trust.status) $($trust.raw)"}

  $susp = Invoke-Api -Method 'POST' -Url "$base/api/admin/campus-feed/creators/$($userA.id)/suspension" -Session $admin -Body @{ suspend=$true; reason='target'; until=(Get-Date).AddHours(1).ToString('o') }
  $result.steps += "suspend status=$($susp.status) ok=$($susp.ok)"
  if(-not $susp.ok){$result.bugs += "suspend failed: $($susp.status) $($susp.raw)"}

  foreach($pair in @(@('add',5),@('remove',2),@('bonus',3),@('fraud_correction',1))) {
    $ptype=$pair[0];$amt=[int]$pair[1]
    $pr = Invoke-Api -Method 'POST' -Url "$base/api/admin/campus-feed/creators/$($userA.id)/points" -Session $admin -Body @{ actionType=$ptype; amount=$amt; reason='target points' }
    $result.steps += "points $ptype status=$($pr.status) ok=$($pr.ok)"
    if(-not $pr.ok){$result.bugs += "points $ptype failed: $($pr.status) $($pr.raw)"}
  }

  $rp = Invoke-Api -Method 'POST' -Url "$base/api/campus-feed/posts/$postId/report" -Session $studentA -Body @{ reason='spam'; details='target report' }
  $result.steps += "report status=$($rp.status) ok=$($rp.ok)"
  if($rp.ok){
    $rid=[int]$rp.data.report.id
    $rr = Invoke-Api -Method 'POST' -Url "$base/api/admin/campus-feed/reports/$rid/resolve" -Session $admin -Body @{ action='resolved'; postAction='remove'; pointsDelta=-1 }
    $result.steps += "resolve status=$($rr.status) ok=$($rr.ok)"
    if(-not $rr.ok){$result.bugs += "resolve failed: $($rr.status) $($rr.raw)"}
  } else {
    $result.bugs += "report failed: $($rp.status) $($rp.raw)"
  }

  $feedC = Invoke-Api -Method 'GET' -Url "$base/api/campus-feed/posts?tab=latest&limit=30" -Session $studentC
  $result.steps += "feedC status=$($feedC.status) ok=$($feedC.ok)"
  if($feedC.ok -and ($feedC.data.posts | Where-Object { [int]$_.id -eq $postId })) {
    $result.bugs += 'college isolation leak: post visible to different college'
  }

  $cx = Invoke-Api -Method 'GET' -Url "$base/api/campus-feed/creator/$($userA.id)" -Session $studentC
  $result.steps += "cross creator status=$($cx.status) ok=$($cx.ok)"

  $an = Invoke-Api -Method 'GET' -Url "$base/api/admin/campus-feed/analytics" -Session $admin
  $result.steps += "analytics status=$($an.status) ok=$($an.ok)"
  if(-not $an.ok){$result.bugs += "analytics failed: $($an.status) $($an.raw)"}

} catch {
  $result.bugs += $_.Exception.Message
}

$result | ConvertTo-Json -Depth 10
