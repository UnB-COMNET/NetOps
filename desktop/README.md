# NetOps Studio — Aplicação Desktop

## Instalação (uma vez só)

### Opção 1 — com o mouse (recomendado)

1. Abra a pasta **`desktop/`** no gerenciador de arquivos
2. Dê um **duplo clique** em **`Instalar NetOps Studio.desktop`**
3. Se o sistema perguntar, escolha **"Executar"** ou **"Confiar e executar"**
4. Um terminal abre e a instalação roda automaticamente
5. Ao final, pressione **ENTER** para fechar

> Se o gerenciador de arquivos não reconhecer o `.desktop`, clique com o botão direito em `install.sh` → **"Executar como programa"**.

### Opção 2 — pelo terminal

```bash
bash desktop/install.sh
```

---

O instalador faz **tudo automaticamente**:
- Verifica e instala Node.js ≥ 18 (via NodeSource, se necessário)
- Verifica e instala pacotes do sistema (`python3-gi`, `gir1.2-webkit2-4.0`, etc.)
- Cria o ambiente Python virtual (`.venv`) configurado corretamente
- Instala todas as dependências Python
- Instala as dependências Node.js e compila o frontend Next.js (`npm ci && npm run build`)
- Registra o ícone no sistema
- Cria o atalho **"NetOps Studio"** no menu de aplicativos

## Usar

Após instalar, procure por **"NetOps Studio"** no menu de aplicativos.

Ou execute direto pelo terminal:
```bash
./desktop/run_netops.sh
```

## O que acontece ao abrir

1. O backend FastAPI sobe automaticamente na porta **8000**
2. O frontend Next.js sobe na porta **3000** (`next start`)
3. A janela da aplicação abre automaticamente

## Diagnóstico (se algo der errado)

```bash
tail -50 /tmp/netops_app.log
```

## Reinstalar / Atualizar

Basta executar o instalador novamente (opção 1 ou 2 acima).


> O instalador é idempotente — pode ser executado quantas vezes quiser sem risco de duplicar entradas.

O instalador é idempotente — pode rodar quantas vezes quiser.
