# 密钥分发系统 API 文档

## 基础信息

- **Base URL**: `https://你的域名` (例如 `https://distribute-keys.vercel.app`)
- **认证方式**: JWT Token，通过登录接口获取
- **请求格式**: JSON (`Content-Type: application/json`)

---

## 认证

### 登录

```
POST /api/auth/login
```

**请求体**:
```json
{
  "username": "your_username",
  "password": "your_password"
}
```

**成功响应** (200):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "your_username",
    "role": "user"
  }
}
```

**失败响应** (401):
```json
{
  "error": "用户名或密码错误"
}
```

> Token 有效期 7 天。响应同时会设置 httpOnly cookie，浏览器场景自动携带。

---

## 使用 Token

后续所有请求需携带 Token，支持两种方式：

**方式 1 - Authorization Header（推荐）**:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

**方式 2 - Cookie**:
登录时自动设置，curl 通过 `-c`/`-b` 管理 cookie 文件。

---

## 密钥操作

### 获取单个密钥

```
GET /api/keys/{keyName}
```

**路径参数**:
- `keyName` - 密钥名称，例如 `GEMINI_API_KEY`

**成功响应** (200):
```json
{
  "keyName": "GEMINI_API_KEY",
  "value": "AIzaSy..."
}
```

**错误响应**:
- `401` - 未登录
- `403 {"error": "没有访问权限"}` - 无权限访问该密钥
- `404 {"error": "密钥不存在"}` - 密钥名称不存在

### 批量获取密钥

```
POST /api/keys
```

**请求体**:
```json
{
  "keyNames": ["GEMINI_API_KEY", "OPENAI_API_KEY", "SOME_OTHER_KEY"]
}
```

**成功响应** (200):
```json
{
  "keys": {
    "GEMINI_API_KEY": "AIzaSy...",
    "OPENAI_API_KEY": "sk-..."
  }
}
```

> 只返回有权限访问的密钥。无权限或不存在的密钥会被静默跳过。

### 上报使用记录

```
POST /api/keys/{keyName}/usage
```

**路径参数**:
- `keyName` - 密钥名称

**请求体**:
```json
{
  "description": "用于翻译服务调用"
}
```

**成功响应** (200):
```json
{
  "success": true
}
```

**错误响应**:
- `400` - 说明文字为空
- `403` - 无权限
- `404` - 密钥不存在

### 列出可用密钥

```
GET /api/keys
```

返回当前用户有权访问的所有密钥名称（不含密钥值）。

**成功响应** (200):
```json
{
  "keys": [
    { "id": 1, "keyName": "GEMINI_API_KEY" },
    { "id": 2, "keyName": "OPENAI_API_KEY" }
  ]
}
```

---

## 调用示例

### curl

```bash
# 登录
curl -X POST https://域名/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"myuser","password":"mypass"}'

# 获取单个密钥
curl https://域名/api/keys/GEMINI_API_KEY \
  -H "Authorization: Bearer <token>"

# 批量获取密钥
curl -X POST https://域名/api/keys \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"keyNames":["GEMINI_API_KEY","OPENAI_API_KEY"]}'

# 上报使用记录
curl -X POST https://域名/api/keys/GEMINI_API_KEY/usage \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"description":"用于翻译服务"}'
```

### Python

```python
import requests

BASE_URL = "https://域名"

# 登录
resp = requests.post(f"{BASE_URL}/api/auth/login", json={
    "username": "myuser",
    "password": "mypass"
})
token = resp.json()["token"]
headers = {"Authorization": f"Bearer {token}"}

# 列出可用密钥
resp = requests.get(f"{BASE_URL}/api/keys", headers=headers)
print(resp.json()["keys"])

# 获取单个密钥
resp = requests.get(f"{BASE_URL}/api/keys/GEMINI_API_KEY", headers=headers)
print(resp.json()["value"])

# 批量获取密钥
resp = requests.post(f"{BASE_URL}/api/keys", headers=headers,
    json={"keyNames": ["GEMINI_API_KEY", "OPENAI_API_KEY"]})
print(resp.json()["keys"])  # {"GEMINI_API_KEY": "...", "OPENAI_API_KEY": "..."}

# 上报使用记录
requests.post(f"{BASE_URL}/api/keys/GEMINI_API_KEY/usage",
    headers=headers,
    json={"description": "用于翻译服务"})
```

### JavaScript / Node.js

```javascript
const BASE_URL = "https://域名";

// 登录
const loginResp = await fetch(`${BASE_URL}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "myuser", password: "mypass" }),
});
const { token } = await loginResp.json();

// 获取单个密钥
const keyResp = await fetch(`${BASE_URL}/api/keys/GEMINI_API_KEY`, {
  headers: { Authorization: `Bearer ${token}` },
});
const { value } = await keyResp.json();

// 批量获取密钥
const batchResp = await fetch(`${BASE_URL}/api/keys`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ keyNames: ["GEMINI_API_KEY", "OPENAI_API_KEY"] }),
});
const { keys } = await batchResp.json();
```
