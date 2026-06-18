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

# Clone browser-n8n-local bridge if not already present
if [ ! -d "browser-n8n-local" ]; then
    echo "📥 Cloning browser-n8n-local (API bridge for n8n → Browser Use)..."
    git clone https://github.com/hoangnb24/browser-n8n-local.git
    echo "✅ browser-n8n-local cloned"
else
    echo "✅ browser-n8n-local already exists"
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
echo "🤖 Browser Use WebUI at: http://localhost:7788"
echo "👁️  Browser live view at: http://localhost:6080/vnc.html (password: vncpassword)"
echo "🔌 Browser Use API at: http://localhost:8000"
echo ""
echo "⚠️  Don't forget to set at least one LLM API key in .env (DeepSeek, OpenAI, or Anthropic)"
