# Navloom

Mapeamento de navegação e cenários de aplicações reais, conduzido por agentes via MCP. O Navloom executa interações em **Web e Android**, registra screenshots e evidências e transforma as navegações observadas em um grafo consultável.

O agente decide o que explorar. O serviço local executa as ações permitidas, guarda as evidências e reproduz caminhos conhecidos. Preparar uma missão na interface não inicia, por si só, uma exploração autônoma: conecte um agente ao MCP.

## Como funciona

1. **Configure um projeto:** plataforma, endereço ou pacote Android, repositórios, perfil, permissões, reset e orçamento.
2. **Conecte o agente:** ele consulta a memória do projeto e verifica as capacidades disponíveis.
3. **Explore:** o executor identifica elementos pelo DOM/acessibilidade na Web ou pela hierarquia acessível do Android. Cada interação registra o contexto, as capturas antes/depois, o que mudou (texto, elementos, região da imagem), as chamadas de API disparadas e um resumo determinístico do efeito. `navloom_explore` percorre os candidatos pendentes em ordem estável e limitada; o agente decide formulários e caminhos de negócio.
4. **Organize:** telas e estados formam fluxos. As telas aparecem da esquerda para a direita pela primeira visita na execução selecionada; setas partem do botão tocado e apontam para a nova tela ou para o novo estado, com a região alterada destacada. Descrições explicam a finalidade e as regras de negócio da tela e o que cada interação faz.
5. **Reutilize:** uma missão focada pode reproduzir um trecho confirmado do grafo. Divergências interrompem a reprodução para recuperação localizada.
6. **Confira:** resultados, verificações, logs e pendências ficam no histórico. Concluir uma navegação não equivale a passar um teste; sem assertions, o resultado é `not_verified`.

Tudo que o serviço aprende é espelhado em texto no diretório `navloom-map/` do projeto (`map.yaml`, `README.md` e miniaturas dos estados), pronto para commit. Um checkout novo renderiza esse mapa na interface mesmo sem execuções ou evidências locais.

Elementos detectados são candidatos. Uma transição só é confirmada depois de uma ação observada. Screenshots, estados e posições de scroll são registros distintos. A versão do aplicativo e a versão do código são registradas separadamente quando disponíveis; não se presume que um APK corresponda ao checkout.

## Executar localmente

Requisitos:

- Node.js **22.13+**, npm e Git para registrar versões do código.
- Chromium do Playwright para Web.
- Para Android: ADB no `PATH`, dispositivo/emulador configurado e o aplicativo instalado.
- Docker somente para plugins que executam lógica em container.

Na raiz do repositório:

```sh
npm ci
npx playwright install chromium
```

Para experimentar com a aplicação Web incluída, use três terminais:

```sh
# 1. Aplicação de demonstração: http://127.0.0.1:4790
node tests/agent/fixture.mjs
```

```sh
# 2. Serviço do projeto: porta 4788
npm run agent:serve -- examples/agent-project
```

```sh
# 3. Interface: porta 5173
NAVLOOM_AGENT_PROJECT=examples/agent-project npm run dev -- --host 127.0.0.1
```

No PowerShell, defina `$env:NAVLOOM_AGENT_PROJECT="examples/agent-project"` antes de executar `npm run dev -- --host 127.0.0.1`.

Abra [o workspace local](http://127.0.0.1:5173/signin-with-chatgpt?return_to=/explore). O login desse endereço é uma simulação para desenvolvimento em loopback. Esses comandos não publicam o app na internet.

O seletor **Projeto** troca projetos ou cria um novo Web/Android, com configuração, grafo e histórico separados. O serviço e o MCP precisam apontar para a mesma pasta indicada no painel. O editor visual anterior continua disponível em `/`.

## Skill para o agente

[`agent-skills/navloom/SKILL.md`](agent-skills/navloom/SKILL.md) explica o setup completo e a operação: pré-requisitos, `navloom.yaml`, serviço e interface, conexão MCP, exploração determinística, pedidos de ajuda e harness, API, deeplinks, vínculo com o código, descrições, o que versionar e as regras fixas. Instale no cliente do agente (por exemplo, copie a pasta para `.claude/skills/navloom/` no projeto ou em `~/.claude/skills/`) para que ele saiba como usar o Navloom antes de conectar.

## Conectar um agente por MCP

Adicione ao cliente MCP, substituindo os caminhos pelos caminhos absolutos do seu checkout e projeto:

```json
{
  "mcpServers": {
    "navloom": {
      "command": "node",
      "args": [
        "/caminho/Navloom/scripts/agent-mcp.mjs",
        "/caminho/Navloom/examples/agent-project"
      ]
    }
  }
}
```

Inicie o serviço antes da conexão. Um pedido típico ao agente:

> Leia a memória e as capacidades do projeto. Explore o checkout com uma conta de teste, registre estados de erro e recuperação e organize as telas pela primeira visita. Descreva cada tela em termos de negócio. Finalize com verificações explícitas e liste os caminhos não explorados.

Principais operações:

| Operação | Finalidade |
| --- | --- |
| `navloom_memory`, `navloom_capabilities` | Contexto persistido e recursos da plataforma |
| `navloom_start`, `navloom_observe`, `navloom_step` | Missão, captura e interação (cada passo devolve `outcome`, diff, chamadas de API e resumo) |
| `navloom_frontier`, `navloom_probe`, `navloom_explore` | Candidatos pendentes; sondar um candidato; exploração determinística limitada |
| `navloom_deeplinks` | Deeplinks declarados (intent filters), links observados, prefixos permitidos e deeplinks verificados |
| `navloom_route`, `navloom_replay` | Planejar e reproduzir caminhos confirmados |
| `navloom_annotate`, `navloom_describe`, `navloom_group_flow` | Descrições de negócio de telas, transições/estados/fluxos e agrupamentos |
| `navloom_ask`, `navloom_await`, `navloom_help` | Pedir ajuda a uma pessoa quando não dá para avançar (senha, dado, decisão, pré-condição); a resposta vira harness e é lembrada |
| `navloom_search_source`, `navloom_source_tree`, `navloom_link_suggestions`, `navloom_link` | Explorar os repositórios configurados e vincular telas ao frontend e endpoints ao backend |
| `navloom_export_map` | Gravar o mapa versionável (`navloom-map/`) |
| `navloom_finish`, `navloom_compare` | Verificações, diagnóstico e comparação |

Para testar um fluxo específico, prefira `scenarioRunId` e o intervalo de passos ao planejar a reprodução. Chegar ao mesmo recibo por outro caminho não prova que o fluxo solicitado foi executado. O exemplo `node scripts/agent-demo.mjs examples/agent-project` usa um roteiro conhecido para demonstrar a integração; não é uma exploração autônoma.

## Exploração determinística, API e deeplinks

- `navloom_explore` toca candidatos clicáveis pendentes em ordem estável (de cima para baixo, da esquerda para a direita), classifica cada efeito como nova tela, mudança de estado, scroll ou sem mudança, e volta com `back` apenas quando abriu uma tela nova (nunca de telas já visitadas antes da origem, nem sem histórico no navegador). Campos sensíveis e rótulos que casam com `exploration.avoid` (sair, excluir…) ficam para o agente. Mudanças automáticas (fim de loading, redirecionamentos) são registradas como eventos automáticos.
- Chamadas de API: na Web todas as requisições do navegador entre a ação e a captura seguinte; no Android as linhas de logcat do processo do app (OkHttp logging ou linhas como `GET /api/x -> 200`). Elas aparecem na transição, no painel **API** e no mapa versionado. São evidência do que o app pediu, não prova do comportamento do servidor.
- Deeplinks: o Android lista os intent filters do pacote instalado (`dumpsys package`), a Web lista links observados nas telas. Um deeplink só é **verificado** quando um passo `deeplink` observado registra a tela de destino.
- iOS: alvo `ios` com simulador (`xcrun simctl`) para captura, abertura e deeplinks. Sem um driver XCUITest/WebDriverAgent, `interact` e `hierarchy` são reportados como ausentes em vez de simulados.

## Respostas compactas e capturas comprimidas

O serviço devolve ao agente, por padrão, um grafo textual da tela (`digest`): uma linha por nó com tipo, rótulo, posição e tamanho em pixels, `#resource_id`, ações e `id`. O XML da hierarquia, seletores e identidades nunca viajam pelo MCP. O digest de cada estado fica salvo no grafo e em `navloom-map/map.yaml`, para descrever telas e fluxos sem reabrir imagens. `navloom_run` vira uma narrativa de uma linha por passo. `detail: full` devolve os registros completos quando necessário.

Capturas: o PNG original continua como evidência imutável, mas o site e o modelo recebem um JPEG reduzido (`captures.previewWidth`/`previewQuality`, `captures.modelWidth`), e as miniaturas do mapa são JPEG (`map.thumbnailQuality`). No Android, cada observação usa duas chamadas ADB (foco filtrado no aparelho e dump+cat em um shell) e um passo logo após a observação pula a checagem redundante de tela (`exploration.staleCheckMs`).

## Pedidos de ajuda e harness

O agente deve reconhecer quando não tem condições de avançar. Cada observação traz `help.needs` (campos sensíveis e se o harness já conhece o `secretRef`) e `help.hints` (instruções lembradas para a tela). Quando falta algo que só uma pessoa sabe, o agente chama `navloom_ask` e espera com `navloom_await`; a pessoa responde no painel **Ajuda** da interface. A resposta entra no harness do projeto (`navloom-map/map.yaml`, seção `harness`) e as próximas execuções já a encontram: `navloom_ask` devolve `known` em vez de perguntar de novo. Segredos ficam apenas em `.navloom/secrets.json` (ignorado pelo git) e são usados por `secretRef`; o mapa guarda a referência, nunca o valor.

## Vínculo com o código

Com `repositories` configurados, `navloom_link_suggestions` busca no código os identificadores, rótulos e rota de uma tela (frontend) e os caminhos dos endpoints que ela dispara (backend), devolvendo candidatos com as linhas encontradas. O agente lê os arquivos (`navloom_source`, `navloom_search_source`) e confirma com `navloom_link`. Os vínculos aparecem no inspector da tela, na coluna **Backend** do painel de API e no mapa versionado. Vínculos inferidos são hipóteses; só o status `confirmed` indica leitura do código.

## Android de demonstração

[Navloom Lab](examples/android-test-app/README.md) é um app Jetpack Compose com API mock local. Inclui cadastro/login, catálogo, favoritos, carrinho, compra/comprovante, Pix e cartões/aumento de limite. Nenhuma operação financeira é real.

```sh
# API local, em outro terminal
node examples/android-test-app/server/server.mjs

# Com JDK 17/21 e Android SDK configurados
cd examples/android-test-app
./gradlew :app:assembleDebug
adb devices -l
adb -s emulator-5554 reverse tcp:4791 tcp:4791
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 shell am start -n dev.navloom.testapp/.MainActivity
```

Use o serial real do seu dispositivo também em `navloom.yaml`. O app usa internamente `http://127.0.0.1:4791`. A conta e a senha documentadas no exemplo são dados fictícios do mock. Para ações com `secretRef: password`, configure `NAVLOOM_TEST_PASSWORD` no ambiente do **serviço**, sem gravar a senha no YAML.

## Mapa e controles

- Arrastar com botão do meio ou **Espaço + arrastar** move o canvas.
- Roda do mouse move verticalmente; **Command + roda** dá zoom no cursor (Ctrl também é aceito).
- Uma interação parte do botão correspondente; eventos automáticos identificados podem partir da tela.
- Hover em uma ação destaca seu caminho e esmaece os demais.
- `?` indica ação detectada sem destino mapeado naquela execução.
- Filtros controlam resultado da execução, navegação, estados, scroll e ações pendentes.
- Painéis laterais são recolhíveis. Estados/capturas podem ser expandidos.

## Dados locais e privacidade

`navloom.yaml` guarda a configuração versionável. Perfis referenciam nomes de variáveis de ambiente para credenciais. O serviço usa loopback e um token local em `.navloom/runtime.json`.

O `.gitignore` exclui tokens, execuções, screenshots, logs, revisões, mapas locais, caches, builds, configuração do SDK Android e relatórios de verificação. Skills e código de plugins de exemplo podem ser versionados. Novos projetos criados na interface dentro do exemplo são locais e também ficam excluídos.

Capturas e logs podem conter dados da aplicação. Use contas descartáveis e revise qualquer evidência antes de compartilhar. O projeto não promete detectar ou remover automaticamente todo dado sensível de screenshots. Personalize os exemplos de configuração sem adicionar caminhos privados ou credenciais ao Git.

## Plugins e arquitetura

| Pasta | Conteúdo |
| --- | --- |
| `agent/` | Serviço local, persistência, executores Web/ADB/iOS, diffs, rede, deeplinks, mapa versionável, MCP e plugins |
| `navloom-map/` (no projeto) | Conhecimento do app em texto: telas, estados, transições, endpoints, deeplinks e miniaturas |
| `app/explore/` | Workspace de projetos, mapa e histórico |
| `components/agent-*` | Canvas, conexões e elementos interativos |
| `examples/agent-project/` | Configuração, skill e plugin de deeplinks |
| `examples/android-test-app/` | App Compose e servidor mock |
| `tests/agent/` | Testes de execução, evidências, permissões e isolamento |

Componentes de plugins usam iframe isolado; lógica local usa containers restritos e uma ponte de capacidades. Veja o [guia do serviço e SDK](agent/README.md) para setup, permissões, retomada, replay e plugins.

## Verificação e limites atuais

```sh
npm run test:model
npm run test:agent
npx tsc --noEmit
npm run build
```

Os testes Web precisam do Chromium instalado. Testes com Android e containers são opt-in; consulte `tests/agent/android-device.test.mjs` e `tests/agent/plugins.test.mjs` antes de habilitá-los, pois interagem com recursos locais.

A exploração é limitada pelo orçamento e pela cobertura realmente observada. Identidade estrutural pode confundir telas semelhantes; marcações opcionais de tela/estado ajudam. O executor Android usa entrada básica via ADB: Unicode não é suportado e foram observadas limitações ao substituir texto ou tocar com teclado aberto. É necessário verificar o conteúdo após preenchimentos. Estados de loading muito breves podem não aparecer na captura. Resultados dessas limitações devem ser reportados, não tratados como sucesso semântico.
