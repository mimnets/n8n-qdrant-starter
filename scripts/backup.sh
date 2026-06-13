#!/bin/bash
set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_PATH="$BACKUP_DIR/backup_$TIMESTAMP"

echo "💾 Creating backup at $BACKUP_PATH..."

mkdir -p "$BACKUP_PATH"

# Backup PostgreSQL
echo "📦 Backing up PostgreSQL..."
docker compose exec -T postgres pg_dump -U ${POSTGRES_USER:-n8n} ${POSTGRES_DB:-n8n} > "$BACKUP_PATH/postgres_dump.sql"

# Backup n8n data
echo "📦 Backing up n8n data..."
docker compose exec -T n8n tar -czf - -C /home/node/.n8n . > "$BACKUP_PATH/n8n_data.tar.gz"

# Backup Qdrant
echo "📦 Backing up Qdrant data..."
docker compose exec -T qdrant tar -czf - -C /qdrant/storage . > "$BACKUP_PATH/qdrant_data.tar.gz"

echo "✅ Backup complete: $BACKUP_PATH"
echo ""
echo "📋 To restore, use:"
echo "   tar -xzf $BACKUP_PATH/n8n_data.tar.gz"
echo "   docker compose exec -T postgres psql -U n8n n8n < $BACKUP_PATH/postgres_dump.sql"
