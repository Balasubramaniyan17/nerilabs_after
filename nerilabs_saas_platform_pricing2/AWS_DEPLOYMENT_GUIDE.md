# NeriLabs SaaS — AWS Production Deployment & Customer Launch Playbook

This playbook provides step-by-step instructions to deploy the NeriLabs Autonomous Experimentation Platform to AWS, connect live payments, and start acquiring paying customers.

---

## 1. Fast-Track Deployment: AWS App Runner (Recommended)

**AWS App Runner** is AWS's fully-managed service that deploys containerized web applications in under 15 minutes with built-in HTTPS/TLS, automated certificate management, health checks, and autoscaling.

### Step 1: Push Code to GitHub or Amazon ECR
You can deploy either directly from a private GitHub repository or by pushing the Docker container to Amazon Elastic Container Registry (ECR).

**Option A: Push Docker image to Amazon ECR**
```bash
# 1. Log in to your AWS ECR registry
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# 2. Create the ECR repository (if not already created)
aws ecr create-repository --repository-name nerilabs-saas-platform --region us-east-1

# 3. Build, tag, and push the container image
docker build -t nerilabs-saas-platform .
docker tag nerilabs-saas-platform:latest <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nerilabs-saas-platform:latest
docker push <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nerilabs-saas-platform:latest
```

### Step 2: Create App Runner Service
1. Open the [AWS App Runner Console](https://console.aws.amazon.com/apprunner).
2. Click **Create an App Runner service**.
3. Under **Source**:
   - Select **Container registry** -> **Amazon ECR**.
   - Browse and pick `nerilabs-saas-platform:latest`.
   - Under **Deployment trigger**, select **Automatic** (auto-deploys when you push a new image).
4. Under **Configure service**:
   - **Service name**: `nerilabs-saas-platform`
   - **Virtual CPU & Memory**: `1 vCPU, 2 GB`
   - **Port**: `8000`
5. Under **Environment variables**, set:
   - `APP_BASE_URL`: `https://app.yourdomain.com` (or your initial App Runner URL)
   - `JWT_SECRET`: `$(openssl rand -hex 32)`
   - `STRIPE_API_KEY`: `sk_live_...`
   - `STRIPE_WEBHOOK_SECRET`: `whsec_...`
   - `OPENAI_API_KEY`: `sk-proj-...`
   - `DATABASE_PATH`: `/data/nerilabs_saas_platform.db`
6. Under **Health check**:
   - **Protocol**: `HTTP`
   - **Path**: `/health`
   - **Interval**: `10` seconds, **Timeout**: `5` seconds
7. Click **Create & Deploy**. In ~3 minutes, your service will be live on an active HTTPS URL (e.g. `https://xyz.us-east-1.awsapprunner.com`).

### Step 3: Map Custom Domain & SSL
1. In the App Runner console, navigate to **Custom domains** -> **Link domain**.
2. Enter your domain (e.g., `app.yourstartup.com`).
3. Add the generated CNAME and DNS verification records to your DNS provider (Route 53, Cloudflare, etc.).
4. AWS automatically provisions and auto-renews free SSL/TLS certificates.

---

## 2. Low-Cost Virtual Machine: AWS EC2 / Lightsail ($10–$20/mo)

If you prefer a single-node virtual server with an Nginx reverse proxy:

### Step 1: Launch an AWS EC2 Instance
- **AMI**: Ubuntu 22.04 LTS or 24.04 LTS
- **Instance Type**: `t3.small` (2 vCPU, 2GB RAM)
- **Security Group**: Allow incoming traffic on ports `80` (HTTP), `443` (HTTPS), and `22` (SSH).

### Step 2: Install Docker and Docker Compose
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin curl
sudo systemctl enable --now docker
```

### Step 3: Deploy the Platform
```bash
# 1. Unzip the project folder
unzip nerilabs_saas_platform_aws_v8.zip
cd nerilabs-saas-platform

# 2. Configure production secrets
cp .env.production.example .env
nano .env  # Add your live Stripe, OpenAI, and JWT keys

# 3. Launch the container stack with Nginx
docker compose -f docker-compose.aws.yml up -d --build

# 4. Verify service health
curl http://localhost/health
```

### Step 4: Configure Let's Encrypt SSL (via Certbot)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.yourdomain.com
```

---

## 3. Stripe Billing & Webhook Activation

To accept payments from customers:
1. Log in to the [Stripe Dashboard](https://dashboard.stripe.com/).
2. Toggle to **Live Mode**.
3. Copy your live **Secret key** (`sk_live_...`) into your production environment variables.
4. Navigate to **Developers -> Webhooks** -> **Add destination**:
   - **Endpoint URL**: `https://app.yourdomain.com/api/billing/stripe/webhook`
   - **Events to listen for**:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
5. Copy the **Signing secret** (`whsec_...`) and set it as `STRIPE_WEBHOOK_SECRET`.

---

## 4. Customer Acquisition Playbook: Onboarding Your First 10 Customers

### Target Customer Profile
* **Ideal Customer Profile (ICP)**: B2B SaaS founders, indie hackers, growth marketers, and design agencies (Webflow/Framer) spending money on ads or Product Hunt launches who want to increase conversion rates without hiring a data scientist.
* **Core Value Proposition**: *"Autonomous, AI-driven A/B testing and behavioral rescue offers that pre-computes variants with zero website flicker."*

### Customer Onboarding Steps

#### 1. Directing Customers to Self-Serve Onboarding
Send prospects to your landing page at:
`https://app.yourdomain.com/landing`

Customers can review pricing tiers (Starter $49/mo, Growth $99/mo, Scale $199/mo) and click **"Start 14-Day Trial"** or **"Launch Setup Wizard"**.

#### 2. Delivering the Single-Line Script Tag
Once a customer completes onboarding in the wizard or dashboard, the platform generates their custom tracking snippet:

```html
<!-- NeriLabs Autonomous Experimentation SDK -->
<script>
  window.AI_EXPERIMENT_API_BASE = "https://app.yourdomain.com";
  window.AI_EXPERIMENT_PUBLISHABLE_KEY = "pk_live_customer_key_here";
  window.AI_EXPERIMENT_ID = "exp_customer_experiment_id_here";
</script>
<script src="https://app.yourdomain.com/static/experiment_sdk.js" async></script>
```

#### 3. Platform Integration Instructions for Customers

* **Webflow**: Go to *Project Settings* -> *Custom Code* -> paste into *Head Code* or *Footer Code* -> Publish.
* **Framer**: Go to *Site Settings* -> *General* -> *Custom Code* -> paste into *End of <head> tag* -> Publish.
* **WordPress**: Use any "Header and Footer Scripts" plugin or insert into `header.php`.
* **Next.js / React**: Add to `app/layout.tsx` or `pages/_document.tsx` using `next/script`:
  ```tsx
  import Script from 'next/script';

  export default function RootLayout({ children }) {
    return (
      <html>
        <head>
          <Script id="nerilabs-config" strategy="beforeInteractive">
            {`
              window.AI_EXPERIMENT_API_BASE = "https://app.yourdomain.com";
              window.AI_EXPERIMENT_PUBLISHABLE_KEY = "pk_live_...";
              window.AI_EXPERIMENT_ID = "exp_...";
            `}
          </Script>
          <Script src="https://app.yourdomain.com/static/experiment_sdk.js" strategy="afterInteractive" />
        </head>
        <body>{children}</body>
      </html>
    );
  }
  ```

#### 4. Running the First Live Experiment
1. Log in to the Founder Dashboard at `https://app.yourdomain.com/`.
2. Select or create an experiment (e.g. *Pricing Headline & CTA Optimization*).
3. The platform's AI Copy, UI, and Bandit engines will automatically pre-compute variants, verify WCAG 2.1 AA accessibility and XSS safety, and begin routing live visitors via Thompson Sampling.
