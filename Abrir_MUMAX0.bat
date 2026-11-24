@echo off
title MUMAX0 - Servidor Local MuMax3
cd /d "%~dp0"
echo Iniciando MUMAX0 em http://127.0.0.1:8765 ...
node server.js
if errorlevel 1 (
  echo.
  echo Erro ao iniciar o servidor. Verifique se o Node.js esta instalado.
  pause
)
