import { WS_OUTBOUND_TYPES } from "./ws_protocol.js";

const WS_RECONNECT_INTERVAL = 3000;

let port = null;
let ws = null;
let wsUrl = null;
let authToken = null;
let reconnectTimer = null;
let lastPongAt = 0;

function connectPort() {
    if (port) return;
    port = chrome.runtime.connect({ name: "offscreen" });
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => {
        port = null;
        setTimeout(connectPort, 200);
    });
}

async function loadConfig() {
    const stored = await chrome.storage.local.get(["apiBase", "authToken"]);
    const apiBase = stored.apiBase || "http://localhost:5000";
    wsUrl = apiBase.replace(/^http/, "ws") + "/ws/extension";
    authToken = stored.authToken || null;
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setInterval(() => {
        if (!authToken) return;
        if (!ws || ws.readyState === WebSocket.CLOSED) connectWebSocket();
    }, WS_RECONNECT_INTERVAL);
}

function clearReconnect() {
    if (!reconnectTimer) return;
    clearInterval(reconnectTimer);
    reconnectTimer = null;
}

function connectWebSocket() {
    if (!wsUrl || !authToken) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
        ws = new WebSocket(wsUrl);
    } catch {
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        clearReconnect();
        ws.send(JSON.stringify({ type: WS_OUTBOUND_TYPES.AUTH, token: authToken }));
        port?.postMessage({ type: "WS_STATUS", connected: true });
    };

    ws.onmessage = (event) => {
        let data = null;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }
        if (data?.type === "PONG") lastPongAt = Date.now();
        port?.postMessage({ type: "WS_MESSAGE", data });
    };

    ws.onclose = () => {
        port?.postMessage({ type: "WS_STATUS", connected: false });
        scheduleReconnect();
    };

    ws.onerror = () => {
        try {
            ws?.close();
        } catch {
        }
    };
}

function sendWs(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
        ws.send(JSON.stringify(data));
        return true;
    } catch {
        return false;
    }
}

async function onPortMessage(msg) {
    if (!msg) return;

    if (msg.type === "WS_SEND") {
        sendWs(msg.data);
        return;
    }

    if (msg.type === "RELOAD_CONFIG") {
        await loadConfig();
        try {
            ws?.close();
        } catch {
        }
        ws = null;
        connectWebSocket();
        return;
    }
}

chrome.storage.onChanged.addListener(async (changes) => {
    if (changes.apiBase || changes.authToken) {
        await loadConfig();
        port?.postMessage({ type: "WS_STATUS", connected: ws?.readyState === WebSocket.OPEN });
        try {
            ws?.close();
        } catch {
        }
        ws = null;
        connectWebSocket();
    }
});

connectPort();
await loadConfig();
connectWebSocket();
scheduleReconnect();

setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (lastPongAt && now - lastPongAt > 120000) {
        try {
            ws.close();
        } catch {
        }
        return;
    }
    sendWs({ type: "PING", ts: Math.floor(now / 1000) });
}, 30000);

