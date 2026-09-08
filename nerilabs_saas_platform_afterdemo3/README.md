# NeriLabs — Autonomous Experimentation & CRO Platform (SaaS)

An autonomous, multi-tenant AI experimentation platform engineered for startups and SMBs to systematically optimize landing pages, pricing tiers, and onboarding flows without hiring a dedicated data science team.

Built around **3 generation modes**:
1. **Founder-Directed (Macro Tests):** Natural language hypothesis input $\rightarrow$ Multi-modal variant synthesis (Copy, UI, Schema) $\rightarrow$ Strict runtime guardrail interdiction $\rightarrow$ Cryptographically signed JWT tokens $\rightarrow$ Thompson Sampling traffic allocation.
2. **Behavior-Triggered (Micro Interventions):** Telemetry listeners monitor dwell hesitation and scroll-past friction $\rightarrow$ Pre-approved micro-interventions $\rightarrow$ In-place token escalation $\rightarrow$ Hard commit boundary locking.
3. **Autonomous (Anomaly Detection):** Scheduled scans identify conversion drops adjusted for seasonality and day-of-week confounders $\rightarrow$ Actionable remediation hypotheses surfaced to the founder dashboard for 1-click human approval.

---

## Repository Structure

```
.
├── saas_platform/
│   ├── config.py                 # Platform configuration & cryptographic secrets
│   ├── server.py                 # Multi-tenant FastAPI SaaS application
│   ├── models/
│   │   ├── schemas.py            # Pydantic data schemas (tenants, tokens, variants, audits)
│   │   └── database.py           # Multi-tenant thread-safe database repository
│   ├── security/
│   │   └── token_service.py      # HMAC-SHA256 signed JWTs with opaque IDs & commit locking
│   ├── agents/
│   │   ├── copy_agent.py         # Copy synthesis with psychological triggers & brand voice
│   │   ├── ui_agent.py           # Token-constrained CSS/HTML layout diffs
│   │   ├── schema_agent.py       # Onboarding schema relaxation & synthetic backfilling
│   │   └── orchestrator.py       # Pre-computation caching (Zero LLM latency on request path)
│   ├── guardrails/
│   │   ├── audit_logger.py       # Rule-level safety audit logs & founder override path
│   │   ├── security_checker.py   # XSS sanitization, inline JS handlers, CSS injection
│   │   ├── brand_checker.py      # Prohibited claims & copy length variance bounds
│   │   ├── visual_checker.py     # WCAG 2.1 AA contrast ratio & critical CTA survival
│   │   └── engine.py             # Consolidated runtime interdiction engine
│   ├── bandit/
│   │   └── thompson_sampling.py  # Thompson Sampling MAB with 10% exploration floor & sample gates
│   ├── billing/
│   │   └── stripe_service.py     # Stripe Price auto-creation, server-side resolution, idempotent webhooks
│   ├── customer_sdk/
│   │   ├── middleware.py         # Customer-side Python/FastAPI middleware (synthetic backfilling)
│   │   └── node_middleware.js    # Customer-side Node.js/Express middleware equivalent
│   ├── telemetry/
│   │   └── listener.py           # Batched HTTP beacon ingestion with event deduplication
│   ├── behavior/
│   │   └── friction_engine.py    # Dwell/scroll friction detection & in-place token escalation
│   ├── autonomous/
│   │   └── anomaly_engine.py     # Scheduled anomaly scanner with confounder adjustments
│   ├── client_sdk/
│   │   └── experiment_sdk.js     # Vanilla JS Client SDK (150ms anti-flicker cloak, MutationObserver)
│   ├── dashboard/
│   │   ├── templates/index.html  # Interactive Founder Dashboard web UI
│   │   └── static/
│   │       ├── app.js            # Dashboard single-page frontend application
│   │       └── style.css         # Modern dark-mode SaaS styling
│   └── tests/
│       └── test_saas_platform.py # Complete unit & integration test suite (11 test suites)
├── simulate_saas.py              # End-to-end multi-tenant simulation demonstration
├── Dockerfile                    # Production Docker container definition
├── docker-compose.yml            # Production Docker Compose stack
├── requirements.txt              # Python dependencies
└── README.md
```

---

## Quickstart & Local Hosting

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Run Test Suite
```bash
python -m unittest saas_platform.tests.test_saas_platform
```

### 3. Run End-to-End Simulation
```bash
python simulate_saas.py
```

### 4. Launch the SaaS Server & Founder Dashboard
```bash
uvicorn saas_platform.server:app --host 0.0.0.0 --port 8000 --reload
```
Open **http://localhost:8000** in your browser to access the Founder Dashboard.

### 5. Deploy via Docker Compose
```bash
docker-compose up -d --build
```

---


---

## AWS Production Deployment & Customer Launch

For full AWS deployment instructions and customer onboarding workflows, see **[AWS_DEPLOYMENT_GUIDE.md](AWS_DEPLOYMENT_GUIDE.md)**.

### Quick Deploy Options:
1. **AWS App Runner (Zero DevOps / Automated SSL)**:
   - Push container to Amazon ECR or GitHub repository.
   - Deploy using `apprunner.yaml` or container image pointing to port 8000.
   - Healthcheck path: `/health`.
2. **AWS EC2 / Lightsail (Low-Cost Single VM)**:
   - Run `docker compose -f docker-compose.aws.yml up -d --build`.
   - Includes production Nginx reverse proxy with gzip compression and rate limiting.
3. **AWS ECS Fargate (Enterprise Multi-Zone)**:
   - Task definition template located at `aws/ecs-task-definition.json`.

## Key SaaS Innovations & Safety Guarantees

1. **Zero LLM Latency on Request Path (Constraint 5.1):** All copy, UI, and component variants are pre-computed and cached ahead of time. Runtime assignment is a sub-10ms bandit lookup.
2. **Cryptographic Token Security (Section 3.6):** Assignment tokens carry opaque IDs only. No client-side price manipulation is possible.
3. **Hard Commit Boundary Enforcement (Section 3.11 & 6.3):** Mid-session behavioral reassignment is strictly locked once a Stripe PaymentIntent is created or an onboarding state is persisted.
4. **Data Integrity (Constraint 5.3):** Omitted fields in relaxed onboarding schemas are auto-backfilled with explicit `is_synthetic: True` tags to prevent polluting CRM pipelines.
5. **Sample Size Sufficiency Gate (Section 3.9):** The bandit UI displays an explicit *"Gathering Baseline Data"* trust commitment banner until statistical sample thresholds are met.
