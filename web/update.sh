git fetch --all
git pull
docker compose down
docker rm -f mapories-web 2>/dev/null || true
docker image rm web-web 2>/dev/null || true
docker compose build --no-cache web
docker compose up -d --build