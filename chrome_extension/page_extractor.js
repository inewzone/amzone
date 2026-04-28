(function () {
    if (globalThis.__AVST_PAGE_EXTRACTOR__) return;
    globalThis.__AVST_PAGE_EXTRACTOR__ = true;

    function nowIso() {
        return new Date().toISOString();
    }

    function safeText(el) {
        return el?.textContent?.trim() || null;
    }

    function normalizePrice(raw) {
        if (raw == null) return null;
        if (typeof raw === "number" && Number.isFinite(raw)) return raw;
        const num = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
        return Number.isFinite(num) ? num : null;
    }

    function pickFirst(v) {
        if (Array.isArray(v)) return v.find(Boolean) ?? null;
        return v ?? null;
    }

    function parseJsonLd() {
        const nodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        const out = [];
        for (const n of nodes) {
            const txt = n.textContent?.trim();
            if (!txt) continue;
            try {
                const v = JSON.parse(txt);
                if (Array.isArray(v)) out.push(...v);
                else out.push(v);
            } catch {
            }
        }
        return out;
    }

    function flattenGraph(obj) {
        if (!obj) return [];
        if (Array.isArray(obj)) return obj.flatMap(flattenGraph);
        const g = obj["@graph"];
        if (Array.isArray(g)) return g.flatMap(flattenGraph).concat([obj]);
        return [obj];
    }

    function isType(v, t) {
        if (!v) return false;
        const raw = v["@type"];
        if (!raw) return false;
        if (Array.isArray(raw)) return raw.includes(t);
        return raw === t;
    }

    function extractFromJsonLdProduct(p) {
        if (!p) return null;
        const offers = p.offers || null;
        const offer0 = Array.isArray(offers) ? offers[0] : offers;
        const url = offer0?.url || p.url || document.location.href;
        const price = normalizePrice(offer0?.price ?? offer0?.lowPrice ?? offer0?.highPrice);
        const currency = offer0?.priceCurrency || null;
        const rating = p.aggregateRating?.ratingValue != null ? parseFloat(p.aggregateRating.ratingValue) : null;
        const reviewCount = p.aggregateRating?.reviewCount != null ? parseInt(p.aggregateRating.reviewCount, 10) : null;
        return {
            title: p.name || null,
            url,
            price,
            currency,
            rating: Number.isFinite(rating) ? rating : null,
            reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
            imageUrl: pickFirst(p.image) || null
        };
    }

    function extractProductsFromItemList(itemList) {
        const els = itemList?.itemListElement;
        if (!Array.isArray(els)) return [];
        const products = [];
        for (const el of els) {
            const item = el?.item || el;
            if (!item) continue;
            if (isType(item, "Product")) {
                const p = extractFromJsonLdProduct(item);
                if (p) products.push(p);
                continue;
            }
            if (item["@type"] === "ListItem" && item.item && isType(item.item, "Product")) {
                const p = extractFromJsonLdProduct(item.item);
                if (p) products.push(p);
            }
        }
        return products;
    }

    function extractOpenGraph() {
        const title = document.querySelector('meta[property="og:title"]')?.content || null;
        const imageUrl = document.querySelector('meta[property="og:image"]')?.content || null;
        const url = document.querySelector('meta[property="og:url"]')?.content || document.location.href;
        const price = normalizePrice(document.querySelector('meta[property="product:price:amount"]')?.content);
        const currency = document.querySelector('meta[property="product:price:currency"]')?.content || null;
        return { title, imageUrl, url, price, currency };
    }

    function extractAmazonOverrides(base) {
        const url = document.location.href;
        const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/i) || url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
        const asin = asinMatch ? asinMatch[1].toUpperCase() : null;
        const title = base.title || safeText(document.querySelector("#productTitle"));
        const imageUrl = base.imageUrl || document.querySelector("#landingImage, #imgBlkFront")?.getAttribute("data-old-hires") || document.querySelector("#landingImage, #imgBlkFront")?.src || null;

        let rating = base.rating;
        if (rating == null) {
            const t = safeText(document.querySelector("#acrPopover .a-icon-alt"));
            const m = t ? t.match(/([\d.]+)/) : null;
            rating = m ? parseFloat(m[1]) : null;
        }

        let reviewCount = base.reviewCount;
        if (reviewCount == null) {
            const t = safeText(document.querySelector("#acrCustomerReviewText"));
            const m = t ? t.replace(/,/g, "").match(/(\d+)/) : null;
            reviewCount = m ? parseInt(m[1], 10) : null;
        }

        let price = base.price;
        if (price == null) {
            const p = document.querySelector(".a-price .a-offscreen")?.textContent || null;
            price = normalizePrice(p);
        }

        const bsr = [];
        const rows = document.querySelectorAll("#productDetails_detailBullets_sections1 tr, #detailBulletsWrapper_feature_div li");
        for (const row of rows) {
            const text = row.textContent || "";
            if (!text.includes("Best Sellers Rank")) continue;
            const matches = text.matchAll(/#([\d,]+)\s+in\s+(.+?)(?:\(|$)/g);
            for (const m of matches) {
                bsr.push({ rank: parseInt(m[1].replace(/,/g, ""), 10), category: m[2].trim() });
            }
        }

        const sellerLink = document.querySelector("#sellerProfileTriggerId, #merchant-info a");
        const sellers = sellerLink?.textContent?.trim()
            ? [{ name: sellerLink.textContent.trim(), id: sellerLink.href || null }]
            : [];

        return { ...base, title, price, rating, reviewCount, imageUrl, asin, bsr, sellers };
    }

    function extractAmazonSearch() {
        const products = [];
        const items = document.querySelectorAll('[data-component-type="s-search-result"]');
        for (const item of items) {
            const asin = item.getAttribute("data-asin");
            if (!asin) continue;
            const title = item.querySelector("h2 a span")?.textContent?.trim() || null;
            const price = normalizePrice(item.querySelector(".a-price .a-offscreen")?.textContent || null);
            const ratingText = item.querySelector(".a-icon-alt")?.textContent || null;
            const rating = ratingText ? parseFloat((ratingText.match(/([\d.]+)/) || [])[1]) : null;
            const reviewCount = parseInt((item.querySelector(".a-size-base.s-underline-text")?.textContent || "").replace(/[^0-9]/g, ""), 10);
            const imageUrl = item.querySelector(".s-image")?.src || null;
            const url = item.querySelector("h2 a")?.href || null;
            products.push({
                title,
                url,
                price,
                currency: "USD",
                rating: Number.isFinite(rating) ? rating : null,
                reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
                imageUrl,
                asin,
                sellers: [],
                bsr: []
            });
        }
        return products;
    }

    function extractEbaySearch() {
        const products = [];
        const items = document.querySelectorAll("li.s-item");
        for (const item of items) {
            const a = item.querySelector("a.s-item__link");
            const url = a?.href || null;
            const title = item.querySelector(".s-item__title")?.textContent?.trim() || null;
            if (!url || !title || title === "Shop on eBay") continue;
            const price = normalizePrice(item.querySelector(".s-item__price")?.textContent || null);
            const imageUrl = item.querySelector(".s-item__image-img")?.src || null;
            products.push({
                title,
                url,
                price,
                currency: null,
                rating: null,
                reviewCount: null,
                imageUrl,
                asin: null,
                sellers: [],
                bsr: []
            });
        }
        return products;
    }

    function normalizeProduct(p) {
        const url = p.url || document.location.href;
        const site = new URL(url).hostname.replace(/^www\./, "");
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
            extractedAt: nowIso()
        };
    }

    function extract() {
        const pageUrl = document.location.href;
        const site = document.location.hostname.replace(/^www\./, "");

        const jsonlds = parseJsonLd().flatMap(flattenGraph);
        const itemLists = jsonlds.filter((o) => isType(o, "ItemList"));
        const jsonldProducts = jsonlds.filter((o) => isType(o, "Product"));

        const isAmazon = site.includes("amazon.");
        const isEbay = site.includes("ebay.");

        let kind = "product";
        if (isAmazon && (pageUrl.includes("/s?") || pageUrl.includes("/s/"))) kind = "search";
        if (isEbay && (pageUrl.includes("_nkw=") || pageUrl.includes("/sch/"))) kind = "search";
        if (itemLists.length) kind = "search";

        if (kind === "search") {
            let products = [];
            for (const list of itemLists) products.push(...extractProductsFromItemList(list));
            if (isAmazon) products = products.length ? products : extractAmazonSearch();
            if (isEbay) products = products.length ? products : extractEbaySearch();
            products = products.map((p) => normalizeProduct(p));
            return { kind, site, pageUrl, products, extractedAt: nowIso() };
        }

        const og = extractOpenGraph();
        let p = extractFromJsonLdProduct(jsonldProducts[0]) || null;
        if (!p && (og.title || og.imageUrl)) p = og;
        if (!p) p = { title: document.title || null, url: pageUrl, price: null, currency: null, imageUrl: null };
        if (isAmazon) p = extractAmazonOverrides(p);

        return { kind, site, pageUrl, products: [normalizeProduct(p)], extractedAt: nowIso() };
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.type === "PAGE_EXTRACT") {
            try {
                const data = extract();
                sendResponse({ ok: true, data });
            } catch (e) {
                sendResponse({ ok: false, error: String(e?.message || e) });
            }
            return;
        }
        sendResponse({ ok: false });
    });
})();

