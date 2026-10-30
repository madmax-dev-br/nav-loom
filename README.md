# Navloom

Mapeamento de navegação e cenários de aplicações reais, conduzido por agentes via MCP. O Navloom executa interações em **Web e Android**, registra screenshots e evidências e transforma as navegações observadas em um grafo consultável.

O agente decide o que explorar. O serviço local executa as ações permitidas, guarda as evidências e reproduz caminhos conhecidos. Preparar uma missão na interface não inicia, por si só, uma exploração autônoma: conecte um agente ao MCP.

## Como funciona

1. **Configure um projeto:** plataforma, endereço ou pacote Android, repositórios, perfil, permissões, reset e orçamento.
2. **Conecte o agente:** ele consulta a memória do projeto e verifica as capacidades disponíveis.
3. **Explore:** o executor identifica elementos pelo DOM/acessibilidade na Web ou pela hierarquia acessível do Android. Cada interação registra o contexto e as capturas antes/depois.
4. **Organize:** telas e estados formam fluxos. As telas aparecem da esquerda para a direita pela primeira visita na execução selecionada. Descrições explicam a finalidade e as regras de negócio da tela.
5. **Reutilize:** uma missão focada pode reproduzir um trecho confirmado do grafo. Divergências interrompem a reprodução para recuperação localizada.
6. **Confira:** resultados, verificações, logs e pendências ficam no histórico. Concluir uma navegação não equivale a passar um teste; sem assertions, o resultado é `not_verified`.

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
| `navloom_start`, `navloom_observe`, `navloom_step` | Missão, captura e interação |
| `navloom_frontier` | Ações descobertas ainda não visitadas |
| `navloom_route`, `navloom_replay` | Planejar e reproduzir caminhos confirmados |
| `navloom_annotate`, `navloom_group_flow` | Descrições de negócio e agrupamentos |
| `navloom_finish`, `navloom_compare` | Verificações, diagnóstico e comparação |

Para testar um fluxo específico, prefira `scenarioRunId` e o intervalo de passos ao planejar a reprodução. Chegar ao mesmo recibo por outro caminho não prova que o fluxo solicitado foi executado. O exemplo `node scripts/agent-demo.mjs examples/agent-project` usa um roteiro conhecido para demonstrar a integração; não é uma exploração autônoma.

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
| `agent/` | Serviço local, persistência, executores Web/ADB, MCP e plugins |
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
