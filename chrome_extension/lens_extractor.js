(function () {
    if (globalThis.__AVST_LENS_EXTRACTOR__) return;
    globalThis.__AVST_LENS_EXTRACTOR__ = true;

    const targetDomains = [
        "amazon.",
        "temu.com",
        "shein.",
        "aliexpress.",
        "1688.com",
        "coupang.com",
        "ebay.",
        "tiktok.com"
    ];

    function isTargetDomain(hostname) {
        const lower = hostname.toLowerCase();
        return targetDomains.some(d => lower.includes(d));
    }

    function decodeGoogleUrl(href) {
        try {
            if (href.includes("google.com/url?")) {
                const urlObj = new URL(href);
                const actualUrl = urlObj.searchParams.get("url") || urlObj.searchParams.get("q");
                if (actualUrl) return actualUrl;
            }
        } catch { }
        return href;
    }

    function extractLinks() {
        const links = [];
        const seen = new Set();
        const anchors = document.querySelectorAll("a[href]");

        for (const a of anchors) {
            let href = a.href;
            if (!href || typeof href !== "string") continue;
            if (!href.startsWith("http")) continue;

            href = decodeGoogleUrl(href);

            let url = null;
            try {
                url = new URL(href);
            } catch {
                continue;
            }

            if (!isTargetDomain(url.hostname)) continue;

            // Normalize URL to deduplicate (e.g. remove tracking params)
            const cleanUrl = new URL(url.origin + url.pathname);
            
            // Keep ASIN or product ID if present in search params
            if (url.searchParams.has("id")) cleanUrl.searchParams.set("id", url.searchParams.get("id"));
            if (url.searchParams.has("goods_id")) cleanUrl.searchParams.set("goods_id", url.searchParams.get("goods_id"));
            if (url.searchParams.has("itemId")) cleanUrl.searchParams.set("itemId", url.searchParams.get("itemId"));

            const key = cleanUrl.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            
            links.push(href); // Return the original link so we don't break site-specific routing
        }

        return links;
    }

    let extractionTimeout = null;

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.type === "LENS_GET_LINKS") {
            const requiredCount = msg.requiredCount || 10;
            
            // Try to scroll down to load more results if needed
            window.scrollBy(0, 1000);

            const links = extractLinks();
            
            if (links.length >= requiredCount) {
                sendResponse({ ok: true, links: links.slice(0, requiredCount) });
            } else {
                // If not enough, send what we have, background will poll again
                sendResponse({ ok: true, links: links });
            }
            return;
        }
        sendResponse({ ok: false });
    });
})();

