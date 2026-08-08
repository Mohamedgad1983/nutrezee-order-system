# Project A — Full Architecture (System Architecture)
## Intelligent Omnichannel Customer Service System for Nutreeze

> **Goal:** Unify all customer communication channels (WhatsApp, website, email, social) into one self-hosted system on Milagro VPS, with an Arabic AI layer that answers customers using real data from your systems (ERPNext / BigQuery), with zero licensing fees and full data ownership.

> **Starting point:** the first live use case is **subscription-reminder messages** to customers. These are outbound messages, which shapes the WhatsApp connection strategy (see Section 3).

---

## 1. The Big Picture

The system is built on **four layers**, each with a single, clear responsibility. This separation is deliberate: it lets you replace any layer later without breaking the others, and it lets each layer do what it does best.

A new **gateway layer (Evolution API)** sits in front of Chatwoot. It is the bridge between WhatsApp and your stack, and it is what lets you start free on Baileys today and migrate to the official Cloud API later without rebuilding anything.

```
┌─────────────────────────────────────────────────────────────┐
│                        Customers                             │
│   WhatsApp │ Website/App │ Email │ Instagram │ Telegram      │
└───────┬─────────┬──────────┬──────────┬───────────┬──────────┘
        │         │          │          │           │
        ▼         ▼          ▼          ▼           ▼
┌─────────────────────────────────────────────────────────────┐
│       LAYER 0: EVOLUTION API (WhatsApp Gateway)             │
│   - Bridges WhatsApp <-> your stack via REST + webhooks      │
│   - Two modes: Baileys (free) OR official Cloud API          │
│   - Native, config-driven integration with Chatwoot & Dify   │
│   - Apache 2.0 license (+ brand-protection conditions)       │
└────────────────────────┬────────────────────────────────────┘
                         │ native integration
                         ▼
┌─────────────────────────────────────────────────────────────┐
│        LAYER 1: CHATWOOT (Unified Intake Channel)            │
│   - One inbox for all channels                               │
│   - Conversation management + agent assignment + tagging     │
│   - All data stored on Milagro (full ownership)              │
│   - MIT license (full freedom to modify)                     │
└────────────────────────┬────────────────────────────────────┘
                         │ Webhook / API
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              LAYER 2: DIFY (The AI Brain)                    │
│   - Receives the customer message from Chatwoot              │
│   - RAG: searches the knowledge base (FAQ, policies, menus)  │
│   - Tool Calling: pulls real data from ERPNext/BigQuery      │
│   - Routing: answers itself or hands off to a human          │
└──────────┬──────────────────────────────┬───────────────────┘
           │                              │
           ▼                              ▼
┌──────────────────────┐    ┌─────────────────────────────────┐
│  LAYER 3: CLAUDE API │    │       Data Sources              │
│  - Generates the     │    │  - ERPNext (subscriptions,      │
│    natural Arabic/   │    │    orders)                      │
│    Gulf response     │    │  - BigQuery (analytics, history)│
│  - Understands       │    │  - Knowledge base (Vector DB)   │
│    customer intent   │    │                                 │
└──────────────────────┘    └─────────────────────────────────┘
```

---

## 2. Layer-by-Layer Detail

### Layer 0 — Evolution API (WhatsApp Gateway) ★ NEW

**Responsibility:** the bridge between WhatsApp and the rest of your stack. It maintains the WhatsApp connection, exposes a clean REST API + webhooks, and pushes messages into Chatwoot and Dify. Everything downstream is identical whether you are on the free Baileys mode or the official Cloud API — that is the whole point of putting it here.

**Why Evolution API specifically:**
- **Dual connection modes** — Baileys (free, WhatsApp Web) OR the official WhatsApp Cloud API. You can switch by creating a new instance and pointing the webhook at it; nothing else in the architecture changes.
- **Native, config-driven integrations** — Chatwoot and Dify connect by passing credentials (account ID, token, URL) when you create an instance. No custom bridge code to write or maintain.
- **Matches your stack exactly** — Node.js 20+, PostgreSQL, Redis, Docker, automatic SSL. Sessions persist in PostgreSQL, so instances reconnect automatically after any restart.
- **Production-grade** — 8.8k GitHub stars, actively maintained, supports text, media, polls, lists, buttons, S3 storage, and 7 chatbot integrations.

**License note:** Apache 2.0 (permissive, much lighter than AGPL), **but** with added brand-protection conditions (preserve the logo/copyright, plus a usage-notification requirement). Read the LICENSE file before any commercial or white-label use.

**Technical components:**
| Component | Role |
|---|---|
| Evolution API (Node.js) | WhatsApp gateway + REST API + webhooks |
| PostgreSQL | Session persistence + instance data |
| Redis | Caching + connection state |
| Evolution Manager | Web UI for managing instances / QR codes |

---

### Layer 1 — Chatwoot (Unified Intake Channel)

**Responsibility:** the single inbox for all customer messages, regardless of channel. It does no AI — that is Layer 2's job. Its only job: receive, unify, store, and route.

**Why Chatwoot specifically:**
- **MIT license** — the lightest license possible. Modify and deploy with no obligation to disclose your code.
- **True omnichannel** — WhatsApp (via Evolution), email, live chat, Instagram, Telegram, SMS in one inbox.
- **Free self-host, fully featured** — no caps on agent count or features.
- **Data stays with you** — all conversations on Milagro VPS, resolving the Kuwait compliance question (CITRA) at the root.

**How it connects to Evolution:** Evolution API creates the Chatwoot inbox automatically when you configure the instance (account ID + token + base URL). It can even import historical WhatsApp messages so conversation continuity is preserved.

**Technical components:**
| Component | Role |
|---|---|
| Rails app | Core Chatwoot application |
| PostgreSQL | Stores conversations and customers |
| Redis | Queues and real-time |
| Sidekiq | Background job processing |

**Connected channels:**
- **WhatsApp** -> via Evolution API gateway (Baileys now, Cloud API later)
- **Website/App** -> live chat widget
- **Email** -> connect the it@nutreeze.com or support@ mailbox
- **Instagram/Facebook** -> via Meta API

---

### Layer 2 — Dify (The AI Brain / Orchestration)

**Responsibility:** the brain. It takes the customer message, understands it, and decides: answer from the knowledge base? Pull real data from ERPNext? Or hand off to a human agent?

**Why Dify specifically:**
- **Built-in RAG** — grounds answers in your knowledge base (FAQ, policies, meal menus) so replies are real, not hallucinated.
- **Tool Calling / Workflows** — can call external APIs (ERPNext, BigQuery) mid-conversation.
- **Visual interface** — build workflows visually, faster than raw code.
- **Docker Compose** — installs on Milagro in one step.
- **Multi-model** — switch between Claude, GPT, or a local model based on cost/quality.
- **Native Evolution integration** — Evolution API connects to Dify directly for trigger management and multiple agents.

**Dify components:**
| Component | Role |
|---|---|
| Dify API | Core orchestration engine |
| Vector DB (Weaviate/Qdrant) | Stores the knowledge base as embeddings |
| PostgreSQL | Workflow settings and logs |
| Redis | Cache and queues |
| Sandbox | Safe code execution |

**Practical workflow examples for Nutreeze:**
1. **Subscription reminder (your starting use case):** a scheduled job checks ERPNext for subscriptions nearing expiry -> Evolution sends the reminder via WhatsApp -> any reply flows back through Chatwoot.
2. **Subscription query:** customer asks "when does my subscription end?" -> Dify calls ERPNext -> returns the date -> Claude phrases it in Arabic.
3. **General question:** "do you have keto meals?" -> Dify searches the knowledge base (RAG) -> answers from the stored menu.
4. **Escalation:** complex complaint -> Dify detects intent -> hands off to a human agent in Chatwoot with a summary.

---

### Layer 3 — Claude API (Arabic Language Generation)

**Responsibility:** gives the system its natural Arabic/Gulf voice. Dify decides *what* the information is; Claude phrases it *how* — naturally and culturally appropriate.

**Why Claude API:**
- **Excellent Arabic** — understands Gulf dialect and replies naturally; the blue ocean you identified.
- **Transparent cost** — pay per token, zero licensing or per-resolution fees.
- **You already have expertise** — from your prior projects (MobileAIOverJar, central kitchen).

---

## 3. WhatsApp Connection Strategy (Critical Section)

This is the most important operational decision in the whole system, because your first use case — **subscription reminders** — is outbound messaging, which carries the highest ban risk on the free Baileys mode.

### The two modes, side by side

| | Baileys (free) | Official Cloud API |
|---|---|---|
| Cost | Free | ~$0.004 per utility message (~$9/month at 75/day) |
| Setup speed | Minutes (scan QR) | Days (business verification) |
| Ban risk | Real and permanent | Zero |
| Outbound reminders | Highest-risk use | Fully supported (approved templates) |
| Message limits | ~1,000-1,500/day practical (with risk) | 250/day unverified -> 1,000+ verified |

### Your reality

You plan ~75-100 reminders/day, and colleagues already run the same outbound-reminder pattern on Baileys successfully at this volume. The volume is small and safe in itself — the risk is not the number, it is that Baileys mimics WhatsApp Web, and Meta can detect and **permanently ban the number** after any protocol update. "Working today" is not a guarantee; documented cases show numbers running fine for years, then getting banned within 48 hours of a Meta update.

### The decision: start on Baileys, but protect the business

You can begin on Baileys like your colleagues, **provided** you follow three safeguards:

1. **Use a dedicated, separate number for reminders** — NOT the official Nutreeze number customers know. If it ever gets banned, you swap it and continue, without losing your primary identity.
2. **Warm up new numbers** — start at ~20 messages on day one, ramp gradually over ~7 days to your target of 75-100. Sending full volume from a fresh number is a guaranteed ban.
3. **Keep a Cloud API migration path ready** — Evolution API supports it natively, so switching is creating a new instance and repointing the webhook. No architecture change.

### The migration trigger

Move reminders to the **official Cloud API** when any of these happen:
- The reminder volume grows beyond a few hundred per day
- You want to put reminders on the official Nutreeze number
- The dedicated Baileys number gets banned (reactive fallback)
- You add customer-facing two-way AI conversations (those are better on Cloud API anyway)

> **Bottom line:** Baileys is acceptable for low-volume reminders on a disposable number as a fast, free start. The official Cloud API is the responsible long-term home for outbound reminders — and at ~$9/month for 75/day, the cost is negligible.

---

## 4. Full End-to-End Flows

### Flow A — Subscription reminder (your starting use case, outbound)

```
1. Scheduled job (daily) queries ERPNext for subscriptions expiring soon
        |
2. For each customer -> Dify formats the reminder (Claude phrases it in Arabic)
        |
3. Evolution API sends the WhatsApp message (Baileys now / Cloud API later)
        |
4. Message delivered to the customer
        |
5. If the customer replies -> Evolution -> Chatwoot inbox (conversation opens)
        |
6. Reply handled by AI (future) or a human agent
```

### Flow B — Customer-initiated query (future, inbound)

```
1. Customer messages on WhatsApp
        |
2. Evolution API -> Chatwoot inbox
        |
3. Chatwoot webhook -> Dify (new message)
        |
4. Dify understands intent + calls ERPNext if needed
        |
5. Dify -> Claude API -> natural Arabic reply
        |
6. Reply -> Chatwoot -> WhatsApp -> customer
        |
7. Complex request -> escalate to a human agent
```

Inbound replies (Flow B) are free service messages with no limit; this is why expanding into two-way AI conversations later is cheap and low-risk on Cloud API.

---

## 5. Infrastructure on Milagro VPS

Everything in Docker, organized with Docker Compose, behind Caddy (consistent with your current stack).

```
Milagro VPS (Ubuntu 24.04)
|
├── Caddy (Reverse Proxy + automatic SSL)
│   ├── wa.nutreeze.com      -> Evolution API
│   ├── chat.nutreeze.com    -> Chatwoot
│   ├── ai.nutreeze.com      -> Dify
│   └── (internal services not exposed to the internet)
|
├── Docker Network: nutreeze-cs
│   ├── evolution-api
│   ├── evolution-postgres
│   ├── evolution-redis
│   ├── chatwoot-web
│   ├── chatwoot-worker (Sidekiq)
│   ├── chatwoot-postgres
│   ├── chatwoot-redis
│   ├── dify-api
│   ├── dify-worker
│   ├── dify-web
│   ├── dify-postgres
│   ├── dify-redis
│   └── dify-vectordb (Qdrant)
|
└── External integrations (via API):
    ├── Claude API (api.anthropic.com)
    ├── ERPNext (same VPS or separate)
    ├── BigQuery (Google Cloud)
    └── WhatsApp (Baileys session / Meta Cloud API)
```

**Important architecture notes:**
- **Isolation:** Evolution, Chatwoot, and Dify each have their own database — no conflicts.
- **Backups:** daily backup of all three PostgreSQL instances (tied into your existing backup system). The Evolution DB holds the WhatsApp session — back it up so a restart never forces a re-scan.
- **Resources:** this setup needs ~6-10GB RAM (Evolution adds a modest footprint). If Milagro is crowded, split Dify onto a separate VPS later.
- **Security:** internal services (databases, Redis) are not exposed to the internet — Caddy exposes only the interfaces.

---

## 6. Integration with Your Existing Systems

| System | Connection Method | Purpose |
|---|---|---|
| **ERPNext v16** | REST API | Subscription expiry dates (for reminders), orders, customers, invoices |
| **BigQuery** | Service Account (least-privilege) | Analytics, order history, customer behavior |
| **Fleetbase** (future) | REST API | Create delivery orders directly from conversations |
| **Hermes** | Merge/replace | Your WhatsApp Hermes work integrates as a channel via Evolution |
| **WhatsApp** | Evolution API gateway | Baileys now, official Cloud API later |

**Strategic point:** the Hermes work you are building (WhatsApp parser + customer management) is **not discarded** — Evolution API becomes the unified gateway, and Hermes logic integrates behind it. Your effort is preserved inside a larger, cleaner system.

---

## 7. Design Principles (Why This Architecture Is Right)

1. **Separation of Concerns:** each layer does one thing. The Evolution gateway means the WhatsApp connection method (Baileys vs Cloud API) is swappable without touching Chatwoot, Dify, or Claude.

2. **Data Sovereignty:** everything on Milagro. Resolves Kuwait compliance and frees you from vendor lock-in.

3. **Zero licensing fees:** Evolution (Apache 2.0) + Chatwoot (MIT) + Dify (open-source) + Claude (pay-per-token). The only real cost is API usage and, eventually, negligible Cloud API message fees.

4. **Build on what exists:** leverages your current stack (Docker, Caddy, ERPNext, BigQuery, Claude API expertise).

5. **Start free, scale safely:** begin on Baileys for free reminders, migrate to Cloud API as the responsible long-term path — with no rebuild.

---

## 8. Risks and Considerations

| Risk | Mitigation |
|---|---|
| **Baileys ban on the reminder number** | Use a dedicated, disposable number — never the official Nutreeze number; keep Cloud API migration ready |
| New-number ban during ramp-up | Warm up: ~20/day on day one, gradual increase over 7 days |
| VPS resources | Monitor RAM; split Dify onto a separate VPS if needed |
| WhatsApp Cloud API approval (when migrating) | Start business verification early — it takes days |
| AI accuracy (hallucination, future phase) | RAG + strict grounding; human-handoff fallback |
| Evolution license conditions | Read the Apache-2.0 + brand-protection terms before commercial/white-label use |

---

*This file defines "what" the architecture is. File B defines "how and when" to build it, and File C defines "how much."*
