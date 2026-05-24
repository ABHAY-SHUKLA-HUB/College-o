$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['Invoke-RestMethod:TimeoutSec'] = 180
$PSDefaultParameterValues['Invoke-WebRequest:TimeoutSec'] = 180

$baseUrl = $env:API_PUBLIC_URL
if (-not $baseUrl) { $baseUrl = 'https://college-o.onrender.com' }

$student1 = @{ email = 'qa.student1@collegeos.test'; password = 'QaPass#123' }
$student2 = @{ email = 'qa.student2@collegeos.test'; password = 'QaPass#123' }
$helper1 = @{ email = 'qa.helper1@collegeos.test'; password = 'QaPass#123' }
$admin1 = @{ email = 'qa.admin@collegeos.test'; password = 'QaAdmin#123' }
$results = [ordered]@{}

function Add-Result {
  param(
    [string]$Flow,
    [bool]$Passed,
    [string]$Detail
  )
  $results[$Flow] = [ordered]@{ passed = $Passed; detail = $Detail }
}

function Step {
  param([string]$Message)
  Write-Output ("[STEP] " + $Message)
}

function Get-Captcha {
  param([Microsoft.PowerShell.Commands.WebRequestSession]$Session)
  $captchaResp = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/auth/captcha/challenge" -WebSession $Session
  return $captchaResp.captcha
}

function ConvertTo-PlainText {
  param([SecureString]$SecureValue)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function ConvertTo-SecureValue {
  param([string]$Text)
  $secure = New-Object System.Security.SecureString
  foreach ($ch in ($Text.ToCharArray())) {
    $secure.AppendChar($ch)
  }
  $secure.MakeReadOnly()
  return $secure
}

function Invoke-UserLogin {
  param([System.Management.Automation.PSCredential]$Credential)
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $captcha = Get-Captcha -Session $session
  $body = @{
    email = $Credential.UserName
    password = ConvertTo-PlainText -SecureValue $Credential.Password
    captcha = @{
      answer = [int]$captcha.a + [int]$captcha.b
      a = $captcha.a
      b = $captcha.b
      expiresAt = $captcha.expiresAt
      nonce = $captcha.nonce
      signature = $captcha.signature
    }
  } | ConvertTo-Json -Depth 8

  $resp = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/login" -WebSession $session -ContentType 'application/json' -Body $body
  return @{ session = $session; user = $resp.user }
}

Step 'Login student1'
$student1Cred = [System.Management.Automation.PSCredential]::new($student1.email, (ConvertTo-SecureValue -Text $student1.password))
$student1Login = Invoke-UserLogin -Credential $student1Cred
Step 'Login student2'
$student2Cred = [System.Management.Automation.PSCredential]::new($student2.email, (ConvertTo-SecureValue -Text $student2.password))
$student2Login = Invoke-UserLogin -Credential $student2Cred
Step 'Login helper1'
$helperCred = [System.Management.Automation.PSCredential]::new($helper1.email, (ConvertTo-SecureValue -Text $helper1.password))
$helperLogin = Invoke-UserLogin -Credential $helperCred
Step 'Login admin'
$adminCred = [System.Management.Automation.PSCredential]::new($admin1.email, (ConvertTo-SecureValue -Text $admin1.password))
$adminLogin = Invoke-UserLogin -Credential $adminCred

$student1Session = $student1Login.session
$student2Session = $student2Login.session
$helperSession = $helperLogin.session
$adminSession = $adminLogin.session

# Flow 1: Student support request creation
Step 'Flow 1 create request'
$request1Body = @{
  title = "QA Request 1 $(Get-Date -Format 'yyyyMMddHHmmss')"
  description = 'Need help with runtime smoke test setup for support hub and governance validation.'
  request_category = 'Technical Doubt'
  subject = 'Node Runtime'
  urgency_level = 'high'
  tags = @('runtime','qa')
} | ConvertTo-Json -Depth 8

$request1 = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/create-request" -WebSession $student1Session -ContentType 'application/json' -Body $request1Body
$request1Id = $request1.request.id
Add-Result -Flow '1_student_request_creation' -Passed ($request1.success -eq $true -and $request1Id) -Detail "requestId=$request1Id"

# Seed cross-branch request from student2 for isolation checks
$request2Body = @{
  title = "QA Branch-2 Request $(Get-Date -Format 'yyyyMMddHHmmss')"
  description = 'Isolation check request in different branch.'
  request_category = 'General Help'
  subject = 'Isolation'
  urgency_level = 'medium'
} | ConvertTo-Json -Depth 8
$request2 = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/create-request" -WebSession $student2Session -ContentType 'application/json' -Body $request2Body
$request2Id = $request2.request.id

# Flow 2: Listing with strict isolation
Step 'Flow 2 listing isolation'
$list1 = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/support/requests?limit=50" -WebSession $student1Session
$ids1 = @($list1.requests | ForEach-Object { $_.id })
$isolationPass = -not ($ids1 -contains $request2Id) -and ($ids1 -contains $request1Id)
Add-Result -Flow '2_listing_isolation' -Passed $isolationPass -Detail "student1HasOwn=$($ids1 -contains $request1Id); student1SeesBranch2=$($ids1 -contains $request2Id)"

# Flow 3: Request detail page/API
Step 'Flow 3 request detail'
$detail1 = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/support/request/$request1Id" -WebSession $student1Session
$detailPass = $detail1.success -eq $true -and $detail1.request.id -eq $request1Id
Add-Result -Flow '3_request_detail' -Passed $detailPass -Detail "answers=$($detail1.answers.Count)"

# Flow 4: Threaded answers
Step 'Flow 4 threaded answer'
$answerBody = @{
  content = 'This is a helper answer for QA smoke validation. Please verify end-to-end acceptance and vote behavior.'
  explanation_detail = 'Step-by-step solution for testing acceptance flow and moderation state transitions.'
} | ConvertTo-Json -Depth 8
$answerResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/answer/$request1Id" -WebSession $helperSession -ContentType 'application/json' -Body $answerBody
$answerId = $answerResp.answer.id
Add-Result -Flow '4_threaded_answers' -Passed ($answerResp.success -eq $true -and $answerId) -Detail "answerId=$answerId"

# Flow 5: Voting
Step 'Flow 5 voting'
$voteBody = @{ vote_type = 'helpful' } | ConvertTo-Json
$voteResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/answer/$answerId/vote" -WebSession $student1Session -ContentType 'application/json' -Body $voteBody
Add-Result -Flow '5_voting' -Passed ($voteResp.success -eq $true) -Detail ($voteResp.message)

# Flow 6: Accepted answer flow
Step 'Flow 6 accept answer'
$acceptResp = Invoke-RestMethod -Method Put -Uri "$baseUrl/api/support/answer/$answerId/accept" -WebSession $student1Session
Add-Result -Flow '6_accepted_answer' -Passed ($acceptResp.success -eq $true) -Detail "pointsAwarded=$($acceptResp.points_awarded)"

# Flow 7: Solved status flow
Step 'Flow 7 solved flow'
$request3Body = @{
  title = "QA Solve Flow $(Get-Date -Format 'yyyyMMddHHmmss')"
  description = 'Request used for direct mark-solved flow validation.'
  request_category = 'General Help'
  subject = 'Solved API'
  urgency_level = 'low'
} | ConvertTo-Json -Depth 8
$request3 = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/create-request" -WebSession $student1Session -ContentType 'application/json' -Body $request3Body
$request3Id = $request3.request.id
$solvedResp = Invoke-RestMethod -Method Put -Uri "$baseUrl/api/support/request/$request3Id/mark-solved" -WebSession $student1Session
Add-Result -Flow '7_solved_status' -Passed ($solvedResp.success -eq $true) -Detail ($solvedResp.message)

# Flow 8: Attachment upload validation
Step 'Flow 8 upload validation'
$validFile = Join-Path $PWD 'tools\\qa-valid-upload.txt'
$invalidFile = Join-Path $PWD 'tools\\qa-invalid-upload.exe'
Set-Content -Path $validFile -Value 'qa-valid-upload'
Set-Content -Path $invalidFile -Value 'MZ-qa-invalid-upload'

$uploadValidResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/upload" -WebSession $student1Session -Form @{ files = Get-Item $validFile }
$validUploadPass = $uploadValidResp.success -eq $true -and @($uploadValidResp.files).Count -ge 1

$invalidUploadBlocked = $false
try {
  $null = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/upload" -WebSession $student1Session -Form @{ files = Get-Item $invalidFile }
  $invalidUploadBlocked = $false
} catch {
  $statusCode = [int]$_.Exception.Response.StatusCode
  if ($statusCode -eq 400 -or $statusCode -eq 403) { $invalidUploadBlocked = $true }
}
Add-Result -Flow '8_attachment_upload_validation' -Passed ($validUploadPass -and $invalidUploadBlocked) -Detail "validUpload=$validUploadPass; invalidBlocked=$invalidUploadBlocked"

# Flow 9: Google Meet link sanitization
Step 'Flow 9 meet sanitization'
$badMeetBody = @{
  title = "QA Bad Meet $(Get-Date -Format 'yyyyMMddHHmmss')"
  description = 'Testing invalid meet link rejection.'
  request_category = 'General Help'
  urgency_level = 'medium'
  meet_link = 'https://evil.example.com/room'
} | ConvertTo-Json -Depth 8
$badMeetRejected = $false
try {
  $null = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/create-request" -WebSession $student1Session -ContentType 'application/json' -Body $badMeetBody
} catch {
  $statusCode = [int]$_.Exception.Response.StatusCode
  if ($statusCode -eq 400) { $badMeetRejected = $true }
}

$goodMeetBody = @{
  title = "QA Good Meet $(Get-Date -Format 'yyyyMMddHHmmss')"
  description = 'Testing valid meet link acceptance.'
  request_category = 'General Help'
  urgency_level = 'medium'
  meet_link = 'https://meet.google.com/abc-defg-hij'
} | ConvertTo-Json -Depth 8
$goodMeetResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/create-request" -WebSession $student1Session -ContentType 'application/json' -Body $goodMeetBody
$goodMeetId = $goodMeetResp.request.id
$goodMeetDetail = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/support/request/$goodMeetId" -WebSession $student1Session
$goodMeetStored = [string]::IsNullOrWhiteSpace($goodMeetDetail.request.meet_link) -eq $false
Add-Result -Flow '9_meet_link_sanitization' -Passed ($badMeetRejected -and $goodMeetStored) -Detail "invalidRejected=$badMeetRejected; validStored=$goodMeetStored"

# Flow 10: Support dashboard stats
Step 'Flow 10 dashboard stats'
$dashResp = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/support/my-dashboard" -WebSession $student1Session
$dashPass = $dashResp.success -eq $true -and $null -ne $dashResp.my_requests -and $null -ne $dashResp.helper_stats
Add-Result -Flow '10_support_dashboard_stats' -Passed $dashPass -Detail "myRequests=$(@($dashResp.my_requests).Count)"

# Flow 11: Top Helpers leaderboard
Step 'Flow 11 leaderboard'
$leaderResp = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/support/leaderboard/top-helpers" -WebSession $student1Session
$leaderPass = $leaderResp.success -eq $true -and (@($leaderResp.helpers).Count -ge 1)
Add-Result -Flow '11_top_helpers' -Passed $leaderPass -Detail "helpers=$(@($leaderResp.helpers).Count)"

# Flow 12: Admin moderation queue
Step 'Flow 12 moderation queue'
$modResp = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/admin/support-governance/threads?limit=20" -WebSession $adminSession
$modPass = $modResp.success -eq $true -and $null -ne $modResp.threads
Add-Result -Flow '12_admin_moderation_queue' -Passed $modPass -Detail "threads=$(@($modResp.threads).Count)"

# Flow 13: Admin reward adjustment
Step 'Flow 13 reward adjust'
$rewardBody = @{ helperUserId = [int]$helperLogin.user.id; pointsDelta = 25; reason = 'QA reward adjust test'; eventType = 'admin_manual' } | ConvertTo-Json
$rewardResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/admin/support-governance/rewards/adjust" -WebSession $adminSession -ContentType 'application/json' -Body $rewardBody
Add-Result -Flow '13_admin_reward_adjustment' -Passed ($rewardResp.success -eq $true) -Detail "pointsDelta=$($rewardResp.pointsDelta)"

# Flow 14: Helper trust/suspension controls
Step 'Flow 14 trust suspension'
$trustSuspendBody = @{
  trustLevel = 'trusted_helper'
  verifiedContributor = $true
  suspend = $true
  suspensionReason = 'QA suspension test'
  suspendedUntil = (Get-Date).AddHours(2).ToString('o')
} | ConvertTo-Json
$trustSuspendResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/admin/support-governance/helpers/$($helperLogin.user.id)/trust" -WebSession $adminSession -ContentType 'application/json' -Body $trustSuspendBody

$request4Body = @{
  title = "QA Suspension Gate $(Get-Date -Format 'yyyyMMddHHmmss')"
  description = 'Request used to verify suspended helper cannot answer.'
  request_category = 'General Help'
  subject = 'Suspension'
  urgency_level = 'medium'
} | ConvertTo-Json -Depth 8
$request4 = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/create-request" -WebSession $student1Session -ContentType 'application/json' -Body $request4Body
$request4Id = $request4.request.id

$suspendBlocked = $false
try {
  $null = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/answer/$request4Id" -WebSession $helperSession -ContentType 'application/json' -Body $answerBody
} catch {
  $statusCode = [int]$_.Exception.Response.StatusCode
  if ($statusCode -eq 403) { $suspendBlocked = $true }
}

$trustRestoreBody = @{
  trustLevel = 'trusted_helper'
  verifiedContributor = $true
  suspend = $false
  suspensionReason = ''
  suspendedUntil = $null
} | ConvertTo-Json
$null = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/admin/support-governance/helpers/$($helperLogin.user.id)/trust" -WebSession $adminSession -ContentType 'application/json' -Body $trustRestoreBody

Add-Result -Flow '14_helper_trust_suspension_controls' -Passed ($trustSuspendResp.success -eq $true -and $suspendBlocked) -Detail "suspendBlockedAnswer=$suspendBlocked"

# Flow 15: Feature visibility toggle / governance controls
Step 'Flow 15 feature toggle'
$cfgCurrent = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/admin/support-governance/feature-config" -WebSession $adminSession
$cfg = $cfgCurrent.config

$cfgOff = @{
  enabled = $cfg.enabled
  moduleVisible = $cfg.moduleVisible
  allowRequestCreation = $cfg.allowRequestCreation
  allowAnswerCreation = $false
  allowMeetLinks = $cfg.allowMeetLinks
  allowAttachments = $cfg.allowAttachments
  allowStudentRewarding = $cfg.allowStudentRewarding
  allowSolvedFlow = $cfg.allowSolvedFlow
} | ConvertTo-Json

$null = Invoke-RestMethod -Method Put -Uri "$baseUrl/api/admin/support-governance/feature-config" -WebSession $adminSession -ContentType 'application/json' -Body $cfgOff

$toggleBlocked = $false
try {
  $null = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/support/answer/$request4Id" -WebSession $helperSession -ContentType 'application/json' -Body $answerBody
} catch {
  $statusCode = [int]$_.Exception.Response.StatusCode
  if ($statusCode -eq 403) { $toggleBlocked = $true }
}

$cfgRestore = $cfg | ConvertTo-Json
$null = Invoke-RestMethod -Method Put -Uri "$baseUrl/api/admin/support-governance/feature-config" -WebSession $adminSession -ContentType 'application/json' -Body $cfgRestore

Add-Result -Flow '15_feature_visibility_governance_toggle' -Passed $toggleBlocked -Detail "answerBlockedWhenDisabled=$toggleBlocked"

# Additional frontend page checks (non-scored)
Step 'Frontend page checks'
try {
  $detailPage = Invoke-WebRequest -Method Get -Uri "$baseUrl/support-request-detail.html" -WebSession $student1Session -UseBasicParsing
  $hubPage = Invoke-WebRequest -Method Get -Uri "$baseUrl/support-hub.html" -WebSession $student1Session -UseBasicParsing
  $results['frontend_page_access'] = [ordered]@{ passed = ($detailPage.StatusCode -eq 200 -and $hubPage.StatusCode -eq 200); detail = "detail=$($detailPage.StatusCode), hub=$($hubPage.StatusCode)" }
} catch {
  $results['frontend_page_access'] = [ordered]@{ passed = $false; detail = $_.Exception.Message }
}

$results | ConvertTo-Json -Depth 8
