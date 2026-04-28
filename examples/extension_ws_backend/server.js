import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const clients = new Set();

function jsonSend(ws, obj) {
    ws.send(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ws: `/ws/extension` }));
});

const wss = new WebSocketServer({ server, path: "/ws/extension" });

wss.on("connection", (ws) => {
    clients.add(ws);

    jsonSend(ws, { type: "AUTH_REQUIRED" });

    ws.on("message", (raw) => {
        let msg = null;
        try {
            msg = JSON.parse(String(raw));
        } catch {
            return;
        }

        if (msg.type === "AUTH") {
            jsonSend(ws, { type: "AUTH_SUCCESS", user_id: "demo" });
            return;
        }

        if (msg.type === "TASK_PROGRESS") {
            process.stdout.write(`[TASK_PROGRESS] ${msg.taskId} ${msg.stage}\n`);
            return;
        }

        if (msg.type === "TASK_RESULT") {
            process.stdout.write(`[TASK_RESULT] ${msg.taskId} status=${msg.status} results=${(msg.results || []).length}\n`);
            return;
        }
    });

    ws.on("close", () => {
        clients.delete(ws);
    });
});

function broadcast(obj) {
    for (const c of clients) {
        if (c.readyState === 1) c.send(JSON.stringify(obj));
    }
}

function taskLens(imageUrl) {
    const taskId = `task_${Date.now()}`;
    broadcast({
        type: "TASK",
        taskType: "LENS_SEARCH_AND_EXTRACT",
        taskId,
        imageUrl,
        maxCandidates: 5,
        lensTimeoutMs: 90000,
        pageTimeoutMs: 60000
    });
    process.stdout.write(`Sent TASK ${taskId}\n`);
}

function taskExtractUrl(url) {
    const taskId = `task_${Date.now()}`;
    broadcast({
        type: "TASK",
        taskType: "EXTRACT_URL",
        taskId,
        url,
        pageTimeoutMs: 60000
    });
    process.stdout.write(`Sent TASK ${taskId}\n`);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
    const line = chunk.trim();
    if (!line) return;
    if (line.startsWith("lens ")) {
        taskLens(line.slice(5).trim());
        return;
    }
    if (line.startsWith("url ")) {
        taskExtractUrl(line.slice(4).trim());
        return;
    }
    process.stdout.write(`Unknown command. Use:\n  lens <imageUrl>\n  url <pageUrl>\n`);
});

server.listen(PORT, () => {
    process.stdout.write(`Demo WS backend listening http://localhost:${PORT}\n`);
    process.stdout.write(`WS endpoint ws://localhost:${PORT}/ws/extension\n`);
});
