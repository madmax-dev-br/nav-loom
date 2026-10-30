# Navloom Lab — Android Compose + servidor local

Aplicativo de demonstração funcional para explorar navegação, estados, falhas e recuperações. Nenhuma compra, transferência ou solicitação financeira é real. O servidor usa somente memória e escuta em loopback.

## Executar

Requer Node 22+, JDK 17 ou 21, Android SDK 35, dispositivo/emulador Android 8+ e ADB. As dependências Gradle são baixadas na primeira compilação; a execução do app e do mock não usa nenhum serviço externo.

```sh
# Neste diretório, terminal 1:
node server/server.mjs

# Terminal 2 (defina ANDROID_HOME para seu SDK, se necessário):
./gradlew :app:assembleDebug
adb devices -l
adb -s emulator-5554 reverse tcp:4791 tcp:4791
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 shell am start -n dev.navloom.testapp/.MainActivity
```

Troque `emulator-5554` pelo serial listado. O AVD `Pixel_API36` existe nesta máquina e pode ser iniciado com `$ANDROID_HOME/emulator/emulator -avd Pixel_API36`. O app usa `http://127.0.0.1:4791`; o encaminhamento `adb reverse` serve tanto para emulador quanto para dispositivo USB. A URL é interna e fixa; configuração de servidor e instruções de ADB não aparecem na interface. O servidor continua limitado a `127.0.0.1`.

- Pacote: `dev.navloom.testapp`
- Conta pronta: `ana@navloom.test` / `Teste123!`
- Saldo inicial: R$ 1.500,00
- Cartão: final 4242, limite R$ 3.000,00, uso R$ 420,00
- Pix demo: `bruno@pix.test`
- Login é mantido somente durante o processo. Force-stop reinicia na autenticação; deeplink pendente é retomado após login.

## Fluxos completos

1. **Criar conta:** login → criar conta → nome/e-mail/senha → home. Valida e-mail duplicado, nome e senha mínima.
2. **Compra:** home/tab Produtos → detalhes → favorito opcional → adicionar → carrinho → pagamento → confirmar → comprovante → home. Carrinho aceita várias unidades, remoção e estado vazio; luminária está esgotada.
3. **Favoritos:** tab Favoritos → lista/vazio → detalhes → salvar/remover. Estado compartilhado com catálogo.
4. **Pix:** home → transferir → chave/valor/descrição → revisar destinatário → confirmar → comprovante → home. O saldo é debitado apenas no sucesso; histórico abre comprovantes.
5. **Cartões:** tab Cartões → aumentar limite → solicitar → resultado aprovado ou rejeitado → voltar aos cartões. Até R$ 10.000,00 aprovado por padrão; valor deve ser maior que limite atual.

Os dados de cada tela vêm do mock HTTP. Toda chamada mostra loading, bloqueia ações duplicadas enquanto está em andamento e apresenta erro. Leituras possuem “Tentar novamente”; mutações são repetidas pelo botão original após a falha, preservando o formulário.

## Cenários controlados

```sh
# Reset dos dados. Invalida sessões. Force-stop opcional para voltar ao login.
node server/reset.mjs --serial emulator-5554

# Loading prolongado + compra recusada (carrinho preservado):
curl -X POST http://127.0.0.1:4791/__admin/scenario \
  -H 'Content-Type: application/json' -d '{"delayMs":2500,"paymentDeclined":true}'

# Recuperar pagamento:
curl -X POST http://127.0.0.1:4791/__admin/scenario \
  -H 'Content-Type: application/json' -d '{"paymentDeclined":false,"delayMs":350}'

# Falha somente na próxima leitura do catálogo:
curl -X POST http://127.0.0.1:4791/__admin/scenario \
  -H 'Content-Type: application/json' -d '{"failNext":["GET /api/products"]}'
```

Outros controles: `pixUnavailable`, `limitRejected`, `catalogUnavailable` (booleanos). `delayMs`: 0–10000. `failNext` consome uma ocorrência por correspondência exata de `METHOD /api/path`. `GET /__admin/state` mostra dados sem senhas e o log de requisições sem tokens. `POST /__admin/reset` recria a seed e reinicia os IDs; horários dos comprovantes refletem a execução real.

## Identificadores e deeplinks

Cada raiz Compose exporta `contentDescription=navloom:screen:<tela>:state:<estado>` sem mesclar/ocultar os filhos. `testTagsAsResourceId=true` expõe tags no UIAutomator: `auth_email`, `auth_password`, `auth_submit`, `tab_products`, `product_tote`, `favorite_tote`, `product_add_cart`, `cart_checkout`, `checkout_confirm`, `pix_key`, `pix_amount`, `pix_review`, `pix_confirm`, `card_increase`, `limit_amount`, `limit_submit`, `receipt_home`, `retry` etc.

Estados da raiz: `loading`, `error`, `ready`, e nos comprovantes `completed`, `approved`, `rejected`. Telas usam IDs: `login`, `register`, `home`, `products`, `favorites`, `product`, `cart`, `checkout`, `pix`, `pix-confirm`, `cards`, `card-limit`, `receipt`.

```sh
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d 'navloomlab://app/products' -p dev.navloom.testapp
```

Rotas: `/login`, `/register`, `/home`, `/products`, `/favorites`, `/product/tote` (ou `headphones`, `bottle`, `lamp`, `backpack`, `notebook`), `/cart`, `/checkout`, `/pix`, `/pix-confirm`, `/cards`, `/card-limit`, `/receipt/<id>`. Rotas protegidas exigem login; checkout exige carrinho, confirmação Pix exige os dados preparados pelo formulário e recibos exigem um ID criado na execução. Deeplinks não fabricam esses pré-requisitos.

Copie `navloom.agent.example.yaml` para `navloom.yaml` neste diretório, ajuste o serial e configure o serviço Navloom para este diretório. Defina `NAVLOOM_LAB_PASSWORD=Teste123!` se quiser usar referência de segredo pelo agente.

## API

Valores monetários são inteiros em **centavos**. Endpoints `/api/*`, exceto login/register, exigem `Authorization: Bearer <token>`.

| Método | Rota | Corpo / resultado |
|---|---|---|
| POST | `/api/auth/login` | `{email,password}` → token |
| POST | `/api/auth/register` | `{name,email,password}` → token |
| POST | `/api/auth/logout` | Invalida token |
| GET | `/api/home` | Perfil, saldo, contadores, cartão, histórico |
| GET | `/api/products` | Catálogo |
| GET | `/api/products/:id` | Produto e estado favorito |
| GET | `/api/favorites` | Favoritos |
| POST / DELETE | `/api/favorites/:id` | Salvar/remover favorito |
| GET | `/api/cart` | Itens e total |
| POST | `/api/cart/items` | `{productId,quantity}` |
| DELETE | `/api/cart/items/:id` | Remover item |
| POST | `/api/checkout` | Compra e comprovante |
| GET | `/api/pix` | Saldo e histórico |
| POST | `/api/pix/recipient` | `{key}` → destinatário demo |
| POST | `/api/pix/transfers` | `{key,amount,description}` → comprovante |
| GET | `/api/cards` | Cartão e solicitações |
| POST | `/api/cards/card-demo/limit` | `{limit}` → resultado da análise |
| GET | `/api/receipts/:id` | Comprovante da própria conta |

## Verificação

```sh
node --test server/server.test.mjs
./gradlew :app:assembleDebug
# Com mock e emulador já ativos (restaura dados ao iniciar/finalizar):
node server/android-smoke.mjs
node server/android-register-smoke.mjs
```

Os testes HTTP verificam autenticação, criação/duplicação de conta, favoritos, estoque, compra com recusa/recuperação, preservação do carrinho, saldo Pix, limite aprovado/rejeitado, falha pontual e reset. Compilação não substitui uma execução em dispositivo; registre separadamente a validação visual e a hierarquia acessível ao testar por ADB.

### Validação realizada nesta implementação

APK debug compilado com Gradle 8.11.1 / SDK 35 e instalado no AVD Pixel_API36 (`emulator-5554`). O smoke ADB percorreu login, produto/favorito, carrinho, compra recusada e recuperação até comprovante, Pix e comprovante, aumento de limite, favoritos persistidos e deeplink. Um segundo teste verificou criação de conta pela UI e abertura repetida do mesmo deeplink. Evidências em `verification/`; os scripts restauram os dados e deixam o app no login.
