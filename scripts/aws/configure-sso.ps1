[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://.+awsapps\.com/start/?$')]
  [string]$StartUrl,
  [string]$Profile = 'AdministratorAccess-746491202681',
  [string]$AccountId = '746491202681',
  [string]$RoleName = 'AdministratorAccess',
  [string]$SsoRegion = 'ap-southeast-2',
  [string]$Region = 'ap-northeast-2'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw 'AWS CLI v2 is required.'
}

aws configure set sso_start_url $StartUrl --profile $Profile
aws configure set sso_region $SsoRegion --profile $Profile
aws configure set sso_account_id $AccountId --profile $Profile
aws configure set sso_role_name $RoleName --profile $Profile
aws configure set region $Region --profile $Profile
aws configure set output json --profile $Profile

Write-Host "Configured AWS profile: $Profile"
Write-Host 'Opening AWS IAM Identity Center login...'
aws sso login --profile $Profile
if ($LASTEXITCODE -ne 0) { throw 'AWS SSO login failed.' }

$identity = aws sts get-caller-identity --profile $Profile --region $Region | ConvertFrom-Json
if ($identity.Account -ne $AccountId) {
  throw "Unexpected AWS account $($identity.Account); expected $AccountId."
}

Write-Host "Authenticated account: $($identity.Account)"
Write-Host "Caller ARN: $($identity.Arn)"
