# profissa-sdn-framework (produção mínima)

Conjunto mínimo para rodar a plataforma (backend FastAPI + UI estática) e o módulo `gr-netmon` do GNU Radio. O foco é manter apenas o essencial para execução em produção.

## Estrutura mínima
- `platform/backend/` – API FastAPI + SSE + coleta e métricas.
- `platform/frontend/dist/` – build estático da UI (servir com qualquer servidor HTTP).
- `platform/experiments/platform_config.json` – configuração padrão.
- `gr-netmon/` – blocos GNU Radio (`python/netmon`) + definições GRC (`grc/blocks`).
- `requirements.txt` – dependências runtime do backend.
- `VERSION` – versão do backend (lida no startup).

## Requisitos
- Python 3.11+.
- GNU Radio 3.10+ (para usar `gr-netmon`).
- Docker/Mininet conforme o cenário de coleta.

## Backend (API)
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

PLATFORM_CONFIG_PATH=platform/experiments/platform_config.json \
PYTHONPATH=$(pwd) uvicorn platform.backend.api.app:app --host 0.0.0.0 --port 8000
```

## Frontend (UI estática)
Sirva o build em `platform/frontend/dist` com qualquer servidor HTTP. Exemplo simples:
```bash
cd platform/frontend/dist
python -m http.server 5173
```
Defina `VITE_API_BASE` no ambiente do servidor estático, se necessário, para apontar ao backend.

## gr-netmon
Consulte `gr-netmon/README.md` para instalar via CMake e usar os blocos no GRC.

## Variáveis úteis
- `PLATFORM_CONFIG_PATH` (default `platform/experiments/platform_config.json`)
- `API_KEY` (opcional, para escrita via header `X-API-Key`)
- `REAL_COLLECTION` (default `1`)
- `AUTO_COLLECT_INTERVAL` (default `5`)

## Licenca
MIT License. Veja `LICENSE`.


NetOps Studio — novo logo e identidade
Design do ícone (profissa.svg)
Fundo: gradiente escuro space #0a0e1a → #111827 com grade sutil (estilo terminal/dashboard)
Forma central: hexágono (símbolo universal de nó de rede) com borda gradiente cyan → indigo
Topologia: 5 nós satélite conectados por linhas tracejadas ao hexágono central, simulando uma rede SDN estrela
Glow: auras luminosas em cada nó + halo no core (efeito de pulso de sinal)
Anel orbital externo: tracejado girando ao redor do núcleo
Cores: electric cyan #00f5ff + indigo #6366f1 + azul #0ea5e9 — paleta tech/ops moderna
Wordmark:
NetOps — bold heavy, branco gelo
STUDIO — espaçado, caps, cyan
Separador com gradiente entre as duas linhas
Acabamento: gloss sutil no topo + borda luminosa arredondada