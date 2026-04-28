"""
WebSocket 处理器 (PRD 3.1.2)

提供 Chrome 插件与 Web 端的实时双向通信:
  - /ws/extension  - 插件连接端点
  - 支持认证、指令下发、数据回传

需配合 flask-sock 或 gevent-websocket 使用
"""

import json
import time
from collections import defaultdict

from utils.logger import get_logger

logger = get_logger()

# 在线连接池: user_id -> list of ws connections
_connections = defaultdict(list)


def register_websocket_routes(app):
    """
    注册 WebSocket 路由到 Flask 应用

    需要安装: pip install flask-sock
    """
    try:
        from flask_sock import Sock
    except ImportError:
        logger.warning("[WebSocket] flask-sock not installed, WebSocket disabled")
        return

    sock = Sock(app)

    @sock.route("/ws/extension")
    def extension_ws(ws):
        """Chrome 插件 WebSocket 连接端点"""
        user_id = None
        authenticated = False

        try:
            # 等待认证消息 (10秒超时)
            ws.send(json.dumps({"type": "AUTH_REQUIRED"}))

            auth_msg = ws.receive(timeout=10)
            if not auth_msg:
                ws.close()
                return

            auth_data = json.loads(auth_msg)
            if auth_data.get("type") != "AUTH" or not auth_data.get("token"):
                ws.send(json.dumps({"type": "AUTH_FAILED", "message": "Invalid auth message"}))
                ws.close()
                return

            # 验证 token
            from auth.jwt_handler import verify_access_token
            payload = verify_access_token(auth_data["token"])
            if not payload:
                ws.send(json.dumps({"type": "AUTH_FAILED", "message": "Invalid or expired token"}))
                ws.close()
                return

            user_id = payload.get("user_id") or payload.get("id")
            authenticated = True

            # 加入连接池
            _connections[user_id].append(ws)
            logger.info(f"[WebSocket] User {user_id} connected (total: {len(_connections[user_id])})")

            ws.send(json.dumps({
                "type": "AUTH_SUCCESS",
                "user_id": user_id,
            }))

            # 消息循环
            while True:
                msg = ws.receive(timeout=30)
                if msg is None:
                    # 发送心跳
                    ws.send(json.dumps({"type": "PING", "ts": int(time.time())}))
                    continue

                data = json.loads(msg)
                handle_extension_message(user_id, data, ws)

        except Exception as e:
            logger.debug(f"[WebSocket] Connection closed: {e}")
        finally:
            if user_id and ws in _connections.get(user_id, []):
                _connections[user_id].remove(ws)
                logger.info(f"[WebSocket] User {user_id} disconnected")


def handle_extension_message(user_id, data, ws):
    """处理来自 Chrome 插件的消息"""
    msg_type = data.get("type", "")

    if msg_type == "PONG":
        return  # 心跳响应

    elif msg_type == "TASK_PROGRESS":
        broadcast_to_user(user_id, {
            "type": "TASK_PROGRESS",
            "task_id": data.get("taskId") or data.get("task_id"),
            "stage": data.get("stage"),
            "ts": data.get("ts"),
            "extra": {k: v for k, v in data.items() if k not in {"type", "taskId", "task_id", "stage", "ts"}}
        }, exclude_ws=ws)

    elif msg_type == "TASK_RESULT":
        broadcast_to_user(user_id, {
            "type": "TASK_RESULT",
            "task_id": data.get("taskId") or data.get("task_id"),
            "status": data.get("status"),
            "results": data.get("results", []),
            "errors": data.get("errors", []),
            "error": data.get("error"),
            "ts": data.get("ts")
        }, exclude_ws=ws)

    elif msg_type == "PRODUCT_DATA":
        # 插件回传的产品数据
        logger.info(f"[WebSocket] Received product data from user {user_id}: {data.get('asin')}")
        # 存储到数据库或转发到前端
        broadcast_to_user(user_id, {
            "type": "PRODUCT_DATA_RECEIVED",
            "asin": data.get("asin"),
            "status": "success",
        }, exclude_ws=ws)

    elif msg_type == "SCRAPE_COMPLETE":
        # 插件完成抓取任务
        broadcast_to_user(user_id, {
            "type": "SCRAPE_TASK_COMPLETE",
            "task_id": data.get("task_id"),
            "results_count": data.get("results_count", 0),
        }, exclude_ws=ws)

    elif msg_type == "ERROR":
        logger.error(f"[WebSocket] Extension error from user {user_id}: {data.get('message')}")

    else:
        logger.debug(f"[WebSocket] Unknown message type from user {user_id}: {msg_type}")


def broadcast_to_user(user_id, message, exclude_ws=None):
    """向指定用户的所有连接广播消息"""
    msg_str = json.dumps(message)
    dead_connections = []

    for ws in _connections.get(user_id, []):
        if ws == exclude_ws:
            continue
        try:
            ws.send(msg_str)
        except Exception:
            dead_connections.append(ws)

    # 清理断开的连接
    for ws in dead_connections:
        if ws in _connections.get(user_id, []):
            _connections[user_id].remove(ws)


def send_to_extension(user_id, command):
    """
    从 Web 端向用户的 Chrome 插件发送指令

    支持的指令类型:
      - NAVIGATE: 打开指定 URL
      - SCRAPE_ASIN: 抓取指定 ASIN
      - SCRAPE_PAGE: 抓取当前页面
      - BATCH_SCRAPE: 批量抓取多个 ASIN
    """
    connections = _connections.get(user_id, [])
    if not connections:
        logger.warning(f"[WebSocket] No extension connected for user {user_id}")
        return False

    msg_str = json.dumps(command)
    sent = False
    for ws in connections:
        try:
            ws.send(msg_str)
            sent = True
            break  # 只发给第一个活跃连接
        except Exception:
            continue

    return sent


def get_online_users():
    """获取当前在线的用户列表"""
    return {uid: len(conns) for uid, conns in _connections.items() if conns}
