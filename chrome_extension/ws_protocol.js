export const WS_INBOUND_TYPES = {
    AUTH_REQUIRED: "AUTH_REQUIRED",
    AUTH_SUCCESS: "AUTH_SUCCESS",
    AUTH_FAILED: "AUTH_FAILED",
    PING: "PING",
    TASK: "TASK",
    NAVIGATE: "NAVIGATE",
    SCRAPE_PAGE: "SCRAPE_PAGE",
    SCRAPE_ASIN: "SCRAPE_ASIN",
    BATCH_SCRAPE: "BATCH_SCRAPE"
};

export const WS_OUTBOUND_TYPES = {
    AUTH: "AUTH",
    PONG: "PONG",
    TASK_PROGRESS: "TASK_PROGRESS",
    TASK_RESULT: "TASK_RESULT",
    PRODUCT_DATA: "PRODUCT_DATA",
    SEARCH_RESULTS: "SEARCH_RESULTS",
    ERROR: "ERROR"
};

export function nowIso() {
    return new Date().toISOString();
}

export function normalizeCurrency(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (/^[A-Z]{3}$/.test(s)) return s;
    const map = {
        "$": "USD",
        "US$": "USD",
        "€": "EUR",
        "£": "GBP",
        "¥": "JPY",
        "￥": "CNY",
        "₩": "KRW"
    };
    return map[s] || null;
}

export function normalizePrice(raw) {
    if (raw == null) return null;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const s = String(raw);
    const num = parseFloat(s.replace(/[^0-9.]/g, ""));
    return Number.isFinite(num) ? num : null;
}

export function pickFirst(v) {
    if (Array.isArray(v)) return v.find(Boolean) ?? null;
    return v ?? null;
}

export function guessSiteFromUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return null;
    }
}

export function ensureProductShape(p) {
    if (!p) return null;
    const url = p.url || p.pageUrl || null;
    const site = p.site || guessSiteFromUrl(url);
    return {
        title: p.title ?? null,
        url,
        price: p.price ?? null,
        currency: p.currency ?? null,
        rating: p.rating ?? null,
        reviewCount: p.reviewCount ?? null,
        imageUrl: p.imageUrl ?? null,
        asin: p.asin ?? null,
        site,
        sellers: Array.isArray(p.sellers) ? p.sellers : [],
        bsr: Array.isArray(p.bsr) ? p.bsr : [],
        extractedAt: p.extractedAt || nowIso()
    };
}

