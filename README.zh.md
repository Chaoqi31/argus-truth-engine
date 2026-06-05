<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

<img src="web/public/argus-icon.png" alt="Argus" width="96" height="96" />

# Argus

### **Argus 是 AI 生成内容的审计层。**

上传任何由 AI 写出的东西 —— 研究报告、法律诉状、合规备忘录。Argus 还给你
**每一个事实性声明**、**每个声明的判决**，以及一条**可逐步点开核实的推理链**。

[![Live demo](https://img.shields.io/badge/demo-live-7132f5)](https://argus-truth-engine.vercel.app)
[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.x-purple)](https://github.com/langchain-ai/langgraph)
[![Tests](https://img.shields.io/badge/tests-passing-success)](#-测试)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[🌐 在线演示](https://argus-truth-engine.vercel.app)** · **🎬 演示视频** _（提交时附链接）_ · **[English](README.md)** · **[简体中文](README.zh.md)**

</div>

---

## Argus 是什么

Argus 是 AI 生成内容的审计层 —— 为那些*消费* AI 输出、但并非其生产者的人而建：
合规官、法务团队、AI 治理团队、买方分析师。你交给它一份 PDF 或粘贴一段文本；
它抽取每一个事实性声明，用自主深度研究逐条验证，并为每条声明返回一项发现、一个判决、
一个置信度分数，以及一条可点击的证据链。

现有市场把内联幻觉评分卖给 AI 的*生产者* —— 那些构建 RAG 流水线的团队。Argus 服务的是
*消费者*:那个必须在签字认可别人的 AI 输出之前先信任它的审阅者。它的产出不是一个分数 ——
而是一条人能读懂、能审计、能归档的推理链。

现在就试:打开**[在线演示](https://argus-truth-engine.vercel.app)**,点击
*Try a sample walkthrough* —— 它会回放一次真实录制的审计,无需 API key。

## 🧭 我们要解决什么

一位合规官收到了供应商发来的 AI 生成风险备忘录。一名律师打开了对方律所聊天机器人起草的诉状。一位买方基金经理拿到了第三方 RAG 系统生成的研究报告。这些文件都不是他们写的;但他们都必须在采取行动之前*信任*它。

这个问题背后有真实且可查证的数据:

- 已有 **1,536** 起法律案件被记录为法院或仲裁庭处理了 AI 幻觉内容 ——
  [追踪统计](https://www.damiencharlotin.com/hallucinations/)（Damien Charlotin,HEC Paris）仍在增长。
- Gartner 预测 **30% 的生成式 AI 项目将在 2025 年底前、于 PoC 阶段后被放弃** ——
  原因是数据质量差、风险控制不足、成本攀升与商业价值不清
  ([Gartner, 2024](https://www.gartner.com/en/newsroom/press-releases/2024-07-29-gartner-predicts-30-percent-of-generative-ai-projects-will-be-abandoned-after-proof-of-concept-by-end-of-2025))。

模式处处相同:有人要基于自己没写、又无法完全核实的 AI 输出采取行动。Argus 就是
*"模型说了这句话"*和*"我们签字认可"*之间的那道关卡。

## 🎯 Argus 做什么

你给它任何一份 AI 生成的文档 —— PDF、备忘录、研究报告、聊天记录。它还给你**每一个事实性声明**、**每个声明的判决**,以及**得出判决的每一步推理过程**。

| 问题类型 | 它能抓到什么 | 如何验证 |
|---|---|---|
| 🪤 **虚构引用** | 根本不存在的论文、案例、备案文件 | 在学术与公开注册库中自主深度检索 |
| ❌ **不准确声明** | 数字、姓名、日期上的事实错误 | 与 ≥2 个独立权威来源交叉验证 |
| 🪞 **错位引述** | 释义 ≠ 原文 | 抓取被引 URL,与原文对比 |
| 📉 **过时数据** | 已被更新数据取代的数字 | 核对一手来源的最新官方数据 |
| 🧩 **内部矛盾** | 文档自相矛盾 | 两两声明一致性检查 |

每条发现都附带:

- **判决** + 严重程度 + 置信度
- **错在哪里** —— 对错误的清晰解释
- **正确信息** —— 正确答案是什么,附带权威来源 URL
- **推理链** —— 逐步的 行动/观察/推理 记录
- **证据链** —— 可点击的来源 URL + 原文片段
- **Skeptic 复核** —— 对最高风险、最不确定的判决做一次二次质疑（见下文）

## 👥 谁会用 Argus

**法律与合规团队。** 对方律所用 AI 起草了诉状。你需要在引用这些案例之前标出其中的虚构内容。Argus 的证据链可以作为你回应的附件直接归档。

**AI 治理团队（受监管行业）。** 你的分析师把聊天机器人的输出粘贴进了董事会备忘录。你需要在"模型说了这句话"和"我们签字认可"之间设一道有据可查的审计闸门 —— 这正是受监管行业日益要求的。

**投研分析师。** 供应商发来了一份 40 页的 AI 生成研究报告。你读不完全部;你不能全盘信任;逐条手工核查每个引用在经济上也不划算。Argus 只把有问题的地方呈现给你。

## 🧭 Argus 处在什么位置

Patronus、Galileo、Vectara 这类工具把内联评分卖给 AI 的*生产者* —— 那些构建 RAG
流水线、交付 AI 产品的团队。Argus 站在这次交付的另一侧:它服务那个*接收*这份输出、
并且要为它背书的人。

|  | 生产者侧评分 | **Argus** |
|---|---|---|
| **用户** | AI 基础设施团队 | **AI 输出消费者**（合规、法务、研究） |
| **集成方式** | API 内联嵌入 RAG 流水线 | **上传文件 / 粘贴文本 → 审计报告** |
| **核心输出** | 分数 / 分类标签 | **推理链 + 证据链 + 判决** |
| **信任凭证** | 数值分数 | **可导出的审计包**（可归档、可引用） |

我们不在幻觉分类器的准确率上竞争。我们的竞争点在于:**人类能否读懂我们做了什么,并信任这个判决。**

## ✨ 推理透明度

每条发现都同时包含一段整理后的**推理链**（行动 / 观察 / 推理三元组）和完整的**原始步骤
trace** —— verifier 实际产生的每个思考、网页搜索和页面抓取事件。

来自内置的投研 demo,系统识别出一条虚构的 Goldman Sachs 引用:

```
Claim: "a February 2026 Goldman Sachs report titled
        'Silicon Supercycle: The $5 Trillion AI Buildout'…"

  🔍 77 次不同搜索 —— 精确标题、site:goldmansachs.com、filetype:pdf、
     近似改写、Scholar / ResearchGate / LinkedIn、反向排除 …
  → 没有找到任何形式的该报告
  → 最接近的真实 Goldman Sachs 文章是 "Tracking Trillions: The
     Assumptions Shaping the Scale of the AI Build-Out" —— 标题、数字都不同

  Verdict: fabricated (0.93) —— 这条引用同时虚构了报告标题与 Goldman Sachs 归属。
```

来自内置的法律 demo,**Skeptic 复核**在信任一条低置信度的虚构判决之前对它二次质疑:

```
Claim: "In Rivera v. Metro Transit Authority, 412 F.3d 880, 887 (2d Cir. 2009),
        the Second Circuit excused the administrative-exhaustion requirement…"

  🥊 53 步推理 —— 检索了所有判例汇编/案名/引证变体
  → 不存在叫这个名字的第二巡回案件;412 F.3d 887 实为第八巡回的刑案
     (United States v. Hagan)
  Skeptic: 未发现反证 —— 维持"虚构"判决。
```

Trace 面板使用**渐进披露**:每个 claim 先以一行展示 verdict、证据数量与搜索/推理步数;
展开后先看到 compact verdict brief（为什么错、正确答案是什么）,再向下查看完整 reasoning
stream;搜索步骤还能继续展开查看结果链接。关键数字先行,完整信息流仅按需展开。在**实时审查**
中,前端通过 WebSocket 在每一步发生的当下流式渲染;**示例审查**回放同一段已记录的真实 trace。
无论哪种方式,审阅者看到的不只是判决,还有它*为何*出错、*正确答案是什么* —— 并附带可点击的
来源 URL 供独立核实。

## 🏗️ 工作原理

一个 LangGraph 状态机分两个阶段编排整条流水线,中间由一道人在环（HITL）审核闸门分隔:

```
                      ┌─────────────────────────────┐
                      │   📄 输入（PDF 或文本）        │
                      └──────────────┬──────────────┘
                                     ▼
        阶段 A —— 抽取声明（DeepSeek + 确定性,不联网）
        ┌────────────────────────────────────────────────────────────┐
        │  parse → 🧠 planner → atomizer → 🎯 checkworthiness          │
        │  → 类型化的原子声明;观点 / 琐碎信息被丢弃                      │
        └──────────────────────────┬─────────────────────────────────┘
                                     ▼
                      ┌─────────────────────────────┐
                      │  🚦 审核闸门（HITL 暂停）      │  人工挑选要
                      │  去重 + 成本上限 + 选择        │  验证哪些声明
                      └──────────────┬──────────────┘
                                     │  fan-out —— 选中的声明,并行
        阶段 B —— 验证                │
                      ┌──────────────┴──────────────┐
                      ▼                             ▼
            ┌────────────────────┐        ┌─────────────────────┐
            │ 🔬 UnifiedVerifier   │        │ 🧩 一致性检查器       │
            │  ★ MiroMind ★       │        │  （DeepSeek,不联网） │
            │  实时联网深度研究     │        │  跨声明矛盾检测       │
            │  每条声明一次调用     │        │                     │
            └─────────┬──────────┘        └─────────┬───────────┘
                      ▼                             │
            ┌────────────────────┐                 │
            │ 🥊 Skeptic 复核      │                 │  仅复核低置信度
            │  ★ MiroMind ★       │                 │  的高风险判决
            │  二次对抗式质疑       │                 │
            └─────────┬──────────┘                 │
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

**只有 UnifiedVerifier 和 Skeptic 这两步调用 MiroMind。** UnifiedVerifier 对自己的验证策略
拥有完全自主权 —— 由它决定核查哪些来源、调用哪些工具（网页搜索、抓取、代码）、走多少步。
我们只约束*输出格式*（verdict + why_wrong + correct_information + reasoning_chain）,以保证
透明度。非强制性的**领域提示**（domain hints）会根据声明类型建议相关权威来源,但不强制固定检索顺序。

**Skeptic 质疑复核。** verifier 给出判决后,凡是它**没有把握**的*高风险*发现（虚构 / 不准确 /
过时 / 错位引述,且置信度低于 `skeptic_confidence_threshold`,默认 `0.85`）会再走一次对抗式
MiroMind 复核。它去找 verifier 可能漏掉的反证:案名/标题变体、更新的来源、被误读的引用。若找到
可信反证,就把判决降级为*不确定*并封顶置信度;否则维持原判。高置信度的判决不动 —— 这样这次额外的
深度研究调用**只花在二次意见可能改变结论的地方**,而不是每一条指控上。

其余环节都不在关键联网路径上:planner、atomizer、checkworthiness、一致性检查器、reporter 全部
运行在 **DeepSeek**（成本低、不联网）;parse、审核闸门、置信度为**确定性**。这样把 MiroMind 的
深度研究预算只花在真正需要开放网络的那两步。

### 工程化控制

- **`BoundedRunner`** — 每个 agent 的信号量并发上限
- **`BudgetTracker`** — 硬性 USD 上限,超支前中途中止,防止失控烧钱
- **置信度门控的 Skeptic** — 二次意见调用只在"没把握的高风险判决"上触发,既封顶成本,又防止错误指控
- **`retry_on_transient`** — 针对上游 `429` / `5xx` 的指数退避重试
- **`make_idempotency_key`** — 确定性的 job-keyed 幂等键
- **`json-repair`** — LLM JSON 输出的启发式修复 + 针对 MiroMind 怪异返回的数组解包
- **`SSEDecoder`** — 跨网络分块缓冲的有状态流解析器:一个被 TCP/HTTP 分块切断的 SSE 事件会被重新拼接、绝不丢失 —— 保证 trace 文本忠实、证据 URL 完整
- **软性 ≥2 来源规则** — 仅靠过少独立来源支撑的判定会被**封顶置信度并标记需人工复核**,而非悄悄丢弃

### 存储与实时事件流

SQLAlchemy 2.0 异步 ORM,开发/测试环境使用 aiosqlite,生产环境使用 asyncpg + Postgres,Alembic 迁移在两个后端之间共享同一套版本历史。可插拔的 `TraceBus` 通过 WebSocket 推送实时 agent 事件 —— 单实例使用 `InProcessBus`,多实例使用 Redis pub/sub。

## 🚀 快速开始

### 方式 A — Web UI

```bash
# 1. 后端
cp .env.example .env       # 填入 ARGUS_MIROMIND_API_KEY（或跳过 —— UI 支持 BYOK 自带 key）
uv sync
uv run argus serve --host 127.0.0.1 --port 8080

# 2. 前端
cd web && pnpm install && pnpm dev

# 3. 打开 http://127.0.0.1:3000
#    点击 "Try a sample walkthrough" 回放一次真实录制的审计 —— 无需 API key。
```

前端默认把 `/api/argus/*` 代理到 `http://localhost:8080`（可用 `ARGUS_API_HOST` 覆盖）。

macOS 上如果使用 WeasyPrint 导出 PDF 报告,可能需要把 Homebrew 的 Pango/Cairo 动态库路径暴露给后端:

```bash
DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run argus serve --host 127.0.0.1 --port 8080
```

### 方式 B — 命令行

```bash
uv sync
export ARGUS_MIROMIND_API_KEY=sk-…

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
| **模型** | MiroMind `mirothinker-1-7-deepresearch`（per-claim 验证器 + Skeptic 复核 —— 联网深度研究的两步）+ DeepSeek `deepseek-chat`（planner / atomizer / checkworthiness / 一致性 / reporter） |
| **编排** | LangGraph 1.x StateGraph,并行 fan-out + reducer fan-in |
| **后端** | Python 3.12 · Pydantic v2 · FastAPI · uvicorn · httpx + 原生 SSE |
| **持久化** | SQLAlchemy 2.0 async · asyncpg / aiosqlite · Alembic |
| **报告** | Jinja2 + WeasyPrint（HTML→PDF） |
| **实时总线** | WebSocket · 可插拔 `TraceBus`（in-process / Redis pub/sub） |
| **前端** | Next.js 16 · React 19 · TypeScript 5 · Tailwind v4 · Zustand · react-pdf · @xyflow/react |

## 🧪 测试

```bash
uv run pytest -q          # 后端测试
uv run mypy src/argus     # 严格类型检查
uv run ruff check .       # lint
cd web && pnpm test       # 前端测试
```

## 📜 许可证

[MIT](LICENSE)

## 🙏 致谢

- **[MiroMind](https://platform.miromind.ai/)** 提供 `mirothinker-1-7-deepresearch` 模型
- **[UCWS Singapore](https://www.ucws.sg/)** 主办本次黑客松
- **[LangGraph](https://github.com/langchain-ai/langgraph)** 提供 agent 编排原语
</content>
