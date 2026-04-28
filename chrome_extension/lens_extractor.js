(function () {
    if (globalThis.__AVST_LENS_EXTRACTOR__) return;
    globalThis.__AVST_LENS_EXTRACTOR__ = true;

    const preferredHosts = [
        "amazon.",
        "ebay.",
        "aliexpress.",
        "walmart.",
        "temu.",
        "shein.",
        "alibaba.",
        "1688.com",
        "coupang.",
        "rakuten.",
        "shopify.com",
        "etsy."
    ];

    function scoreUrl(u) {
        const h = u.hostname.toLowerCase();
        const idx = preferredHosts.findIndex((p) => h.includes(p));
        return idx === -1 ? 1000 : idx;
    }

    function extractLinks() {
        const links = [];
        const seen = new Set();
        const anchors = document.querySelectorAll("a[href]");

        for (const a of anchors) {
            const href = a.href;
            if (!href || typeof href !== "string") continue;
            if (!href.startsWith("http")) continue;
            if (href.includes("google.com")) continue;
            if (href.includes("lens.google.com")) continue;
            if (href.includes("accounts.google.com")) continue;
            if (href.startsWith("https://support.google.com/")) continue;

            let url = null;
            try {
                url = new URL(href);
            } catch {
                continue;
            }
            const key = url.origin + url.pathname;
            if (seen.has(key)) continue;
            seen.add(key);
            links.push(url);
        }

        links.sort((a, b) => scoreUrl(a) - scoreUrl(b));
        return links.map((u) => u.toString());
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.type === "LENS_GET_LINKS") {
            sendResponse({ ok: true, links: extractLinks() });
            return;
        }
        sendResponse({ ok: false });
    });
})();

