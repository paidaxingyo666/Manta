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

还有三个可选项：`MANTA_RELAY_ACCOUNTS`（这个中继是一个身份还是每人一个，见下文
第 3 步）、`MANTA_RELAY_ALLOW_REGISTRATION`（谁可以注册：不设=沿用注册密钥、
`open`、`disabled`，仅在 per-user 下有意义）和 `MANTA_RELAY_MAX_HOSTS_PER_ACCOUNT`
（每个账号最多几台设备，默认 16）。

两个密钥都可用：`openssl rand -base64 32`。

Caddy 终止 TLS 并转发给中继，中继本身不对主机暴露端口。中继容器以非特权、
只读根文件系统运行。

**用现成镜像，或自行构建。** 不改任何配置时，compose 会就地编译当前 checkout ——
小配置 VPS 要花几分钟，且主机上未必装了工具链。想直接拉取已发布的镜像，在 `.env`
里设 `RELAY_IMAGE`：

```bash
# Docker Hub
RELAY_IMAGE=paidaxingyo666/manta-relay:1.1.0-dev.1

# 阿里云（上海）—— 同一个镜像，一次构建同时推送两处，digest 一致
RELAY_IMAGE=crpi-b5cuqx1nkkudw599.cn-shanghai.personal.cr.aliyuncs.com/manta-relay/manta-relay:1.1.0-dev.1
```

两处都含 `linux/amd64` 与 `linux/arm64`，`docker pull` 会自动选对架构。请固定版本号
而不是用 `:latest` —— 中继在重启后悄悄换了版本不是好事。

**账号功能需要 1.1.0 或更新的镜像。** 1.0.0 早于账号层，对所有账号端点都返回 404，
登录和设备列表在它上面根本不存在。从源码构建（默认行为）永远与当前检出一致。

`1.1.0-dev.1` 是预发布版本，上面的固定版本号写的就是它——因为目前发布出来的就是它。
预发布不会带 `:latest`，所以不指定标签的 `docker pull` 仍然拿到上一个稳定版。等账号层
在真实环境跑一段时间后，再用 `1.1.0` 取代它。

如果你跑的是未发布的提交，或者不愿意用别人构建的二进制，从源码构建仍然是对的选择。

部署前先验证镜像：

```bash
docker run --rm -p 8787:8787 \
  -e MANTA_RELAY_PUBLIC_URL=http://127.0.0.1:8787 \
  -e MANTA_RELAY_TOKEN_SECRET="$(openssl rand -base64 32)" \
  paidaxingyo666/manta-relay:1.1.0-dev.1

curl localhost:8787/health
# {"ok":true,"version":"1.1.0-dev.1","revision":"a1b2c3d…","builtAt":"2026-08-21T14:00:04Z"}
```

这只是冒烟测试，不是部署 —— 没有注册密钥、没有 TLS，中继会拒绝任何注册请求。
正式部署请用 compose。

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

应用后会退出登录并重启 —— 一个部署签发的会话对另一个部署没有意义。

每台桌面端重复一次，它们共用同一个注册密钥。

### 3. 决定这个中继给谁用

默认情况下，一个中继只服务**一个身份**：所有拿着注册密钥的人就是同一个人，
没有什么可登录的，桌面端根本不带账号连上去。自己一个人用的中继通常就要这样，
账号层出现之前的中继也都是这样。

几个人共用一个中继时，设 `MANTA_RELAY_ACCOUNTS=per-user`。这时每个人各自注册，
各有自己的身份和自己的设备 —— 设置 → **Manta 账户** → 填邮箱和密码，或点
**在此中继创建账号**。账号只存在于你自己的中继上，密码也只有中继见得到。

二选一，部署时定下来。一个两种都收的中继，只要有人手滑点一下就会落到共享身份上，
而在那里他的设备就是所有人的设备 —— 所以桌面端会先问中继是哪一种，只画那一种界面。

在第二台电脑上登录同一个账号，两台就归到一起了：**我的设备** 会列出该账号下的
每台电脑、谁当前在线、各自最后一次在线是什么时候。这也是 per-user 中继能保持诚实
的原因 —— 一台主机从被认领的那一刻起就只属于一个账号，别的账号来要 token 会被拒。

谁可以注册由 `MANTA_RELAY_ALLOW_REGISTRATION` 决定；不设时沿用注册密钥作门槛，
这正是暴露在公网的中继所需要的。账号层之前就在跑的中继原样继续跑 —— 不设
`MANTA_RELAY_ACCOUNTS` 就是它原来的样子。之后再改成 `per-user` 也不会丢东西：
所有主机仍挂在旧的共享身份下，每台桌面端会用它本来就有的注册密钥，在有人首次
在它上面登录时把自己要回来。

### 4. 配对手机

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
