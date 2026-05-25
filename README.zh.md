<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

# 🛡️ Argus

### **Argus 是 AI 生成内容的审计层。**

*Patronus 和 Galileo 帮你构建可以上线的 AI。*
*Argus 帮你信任别人交付给你的 AI。*

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.x-purple)](https://github.com/langchain-ai/langgraph)
[![Tests](https://img.shields.io/badge/tests-122_passing-success)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[English](README.md)** · **[简体中文](README.zh.md)**

</div>

---

## 🧭 我们要解决什么

一位合规官收到了供应商发来的 AI 生成风险备忘录。一名律师打开了对方律所聊天机器人起草的诉状。一位买方基金经理拿到了第三方 RAG 系统生成的研究报告。这些文件都不是他们写的；但他们都必须在采取行动之前*信任*它。

这个问题背后的数字触目惊心：

- **$67.4B**：2024 年企业因 AI 幻觉造成的损失
- **1,353+**：有据可查的涉及 AI 幻觉的法庭案件（且还在加速增长）
- **76%** 的企业仍依靠人工审核来发现幻觉 —— 每名员工每年花费约 **$14K**
- **30%** 的企业 AI 项目将在 2026 年前因信任问题被放弃（Gartner）

现有市场（Patronus、Galileo、Vectara）向 AI 的*生产者*出售内联评分服务 —— 也就是那些构建 RAG 流水线和 AI 产品的团队。没有人服务 AI 输出的*消费者*。Argus 做的就是这件事。

## 🎯 Argus 做什么

你给它任何一份 AI 生成的文档 —— PDF、备忘录、研究报告、聊天记录。它还给你**每一个事实性声明**、**每个声明的判决**，以及**得出判决的每一步推理过程**。

| 问题类型 | 它能抓到什么 | 如何验证 |
|---|---|---|
| 🪤 **虚构引用** | 根本不存在的论文、案例、备案文件 | Crossref / arXiv / SSRN / 公开注册库 |
| 🪞 **错位引述** | 释义 ≠ 原文 | 抓取被引 URL，逐段对比 |
| 📉 **过时数据** | 已被更新数据取代的数字 | FRED / 世界银行 / SEC EDGAR / IMF |
| 🧩 **内部矛盾** | 文档自相矛盾 | 两两声明一致性检查 |

每条发现都附带：判决、严重程度、置信度、证据链（可点击的来源 URL + 原文片段），以及完整推理记录 —— agent 执行的每次网页搜索、每个抓取的页面、每一步思维链。

## 👥 谁会用 Argus

**法律与合规团队。** 对方律所用 AI 起草了诉状。你需要在引用这些案例之前标出其中的虚构内容。Argus 的证据链可以作为你回应的附件直接归档。

**AI 治理团队（受监管行业）。** 你的分析师把 ChatGPT 的输出粘贴进了董事会备忘录。你需要在"模型说了这句话"和"我们签字认可"之间设一道关卡。92% 的财富 500 强要求系统性事实核查；Argus 就是你的审计门禁。

**投研分析师。** 供应商发来了一份 40 页的 AI 生成研究报告。你读不完全部；你不能全盘信任；逐条手工核查每个引用在经济上也不划算。Argus 只把有问题的地方呈现给你。

## 🆚 与 Patronus / Galileo / Vectara 的区别

|  | Patronus / Galileo / Vectara | **Argus** |
|---|---|---|
| **买家** | AI 基础设施团队 | **AI 输出消费者**（合规、法务、研究） |
| **集成方式** | API 内联嵌入 RAG 流水线 | **上传文件 / 粘贴文本 → 审计报告** |
| **核心输出** | 分数 / 分类标签 | **完整推理链 + 证据链 + 判决** |
| **计费方式** | 按 token / 按调用 | **按次审计 / 按案例** |
| **信任凭证** | 数值分数 | **可导出 PDF 审计报告**（可归档、可引用） |

我们不在幻觉分类器的准确率上竞争。我们的竞争点在于：**人类能否读懂我们做了什么，并信任这个判决。**

## ✨ 推理透明度

前端**实时**流式渲染每一步，就在它发生的当下：

```
seq=  3  🔍 web_search       CitationVerifier  ⟶  "Smith 2021 widget resilience SSRN"
seq=  4  🌐 fetch_url_content CitationVerifier ⟶  https://api.crossref.org/works/...
seq=  5  💭 thinking          CitationVerifier ⟶  "Crossref returned 404. Checking arXiv..."
seq=  6  ✅ finding emitted    CitationVerifier ⟶  fabricated · major · 0.91 confidence
```

验证完成后，**对抗性辩论协议**（攻击方 / 防御方 / 法官 —— 每轮使用 DeepSeek，花费约 $0.001）对每一条高风险发现进行压力测试。辩论记录随审计报告一并交付。审阅者看到的不仅是判决，还有对判决最强有力的反驳意见 —— 以及它为何输了。

## 🏗️ 工作原理

一个 LangGraph 状态机将 10+ 个专业 agent 展开，覆盖文档中的所有声明：

```
                      ┌─────────────────────────────┐
                      │   📄 Ingest (PDF or text)     │
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  🧠 Planner → Atomizer        │
                      │  → typed atomic claims        │
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  🎯 CheckWorthiness gate      │
                      │  → drops trivial claims       │
                      └──────────────┬──────────────┘
                                     │  fan-out (per claim type)
            ┌──────────────┬─────────┼─────────┬──────────────┐
            ▼              ▼         ▼         ▼              ▼
       ┌────────┐   ┌──────────┐  ┌──────┐  ┌────────────┐  ┌────────────┐
       │Citation│   │ Citation │  │Data  │  │Consistency │  │ Evidence   │
       │Verifier│   │Alignment │  │Fresh.│  │  Checker   │  │  Hunter    │
       └───┬────┘   └────┬─────┘  └──┬───┘  └────┬───────┘  └────┬───────┘
           └─────────────┴──────┬────┴───────────┴───────────────┘
                                ▼
                      ┌─────────────────────────────┐
                      │  ⚔️ Challenger (debate)      │
                      │  Attacker / Defender / Judge  │
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  📋 Reporter → audit report   │
                      │  → executive summary + PDF    │
                      └─────────────────────────────┘
```

Atomizer / CheckWorthiness / Challenger 运行在 DeepSeek 上（成本低），MiroMind 的费用集中用在真正重要的验证器上。典型的单文档审计模型调用成本约 ~$3 —— 相比之下，它所替代的人工分析师审查成本约 ~$70。

### 工程化控制

- **`BoundedRunner`** — 每个 agent 的信号量并发上限
- **`BudgetTracker`** — 硬性 USD 上限，超支前中途中止，防止失控烧钱
- **`retry_on_transient`** — 针对上游 `429` / `5xx` 的指数退避重试
- **`make_idempotency_key`** — 确定性的 job-keyed 幂等键
- **`json-repair`** — LLM JSON 输出的启发式修复

### 存储与实时事件流

SQLAlchemy 2.0 异步 ORM，开发/测试环境使用 aiosqlite，生产环境使用 asyncpg + Postgres，Alembic 迁移在两个后端之间共享同一套版本历史。可插拔的 `TraceBus` 通过 WebSocket 推送实时 agent 事件 —— 单实例使用 `InProcessBus`，多实例使用 Redis pub/sub。

## 🚀 快速开始

### 方式 A — Web UI

```bash
# 1. Backend
cp .env.example .env       # fill in ARGUS_MIROMIND_API_KEY (or skip — UI accepts BYOK)
uv sync
uv run argus serve --host 127.0.0.1 --port 8080

# 2. Frontend
cd web && pnpm install && pnpm dev

# 3. Open http://localhost:3000
#    Click "…or try the sample audit" to see a curated audit without an API key.
```

### 方式 B — 命令行

```bash
uv sync
export ARGUS_MIROMIND_API_KEY=sk_…

uv run argus audit examples/sample-report.pdf \
  -o findings.json \
  --budget-usd 50
```

### 方式 C — HTTP API

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET`  | `/healthz` | 健康检查 |
| `POST` | `/jobs` | 上传 PDF（multipart `pdf=…`）→ `{job_id}` 202 |
| `POST` | `/jobs/text` | 提交原始文本 → `{job_id}` 202 |
| `GET`  | `/jobs/{job_id}` | 轮询状态或获取最终 Job JSON |
| `GET`  | `/jobs/{job_id}/report.pdf` | 下载审计报告 PDF |
| `WS`   | `/ws/jobs/{job_id}/trace` | 历史回放 + 实时事件流 |

## 🧰 技术栈

| 层 | 选型 |
|---|---|
| **模型** | MiroMind `mirothinker-1-7-deepresearch`（验证器）+ DeepSeek（atomizer/challenger） |
| **编排** | LangGraph 1.x StateGraph，并行 fan-out + reducer fan-in |
| **后端** | Python 3.12 · Pydantic v2 · FastAPI · uvicorn · httpx + 原生 SSE |
| **持久化** | SQLAlchemy 2.0 async · asyncpg / aiosqlite · Alembic |
| **报告** | Jinja2 + WeasyPrint（HTML→PDF） |
| **实时总线** | WebSocket · 可插拔 `TraceBus`（in-process / Redis pub/sub） |
| **前端** | Next.js 16 · React 19 · TypeScript 5 · Tailwind v4 · Zustand · react-pdf · @xyflow/react |

## 🧪 测试

```bash
uv run pytest -q          # 122 collected
uv run mypy src/argus     # strict
uv run ruff check .       # lint
cd web && pnpm test       # vitest
```

## 📜 许可证

[MIT](LICENSE)

## 🙏 致谢

- **[MiroMind](https://platform.miromind.ai/)** 提供 `mirothinker-1-7-deepresearch` 模型
- **[UCWS Singapore](https://www.ucws.sg/)** 主办本次黑客松
- **[LangGraph](https://github.com/langchain-ai/langgraph)** 提供 agent 编排原语
