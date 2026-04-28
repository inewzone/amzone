import { WS_OUTBOUND_TYPES, ensureProductShape, nowIso } from "./ws_protocol.js";

const DEFAULT_API_BASE = "http://localhost:5000";

let apiBase = DEFAULT_API_BASE;
let authToken = null;

let offscreenPort = null;
let wsConnected = false;

const activeTasks = new Map();

function pTabsCreate(createProperties) {
    return new Promise((resolve) => chrome.tabs.create(createProperties, resolve));
}

function pTabsRemove(tabId) {
    return new Promise((resolve) => chrome.tabs.remove(tabId, resolve));
}

function pScriptingExecuteScript(details) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript(details, (results) => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(results);
        });
    });
}

function pTabsSendMessage(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (resp) => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(resp);
        });
    });
}

function waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
        let done = false;

        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error("Tab load timeout"));
        }, timeoutMs);

        function listener(updatedTabId, info) {
            if (done) return;
            if (updatedTabId !== tabId) return;
            if (info.status !== "complete") return;
            done = true;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }

        chrome.tabs.onUpdated.addListener(listener);
    });
}

async function ensureOffscreen() {
    if (!chrome.offscreen?.createDocument) return;
    const has = chrome.offscreen.hasDocument ? await chrome.offscreen.hasDocument() : false;
    if (has) return;
    await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: "keep websocket alive"
    });
}

function wsSend(data) {
    offscreenPort?.postMessage({ type: "WS_SEND", data });
}

function wsProgress(taskId, stage, extra = {}) {
    wsSend({
        type: WS_OUTBOUND_TYPES.TASK_PROGRESS,
        taskId,
        stage,
        ts: nowIso(),
        ...extra
    });
}

function wsResult(taskId, status, payload) {
    wsSend({
        type: WS_OUTBOUND_TYPES.TASK_RESULT,
        taskId,
        status,
        ts: nowIso(),
        ...payload
    });
}

async function injectOnce(tabId, file) {
    await pScriptingExecuteScript({ target: { tabId }, files: [file] });
}

async function extractPageFromUrl(url, { closeTab = true, timeoutMs = 60000 } = {}) {
    const tab = await pTabsCreate({ url, active: false });
    try {
        await waitForTabComplete(tab.id, timeoutMs);
        await injectOnce(tab.id, "page_extractor.js");
        const resp = await pTabsSendMessage(tab.id, { type: "PAGE_EXTRACT" });
        if (!resp?.ok || !resp.data) throw new Error(resp?.error || "extract failed");
        return resp.data;
    } finally {
        if (closeTab) {
            try {
                await pTabsRemove(tab.id);
            } catch {
            }
        }
    }
}

async function pollLensLinks(tabId, timeoutMs, requiredCount = 10) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const resp = await pTabsSendMessage(tabId, { type: "LENS_GET_LINKS", requiredCount });
            const links = Array.isArray(resp?.links) ? resp.links : [];
            if (links.length >= requiredCount) return links.slice(0, requiredCount);
            // If we have some links but timeout is approaching (e.g., last 3 seconds), just return what we have
            if (links.length > 0 && Date.now() - started > timeoutMs - 3000) return links;
        } catch {
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    // Return whatever we managed to get on the last attempt, or empty array
    try {
        const resp = await pTabsSendMessage(tabId, { type: "LENS_GET_LINKS", requiredCount });
        return Array.isArray(resp?.links) ? resp.links.slice(0, requiredCount) : [];
    } catch {
        return [];
    }
}

async function runLensSearchTask(task) {
    const taskId = task.taskId || task.id || task.task_id;
    const imageUrl = task.imageUrl || task.image_url;
    const maxCandidates = Number.isFinite(task.maxCandidates) ? task.maxCandidates : 10;
    const lensTimeoutMs = Number.isFinite(task.lensTimeoutMs) ? task.lensTimeoutMs : 90000;
    const pageTimeoutMs = Number.isFinite(task.pageTimeoutMs) ? task.pageTimeoutMs : 60000;

    if (!taskId) throw new Error("missing taskId");
    if (!imageUrl) throw new Error("missing imageUrl");

    wsProgress(taskId, "lens_open");
    const lensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
    const tab = await pTabsCreate({ url: lensUrl, active: false });

    try {
        await waitForTabComplete(tab.id, lensTimeoutMs);
        await injectOnce(tab.id, "lens_extractor.js");
        wsProgress(taskId, "lens_loaded");
        const links = await pollLensLinks(tab.id, lensTimeoutMs, maxCandidates);
        wsProgress(taskId, "lens_links", { linksCount: links.length });

        const results = [];
        const errors = [];
        const concurrencyLimit = 3;
        
        // Helper function to process a single link
        const processLink = async (link) => {
            try {
                const page = await extractPageFromUrl(link, { closeTab: true, timeoutMs: pageTimeoutMs });
                for (const p of page.products || []) results.push(ensureProductShape(p));
                wsProgress(taskId, "page_extracted", { url: link });
            } catch (e) {
                errors.push({ url: link, message: String(e?.message || e) });
            }
        };

        // Run with concurrency limit
        for (let i = 0; i < links.length; i += concurrencyLimit) {
            const batch = links.slice(i, i + concurrencyLimit);
            await Promise.all(batch.map(processLink));
        }

        wsResult(taskId, "ok", { results, errors });
    } finally {
        try {
            await pTabsRemove(tab.id);
        } catch {
        }
    }
}

async function runExtractUrlTask(task) {
    const taskId = task.taskId || task.id || task.task_id;
    const url = task.url;
    if (!taskId) throw new Error("missing taskId");
    if (!url) throw new Error("missing url");

    wsProgress(taskId, "open");
    const page = await extractPageFromUrl(url, { closeTab: true, timeoutMs: task.pageTimeoutMs || 60000 });
    const results = (page.products || []).map((p) => ensureProductShape(p));
    wsResult(taskId, "ok", { results });
}

async function dispatchTask(task) {
    const taskId = task.taskId || task.id || task.task_id;
    if (!taskId) throw new Error("missing taskId");
    if (activeTasks.has(taskId)) throw new Error("task already running");
    activeTasks.set(taskId, { startedAt: Date.now() });
    try {
        const t = task.taskType || task.task_type || task.type;
        if (t === "LENS_SEARCH_AND_EXTRACT" || t === "LENS_SEARCH" || t === "TASK_LENS") {
            await runLensSearchTask({ ...task, taskId });
            return;
        }
        if (t === "EXTRACT_URL" || t === "TASK_EXTRACT_URL") {
            await runExtractUrlTask({ ...task, taskId });
            return;
        }
        if (task.type === "NAVIGATE" && task.url) {
            await pTabsCreate({ url: task.url, active: task.active !== false });
            wsResult(taskId, "ok", { results: [] });
            return;
        }
        throw new Error(`unsupported taskType: ${t}`);
    } catch (e) {
        wsResult(taskId, "error", { error: { message: String(e?.message || e) } });
    } finally {
        activeTasks.delete(taskId);
    }
}

function handleWebSocketMessage(msg) {
    if (!msg) return;
    if (msg.type === "PING") {
        wsSend({ type: WS_OUTBOUND_TYPES.PONG });
        return;
    }
    if (msg.type === "TASK") {
        dispatchTask(msg).catch(() => {});
        return;
    }
    if (msg.type === "LENS_SEARCH") {
        dispatchTask({ ...msg, taskType: "LENS_SEARCH_AND_EXTRACT", taskId: msg.taskId || msg.task_id || msg.id || nowIso() }).catch(() => {});
        return;
    }
    if (msg.type === "EXTRACT_URL") {
        dispatchTask({ ...msg, taskType: "EXTRACT_URL", taskId: msg.taskId || msg.task_id || msg.id || nowIso() }).catch(() => {});
        return;
    }
    if (msg.type === "NAVIGATE") {
        pTabsCreate({ url: msg.url, active: msg.active !== false });
        return;
    }
    if (msg.type === "SCRAPE_ASIN" && msg.asin) {
        dispatchTask({
            taskType: "EXTRACT_URL",
            taskId: msg.taskId || msg.task_id || msg.id || nowIso(),
            url: `https://www.amazon.com/dp/${msg.asin}`
        }).catch(() => {});
        return;
    }
    if (msg.type === "BATCH_SCRAPE" && Array.isArray(msg.asins)) {
        msg.asins.slice(0, 50).forEach((asin) => {
            dispatchTask({
                taskType: "EXTRACT_URL",
                taskId: nowIso(),
                url: `https://www.amazon.com/dp/${asin}`
            }).catch(() => {});
        });
        return;
    }
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "offscreen") return;
    offscreenPort = port;
    port.onMessage.addListener((msg) => {
        if (msg?.type === "WS_MESSAGE") handleWebSocketMessage(msg.data);
        if (msg?.type === "WS_STATUS") wsConnected = !!msg.connected;
    });
    port.onDisconnect.addListener(() => {
        if (offscreenPort === port) offscreenPort = null;
        wsConnected = false;
    });
});

chrome.runtime.onInstalled.addListener(async () => {
    const stored = await chrome.storage.local.get(["apiBase", "authToken"]);
    if (stored.apiBase) apiBase = stored.apiBase;
    if (stored.authToken) authToken = stored.authToken;
    await ensureOffscreen();
});

chrome.runtime.onStartup.addListener(async () => {
    const stored = await chrome.storage.local.get(["apiBase", "authToken"]);
    if (stored.apiBase) apiBase = stored.apiBase;
    if (stored.authToken) authToken = stored.authToken;
    await ensureOffscreen();
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.apiBase?.newValue) apiBase = changes.apiBase.newValue;
    if (changes.authToken?.newValue) authToken = changes.authToken.newValue;
    offscreenPort?.postMessage({ type: "RELOAD_CONFIG" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case "PRODUCT_DATA":
            handleProductData(message.data, sender.tab);
            sendResponse({ success: true });
            break;
        case "SEARCH_RESULTS":
            handleSearchResults(message.data, sender.tab);
            sendResponse({ success: true });
            break;
        case "SET_CONFIG":
            handleSetConfig(message.data);
            sendResponse({ success: true });
            break;
        case "GET_STATUS":
            sendResponse({
                connected: !!authToken,
                wsConnected,
                apiBase
            });
            break;
        case "LOGIN":
            handleLogin(message.data).then(sendResponse);
            return true;
        default:
            sendResponse({ success: false, error: "Unknown message type" });
    }
});

async function handleProductData(data, tab) {
    try {
        await fetch(`${apiBase}/api/v1/extension/product`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${authToken}`
            },
            body: JSON.stringify({
                asin: data.asin,
                title: data.title,
                price: data.price,
                rating: data.rating,
                review_count: data.reviewCount,
                bsr: data.bsr,
                brand: data.brand,
                images: data.images,
                variants: data.variants,
                hidden_data: data.hiddenData,
                page_url: tab?.url,
                extracted_at: nowIso()
            })
        });
    } catch {
    }
}

async function handleSearchResults(data, tab) {
    try {
        await fetch(`${apiBase}/api/v1/extension/search-results`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${authToken}`
            },
            body: JSON.stringify({
                keyword: data.keyword,
                page: data.page,
                products: data.products,
                total_results: data.totalResults,
                page_url: tab?.url,
                extracted_at: nowIso()
            })
        });
    } catch {
    }
}

function handleSetConfig(config) {
    if (config.apiBase) {
        apiBase = config.apiBase;
        chrome.storage.local.set({ apiBase });
    }
    if (config.authToken) {
        authToken = config.authToken;
        chrome.storage.local.set({ authToken });
    }
    offscreenPort?.postMessage({ type: "RELOAD_CONFIG" });
}

async function handleLogin(credentials) {
    try {
        const response = await fetch(`${apiBase}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials)
        });

        const result = await response.json();

        if (result.success && result.data?.access_token) {
            authToken = result.data.access_token;
            chrome.storage.local.set({ authToken });
            await ensureOffscreen();
            return { success: true };
        }
        return { success: false, error: result.message || "登录失败" };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
