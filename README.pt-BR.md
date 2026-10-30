<p align="center"><img src="src/icons/128.png" width="96" alt=""></p>

<h1 align="center">Reelster</h1>

<p align="center">
  Exporta todos os Reels <b>enviados e recebidos</b> numa conversa do Instagram Direct para um único <code>.tar.gz</code>.<br>
  JavaScript puro · Manifest V3 · zero dependências · nada sai do seu navegador.
</p>

<p align="center"><a href="README.md">English</a></p>

---

## O que você recebe

```
reelster-<id-da-conversa>-2026-10-30.tar.gz
├── enviados/      # Reels que você mandou
├── recebidos/     # Reels que você recebeu
└── manifest.json  # links, datas, remetentes e falhas
```

Um `.mp4` por Reel, na maior resolução disponível, nomeado `<data UTC>_<hora>_<shortcode>.mp4`. Reel repetido na mesma direção entra uma vez só. Reel apagado ou de conta privada vai para `failed` no `manifest.json` sem interromper a exportação.

## Instalação

1. Baixe o `reelster-x.y.z.zip` mais recente em [Releases](https://github.com/prod455/reelster/releases) e descompacte.
2. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta descompactada (ou `src/` do repositório).

## Uso

1. Abra [instagram.com/direct](https://www.instagram.com/direct/inbox/) e entre na conversa.
2. Clique no ícone do Reelster → **Exportar Reels desta conversa**.
3. Deixe as duas abas abertas. No fim, o navegador salva o `.tar.gz`.

## Desenvolvimento

```bash
npm test            # testes unitários
npm install && npx playwright install chromium
npm run test:e2e    # carrega a extensão no Chromium contra um Instagram simulado
npm run build       # dist/reelster-<versão>.zip
```

## Aviso

Projeto independente, sem vínculo com Instagram ou Meta. Use só nas suas próprias conversas e respeite os direitos dos criadores e os Termos de Uso do Instagram. Acesso automatizado pode ser limitado pelo Instagram; use por sua conta e risco.

Licença [MIT](LICENSE).
