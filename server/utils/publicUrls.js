/** Detect localhost / loopback hosts in URLs or Host headers. */
function isLoopbackHost(value) {
    const s = String(value || '').toLowerCase();
    return (
        s.includes('localhost') ||
        s.includes('127.0.0.1') ||
        s.includes('[::1]') ||
        s.includes('0.0.0.0')
    );
}

function requestPublicHost(req) {
    const host = String(req?.get?.('host') || req?.headers?.host || '').trim();
    if (!host || isLoopbackHost(host)) return '';
    return host;
}

function requestProto(req) {
    const raw = String(
        req?.get?.('x-forwarded-proto') || req?.protocol || 'https'
    )
        .split(',')[0]
        .trim()
        .toLowerCase();
    return raw === 'http' ? 'http' : 'https';
}

/**
 * Resolve a public API base for bootstrap tickets.
 * Never returns localhost when the incoming request is on a public host.
 */
function resolvePublicApiBase(req, preferred) {
    const publicHost = requestPublicHost(req);
    const proto = requestProto(req);
    const allowLoopback = process.env.NODE_ENV !== 'production' && !publicHost;

    const candidates = [
        preferred,
        process.env.NEXT_PUBLIC_API_URL,
        process.env.NEXT_PUBLIC_APP_URL,
    ];

    for (const c of candidates) {
        const v = String(c || '').trim().replace(/\/$/, '');
        if (!v) continue;
        if (!allowLoopback && isLoopbackHost(v)) continue;
        return v;
    }

    if (publicHost) return `${proto}://${publicHost}`;
    if (allowLoopback) return 'http://localhost:3000';
    return 'https://www.zenvora.abdullahtahir.me';
}

/**
 * Resolve WebSocket gateway URL for agents.
 * Drops loopback env/body values on public deployments (common Railway misconfig).
 */
function resolvePublicGatewayUrl(req, preferred) {
    const publicHost = requestPublicHost(req);
    const proto = requestProto(req);
    const wsScheme = proto === 'https' ? 'wss' : 'ws';
    const allowLoopback = process.env.NODE_ENV !== 'production' && !publicHost;

    const candidates = [
        preferred,
        process.env.ZENVORA_GATEWAY_URL,
        process.env.NEXT_PUBLIC_GATEWAY_URL,
    ];

    for (const c of candidates) {
        let gw = String(c || '').trim();
        if (!gw) continue;
        if (!allowLoopback && isLoopbackHost(gw)) continue;

        if (publicHost) {
            if (proto === 'https' && gw.startsWith('ws://')) {
                gw = gw.replace(/^ws:\/\//i, 'wss://');
            } else if (proto === 'http' && gw.startsWith('wss://')) {
                gw = gw.replace(/^wss:\/\//i, 'ws://');
            }
        }
        return gw;
    }

    if (publicHost) return `${wsScheme}://${publicHost}/ws/gateway`;
    if (allowLoopback) return 'ws://localhost:3000/ws/gateway';
    return 'wss://www.zenvora.abdullahtahir.me/ws/gateway';
}

module.exports = {
    isLoopbackHost,
    resolvePublicApiBase,
    resolvePublicGatewayUrl,
};
