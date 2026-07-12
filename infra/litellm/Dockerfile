# LiteLLM forwarding engine for Byoky, with the config baked in.
# Stateless (no DB, no stored keys) — the vault injects the org key per request.
# Railway provides $PORT; bind 0.0.0.0:$PORT.
FROM ghcr.io/berriai/litellm:main-latest
COPY config.yaml /app/config.yaml
ENTRYPOINT []
CMD ["sh", "-c", "litellm --config /app/config.yaml --host 0.0.0.0 --port ${PORT:-4000}"]
