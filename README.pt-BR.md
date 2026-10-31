<p align="center"><img src="src/icons/128.png" width="96" alt=""></p>

<h1 align="center">Reelster</h1>

<p align="center">
  Exporta todos os Reels e posts <b>enviados e recebidos</b> numa conversa do Instagram Direct para um único <code>.tar.gz</code>.<br>
  JavaScript puro · Manifest V3 · zero dependências · nada sai do seu navegador.
</p>

<p align="center"><a href="README.md">English</a></p>

---

## O que você recebe

```
reelster-<id-da-conversa>-2026-10-30.tar.gz
├── enviados/      # o que você mandou: Reels (.mp4) e posts/ (todas as fotos de cada post)
├── recebidos/     # o que você recebeu, mesma estrutura
└── manifest.json  # links, datas, remetentes e falhas
```

Um `.mp4` por Reel e todas as fotos (ou vídeos de carrossel) de cada post, na maior resolução disponível, nomeado `<data UTC>_<hora>_<shortcode>.mp4`. Reel ou post repetido na mesma direção entra uma vez só. Item apagado ou de conta privada vai para `failed` no `manifest.json` sem interromper a exportação.

## Instalação

1. Baixe o `reelster-x.y.z.zip` mais recente em [Releases](https://github.com/prod455/reelster/releases) e descompacte.
2. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta descompactada (ou `src/` do repositório).

## Uso

1. Abra [instagram.com/direct](https://www.instagram.com/direct/inbox/) e entre na conversa.
2. Clique no ícone do Reelster → **Exportar Reels e posts desta conversa**. Abre uma janelinha.
3. Se quiser, escolha o período (**De** / **Até**) e clique em **Começar exportação**.
4. A aba do Instagram recarrega e rola sozinha até o começo da conversa (ou do período). Deixe as duas abertas e a aba do Instagram visível; **Parar e baixar agora** baixa só o que já foi lido. Se o número parar de subir, role a conversa pra cima você mesmo: tudo que o Instagram carregar é capturado.
5. No fim, o navegador salva o `.tar.gz`.

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
