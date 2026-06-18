#!/bin/bash
set -e

echo "🔧 Setting up n8n + Qdrant AI Stack..."

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check Docker Compose
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create .env if not exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env

    # Generate secure keys
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    JWT_SECRET=$(openssl rand -hex 32)

    # Replace placeholder values
    sed -i "s/change_me_to_random_64_hex_chars/$ENCRYPTION_KEY/" .env
    sed -i "s/change_me_to_random_64_hex_chars/$JWT_SECRET/" .env

    echo "⚠️  Please edit .env and set a secure POSTGRES_PASSWORD"
else
    echo "✅ .env file already exists"
fi

# Create required directories
mkdir -p n8n/demo-data
mkdir -p backups

echo "✨ Setup complete!"
echo ""
echo "🚀 To start the stack:"
echo "   docker compose up -d"
echo ""
echo "📊 Access n8n at: http://localhost:5678"
echo "🔍 Qdrant API at: http://localhost:6333"
