#!/bin/bash
# ==============================================================================
# NeriLabs SaaS Platform — Amazon Lightsail Production Deployment Script
# Target OS: Ubuntu 22.04 / 24.04 LTS on Amazon Lightsail
# ==============================================================================
set -e

DOMAIN="${1:-app.nerilabs.io}"
APP_DIR="/opt/nerilabs-saas-platform"

echo ">>> [1/6] Updating system packages and installing prerequisites..."
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y python3 python3-pip python3-venv nginx certbot python3-certbot-nginx curl git ufw

echo ">>> [2/6] Configuring UFW Firewall (SSH, HTTP, HTTPS)..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo ">>> [3/6] Setting up application directory and virtual environment..."
sudo mkdir -p "$APP_DIR"
sudo chown -R $USER:$USER "$APP_DIR"
sudo mkdir -p /data
sudo chown -R $USER:$USER /data

# Assuming script is run from project root, copy files
if [ -f "requirements.txt" ]; then
    cp -r . "$APP_DIR/"
fi

cd "$APP_DIR"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo ">>> [4/6] Creating systemd service (/etc/systemd/system/nerilabs.service)..."
sudo bash -c "cat << 'SERVICE_EOF' > /etc/systemd/system/nerilabs.service
[Unit]
Description=NeriLabs Autonomous Experimentation Platform (FastAPI / Uvicorn)
After=network.target

[Service]
User=$USER
Group=$USER
WorkingDirectory=$APP_DIR
Environment=\"PATH=$APP_DIR/venv/bin:/usr/local/bin:/usr/bin\"
Environment=\"PYTHONPATH=$APP_DIR\"
Environment=\"DATABASE_PATH=/data/nerilabs_saas_platform.db\"
Environment=\"PORT=8000\"
Environment=\"HOST=127.0.0.1\"
Environment=\"WORKERS=4\"
Environment=\"APP_BASE_URL=https://$DOMAIN\"
ExecStart=$APP_DIR/venv/bin/uvicorn saas_platform.server:app --host 127.0.0.1 --port 8000 --workers 4 --proxy-headers --forwarded-allow-ips=\"*\"
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
SERVICE_EOF"

sudo systemctl daemon-reload
sudo systemctl enable nerilabs
sudo systemctl restart nerilabs

echo ">>> [5/6] Configuring Nginx reverse proxy (/etc/nginx/sites-available/nerilabs)..."
sudo bash -c "cat << 'NGINX_EOF' > /etc/nginx/sites-available/nerilabs
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
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Timeouts for telemetry beacons and server-sent events
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /static/ {
        alias $APP_DIR/saas_platform/dashboard/static/;
        expires 1h;
        add_header Cache-Control \"public, no-transform\";
    }
}
NGINX_EOF"

sudo ln -sf /etc/nginx/sites-available/nerilabs /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo ">>> [6/6] Checking health endpoint..."
sleep 3
curl -s http://127.0.0.1:8000/health || echo "Application starting up..."

echo "=============================================================================="
echo " NeriLabs SaaS is deployed and running on Amazon Lightsail!"
echo " Next step: Run Certbot to enable HTTPS for $DOMAIN:"
echo "   sudo certbot --nginx -d $DOMAIN"
echo "=============================================================================="
