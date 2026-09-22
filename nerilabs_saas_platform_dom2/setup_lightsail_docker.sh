#!/bin/bash
# ==============================================================================
# NeriLabs SaaS Platform — Amazon Lightsail Docker Deployment Script
# ==============================================================================
set -e

DOMAIN="${1:-app.nerilabs.io}"

echo ">>> [1/4] Installing Docker and Docker Compose Plugin..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin nginx certbot python3-certbot-nginx

sudo usermod -aG docker $USER || true

echo ">>> [2/4] Building and launching Docker container stack..."
sudo docker compose up -d --build

echo ">>> [3/4] Configuring Nginx Reverse Proxy on Host..."
sudo bash -c "cat << NGINX_EOF > /etc/nginx/sites-available/nerilabs
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX_EOF"

sudo ln -sf /etc/nginx/sites-available/nerilabs /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo ">>> [4/4] Verifying healthcheck..."
sleep 5
curl -s http://127.0.0.1:8000/health || echo "Waiting for container to report healthy..."

echo "=============================================================================="
echo " Docker stack is running on Amazon Lightsail!"
echo " Next step: Obtain free SSL with Certbot:"
echo "   sudo certbot --nginx -d $DOMAIN"
echo "=============================================================================="
