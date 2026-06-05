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
[![Tests](https://img.shields.io/badge/tests-passing-success)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[English](README.md)** · **[简体中文](README.zh.md)**

</div>

---

## 🧭 我们要解决什么

一位合规官收到了供应商发来的 AI 生成风险备忘录。一名律师打开了对方律所聊天机器人起草的诉状。一位买方基金经理拿到了第三方 RAG 系统生成的研究报告。这些文件都不是他们写的；但他们都必须在采取行动之前*信任*它。

这个问题背后有真实且可查证的数据：

- 已有 **1,536** 起法律案件被记录为法院或仲裁庭处理了 AI 幻觉内容 ——
  [追踪统计](https://www.damiencharlotin.com/hallucinations/)（Damien Charlotin，HEC Paris；
  最后更新于 2026 年 6 月 4 日）仍在增长。
- Gartner 预测 **30% 的生成式 AI 项目将在 2025 年底前、于 PoC 阶段后被放弃** ——
  原因是数据质量差、风险控制不足、成本攀升与商业价值不清
  ([Gartner, 2024](https://www.gartner.com/en/newsroom/press-releases/2024-07-29-gartner-predicts-30-percent-of-generative-ai-projects-will-be-abandoned-after-proof-of-concept-by-end-of-2025))。

模式处处相同：有人要基于自己没写、又无法完全核实的 AI 输出采取行动。

现有市场（Patronus、Galileo、Vectara）向 AI 的*生产者*出售内联评分服务 —— 也就是那些构建 RAG 流水线和 AI 产品的团队。没有人服务 AI 输出的*消费者*。Argus 做的就是这件事。

## 🎯 Argus 做什么

你给它任何一份 AI 生成的文档 —— PDF、备忘录、研究报告、聊天记录。它还给你**每一个事实性声明**、**每个声明的判决**，以及**得出判决的每一步推理过程**。

| 问题类型 | 它能抓到什么 | 如何验证 |
|---|---|---|
| 🪤 **虚构引用** | 根本不存在的论文、案例、备案文件 | 在学术与公开注册库中自主深度检索 |
| ❌ **不准确声明** | 数字、姓名、日期上的事实错误 | 与 ≥2 个独立权威来源交叉验证 |
| 🪞 **错位引述** | 释义 ≠ 原文 | 抓取被引 URL，与原文对比 |
| 📉 **过时数据** | 已被更新数据取代的数字 | 核对一手来源的最新官方数据 |
| 🧩 **内部矛盾** | 文档自相矛盾 | 两两声明一致性检查 |

每条发现都附带：
- **判决** + 严重程度 + 置信度
- **错在哪里** —— 对错误的清晰解释
- **正确信息** —— 正确答案是什么，附带权威来源 URL
- **推理链** —— 逐步的 行动/观察/推理 记录
- **证据链** —— 可点击的来源 URL + 原文片段

## 👥 谁会用 Argus

**法律与合规团队。** 对方律所用 AI 起草了诉状。你需要在引用这些案例之前标出其中的虚构内容。Argus 的证据链可以作为你回应的附件直接归档。

**AI 治理团队（受监管行业）。** 你的分析师把 ChatGPT 的输出粘贴进了董事会备忘录。你需要在"模型说了这句话"和"我们签字认可"之间设一道关卡 —— 这正是受监管行业日益要求的、有据可查的审计闸门。Argus 就是这道门禁。

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

每条发现都同时包含一段整理后的**推理链**（行动 / 观察 / 推理三元组）
和完整的**原始步骤 trace** —— verifier 实际产生的每个思考、网页搜索和页面抓取事件。
示例审查中，系统识别出一条虚构的 Goldman Sachs 引用：

```
Claim: "a February 2026 Goldman Sachs report titled
        'Silicon Supercycle: The $5 Trillion AI Buildout'…"

  🔍 77 次不同搜索 —— 精确标题、site:goldmansachs.com、filetype:pdf、
     近似改写、Scholar / ResearchGate / LinkedIn、反向排除 …
  → 没有找到任何形式的该报告
  → 最接近的真实 Goldman Sachs 文章是
     "Tracking Trillions: The Assumptions Shaping the Scale of the
     AI Build-Out"（约 $7.6T capex，2026–2031）—— 标题、时间范围、
     数字都不同

  Verdict: fabricated (0.93) —— 这条引用同时虚构了报告标题与
  Goldman Sachs 归属。
```

Trace 面板使用**渐进披露**：每个 claim 先以一行展示 verdict、证据数量与
搜索/推理步数；展开后先看到 compact verdict brief（为什么错、正确答案是什么），
再向下查看完整 MiroMind reasoning stream。搜索步骤还能继续展开查看结果链接。
在**实时审查**中，前端通过 WebSocket 在每一步发生的当下流式渲染；在**示例审查**
中，系统回放同一段已记录的真实 trace。无论哪种方式，审阅者看到的不只是判决，
还有它*为何*出错、*正确答案是什么* —— 并附带可点击的来源 URL 供独立核实。

## 🏗️ 工作原理

一个 LangGraph 状态机分两个阶段编排整条流水线：

```
                      ┌─────────────────────────────┐
                      │   📄 输入（PDF 或文本）        │
                      └──────────────┬──────────────┘
                                     ▼
        阶段 A —— 抽取声明（DeepSeek + 确定性，不联网）
        ┌────────────────────────────────────────────────────────────┐
        │  parse → 🧠 planner → atomizer → 🎯 checkworthiness          │
        │  → 类型化的原子声明；观点 / 琐碎信息被丢弃                      │
        └──────────────────────────┬─────────────────────────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  🚦 审核闸门（HITL 暂停）      │  人工挑选要
                      │  去重 + 成本上限 + 选择        │  验证哪些声明
                      └──────────────┬──────────────┘
                                     │  fan-out —— 选中的声明，并行
        阶段 B —— 验证                │
                      ┌──────────────┴──────────────┐
                      ▼                             ▼
            ┌────────────────────┐        ┌─────────────────────┐
            │ 🔬 UnifiedVerifier   │        │ 🧩 一致性检查器       │
            │  ★ MiroMind ★       │        │  （DeepSeek，不联网） │
            │  实时联网深度研究     │        │  跨声明矛盾检测       │
            │  每条声明一次调用     │        │                     │
            └─────────┬──────────┘        └─────────┬───────────┘
                      └──────────┬─────────────────┘
                                 ▼
                      ┌─────────────────────────────┐
                      │ 📊 置信度（确定性）           │  3 个度量因子
                      │                               │  + 软 ≥2 来源标记
                      └──────────────┬──────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  📋 Reporter（DeepSeek）      │
                      │  → 执行摘要 + PDF             │
                      └─────────────────────────────┘
```

**UnifiedVerifier** 对自己的验证策略拥有完全自主权 —— 由它决定核查哪些来源、
调用哪些 API、走多少步。我们只约束*输出格式*（verdict + why_wrong +
correct_information + reasoning_chain），以保证透明度。非强制性的**领域提示**
（domain hints）会根据声明类型和内容领域建议相关的权威来源，但不会强制固定的检索顺序。

**只有 per-claim 的 UnifiedVerifier 调用 MiroMind。** 其余环节都不在关键联网路径上：planner、atomizer、checkworthiness、一致性检查器、reporter 全部运行在 **DeepSeek**（成本低、不联网）；parse、审核闸门、置信度为**确定性**。这样把 MiroMind 的深度研究预算只花在真正需要开放网络的那一步 —— 验证。

### 工程化控制

- **`BoundedRunner`** — 每个 agent 的信号量并发上限
- **`BudgetTracker`** — 硬性 USD 上限，超支前中途中止，防止失控烧钱
- **`retry_on_transient`** — 针对上游 `429` / `5xx` 的指数退避重试
- **`make_idempotency_key`** — 确定性的 job-keyed 幂等键
- **`json-repair`** — LLM JSON 输出的启发式修复 + 针对 MiroMind 怪异返回的数组解包
- **`SSEDecoder`** — 跨网络分块缓冲的有状态流解析器：一个被 TCP/HTTP 分块切断的 SSE 事件会被重新拼接、绝不丢失 —— 保证 trace 文本忠实、证据 URL 完整
- **软性 ≥2 来源规则** — 仅靠过少独立来源支撑的判定会被**封顶置信度并标记需人工复核**，而非悄悄丢弃

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

# 3. Open http://127.0.0.1:3000
#    Click "See a sample audit" to replay a real recorded audit — no API key needed.
```

macOS 上如果使用 WeasyPrint 导出 PDF 报告，可能需要把 Homebrew 的
Pango/Cairo 动态库路径暴露给后端：

```bash
DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run argus serve --host 127.0.0.1 --port 8080
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
| **模型** | MiroMind `mirothinker-1-7-deepresearch`（仅 per-claim 验证器，联网深度研究）+ DeepSeek（planner / atomizer / checkworthiness / 一致性 / reporter） |
| **编排** | LangGraph 1.x StateGraph，并行 fan-out + reducer fan-in |
| **后端** | Python 3.12 · Pydantic v2 · FastAPI · uvicorn · httpx + 原生 SSE |
| **持久化** | SQLAlchemy 2.0 async · asyncpg / aiosqlite · Alembic |
| **报告** | Jinja2 + WeasyPrint（HTML→PDF） |
| **实时总线** | WebSocket · 可插拔 `TraceBus`（in-process / Redis pub/sub） |
| **前端** | Next.js 16 · React 19 · TypeScript 5 · Tailwind v4 · Zustand · react-pdf · @xyflow/react |

## 🧪 测试

```bash
uv run pytest -q          # backend tests
uv run mypy src/argus     # strict
uv run ruff check .       # lint
cd web && pnpm test       # frontend tests
```

## 📜 许可证

[MIT](LICENSE)

## 🙏 致谢

- **[MiroMind](https://platform.miromind.ai/)** 提供 `mirothinker-1-7-deepresearch` 模型
- **[UCWS Singapore](https://www.ucws.sg/)** 主办本次黑客松
- **[LangGraph](https://github.com/langchain-ai/langgraph)** 提供 agent 编排原语
