# Netmon Flowgraphs

Este diretório contém flowgraphs prontos para uso no GNU Radio Companion (GRC).

## Conteúdo
- `metrics/`: um flowgraph por métrica (auto + msg).
- `special/`: exemplos específicos (ex.: `host_ping_auto.grc`, `host_ping_msg.grc`).

## Gerar novamente
```bash
python3 scripts/generate_netmon_flowgraphs.py
```

## Uso
Abra o GRC e carregue qualquer `.grc` dentro de `gr-netmon/grc/flowgraphs`.
Os blocos já vêm com parâmetros padrão do Profissa.
