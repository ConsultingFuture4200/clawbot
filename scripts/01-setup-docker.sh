#!/usr/bin/env bash
# 01-setup-docker.sh — Install Docker Engine in WSL2 (NOT Docker Desktop)
set -euo pipefail

echo "=== Setting Up Docker Engine in WSL2 ==="
echo ""

# Remove any old Docker packages
echo "--- Removing old Docker packages (if any) ---"
sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Install prerequisites
echo ""
echo "--- Installing prerequisites ---"
sudo apt-get update
sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's GPG key
echo ""
echo "--- Adding Docker GPG key ---"
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker apt repository
echo ""
echo "--- Adding Docker repository ---"
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
echo ""
echo "--- Installing Docker Engine ---"
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add current user to docker group
echo ""
echo "--- Adding $USER to docker group ---"
sudo usermod -aG docker "$USER"

# Start Docker daemon
echo ""
echo "--- Starting Docker ---"
sudo service docker start || sudo dockerd &

# Wait for Docker to be ready
echo "Waiting for Docker to start..."
for i in $(seq 1 30); do
    if docker info &>/dev/null; then
        break
    fi
    sleep 1
done

# Verify
echo ""
echo "--- Verification ---"
if docker run --rm hello-world 2>/dev/null | grep -q "Hello from Docker"; then
    echo "  [PASS] docker run hello-world succeeded"
else
    echo "  [FAIL] docker run hello-world failed"
    echo "  You may need to log out and back in for group membership to take effect:"
    echo "    newgrp docker"
    echo "  Then re-run this script."
    exit 1
fi

echo ""
echo "Docker Engine installed successfully in WSL2."
echo "Proceed to 02-setup-node.sh"
