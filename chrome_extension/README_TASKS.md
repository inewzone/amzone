# WebSocket 任务协议与流程

## 连接

- WebSocket：`{apiBase 替换 http→ws}/ws/extension`
- 插件发起认证：`{ "type": "AUTH", "token": "<authToken>" }`

## 后端下发任务

### 1) 以图搜图 + 抽取相似商品

```json
{
  "type": "TASK",
  "taskType": "LENS_SEARCH_AND_EXTRACT",
  "taskId": "uuid",
  "imageUrl": "https://.../image.jpg",
  "maxCandidates": 5,
  "lensTimeoutMs": 90000,
  "pageTimeoutMs": 60000
}
```

### 2) 抽取指定 URL（商品详情页或搜索结果页）

```json
{
  "type": "TASK",
  "taskType": "EXTRACT_URL",
  "taskId": "uuid",
  "url": "https://www.amazon.com/dp/B0XXXX",
  "pageTimeoutMs": 60000
}
```

## 插件回传

### 进度

```json
{ "type": "TASK_PROGRESS", "taskId": "uuid", "stage": "lens_links", "ts": "2026-04-28T10:00:00Z" }
```

### 结果

```json
{
  "type": "TASK_RESULT",
  "taskId": "uuid",
  "status": "ok",
  "results": [
    {
      "title": "Example Product",
      "url": "https://www.amazon.com/dp/B0XXXX",
      "price": 24.99,
      "currency": "USD",
      "rating": 4.2,
      "reviewCount": 150,
      "imageUrl": "https://…",
      "asin": "B0XXXX",
      "site": "amazon.com",
      "sellers": [{"name": "…", "id": "…"}],
      "bsr": [{"rank": 123, "category": "Electronics"}],
      "extractedAt": "2026-04-28T10:00:00Z"
    }
  ],
  "errors": [],
  "ts": "2026-04-28T10:00:00Z"
}
```

