# On-premise setup

VIN-AIOS is designed to be installable in environments where you can't `curl`
random scripts off the internet at runtime, can't route traffic to public LLM
APIs, and can't share data with a third-party SaaS. This doc walks the realistic
shapes of "on-prem" we've encountered.

---

## TL;DR by environment

| Environment | Runtime | Setup |
|---|---|---|
| Workstation / dev laptop | Ollama on host | `ollama pull qwen2.5:14b` + `npm install` |
| Single-server lab | Ollama in Docker | `docker compose up -d` + `./scripts/setup-models.sh` |
| GPU server (single host) | Ollama with GPU passthrough | Uncomment the `deploy.resources` block in `docker-compose.yml` |
| Multi-GPU / production throughput | vLLM behind reverse proxy | Use the `openai` provider with `OPENAI_BASE_URL=http://vllm.internal:8000/v1` |
| Fully air-gapped | Pre-pull models on a connected mirror, then `docker save` / `ollama pull --insecure` from internal registry | See "Air-gapped install" below |

---

## What VIN actually touches on the network

After installation, with `HARNESS_PROVIDER=ollama` and no `GEMINI_API_KEY`:

| Call | Where | When |
|---|---|---|
| `POST {OLLAMA_BASE_URL}/api/chat` | Your Ollama host | Every agent step |
| `POST {OLLAMA_BASE_URL}/api/embed` | Your Ollama host | Every message stored to memory |
| `GET {OLLAMA_BASE_URL}/api/tags` | Your Ollama host | Once at first call (model discovery) |
| `fetch(<url>)` from the **`web_fetch` tool** | Wherever the model asks | Only if the agent decides to use that tool |
| **(nothing else)** | | |

There is no telemetry, no usage reporting, no remote logging.

If you need to lock down even the agent's own `web_fetch`, drop it via tool
policy in `harness.config.json5`:

```json5
{
  policy: {
    deny: ["web_fetch"]
  }
}
```

---

## Air-gapped install

If your target environment cannot reach the public internet:

### 1. On a connected machine

```bash
# Save the Ollama image + pull models
docker pull ollama/ollama:latest
docker save ollama/ollama:latest -o ollama.tar

# Pull the models you want, then snapshot ~/.ollama
ollama pull qwen2.5:14b
ollama pull nomic-embed-text
tar -czf ollama-models.tgz -C ~/.ollama .

# Mirror the VIN repo (with node_modules vendored)
git clone https://github.com/accucrazy/VIN.git
cd VIN && npm install
tar -czf VIN-bundle.tgz . --exclude .git
```

### 2. Transfer

Move `ollama.tar`, `ollama-models.tgz`, and `VIN-bundle.tgz` to your
air-gapped host (USB / signed transfer station / approved file share).

### 3. On the air-gapped host

```bash
# Load Ollama image into the local docker daemon
docker load -i ollama.tar

# Restore models
mkdir -p ~/.ollama && tar -xzf ollama-models.tgz -C ~/.ollama

# Unpack VIN
mkdir -p /opt/VIN && tar -xzf VIN-bundle.tgz -C /opt/VIN
cd /opt/VIN
cp .env.example .env
docker compose up -d
npx tsx src/index.ts
```

`./scripts/setup-models.sh` will skip the pull step automatically if the models
already exist locally.

---

## Hardware sizing (rough)

| Model | FP16 | Q4_K_M | Recommended GPU |
|---|---|---|---|
| `qwen2.5:7b` | ~16GB | ~5GB | RTX 3060 (12GB) and up |
| `qwen2.5:14b` | ~28GB | ~9GB | RTX 4070 (12GB) / A5000 (24GB) |
| `qwen2.5:32b` | ~64GB | ~19GB | RTX 4090 (24GB) / A100 40GB |
| `qwen2.5:72b` | ~140GB | ~48GB | 2× A100 40GB / 1× H100 80GB |
| `nemotron:70b` | ~140GB | ~43GB | 2× A100 40GB / 1× H100 80GB |
| `gemma2:9b` | ~18GB | ~6GB | RTX 3060 12GB up |
| `gemma3:12b` | ~24GB | ~8GB | RTX 4070 12GB up |
| `nomic-embed-text` | <1GB | <1GB | CPU is fine |

CPU-only is feasible for 7B / Gemma 2 9B on a recent server with AVX2 — expect
~5-10 tokens/sec, fine for low-volume internal tools.

---

## Reverse-proxy in front of Ollama

If you want SSL, basic auth, or rate limiting at the edge:

```nginx
# /etc/nginx/sites-available/ollama
server {
  listen 443 ssl http2;
  server_name llm.internal.company;

  ssl_certificate     /etc/ssl/internal/llm.crt;
  ssl_certificate_key /etc/ssl/internal/llm.key;

  # Optional: HTTP basic auth so only the agent box can call
  auth_basic           "VIN agents only";
  auth_basic_user_file /etc/nginx/.htpasswd;

  location / {
    proxy_pass         http://127.0.0.1:11434;
    proxy_read_timeout 600s;            # long generations
    proxy_buffering    off;             # streaming friendliness
    proxy_set_header   Host $host;
  }
}
```

Then point VIN at it:

```bash
OLLAMA_BASE_URL=https://llm.internal.company
```

---

## Monitoring

VIN already prints provider / model / token-usage on every step. For
production-style observability, hook the `boot()` call into your tracing system
and listen for the per-tool traces returned by `ask()`:

```ts
const res = await ask('What did the last build break on?');
for (const trace of res.traces) {
  metrics.timing(`tool.${trace.tool}`, trace.duration);
  metrics.increment(`tool.${trace.tool}.calls`);
}
metrics.increment('agent.tokens.in',  res.usage?.inputTokens  ?? 0);
metrics.increment('agent.tokens.out', res.usage?.outputTokens ?? 0);
```
