#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "Iniciando MUMAX0 em http://127.0.0.1:8765 ..."
node server.js
