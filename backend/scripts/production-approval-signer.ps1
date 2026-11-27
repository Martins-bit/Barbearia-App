if ($MyInvocation.InvocationName -ne '.') {
  throw 'Dot-source this file into the current PowerShell session.'
}
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw 'PowerShell 7 or later is required.'
}
if (-not [OperatingSystem]::IsWindows()) {
  throw 'The DPAPI approval signer is available only on Windows.'
}

function Test-ProductionApprovalAcl {
  param(
    [Parameter(Mandatory)]
    [string]$Path,
    [Parameter(Mandatory)]
    [string]$ExpectedSid
  )

  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    return $false
  }

  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $rules = $acl.GetAccessRules(
    $true,
    $true,
    [Security.Principal.SecurityIdentifier]
  )
  return (
    $acl.AreAccessRulesProtected -and
    $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $ExpectedSid -and
    $rules.Count -eq 1 -and
    $rules[0].IdentityReference.Value -eq $ExpectedSid -and
    $rules[0].AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
    $rules[0].FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl -and
    -not $rules[0].IsInherited
  )
}

function New-ProductionMigrationApprovalToken {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [ValidateSet('direct', 'session')]
    [string]$ConnectionMode,
    [ValidateSet('validated', 'accept-risk-unvalidated')]
    [string]$SessionPoolerDisposition
  )

  if ($env:NODE_ENV -ne 'production') {
    throw 'Set NODE_ENV=production in this PowerShell process first.'
  }
  if ($null -ne $env:NODE_TLS_REJECT_UNAUTHORIZED) {
    throw 'NODE_TLS_REJECT_UNAUTHORIZED must be unset.'
  }
  if (-not [string]::IsNullOrEmpty($env:PRODUCTION_MIGRATION_APPROVAL_TOKEN)) {
    throw 'A token is already present in this process; clear it before signing again.'
  }

  $keyDirectory = Join-Path $env:LOCALAPPDATA 'BarbeariaApp-ProductionApprovalKeys'
  $privatePath = Join-Path $keyDirectory 'ed25519-private.dpapi'
  $publicPath = Join-Path $keyDirectory 'ed25519-public.pem'
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if (
    -not (Test-ProductionApprovalAcl -Path $keyDirectory -ExpectedSid $currentSid) -or
    -not (Test-ProductionApprovalAcl -Path $privatePath -ExpectedSid $currentSid) -or
    -not (Test-ProductionApprovalAcl -Path $publicPath -ExpectedSid $currentSid)
  ) {
    throw 'The approval key location ACL is not restricted to the current user.'
  }

  $publicKeyPem = [IO.File]::ReadAllText($publicPath).Trim()
  if (
    -not $publicKeyPem.StartsWith('-----BEGIN PUBLIC KEY-----') -or
    -not $publicKeyPem.EndsWith('-----END PUBLIC KEY-----')
  ) {
    throw 'The public key file is not Ed25519 SPKI PEM.'
  }

  $sessionPoolerHost = $null
  $sessionPoolerValidated = $false
  $sessionPoolerRiskAccepted = $false
  if ($ConnectionMode -eq 'session') {
    if (-not $PSBoundParameters.ContainsKey('SessionPoolerDisposition')) {
      throw 'Choose an explicit Session Pooler disposition.'
    }
    $sessionPoolerHost = $env:PRODUCTION_SESSION_POOLER_HOST
    if (
      [string]::IsNullOrWhiteSpace($sessionPoolerHost) -or
      $sessionPoolerHost -cnotmatch '^aws-\d+-[a-z]{2}(?:-[a-z0-9]+)+-\d+\.pooler\.supabase\.com$'
    ) {
      throw 'Set the exact Session Pooler hostname copied from Supabase Connect.'
    }
    $confirmedHost = Read-Host 'Type the exact Session Pooler hostname copied from Supabase Connect'
    if (-not [string]::Equals($confirmedHost, $sessionPoolerHost, [StringComparison]::Ordinal)) {
      throw 'The confirmed Session Pooler hostname does not match the configured host.'
    }
    if ($SessionPoolerDisposition -eq 'validated') {
      $poolerConfirmation = Read-Host 'Only after completing non-production technical validation, type SESSION_POOLER_VALIDATED'
      if ($poolerConfirmation -cne 'SESSION_POOLER_VALIDATED') {
        throw 'Session Pooler technical validation confirmation is required.'
      }
      $sessionPoolerValidated = $true
    } else {
      $poolerRiskConfirmation = Read-Host 'The Session Pooler migration path has NOT been technically validated in non-production. Type SESSION_POOLER_RISK_ACCEPTED_UNVALIDATED to accept this risk'
      if ($poolerRiskConfirmation -cne 'SESSION_POOLER_RISK_ACCEPTED_UNVALIDATED') {
        throw 'Explicit acceptance of the unvalidated Session Pooler risk is required.'
      }
      $sessionPoolerRiskAccepted = $true
    }
  } elseif ($PSBoundParameters.ContainsKey('SessionPoolerDisposition')) {
    throw 'A Session Pooler disposition cannot be used for Direct mode.'
  }

  $backupConfirmation = Read-Host 'After validating the pre-migration backup, type BACKUP_VALIDATED'
  if ($backupConfirmation -cne 'BACKUP_VALIDATED') {
    throw 'Validated backup confirmation is required.'
  }
  $writersConfirmation = Read-Host 'After stopping every database writer, type WRITERS_STOPPED'
  if ($writersConfirmation -cne 'WRITERS_STOPPED') {
    throw 'Stopped writers confirmation is required.'
  }

  $nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop
  $backendDirectory = Split-Path -Parent $PSScriptRoot
  $signerPath = Join-Path $PSScriptRoot 'production-approval-signer.cjs'
  if (-not (Test-Path -LiteralPath $signerPath)) {
    throw 'The approval signer module is missing.'
  }

  $protectedPrivateKey = [IO.File]::ReadAllText($privatePath).Trim()
  $privateSecureString = $null
  $privateKeyPointer = [IntPtr]::Zero
  $privateKeyPem = $null
  $nodeInput = $null
  $token = $null
  $process = $null
  try {
    $privateSecureString = ConvertTo-SecureString -String $protectedPrivateKey -ErrorAction Stop
    $privateKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($privateSecureString)
    $privateKeyPem = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($privateKeyPointer)

    $nodeInput = [ordered]@{
      connectionMode = $ConnectionMode
      sessionPoolerHost = $sessionPoolerHost
      backupVerified = $true
      writersStopped = $true
      sessionPoolerValidated = $sessionPoolerValidated
      sessionPoolerRiskAccepted = $sessionPoolerRiskAccepted
      privateKeyPem = $privateKeyPem
      publicKeyPem = $publicKeyPem
    } | ConvertTo-Json -Compress

    $processInfo = [Diagnostics.ProcessStartInfo]::new($nodeCommand.Source)
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardInput = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.WorkingDirectory = $backendDirectory
    $processInfo.ArgumentList.Add('-e')
    $processInfo.ArgumentList.Add(
      "const s=require('./scripts/production-approval-signer.cjs');let x='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>x+=d);process.stdin.on('end',()=>{try{process.stdout.write(s.createApprovalToken(JSON.parse(x)))}catch{process.stderr.write('Signing blocked');process.exitCode=1}})"
    )
    $processInfo.Environment.Clear()
    $processInfo.Environment['SystemRoot'] = $env:SystemRoot
    $processInfo.Environment['PATH'] = [IO.Path]::GetDirectoryName($nodeCommand.Source)

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $processInfo
    if (-not $process.Start()) {
      throw 'The signing process could not be started.'
    }
    $standardOutput = $process.StandardOutput.ReadToEndAsync()
    $standardError = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.Write($nodeInput)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(15000)) {
      if (-not $process.HasExited) {
        $process.Kill()
      }
      throw 'Approval signing failed; no token was installed in this process.'
    }
    $token = $standardOutput.GetAwaiter().GetResult()
    $null = $standardError.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
      throw 'Approval signing failed; no token was installed in this process.'
    }
    if ($token -notmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$') {
      throw 'The signer returned an invalid token shape.'
    }

    if (
      -not [string]::IsNullOrWhiteSpace($env:PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY) -and
      -not [string]::Equals(
        $env:PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY.Trim(),
        $publicKeyPem,
        [StringComparison]::Ordinal
      )
    ) {
      throw 'The process public key differs from the protected public key file.'
    }

    $env:PRODUCTION_MIGRATION_APPROVAL_PUBLIC_KEY = $publicKeyPem
    $env:PRODUCTION_MIGRATION_APPROVAL_TOKEN = $token
    Write-Host 'Approval token created in this PowerShell process; token and private key were not displayed.'
  } catch {
    Remove-Item Env:\PRODUCTION_MIGRATION_APPROVAL_TOKEN -ErrorAction SilentlyContinue
    throw 'Approval signing was blocked. No key or token material was displayed.'
  } finally {
    if ($process) {
      $process.Dispose()
    }
    if ($privateKeyPointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($privateKeyPointer)
    }
    if ($privateSecureString) {
      $privateSecureString.Dispose()
    }
    $protectedPrivateKey = $null
    $privateKeyPem = $null
    $nodeInput = $null
    $token = $null
    $publicKeyPem = $null
    $sessionPoolerHost = $null
  }
}
