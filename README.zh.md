<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

# 🛡️ Argus

### **在投资研究报告上做决策前，先审计一下。**

*揪出虚构引用、错位引述、过时数据、内部矛盾 —— 并把整条推理链摆给你看。*

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.x-purple)](https://github.com/langchain-ai/langgraph)
[![Tests](https://img.shields.io/badge/tests-120_passing-success)](#测试)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[English](README.md)** · **[简体中文](README.zh.md)**

</div>

---

## 🧭 问题

买方分析师每周要读几十份股票研究报告。卖方笔记、第三方白皮书，再加上一大批
**AI 自动生成的研究** —— 它们混杂在一起。而 AI 作者会幻觉：引用根本不存在的论文、
把原文释意成相反含义、引用两个季度前已被刷新的 GDP 数字、第 12 页打第 3 页的脸。

**一条假引用就能撼动几十亿美金的决策。** 而靠人工逐条核查每份报告里的每个声明，
不是一个人该干的活。

## 🎯 Argus 干什么

你给它一份 PDF。它返回 **每一个事实声明**、**每个声明的判决**，以及 **每一步推理过程**。

| 问题类型 | 干什么 | 怎么验证 |
|---|---|---|
| 🪤 **虚构引用** | 文中的引用根本不存在 | Crossref / arXiv / SSRN 交叉验证 |
| 🪞 **错位引述** | 释意 ≠ 原文意思 | 抓取原 URL，逐段对比 |
| 📉 **过时数据** | 数字早被更新数据淘汰 | FRED / 世界银行 / SEC EDGAR / IMF |
| 🧩 **内部矛盾** | 报告自相矛盾 | 全报告 claim 两两扫描 |

每条 finding 都带上：

- **判决**（`fabricated` / `mismatch` / `stale` / `contradiction` / `ok` / `uncertain`）
- **严重程度**（`critical` / `major` / `minor`）
- **置信度** 0–1
- **一句话总结**
- **证据链** —— 可点击的来源 URL + 抓到的原文片段
- **完整推理记录** —— 每次网页搜索、抓取的网页、跑的 Python、思考过程

## ✨ 杀手锏：**推理透明化**

> *"过去你看到一份研报，只能选择信或不信。Argus 让你看到 AI 是怎么一步步把每句话
> 验证一遍 —— 并告诉你哪些句子在撒谎。"*

推理不是黑盒。前端实时流式渲染每一步：

```
seq=  3  🔍 web_search       CitationVerifier  ⟶  "Smith 2021 widget resilience SSRN"
seq=  4  🌐 fetch_url_content CitationVerifier ⟶  https://api.crossref.org/works/...
seq=  5  💭 thinking          CitationVerifier ⟶  "Crossref 返回 404。改查 arXiv..."
seq=  6  ✅ finding 产出       CitationVerifier ⟶  fabricated · major · 置信度 0.91
```

看着每个 agent 思考。看着每条来源被检查。**审视每个决策。**

## 🏗️ 怎么实现的

一个 LangGraph 状态机把 5 个 agent 在 PDF 的 claim 集合上 fan-out：

```
                      ┌─────────────────────────────┐
                      │   📄 PDF 解析 (pdfplumber)    │
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  🧠 Planner Agent              │
                      │  → 抽取有类型的 claim          │
                      └──────────────┬──────────────┘
                                     │  fan-out
            ┌──────────────┬─────────┼─────────┬──────────────┐
            ▼              ▼         ▼         ▼              ▼
       ┌────────┐    ┌──────────┐  ┌──────┐  ┌──────────────┐
       │引用    │    │引用      │  │数据  │  │  一致性       │
       │验证   │    │对齐      │  │时效  │  │   检查        │
       └───┬────┘    └────┬─────┘  └──┬───┘  └──────┬───────┘
           └──────────────┴────┬──────┴─────────────┘
                               │  fan-in (LangGraph reducer)
                               ▼
                      ┌─────────────────────────────┐
                      │  📋 Reporter Agent             │
                      │  → 行政摘要（Markdown）        │
                      └─────────────────────────────┘
```

每个专家 agent 并行运行，各管自己负责的 claim 类型，状态 reducer 把它们的发现
合并到一起 —— 没有竞态条件。

### 工程化控制

- **`BoundedRunner`** —— 每个 agent 一个信号量约束并发
- **`BudgetTracker`** —— 硬 USD 上限，超了立即中止，防失控烧钱
- **`retry_on_transient`** —— 上游 `429` / `5xx` 指数退避重试
- **`make_idempotency_key`** —— 确定性的 job-keyed 幂等 key，为事件存储去重铺路
- **`json-repair`** —— LLM JSON 损坏的启发式修复（缺逗号、未转义字符串等）

### 持久化层

```
domain.Pydantic ←─ 1:1 双向 ─→ SQLAlchemy 2.0 async ORM
                                    │
                    ┌──── aiosqlite（测试 + demo）────┐
                    │                                  │
                    └──── asyncpg + Postgres（生产）───┘

Alembic migration 同一套版本历史同时覆盖两个 backend。
```

### Live trace bus

```
audit_pdf() ──publish──→  TraceBus 协议
                              ├── InProcessBus（asyncio.Queue，单实例）
                              └── RedisPubSubBus（pub/sub，多实例安全）
                                         │
                                         ▼
                              WebSocket /ws/jobs/{id}/trace
                              ├── 历史回放（?after=<seq>）
                              └── 实时流直到终态事件
```

## 🚀 快速开始

### 方式 A —— Web UI（推荐）

```bash
# 1. 后端
cp .env.example .env       # 填入 ARGUS_MIROMIND_API_KEY
uv sync
uv run argus serve --host 127.0.0.1 --port 8080

# 2. 前端（新终端）
cd web && pnpm install && pnpm dev

# 3. 打开 http://localhost:3000
#    点 "Upload a PDF" → 看 live 流式审计。
```

> 💡 不想烧 MiroMind credits？点 **"…or try the sample audit"** 加载预置 demo，
> 6 个 finding 横跨四类问题。

### 方式 B —— 命令行

```bash
uv sync
export ARGUS_MIROMIND_API_KEY=sk_…

uv run argus audit examples/sample-report.pdf \
  -o findings.json \
  --budget-usd 50
```

CLI 跑的是和服务端完全相同的 5-agent 流水线。要持久化加 `--db-url`：

```bash
docker compose up -d postgres
uv run alembic -c alembic.ini upgrade head
uv run argus audit your-report.pdf \
  --db-url postgresql+asyncpg://argus:argus@localhost:5436/argus
```

### 方式 C —— HTTP API

```bash
uv run argus serve --host 0.0.0.0 --port 8080
```

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET`  | `/healthz` | 健康检查 |
| `POST` | `/jobs` | 上传 PDF（multipart `pdf=…`）→ `{job_id}` 202 |
| `GET`  | `/jobs/{job_id}` | 查询状态或拿到最终 Job JSON |
| `WS`   | `/ws/jobs/{job_id}/trace` | 历史回放 + 实时事件流 |

Curl 示例：

```bash
JOB=$(curl -s -X POST http://127.0.0.1:8080/jobs \
  -F "pdf=@your-report.pdf;type=application/pdf" | jq -r .job_id)

# 订阅实时事件
wscat -c "ws://127.0.0.1:8080/ws/jobs/${JOB}/trace?after=0"
```

## 🧰 技术栈

| 层 | 选型 |
|---|---|
| **模型** | MiroMind `mirothinker-1-7-deepresearch` 走 Responses API |
| **编排** | LangGraph 1.x StateGraph，reducer 做 fan-in |
| **后端** | Python 3.12 · Pydantic v2 · FastAPI · uvicorn · httpx + 原生 SSE |
| **持久化** | SQLAlchemy 2.0 async · asyncpg / aiosqlite · Alembic |
| **Live bus** | WebSocket · 可插拔 `TraceBus`（in-process / Redis pub/sub） |
| **PDF** | pdfplumber + pymupdf |
| **前端** | Next.js 16 · React 19 · TypeScript 5 · Tailwind v4 · Zustand · react-pdf · @xyflow/react |
| **CLI** | Typer · structlog |
| **测试** | pytest-asyncio · respx · vitest · @testing-library/react |

## 🧪 测试

```bash
# 后端
uv run pytest -q          # 88 collected（无 Redis 时 1 skipped）
uv run mypy src/argus     # 严格类型检查
uv run ruff check .       # lint

# 前端
cd web && pnpm test       # vitest，32 passing
```

核心模块覆盖率 **91%**。

编排器有端到端测试，对接一个确定性的 `StreamRouter` mock 回放预设的 MiroMind SSE
事件，所以完整 5-agent fan-out 在不烧 live credit 的前提下也能被覆盖。

## 🗺️ 路线图

- [x] Plan A —— vertical slice CLI（Planner + Verifier）
- [x] Plan B1 —— 五个 agent（Alignment, Freshness, Consistency, Reporter）
- [x] Plan B2 —— LangGraph 并行流水线 + 工程化控制
- [x] Plan B3a —— async SQLAlchemy 持久化 + Alembic
- [x] Plan B3b —— FastAPI + WebSocket + 可插拔 TraceBus
- [x] Plan B3c —— 前端 live 模式（真上传 + WS 流）
- [x] Plan C —— Next.js UI（PDF viewer, DAG, reasoning panel, trace replay）
- [ ] Plan D-1 —— 带标注的评估集 + precision/recall 计算
- [ ] Plan D-2 —— 公网 demo 部署

## 🎬 Demo

> Demo 视频 —— 即将上线。在此之前，跑 `pnpm dev` 然后点 "Try the sample audit"。

## 🤝 贡献

这是 UCWS Singapore 2026 × MiroMind Deep Research 黑客松提交项目。
提交窗口结束后欢迎 issue 和 PR。

## 📜 协议

[MIT](LICENSE)

## 🙏 致谢

- **[MiroMind](https://platform.miromind.ai/)** 提供 `mirothinker-1-7-deepresearch`
  模型和 Responses API
- **[UCWS Singapore](https://www.ucws.sg/)** 举办本次黑客松
- **[LangGraph](https://github.com/langchain-ai/langgraph)** 提供 agent 编排原语
- **[json-repair](https://github.com/mangiucugna/json_repair)** 不止一次救我们于 LLM 输出畸形之手
