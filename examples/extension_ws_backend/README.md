# Extension WebSocket Demo Backend

启动：

```bash
cd examples/extension_ws_backend
npm install
PORT=8787 node server.js
```

Chrome 插件里把 API 地址设置为：

- `http://localhost:8787`

下发任务（在运行 `node server.js` 的终端里输入）：

- `lens https://example.com/example.jpg`
- `url https://www.amazon.com/dp/B0XXXX`

消息协议（核心字段）：

- 下发任务：`{ type: "TASK", taskType, taskId, ... }`
- 进度回传：`{ type: "TASK_PROGRESS", taskId, stage, ts, ... }`
- 结果回传：`{ type: "TASK_RESULT", taskId, status, results, errors, error, ts }`

