[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('merchant', 'partner', 'platform')]
  [string]$Mode,
  [string]$StackName = '',
  [string]$BucketName = '',
  [string]$DistributionId = '',
  [string]$Profile = 'AdministratorAccess-746491202681',
  [string]$Region = 'ap-northeast-2',
  [string]$ExpectedAccountId = '746491202681',
  [switch]$Execute,
  [switch]$ConfirmProduction
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

if ($Execute -and -not $ConfirmProduction) {
  throw 'Production execution requires both -Execute and -ConfirmProduction.'
}
if (-not [string]::IsNullOrWhiteSpace((git status --porcelain))) {
  throw 'Frontend deployment requires a clean Git worktree.'
}

$identity = aws sts get-caller-identity --profile $Profile --region $Region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne $ExpectedAccountId) {
  throw "Expected AWS account $ExpectedAccountId."
}

pnpm.cmd --filter '@workspace/todopay' "run" "build:$Mode"
if ($LASTEXITCODE -ne 0) { throw "Frontend $Mode build failed." }

$bucket = $BucketName
$distribution = $DistributionId
if ($StackName) {
  $stack = aws cloudformation describe-stacks --stack-name $StackName --profile $Profile --region $Region --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "Could not read stack $StackName." }
  $outputs = $stack.Stacks[0].Outputs
  $bucket = [string](($outputs | Where-Object OutputKey -eq 'BucketName').OutputValue)
  $distribution = [string](($outputs | Where-Object OutputKey -eq 'DistributionId').OutputValue)
}
if (-not $bucket -or -not $distribution) {
  throw 'Provide -StackName with BucketName/DistributionId outputs, or pass -BucketName and -DistributionId directly.'
}

Write-Host "Mode: $Mode"
Write-Host "S3 bucket: $bucket"
Write-Host "CloudFront distribution: $distribution"
if (-not $Execute) {
  Write-Host 'Preview complete. No remote files changed.'
  Write-Host 'Re-run with -Execute -ConfirmProduction to sync and invalidate CloudFront.'
  exit 0
}

aws s3 sync artifacts/todopay/dist/public "s3://$bucket" --delete --profile $Profile --region $Region
if ($LASTEXITCODE -ne 0) { throw 'S3 sync failed.' }
aws cloudfront create-invalidation --distribution-id $distribution --paths '/*' --profile $Profile --output json | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'CloudFront invalidation failed.' }
Write-Host "Frontend $Mode deployment submitted."
