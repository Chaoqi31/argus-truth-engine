<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

<img src="web/public/argus-icon.png" alt="Argus" width="96" height="96" />

# Argus

### **Argus 是 AI 生成内容的审计层。**

上传任何由 AI 写出的东西 —— 研究报告、法律诉状、合规备忘录。Argus 还给你
**每一个事实性声明**、**每个声明的判决**,以及一条**可逐步点开核实的推理链**。

[![Live demo](https://img.shields.io/badge/demo-live-7132f5)](https://argus-truth-engine.vercel.app)
[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.x-purple)](https://github.com/langchain-ai/langgraph)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[在线演示](https://argus-truth-engine.vercel.app)** · **演示视频** _（提交时附链接）_ · **[English](README.md)** · **[简体中文](README.zh.md)**

</div>

---

## Argus 是什么

Argus 为那些*消费* AI 输出、但并非其生产者的人审计 AI 生成内容 —— 合规官、法务团队、
AI 治理团队、买方分析师。你交给它一份 PDF 或粘贴一段文本;它抽取每一个事实性声明,用
自主深度研究逐条验证,为每条声明返回一个判决、一个置信度分数、一条可点击的证据链。它的
产出不是一个分数 —— 而是一条人能读懂、能审计、能归档的推理链。

现在就试:打开**[在线演示](https://argus-truth-engine.vercel.app)**,点击
*Try a sample walkthrough* —— 它会回放一次真实录制的审计,无需 API key。

## 我们要解决什么

一位合规官收到供应商发来的 AI 生成风险备忘录。一名律师打开对方律所聊天机器人起草的诉状。
一位基金经理拿到第三方 RAG 系统生成的研究报告。这些都不是他们写的;但他们都得在行动前先
*信任*它。

这是个真实且可查证的问题:

- 已有 **1,536** 起法律案件被记录为法院处理了 AI 幻觉内容 ——
  [追踪统计](https://www.damiencharlotin.com/hallucinations/)（Damien Charlotin,HEC Paris）仍在增长。
- Gartner 预测 **30% 的生成式 AI 项目将在 2025 年底前、于 PoC 后被放弃** ——
  数据质量差、风险控制不足、成本攀升
  ([Gartner, 2024](https://www.gartner.com/en/newsroom/press-releases/2024-07-29-gartner-predicts-30-percent-of-generative-ai-projects-will-be-abandoned-after-proof-of-concept-by-end-of-2025))。

Argus 就是*"模型说了这句话"*和*"我们签字认可"*之间的那道关卡。

## Argus 做什么

你给它任何一份 AI 生成的文档 —— PDF、备忘录、研究报告、聊天记录。它还给你**每一个事实性
声明**、**每个声明的判决**,以及**得出判决的每一步推理**。

| 问题类型 | 它能抓到什么 | 如何验证 |
|---|---|---|
| **虚构引用** | 根本不存在的论文、案例、备案文件 | 在学术与公开注册库中自主深度检索 |
| **不准确声明** | 数字、姓名、日期上的事实错误 | 与 ≥2 个独立权威来源交叉验证 |
| **错位引述** | 释义 ≠ 原文 | 抓取被引 URL,与原文对比 |
| **过时数据** | 已被更新数据取代的数字 | 核对一手来源的最新官方数据 |
| **内部矛盾** | 文档自相矛盾 | 两两声明一致性检查 |

每条发现都附带:

- **判决** + 严重程度 + 置信度
- **错在哪里** + **正确答案**,附权威来源 URL
- **推理链** —— 行动 / 观察 / 推理 步骤
- **证据链** —— 可点击的来源 URL + 原文片段
- **Skeptic 复核** —— 对最高风险、最不确定的判决做一次二次质疑

## 谁会用 Argus

- **法律与合规** —— 在引用 AI 起草诉状里的虚构案例*之前*把它们标出来;证据链可直接作为回应附件归档。
- **AI 治理（受监管行业）** —— 在"模型说了"和"我们签字"之间设一道有据可查的闸门。
- **投研** —— 一份 40 页、无法全盘信任的 AI 研究报告;Argus 只把有问题的地方挑出来。

## 推理透明度

每条发现都同时包含一段整理后的**推理链**（行动 / 观察 / 推理）*和*完整的**原始步骤
trace** —— verifier 实际产生的每个思考、搜索、抓取。

verifier 抓出一条虚构引用:

```
Claim: "a February 2026 Goldman Sachs report titled
        'Silicon Supercycle: The $5 Trillion AI Buildout'…"

  77 次不同搜索 —— 精确标题、site:goldmansachs.com、近似改写、
     Scholar / ResearchGate / LinkedIn、反向排除 …
  → 没有找到任何形式的该报告

  Verdict: fabricated (0.93) —— 这条引用同时虚构了报告标题与 Goldman Sachs 归属。
```

**Skeptic 复核**在信任一条低置信度虚构判决之前对它二次质疑:

```
Claim: "In Rivera v. Metro Transit Authority, 412 F.3d 880, 887 (2d Cir. 2009)…"

  53 步推理 —— 检索了所有判例汇编/案名/引证变体
  → 不存在叫这个名字的第二巡回案件;412 F.3d 887 实为第八巡回刑案
     (United States v. Hagan)
  Skeptic: 未发现反证 —— 维持"虚构"判决。
```

Trace 使用**渐进披露**:每个 claim 先一行（verdict + 步数）;展开读它的推理,展开搜索打开
结果链接。**实时审查**通过 WebSocket 流式渲染每一步;**示例审查**回放同一段真实 trace。

## 工作原理

一个 LangGraph 状态机分两个阶段编排流水线,中间由一道人在环（HITL）审核闸门分隔:

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

**只有 UnifiedVerifier 和 Skeptic 这两步调用 MiroMind。** UnifiedVerifier 对自己的验证
策略拥有完全自主权 —— 核查哪些来源、用哪些工具（搜索 / 抓取 / 代码）、走多少步;我们只
约束*输出格式*（verdict + why_wrong + correct_information + reasoning_chain）以保证透明度。

**Skeptic 质疑复核。** 凡是 verifier *没把握*的*高风险*判决（置信度低于
`skeptic_confidence_threshold`,默认 `0.85`）会再走一次对抗式 MiroMind 复核去找反证。
找到 → 降级为*不确定*;没找到 → 维持原判。高置信度判决不动 —— 这次额外的深度研究调用
**只花在二次意见可能改变结论的地方**。

其余环节都跑在 **DeepSeek**（planner、atomizer、checkworthiness、一致性、reporter ——
成本低、不联网）或是**确定性**（parse、审核闸门、置信度),把 MiroMind 的预算只花在真正
需要开放网络的两步上。

### 工程化控制

- **`BoundedRunner`** — 每个 agent 的信号量并发上限
- **`BudgetTracker`** — 硬性 USD 上限,超支前中途中止
- **置信度门控的 Skeptic** — 二次意见只在"没把握的高风险判决"上触发:封顶成本,防止错误指控
- **`retry_on_transient`** — 针对上游 `429` / `5xx` 的指数退避重试
- **`make_idempotency_key`** — 确定性的 job-keyed 幂等键
- **`json-repair`** — LLM JSON 输出的启发式修复 + 针对 MiroMind 怪异返回的数组解包
- **`SSEDecoder`** — 有状态流解析器,重新拼接被网络分块切断的 SSE 事件,保证 trace 文本与证据 URL 绝不丢失
- **软性 ≥2 来源规则** — 仅靠过少独立来源的判定会被封顶置信度并标记,而非悄悄丢弃

### 存储与实时事件流

SQLAlchemy 2.0 异步 ORM（开发/测试用 aiosqlite,生产用 asyncpg + Postgres;共享 Alembic
迁移）。可插拔的 `TraceBus` 通过 WebSocket 推送实时 agent 事件 —— 单实例用 `InProcessBus`,
多实例用 Redis pub/sub。

## 快速开始

```bash
# 后端 —— 在 .env 里填 ARGUS_MIROMIND_API_KEY,或跳过（UI 支持 BYOK 自带 key）
cp .env.example .env
docker compose up -d postgres   # 如果保留 .env.example 里的 ARGUS_DB_URL,需要先启动
uv sync
uv run argus serve --host 127.0.0.1 --port 8080

# 前端
cd web && pnpm install && pnpm dev

# 打开 http://127.0.0.1:3000 → 点击 "Try a sample walkthrough" 回放一次真实录制的审计,无需 API key。
```

前端默认把 `/api/argus/*` 代理到 `http://localhost:8080`（可用 `ARGUS_API_HOST` 覆盖）。
macOS 上导出 PDF 需要把 Homebrew 的 Pango/Cairo 放到动态库路径:
`DYLD_LIBRARY_PATH=/opt/homebrew/lib uv run argus serve …`。

## 技术栈

| 层 | 选型 |
|---|---|
| **模型** | MiroMind `mirothinker-1-7-deepresearch`（per-claim 验证器 + Skeptic 复核 —— 联网的两步）+ DeepSeek `deepseek-chat`（planner / atomizer / checkworthiness / 一致性 / reporter） |
| **编排** | LangGraph 1.x StateGraph —— 并行 fan-out + reducer fan-in |
| **后端** | Python 3.12 · Pydantic v2 · FastAPI · uvicorn · httpx + 原生 SSE |
| **持久化** | SQLAlchemy 2.0 async · asyncpg / aiosqlite · Alembic |
| **报告** | Jinja2 + WeasyPrint（HTML→PDF） |
| **实时总线** | WebSocket · 可插拔 `TraceBus`（in-process / Redis pub/sub） |
| **前端** | Next.js 16 · React 19 · TypeScript 5 · Tailwind v4 · Zustand · react-pdf · @xyflow/react |

## 测试

```bash
uv run pytest -q          # 后端测试
uv run mypy src/argus     # 严格类型检查
uv run ruff check .       # lint
cd web && pnpm test       # 前端测试
```

## 许可证

[MIT](LICENSE)

## 致谢

- **[MiroMind](https://platform.miromind.ai/)** 提供 `mirothinker-1-7-deepresearch` 模型
- **[UCWS Singapore](https://www.ucws.sg/)** 主办本次黑客松
- **[LangGraph](https://github.com/langchain-ai/langgraph)** 提供 agent 编排原语
