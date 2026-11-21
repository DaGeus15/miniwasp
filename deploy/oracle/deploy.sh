#!/bin/sh
# MiniWasp detras de Cloudflare Tunnel (miniwasp.dayle.dev).
# La app no publica puertos: su red solo la comparte con cloudflared (sale a internet
# para el bucket de adjuntos), asi que solo el tunel llega a ella y CF-Connecting-IP es confiable.
# Uso: cd ~/miniwasp && ./deploy.sh   (recompila la imagen y recrea los contenedores)
set -e
cd "$(dirname "$0")"
CLOUDFLARED=cloudflare/cloudflared@sha256:4955524aeaa379e154023d5a027c250f7b35041a2e7e950cf13f144bc9b9c5ba

docker build -t miniwasp:latest .
docker network inspect miniwasp_backend >/dev/null 2>&1 || docker network create miniwasp_backend
docker rm -f miniwasp-tunnel miniwasp-app >/dev/null 2>&1 || true

docker run -d --name miniwasp-app --network miniwasp_backend --network-alias app \
  --env-file .env -e HOST=0.0.0.0 -e PORT=3000 -e TRUSTED_PROXY_HEADER=cf-connecting-ip \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  --pids-limit 128 --memory 1g --restart unless-stopped miniwasp:latest

i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' miniwasp-app)" = healthy ]; do
  i=$((i+1)); [ $i -gt 30 ] && { docker logs --tail 30 miniwasp-app; exit 1; }; sleep 3
done

docker run -d --name miniwasp-tunnel --env-file .tunnel.env \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --pids-limit 128 --memory 256m --restart unless-stopped \
  $CLOUDFLARED tunnel --no-autoupdate run
docker network connect miniwasp_backend miniwasp-tunnel
echo "MiniWasp en marcha"
