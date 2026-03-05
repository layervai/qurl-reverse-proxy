# NHP-FRP

[English](README.md) | [中文](README_zh.md)

NHP-FRP 将 [OpenNHP](https://github.com/OpenNHP/opennhp)（网络隐身协议）与 [frp](https://github.com/fatedier/frp)（快速反向代理）集成，为反向代理隧道提供**零信任网络访问**能力。

## NHP-FRP 是什么？

标准的 frp 会将服务器端口暴露在公网上，端口扫描器和攻击者可以轻松发现这些端口。NHP-FRP 通过添加 NHP 层来解决这个问题——**默认隐藏所有服务器端口**，仅对经过身份验证和授权的客户端开放。

**工作原理：**

1. NHP Agent（内置于 `nhp-frpc`）在连接前向 NHP 服务器发送加密的"敲门"数据包
2. NHP 服务器验证客户端身份，**仅对该客户端 IP** 开放 frp 服务器端口
3. frp 隧道通过刚刚开放的端口建立连接
4. 会话结束后端口重新隐藏，对其他所有流量不可见

这使 frp 变成了**零信任反向代理**——服务在网络上完全不可见，直到经过验证的客户端需要访问时才会出现。

## 架构

### 问题：标准 frp

使用标准 frp 时，服务器端口（如 7000）始终开放，对互联网上的任何人可见：

```
                             公共互联网
  ┌──────────┐                                    ┌──────────────────────────┐
  │  frpc    │──── frp 隧道 (TCP:7000) ─────────>│  frps (:7000 开放)       │
  │  客户端  │                                    │         │                │
  └──────────┘                                    │         v                │
                                                  │   后端服务               │
  ┌──────────┐                                    │   ┌─────────────────┐   │
  │  攻击者  │──── 端口扫描 / 漏洞利用 ─────────>│   │ Web 应用 :8080 │   │
  │          │     :7000 可被发现！                │   │ SSH      :22    │   │
  └──────────┘                                    │   │ 数据库   :3306  │   │
                                                  │   └─────────────────┘   │
                                                  └──────────────────────────┘
                                                          私有网络
```

**问题：** 端口 7000 暴露在整个互联网上。攻击者可以通过端口扫描发现它，然后尝试暴力破解、漏洞利用或发起 DDoS 攻击。

### 解决方案：NHP-FRP

NHP-FRP 隐藏所有服务器端口，仅对经过验证的客户端在有限时间内开放：

```
                             公共互联网
                                                  ┌──────────────────────────┐
                  1. NHP 敲门 (UDP)               │                          │
  ┌──────────┐ ─────────────────────────────────> │  NHP 服务器 (nhp-door)   │
  │ nhp-frpc │                                    │    │ 2. 验证身份         │
  │  客户端  │         3. 端口开放                │    │    开放防火墙        │
  │ （内置   │           （仅对此 IP）             │    v                     │
  │   NHP    │                                    │  防火墙                  │
  │  Agent） │ ── 4. frp 隧道 (TCP:7000) ──────> │  [允许客户端IP:7000]     │
  └──────────┘                                    │    │                     │
                                                  │    v                     │
                                                  │  nhp-frps (:7000)       │
  ┌──────────┐                                    │    │                     │
  │  攻击者  │──── 端口扫描 ─────────── X ──────>│    v                     │
  │          │     :7000 不可见！                  │  后端服务                │
  └──────────┘    （所有端口关闭）                 │  ┌─────────────────┐    │
                                                  │  │ Web 应用 :8080  │    │
                                                  │  │ SSH      :22    │    │
                                                  │  │ 数据库   :3306  │    │
                                                  │  └─────────────────┘    │
                                                  └──────────────────────────┘
                                                          私有网络
```

**分步流程：**

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | **NHP 敲门** | `nhp-frpc` 向 NHP 服务器发送加密的 UDP 敲门数据包 |
| 2 | **验证并开放** | NHP 服务器验证客户端的加密身份，指示防火墙**仅对该客户端 IP** 开放 7000 端口 |
| 3 | **端口开放** | 防火墙现在允许来自该客户端 IP 到 7000 端口的流量，其他所有 IP 仍然看到端口关闭 |
| 4 | **FRP 隧道** | `nhp-frpc` 通过刚刚开放的端口建立 frp 隧道 |
| 5 | **服务访问** | 流量通过 frp 隧道到达私有网络中的后端服务 |

**效果：** 服务器在公网上**零端口暴露**。即使攻击者知道服务器 IP 地址，端口扫描也不会返回任何结果。只有能通过 NHP 加密敲门证明身份的客户端才能访问服务。

### 组件

| 程序 | 说明 |
|------|------|
| `nhp-frpc` | frp 客户端，内置 NHP Agent——连接前执行 NHP 敲门 |
| `nhp-frps` | frp 服务端（轻量封装，未来计划集成 NHP） |
| `nhp-agent.dll/.so/.dylib` | nhp-frpc 使用的 NHP SDK 动态链接库 |

## 项目结构

```
nhp-frp/
  cmd/
    frpc/           # nhp-frpc 入口（NHP Agent + frp 客户端）
    frps/           # nhp-frps 入口（frp 服务端封装）
  conf/             # 配置文件示例
  hack/             # 构建辅助脚本
  third_party/
    opennhp/        # OpenNHP 子模块（NHP SDK 源码）
  bin/              # 构建输出
    nhp-frpc(.exe)
    nhp-frps(.exe)
    sdk/            # NHP SDK 动态链接库
  build.bat         # Windows 构建脚本
  Makefile          # Linux/macOS 构建脚本
```

本项目是上游 frp 的**轻量封装**——通过 Go module 依赖导入 [frp v0.67.0](https://github.com/fatedier/frp)，而非 fork 源代码。仓库中仅包含 NHP 相关代码，升级上游 frp 只需修改 `go.mod` 中的版本号。

## 构建

### 前置条件

- **Go** 1.23+
- **GCC**（用于通过 CGO 构建 NHP SDK 动态链接库）
  - Linux: `apt install gcc` 或等效命令
  - macOS: Xcode Command Line Tools
  - Windows: [MSYS2](https://www.msys2.org/) 并安装 `mingw-w64-x86_64-gcc`

### Linux / macOS

```bash
# 构建全部（nhp-frps + nhp-frpc 及 SDK）
make

# 构建单个目标
make frps
make frpc        # 包含 SDK 构建
make build-sdk   # 仅构建 SDK
```

### Windows

```cmd
:: 构建全部
build.bat

:: 构建单个目标
build.bat frps
build.bat frpc        &:: 包含 SDK 构建
build.bat build-sdk   &:: 仅构建 SDK

:: 其他命令
build.bat clean
build.bat help
```

> **Windows 注意事项：** SDK 构建需要 MSYS2 MinGW-w64。构建脚本会自动检测 `C:\Program Files\msys2` 或 `C:\msys64` 中的 MSYS2。如果 DLL 构建被阻止，可能需要在 Windows Defender 中为 `bin\sdk\` 目录和临时文件夹添加排除项。

## 配置

NHP-FRP 使用与 frp 相同的配置格式。将配置文件放在程序同目录下或通过 `-c` 指定。

**frps（服务端）：** `frps.toml`
```toml
bindPort = 7000
```

**frpc（客户端）：** `frpc.toml`
```toml
serverAddr = "127.0.0.1"
serverPort = 7000

[[proxies]]
name = "test-tcp"
type = "tcp"
localIP = "127.0.0.1"
localPort = 22
remotePort = 6000
```

完整配置示例请参见 [conf/](conf/) 目录。frp 配置详情请参考 [frp 文档](https://github.com/fatedier/frp#configuration)。

NHP Agent 独立配置——它从 `nhp-frpc` 程序所在目录读取配置。NHP 配置详情请参见 [OpenNHP 文档](https://github.com/OpenNHP/opennhp)。

## 运行

```bash
# 启动服务端
./bin/nhp-frps -c ./conf/frps.toml

# 启动客户端（NHP Agent 自动启动）
./bin/nhp-frpc -c ./conf/frpc.toml
```

`nhp-frpc` 启动时，会首先初始化 NHP Agent 执行加密敲门流程。NHP 握手成功后，frp 客户端正常连接服务器。

## 相关项目

- [frp](https://github.com/fatedier/frp) -- 上游快速反向代理
- [OpenNHP](https://github.com/OpenNHP/opennhp) -- 网络隐身协议实现

## 许可证

Apache License 2.0 -- 详见 [LICENSE](LICENSE)。

本项目基于 fatedier 的 [frp](https://github.com/fatedier/frp)（Apache 2.0）和 OpenNHP 团队的 [OpenNHP](https://github.com/OpenNHP/opennhp) 构建。
