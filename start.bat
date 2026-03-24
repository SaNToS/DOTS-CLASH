@echo off
echo ==========================================
echo Starting Dots Game with Docker Compose
echo ==========================================

echo Building and starting containers...
docker-compose up -d --build

echo Done! The app is starting up...
echo ------------------------------------------
echo TO CONNECT FROM OTHER DEVICES:
echo 1. Find your computer's IP address (e.g., 192.168.1.XX)
echo 2. Open http://YOUR-IP:5173 on your phone/other device
echo ------------------------------------------

echo.
echo Showing logs (Press Ctrl+C to stop)...
docker-compose logs -f
pause
