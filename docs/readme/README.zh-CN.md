<h1 align="center">
  <a href="https://github.com/paidaxingyo666/Manta"><img src="../../resources/build/icon.png" alt="Manta" width="64" valign="middle" /></a> Manta
</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-08C?style=flat" alt="License: MIT" />
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="支持 macOS、Windows、Linux" />
</p>

**Manta 是 [Orca](https://github.com/stablyai/orca) 的自托管 fork**（MIT，© Lovecast Inc.）。

特性：

- 自建中继服务器
- 无需强制云账号
- 国际化
- 企业内部署

基于：https://github.com/stablyai/orca

目前尚未发布独立的 Manta 构建产物 —— 请从源码构建。

Manta 没有云服务。登录与中继默认关闭，需在 设置 → 高级 → Manta Cloud 端点
中指向你自己的部署；服务端代码在 `relay-server/`。文档链接指向
`manta.sh.cn`，那不是公共服务。

---

## 从源码构建

需要 Node 20+ 与 pnpm。

```bash
pnpm install
pnpm dev            # 运行桌面端
pnpm build:mac      # 或 build:win / build:linux
```

移动端在 `mobile/`，是一个 Expo 应用：

```bash
cd mobile && pnpm install && npx expo run:ios   # 或 run:android
```

---

## 部署中继

中继的作用是让手机连上不在同一网络的桌面端。它是独立部署的服务 —— 桌面端只通过
网络与它通信 —— 并且是可选的：同一局域网内手机可直接配对。

一个中继可以服务多台桌面端。每台由自身密钥的哈希标识，因此与某台配对的手机无法
连到另一台。

### 1. 启动服务端

在一台已解析域名的主机上：

```bash
git clone https://github.com/paidaxingyo666/Manta /opt/manta
cd /opt/manta/relay-server/deploy
cp .env.example .env
$EDITOR .env
docker compose up -d
```

`.env` 需要四个值，全部必填 —— compose 宁可拒绝启动，也不会退回到不安全的默认值：

| 变量 | 含义 |
| --- | --- |
| `RELAY_DOMAIN` | Caddy 申请证书所用的域名 |
| `RELAY_PORT` | 对外端口；除非该主机无法使用，否则填 443 |
| `MANTA_RELAY_ENROLLMENT_SECRET` | 桌面端注册时出示的密钥；不设则任何能访问到的人都能注册 |
| `MANTA_RELAY_TOKEN_SECRET` | 签发中继令牌；留空则每次重启都会让已签发的令牌失效 |

两个密钥都可用：`openssl rand -base64 32`。

Caddy 终止 TLS 并转发给中继，中继本身不对主机暴露端口。中继容器以非特权、
只读根文件系统运行。

### 2. 让桌面端指向它

设置 → 高级 → Manta Cloud → **自建服务器** → **配置端点**：

| 字段 | 值 |
| --- | --- |
| 登录服务器 | `https://relay.example.com` |
| 中继地址 | `https://relay.example.com` |
| OAuth 客户端 ID | `manta-desktop` |
| 注册密钥 | `MANTA_RELAY_ENROLLMENT_SECRET` 的值 |

若中继不在 443 端口，必须带上端口号。该来源会逐字节参与主机质询的签名，
`https://host` 与 `https://host:9443` 是两个不同身份，不一致会导致握手失败。

应用后会退出登录并重启 —— 一个部署签发的会话对另一个部署没有意义。不会打开
浏览器：配置了密钥后，桌面端直接用它换取会话。

每台桌面端重复一次，它们共用同一个注册密钥。

### 3. 配对手机

桌面端 设置 → 移动端 会显示二维码，用手机 App 扫描即可。

**完整参考 —— 配置项、非标端口上的 TLS、可观测性、运维注意事项：
[`relay-server/README.md`](../../relay-server/README.md)。**

---

## 参与贡献

见 [CONTRIBUTING.md](../../.github/CONTRIBUTING.md)。适用于所有改动的设计与平台
规则在 [AGENTS.md](../../AGENTS.md)。

## 许可证

MIT —— 见 [LICENSE](../../LICENSE)。上游 Orca 的版权声明与本 fork 的并列保留在其中。

上游 Orca 的[贡献者](https://github.com/stablyai/orca/graphs/contributors)写下了
本项目所基于的代码。其 [Discord](https://discord.gg/fzjDKHxv8Q) 与
[@orca_build](https://x.com/orca_build) 属于上游，不属于本 fork —— Manta 的问题请
在[这里](https://github.com/paidaxingyo666/Manta/issues)提 issue。
