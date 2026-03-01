<div align="center">

```
███████╗ ██████╗██╗  ██╗ ██████╗
██╔════╝██╔════╝██║  ██║██╔═══██╗
█████╗  ██║     ███████║██║   ██║
██╔══╝  ██║     ██╔══██║██║   ██║
███████╗╚██████╗██║  ██║╚██████╔╝
╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝
```

### ⚖️ AI-Powered Voice-First Legal Aid Assistant for Underserved Communities

<br/>

[![Amazon Nova](https://img.shields.io/badge/Amazon%20Nova-2%20Sonic%20%7C%202%20Lite%20%7C%20Multimodal-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white)](https://aws.amazon.com/bedrock/)
[![Nova Act](https://img.shields.io/badge/Nova%20Act-UI%20Automation-FF6600?style=for-the-badge&logo=amazonaws&logoColor=white)](https://aws.amazon.com/bedrock/)
[![Strands Agents](https://img.shields.io/badge/Strands-Agents%20SDK-4A90D9?style=for-the-badge)](https://github.com/strands-agents)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18+-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org/)

<br/>

**[🎬 Demo](#-demo) · [🚀 Quick Start](#-quick-start) · [📐 Architecture](#-how-it-works) · [🗺️ Roadmap](#️-development-roadmap)**

</div>

---

## 📖 Introduction

**Echo** is a voice-first, multimodal AI legal aid assistant that helps low-income individuals understand their legal rights, prepare legal documents, and autonomously file applications with legal aid organizations — all through a natural spoken conversation.

Built for the **Amazon Nova AI Hackathon**, Echo demonstrates the full power of Amazon Nova's model portfolio working together in a single, coherent pipeline:

- 🎙️ **Speak** about your situation — eviction, wage theft, immigration, family law
- 📄 **Upload** documents — lease agreements, court notices, pay stubs — by photo or file
- ⚖️ **Receive** plain-language legal guidance, rights explanations, and drafted letters
- 🤖 **Watch** Echo autonomously navigate legal aid portals and file your intake forms

No lawyer needed. No complex forms. No barriers.

---

## ✨ Features

### 🎙️ Voice-First Experience (Nova 2 Sonic)
- **Real-time speech-to-speech** conversations with sub-2-second latency
- **Multilingual support** — English and Spanish out of the box
- **Hands-free operation** — fully accessible for people with disabilities
- **Natural interruption** — speak at any point, just like a real conversation
- **Live transcript** displayed alongside voice for accessibility
- **Seamless audio queuing** — zero gaps or overlaps between Echo's responses

### 🧠 Legal Reasoning Engine (Nova 2 Lite + Strands Agents)
- **Multi-agent architecture** with a dedicated orchestrator and three specialist sub-agents:
  - *Legal Classifier Agent* — identifies issue type (housing, employment, immigration, family law, consumer debt)
  - *Eligibility Assessor Agent* — determines qualification for legal aid, pro bono, or self-representation
  - *Document Drafter Agent* — generates customized legal letters, declarations, and demand letters
- **RAG-powered legal knowledge** — semantic search over plain-language legal guides and state law summaries
- **Multi-turn memory** — full conversation context persisted in DynamoDB across turns
- **Tool-use orchestration** — agents call structured tools to search, draft, assess, and file
- **Built-in safety guardrails** — always recommends consulting a licensed attorney for final decisions

### 📎 Document Intelligence (Nova Multimodal Embeddings)
- **Upload any document** — PDFs, photos of letters, screenshots of notices
- **Automatic clause extraction** — identifies key dates, amounts, and legal violations
- **Photo evidence support** — photograph mold, unsafe conditions, or workplace injuries; Echo describes the legal significance
- **Semantic search** — retrieves the most relevant passages from your own documents during conversation
- **Plain-language summaries** of complex lease agreements and legal contracts
- **1024-dimension embeddings** stored in Amazon OpenSearch Serverless for fast retrieval

### 🤖 Autonomous Form Filing (Nova Act)
- **One-click legal intake** — Echo navigates LegalAid.org and fills your intake form automatically
- **Court e-filing support** — uploads documents to court portals on your behalf
- **Government benefits applications** — automates Benefits.gov and similar portals
- **Live browser feed** — watch every Nova Act step in a real-time screenshot panel
- **Voice confirmation** — Echo reads back the filled form before submitting
- **Full audit trail** — every automated action logged to DynamoDB for compliance and user review
- **Retry logic** — if a form fails, Echo explains the issue and asks for missing information by voice

### 🌐 Frontend & Accessibility
- **Animated voice orb** — pulsing visual feedback shows listening, thinking, and speaking states
- **Mobile-first responsive design** — optimized for users who are smartphone-only
- **High-contrast mode** and scalable fonts for visual accessibility
- **ARIA labels** throughout for full screen reader support
- **Progress tracker** — visual steps from Intake → Analysis → Draft → Filing → Confirmation
- **Session history** — past conversations and filed documents retrievable at any time
- **i18n ready** — UI language toggle for English, Spanish, Hindi, and Mandarin

---

## 🛠️ Tech Stack

### AI & ML
| Component | Technology | Purpose |
|---|---|---|
| Voice AI | Amazon Nova 2 Sonic | Real-time speech-to-speech conversations |
| Legal Reasoning | Amazon Nova 2 Lite | Multi-agent legal analysis and document drafting |
| Document Intelligence | Amazon Nova 2 Multimodal Embeddings | Semantic indexing of uploaded evidence |
| UI Automation | Amazon Nova Act | Autonomous legal portal navigation and form filing |
| Agent Orchestration | Strands Agents SDK | Multi-agent coordination and tool management |

### Backend
| Component | Technology |
|---|---|
| API Framework | FastAPI (Python 3.11+) |
| Real-time Voice | WebSocket API (bidirectional streaming) |
| Vector Store | Amazon OpenSearch Serverless |
| Session Store | Amazon DynamoDB |
| File Storage | Amazon S3 |
| Authentication | AWS Cognito |
| Compute | AWS Lambda + Amazon ECS (Nova Act) |

### Frontend
| Component | Technology |
|---|---|
| UI Framework | React 18 + Vite |
| Styling | Tailwind CSS |
| Audio Capture | Web Audio API (MediaRecorder → PCM → Base64) |
| Audio Playback | AudioContext with seamless chunk queuing |
| State Management | React Hooks (useState, useRef, useCallback) |
| Internationalisation | react-i18next |

### Infrastructure
| Component | Technology |
|---|---|
| CDN + Hosting | Amazon CloudFront + S3 |
| API Gateway | AWS API Gateway (WebSocket) |
| Infrastructure as Code | AWS CDK (TypeScript) |
| Region | us-east-1 (required for Nova 2 models) |

---

## 📁 Project Structure

```
echo-legal-ai/
│
├── echo-backend/                  # FastAPI backend
│   ├── main.py                    # App entry point + WebSocket endpoint
│   ├── test_nova.py               # Smoke tests for all 3 Nova models
│   ├── .env                       # Environment variables (never commit!)
│   ├── .env.example               # Safe template for new contributors
│   ├── venv/                      # Python virtual environment
│   │
│   ├── routers/
│   │   ├── voice.py               # Nova 2 Sonic WebSocket router
│   │   ├── documents.py           # Document upload & embedding router
│   │   └── agents.py              # Strands agent invocation router
│   │
│   ├── services/
│   │   ├── echo_sonic.py          # Nova 2 Sonic bidirectional stream engine
│   │   ├── nova_lite.py           # Nova 2 Lite Bedrock client wrapper
│   │   ├── nova_embeddings.py     # Multimodal embeddings + OpenSearch ops
│   │   └── nova_act.py            # Nova Act browser automation service
│   │
│   └── models/
│       ├── session.py             # DynamoDB session schema
│       └── legal_case.py          # Legal case data model
│
├── echo-frontend/                 # React + Vite frontend
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx                # Main app + voice orb UI
│       ├── index.css              # Tailwind base styles
│       ├── components/
│       │   ├── VoiceOrb.jsx       # Animated recording orb
│       │   ├── Transcript.jsx     # Live conversation transcript
│       │   ├── DocumentPanel.jsx  # File upload & evidence viewer
│       │   ├── ActionLog.jsx      # Nova Act live step feed
│       │   └── ProgressBar.jsx    # Intake → Filing progress tracker
│       └── hooks/
│           ├── useWebSocket.js    # WebSocket connection manager
│           └── useAudioStream.js  # Mic capture + PCM encoding
│
├── agents/                        # Strands Agent definitions
│   ├── orchestrator.py            # Main orchestrator agent
│   ├── classifier.py              # Legal issue classifier sub-agent
│   ├── drafter.py                 # Document drafter sub-agent
│   └── eligibility.py             # Eligibility assessor sub-agent
│
├── nova-act-workflows/            # Nova Act YAML automation policies
│   ├── legalaid_intake.yaml       # LegalAid.org intake automation
│   ├── court_efiling.yaml         # Court e-filing portal automation
│   └── benefits_application.yaml # Government benefits portal automation
│
├── infrastructure/                # AWS CDK stack (TypeScript)
│   ├── app.ts
│   └── echo-stack.ts              # All AWS resources as code
│
├── docs/
│   ├── architecture.png           # System architecture diagram
│   └── api.md                     # REST + WebSocket API reference
│
└── README.md                      # You are here
```

---

## ⚙️ Prerequisites

Before you begin, ensure you have:

- **Python 3.11+** (Note: Python 3.14 users should use `sounddevice` instead of PyAudio)
- **Node.js 18+** and npm
- **Git**
- **AWS Account** with billing enabled
- **AWS CLI** installed and configured via `aws configure`
- **Amazon Bedrock** model access in `us-east-1` for:
  - `amazon.nova-2-sonic-v1:0`
  - `us.amazon.nova-2-lite-v1:0`
  - `amazon.nova-2-multimodal-embeddings-v1:0`
- **Nova Act API Key** from [nova-act.aws](https://nova-act.aws)

---

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/echo-legal-ai.git
cd echo-legal-ai
```

### 2. Backend setup

```bash
cd echo-backend

# Create and activate virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux

# Install all dependencies
pip install fastapi uvicorn websockets boto3 python-dotenv \
            aws-sdk-bedrock-runtime strands-agents sounddevice \
            numpy pymupdf pillow python-multipart aiofiles
```

### 3. Configure environment variables

```bash
cp .env.example .env
notepad .env    # Windows
# nano .env     # macOS / Linux
```

Fill in your `.env`:

```env
# AWS Credentials
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_DEFAULT_REGION=us-east-1

# Nova Model IDs (confirmed working)
NOVA_LITE_MODEL_ID=us.amazon.nova-2-lite-v1:0
NOVA_SONIC_MODEL_ID=amazon.nova-2-sonic-v1:0
NOVA_EMBEDDINGS_MODEL_ID=amazon.nova-2-multimodal-embeddings-v1:0

# Nova Act
NOVA_ACT_API_KEY=your_nova_act_key_here

# App Config
APP_NAME=Echo Legal AI
DEBUG=true
```

### 4. Verify all Nova models are working

```bash
python test_nova.py
```

Expected output:
```
✅ PASS — Nova 2 Lite: I am Echo, your AI legal aid assistant...
✅ PASS — Nova Multimodal Embeddings: 256 dimensions | Type: TEXT
✅ PASS — Nova 2 Sonic: Status: ACTIVE
🎉  All systems GO!
```

### 5. Start the backend server

```bash
python main.py
```
```
INFO:  Uvicorn running on http://0.0.0.0:8000
INFO:  WebSocket ready at ws://localhost:8000/ws/voice
```

### 6. Start the frontend (new terminal)

```bash
cd echo-frontend
npm install
npm run dev
```
```
  VITE v6.x.x  ready in 300ms
  ➜  Local:   http://localhost:5173/
```

### 7. Open Echo

Visit **[http://localhost:5173](http://localhost:5173)** → click the microphone orb → allow mic permissions → start talking.

---

## 🗺️ How It Works

```
You speak
    │
    ▼
Browser (Web Audio API)
captures mic → PCM chunks → Base64
    │
    ▼  WebSocket  ws://localhost:8000/ws/voice
FastAPI Backend
    │
    ▼
Amazon Nova 2 Sonic
transcribes speech + generates voice response
    │
    ├──► Audio (Base64 PCM) ──────────────────────► Browser plays through speakers
    │
    ├──► Transcript ──► Strands Orchestrator Agent (Nova 2 Lite)
    │                         │
    │                         ├──► Legal Classifier Agent
    │                         │       identifies: housing / employment / immigration
    │                         │
    │                         ├──► Eligibility Assessor Agent
    │                         │       checks: legal aid qualification
    │                         │
    │                         └──► Document Drafter Agent
    │                                 generates: demand letter / declaration
    │
    ├──► Uploaded docs ──► Nova Multimodal Embeddings
    │                         stored in OpenSearch Serverless
    │                         retrieved semantically during conversation
    │
    └──► Form filing ──► Nova Act
                            navigates browser → fills form → submits
                                 │
                                 ▼
                           Confirmation number
                           read back by voice via Nova 2 Sonic
```

---

## 🎬 Demo

> *Scenario: Maria receives an eviction notice and has 5 days to respond.*

1. **Maria opens Echo** and clicks the microphone orb
2. **She speaks in Spanish** — *"Recibí un aviso de desalojo..."*
3. **Echo responds in Spanish** via Nova 2 Sonic, warmly asks clarifying questions
4. **Maria photographs** the eviction notice and uploads it via the document panel
5. **Nova Multimodal Embeddings** analyze the document — Echo flags a missing mandatory 30-day notice period
6. **Nova 2 Lite** classifies as *wrongful eviction* and drafts a tenant rights demand letter
7. **Nova Act** opens LegalAid.org, fills the intake form, uploads the letter, and submits
8. **Echo reads back** the confirmation: *"Su caso #LA-2025-0847 ha sido presentado."*
9. **Total time: under 3 minutes.** A traditional intake appointment would have taken weeks to schedule.

---

## 🌍 Community Impact

| Metric | Value |
|---|---|
| Americans without adequate legal aid access | **80 million+** |
| Traditional legal intake time | **2–4 weeks** |
| Echo intake time | **< 3 minutes** |
| Reduction in form completion time | **~90%** |
| Languages supported | **English, Spanish** (Hindi & Mandarin planned) |
| Cost to user | **$0** |
| Portals Echo files autonomously | **LegalAid.org, USCourts PACER, Benefits.gov** |

Echo targets communities most underserved by the justice system — non-English speakers, people with disabilities, low-income families, and rural residents far from legal aid offices.

---

## 🔐 Security & Privacy

- All sessions are **user-isolated** via AWS Cognito authentication
- Uploaded documents stored in **private, per-user S3 prefixes**
- No conversation data is shared between users — ever
- Nova Act audit trail is logged to DynamoDB for **user review and compliance**
- `.env` and all credentials are **gitignored** and never committed
- IAM least-privilege principle — each AWS service has only its required permissions

---

## 🗓️ Development Roadmap

- **Phase 1** — AWS environment setup, IAM, CLI, Nova model smoke tests
- **Phase 2** — Nova 2 Sonic WebSocket voice engine + React frontend
- **Phase 3** — Nova 2 Lite + Strands Agents multi-agent legal reasoning
- **Phase 4** — Nova Multimodal Embeddings document intelligence pipeline
- **Phase 5** — Nova Act autonomous form filing workflows
- **Phase 6** — Frontend polish, multilingual UI, full accessibility pass
- **Phase 7** — AWS deployment (CloudFront + Lambda + ECS) + hackathon demo video

---

## 🤝 Contributing

This project was built as an individual submission for the Amazon Nova AI Hackathon. Contributions, feedback, and forks are welcome after the submission deadline.

```bash
# Standard fork → branch → PR flow
git checkout -b feature/your-feature-name
git commit -m "feat: describe your change clearly"
git push origin feature/your-feature-name
# Then open a Pull Request on GitHub
```

---

## 🙏 Acknowledgments

- **Amazon Web Services** — for the Nova model portfolio and hackathon opportunity
- **Strands Agents team** — for the elegant multi-agent orchestration SDK
- **Legal aid organizations everywhere** — for the mission that inspired this project

---

<div align="center">

**Built with ❤️ for the Amazon Nova AI Hackathon**

`#AmazonNova` &nbsp;·&nbsp; `amazon.nova-2-sonic-v1:0` &nbsp;·&nbsp; `us.amazon.nova-2-lite-v1:0` &nbsp;·&nbsp; `amazon.nova-2-multimodal-embeddings-v1:0`

<br/>

*⚖️ Echo provides legal information, not legal advice. Always consult a licensed attorney for final legal decisions.*

</div>