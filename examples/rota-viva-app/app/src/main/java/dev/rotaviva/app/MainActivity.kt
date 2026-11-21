@file:OptIn(ExperimentalMaterial3Api::class)

package dev.rotaviva.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject

/** What a multi-screen flow carries from one screen to the next. */
object Draft {
    var from = "GRU"; var to = ""; var date = "12/12/2026"
    var resetEmail = ""; var demoCode = ""
    var checkoutKind = ""; var checkoutTitle = ""; var checkoutDetail = ""; var checkoutTotal = 0
    var insuranceTotal = 0; var insurancePlan = ""; var insuranceDetail = ""
    var welcomeName = ""
}

private val publicRoutes = setOf("login", "signup", "forgot", "forgot-code", "forgot-new", "forgot-done")
private val tabs = listOf("home" to "Início", "trips" to "Viagens", "explore" to "Explorar", "profile" to "Perfil")
private val withTabs = setOf("home", "trips", "explore", "profile", "hotels", "cars", "tours", "offers", "support", "destination", "trip", "notifications")

class Nav {
    var stack by mutableStateOf(listOf("login"))
    var pending: String? = null
    val route get() = stack.last()
    fun go(r: String) { stack = stack + normalize(r) }
    fun back() { if (stack.size > 1) stack = stack.dropLast(1) }
    fun reset(vararg r: String) { stack = r.map { normalize(it) } }
    fun tab(r: String) { stack = listOf(r) }
    fun signedIn() { val p = pending; pending = null; stack = if (p != null && p != "home") listOf("home", p) else listOf("home") }
    private fun normalize(r: String): String {
        if (r.startsWith("flights-to/")) { Draft.to = r.substringAfter('/'); return "flights" }
        return r
    }
    fun deeplink(raw: String) {
        val r = raw.trim('/').ifEmpty { "home" }
        val known = r.substringBefore('/') in setOf("login", "signup", "forgot", "home", "flights", "flights-to", "hotels", "hotel", "cars", "car", "tours", "offers",
            "insurance", "exchange", "support", "trips", "trip", "explore", "destination", "profile", "profile-edit", "password", "notifications")
        val target = if (known) r else "notfound"
        when {
            target in publicRoutes -> reset(target)
            !FakeApi.signedIn() -> { pending = target; reset("login") }
            target.substringBefore('/') in tabs.map { it.first } && !target.contains('/') -> tab(target)
            else -> reset("home", target)
        }
    }
}

class MainActivity : ComponentActivity() {
    private val nav = Nav()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handle(intent)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF0B6E6E), secondary = Color(0xFFE0703A), background = Color(0xFFF7F7F5), surface = Color.White)) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { App(nav) }
            }
        }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handle(intent) }
    private fun handle(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "rotaviva" && data.host == "app") nav.deeplink((data.path ?: "") + (data.query?.let { "?$it" } ?: ""))
    }
}

// ---------- building blocks ----------

class Form { var busy by mutableStateOf(false); var error by mutableStateOf<String?>(null) }
@Composable fun rememberForm() = remember { Form() }
fun Form.submit(scope: CoroutineScope, block: suspend () -> Unit) {
    if (busy) return
    busy = true; error = null
    scope.launch { try { block() } catch (e: ApiError) { error = e.message } catch (e: IllegalArgumentException) { error = e.message } finally { busy = false } }
}
fun check(ok: Boolean, message: String) { if (!ok) throw IllegalArgumentException(message) }

@Composable
fun Page(nav: Nav, title: String, content: @Composable ColumnScope.() -> Unit) {
    val root = nav.route.substringBefore('/')
    Scaffold(
        topBar = {
            TopAppBar(title = { Text(title, fontWeight = FontWeight.SemiBold) }, navigationIcon = {
                if (nav.stack.size > 1) TextButton(onClick = { nav.back() }) { Text("‹ Voltar") }
            })
        },
        bottomBar = { if (root in withTabs) TabBar(nav) },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

@Composable
fun TabBar(nav: Nav) {
    NavigationBar {
        tabs.forEach { (route, label) ->
            NavigationBarItem(selected = nav.stack.first() == route, onClick = { nav.tab(route) },
                icon = { Text(when (route) { "home" -> "⌂"; "trips" -> "✈"; "explore" -> "◎"; else -> "☺" }) }, label = { Text(label) })
        }
    }
}

@Composable
fun Field(label: String, value: String, password: Boolean = false, number: Boolean = false, onChange: (String) -> Unit) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = when { password -> KeyboardType.Password; number -> KeyboardType.Number; else -> KeyboardType.Text }))
}

@Composable
fun Primary(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text(text) }
}

@Composable fun FormError(f: Form) { f.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }; if (f.busy) LinearProgressIndicator(Modifier.fillMaxWidth()) }

@Composable
fun Loaded(key: Any, load: suspend () -> JSONObject, content: @Composable (JSONObject, () -> Unit) -> Unit) {
    var data by remember(key) { mutableStateOf<JSONObject?>(null) }
    var error by remember(key) { mutableStateOf<String?>(null) }
    var attempt by remember(key) { mutableIntStateOf(0) }
    LaunchedEffect(key, attempt) { data = null; error = null; try { data = load() } catch (e: ApiError) { error = e.message } }
    val reload: () -> Unit = { attempt++ }
    when {
        error != null -> Column(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Algo deu errado", fontWeight = FontWeight.Bold)
            Text(error!!)
            Button(onClick = reload) { Text("Tentar novamente") }
        }
        data == null -> Column(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(); Spacer(Modifier.height(8.dp)); Text("Carregando…")
        }
        else -> content(data!!, reload)
    }
}

@Composable
fun Row2(a: Pair<String, () -> Unit>, b: Pair<String, () -> Unit>) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        listOf(a, b).forEach { (label, click) -> OutlinedCard(onClick = click, modifier = Modifier.weight(1f).height(72.dp)) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(label, fontWeight = FontWeight.Medium) }
        } }
    }
}

@Composable
fun ItemCard(title: String, subtitle: String, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) { Text(title, fontWeight = FontWeight.SemiBold); Text(subtitle, style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
fun Stepper(label: String, value: Int, range: IntRange, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, Modifier.weight(1f))
        OutlinedButton(onClick = { if (value > range.first) onChange(value - 1) }) { Text("− $label") }
        Text("$value", fontWeight = FontWeight.Bold)
        OutlinedButton(onClick = { if (value < range.last) onChange(value + 1) }) { Text("+ $label") }
    }
}

// ---------- app ----------

@Composable
fun App(nav: Nav) {
    BackHandler(enabled = nav.stack.size > 1) { nav.back() }
    val route = nav.route
    val head = route.substringBefore('/')
    val arg = route.substringAfter('/', "")
    if (head !in publicRoutes && !FakeApi.signedIn()) { LaunchedEffect(route) { nav.pending = route; nav.reset("login") }; return }
    key(route) {
        when (head) {
            "login" -> LoginScreen(nav)
            "forgot" -> ForgotScreen(nav)
            "forgot-code" -> ForgotCodeScreen(nav)
            "forgot-new" -> ForgotNewScreen(nav)
            "forgot-done" -> Page(nav, "Senha redefinida") { Text("Pronto! Sua senha foi alterada."); Primary("Voltar ao login") { nav.reset("login") } }
            "signup" -> SignupScreen(nav)
            "welcome" -> Page(nav, "Bem-vindo(a)") {
                Text("Olá, ${Draft.welcomeName.substringBefore(' ')}! Sua conta foi criada.", style = MaterialTheme.typography.titleLarge)
                Text("Ganhe pontos a cada reserva e acompanhe suas viagens.")
                Primary("Começar") { nav.reset("home") }
            }
            "home" -> HomeScreen(nav)
            "flights" -> FlightSearchScreen(nav)
            "flight-results" -> FlightResultsScreen(nav)
            "flight" -> FlightScreen(nav, arg)
            "seat" -> SeatScreen(nav, arg)
            "payment" -> PaymentScreen(nav)
            "booking-done" -> Page(nav, "Reserva confirmada") {
                Text("Tudo certo!", style = MaterialTheme.typography.headlineSmall)
                Text("Código da reserva: $arg")
                Primary("Ver minhas viagens") { nav.tab("trips") }
                OutlinedButton(onClick = { nav.tab("home") }, Modifier.fillMaxWidth()) { Text("Voltar ao início") }
            }
            "hotels" -> HotelsScreen(nav)
            "hotel" -> HotelScreen(nav, arg)
            "hotel-book" -> HotelBookScreen(nav, arg)
            "cars" -> CarsScreen(nav)
            "car" -> CarScreen(nav, arg)
            "tours" -> ToursScreen(nav)
            "offers" -> OffersScreen(nav)
            "insurance" -> InsuranceScreen(nav)
            "insurance-quote" -> Page(nav, "Sua cotação") {
                Text("Plano ${Draft.insurancePlan}", style = MaterialTheme.typography.titleLarge)
                Text(Draft.insuranceDetail)
                Text("Total: ${money(Draft.insuranceTotal)}", fontWeight = FontWeight.Bold)
                Primary("Contratar seguro") {
                    Draft.checkoutKind = "Seguro"; Draft.checkoutTitle = "Seguro ${Draft.insurancePlan}"; Draft.checkoutDetail = Draft.insuranceDetail; Draft.checkoutTotal = Draft.insuranceTotal
                    nav.go("payment")
                }
            }
            "exchange" -> ExchangeScreen(nav)
            "support" -> SupportScreen(nav)
            "support-ticket" -> TicketScreen(nav)
            "ticket-done" -> Page(nav, "Chamado aberto") {
                Text("Recebemos seu pedido. Protocolo $arg.")
                Primary("Voltar ao suporte") { nav.back(); nav.back() }
            }
            "trips" -> TripsScreen(nav)
            "trip" -> TripScreen(nav, arg)
            "explore" -> ExploreScreen(nav)
            "destination" -> DestinationScreen(nav, arg)
            "profile" -> ProfileScreen(nav)
            "profile-edit" -> ProfileEditScreen(nav)
            "password" -> PasswordScreen(nav)
            "notifications" -> NotificationsScreen(nav)
            else -> Page(nav, "Página não encontrada") { Text("Este link não leva a lugar nenhum."); Primary("Ir para o início") { nav.tab("home") } }
        }
    }
}

// ---------- auth ----------

@Composable
fun LoginScreen(nav: Nav) {
    var email by remember { mutableStateOf("") }; var pass by remember { mutableStateOf("") }
    val f = rememberForm(); val scope = rememberCoroutineScope()
    Page(nav, "Entrar") {
        Text("Rota Viva", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Text("Suas viagens em um só lugar")
        Field("E-mail", email) { email = it }
        Field("Senha", pass, password = true) { pass = it }
        FormError(f)
        Primary("Entrar", !f.busy) {
            f.submit(scope) {
                check(email.isNotBlank() && pass.isNotBlank(), "Preencha e-mail e senha.")
                FakeApi.call("POST", "/v2/auth/login", json("email" to email, "password" to pass)); nav.signedIn()
            }
        }
        TextButton(onClick = { nav.go("forgot") }, Modifier.fillMaxWidth()) { Text("Esqueci minha senha") }
        OutlinedButton(onClick = { nav.go("signup") }, Modifier.fillMaxWidth()) { Text("Criar conta") }
    }
}

@Composable
fun ForgotScreen(nav: Nav) {
    var email by remember { mutableStateOf("") }; val f = rememberForm(); val scope = rememberCoroutineScope()
    Page(nav, "Recuperar senha") {
        Text("Informe o e-mail da sua conta. Enviaremos um código de 4 dígitos.")
        Field("E-mail", email) { email = it }
        FormError(f)
        Primary("Enviar código", !f.busy) {
            f.submit(scope) {
                check(email.contains('@'), "Informe um e-mail válido.")
                val r = FakeApi.call("POST", "/v2/auth/forgot", json("email" to email))
                Draft.resetEmail = email.trim(); Draft.demoCode = r.optString("demoCode"); nav.go("forgot-code")
            }
        }
    }
}

@Composable
fun ForgotCodeScreen(nav: Nav) {
    var code by remember { mutableStateOf("") }; val f = rememberForm(); val scope = rememberCoroutineScope()
    Page(nav, "Digite o código") {
        Text("Enviamos um código para ${Draft.resetEmail}.")
        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3E0))) { Text("Ambiente de teste: o código é ${Draft.demoCode}", Modifier.padding(12.dp)) }
        Field("Código", code, number = true) { code = it }
        FormError(f)
        Primary("Confirmar código", !f.busy) {
            f.submit(scope) { FakeApi.call("POST", "/v2/auth/forgot/verify", json("code" to code.trim())); nav.go("forgot-new") }
        }
        TextButton(onClick = { nav.back() }) { Text("Usar outro e-mail") }
    }
}

@Composable
fun ForgotNewScreen(nav: Nav) {
    var p1 by remember { mutableStateOf("") }; var p2 by remember { mutableStateOf("") }; val f = rememberForm(); val scope = rememberCoroutineScope()
    Page(nav, "Nova senha") {
        Field("Nova senha", p1, password = true) { p1 = it }
        Field("Repita a nova senha", p2, password = true) { p2 = it }
        Text("Mínimo de 8 caracteres.", style = MaterialTheme.typography.bodySmall)
        FormError(f)
        Primary("Salvar nova senha", !f.busy) {
            f.submit(scope) {
                check(p1.length >= 8, "A senha precisa ter ao menos 8 caracteres."); check(p1 == p2, "As senhas não são iguais.")
                FakeApi.call("POST", "/v2/auth/forgot/reset", json("password" to p1)); nav.reset("forgot-done")
            }
        }
    }
}

@Composable
fun SignupScreen(nav: Nav) {
    var name by remember { mutableStateOf("") }; var email by remember { mutableStateOf("") }
    var p1 by remember { mutableStateOf("") }; var p2 by remember { mutableStateOf("") }; var terms by remember { mutableStateOf(false) }
    val f = rememberForm(); val scope = rememberCoroutineScope()
    Page(nav, "Criar conta") {
        Field("Nome completo", name) { name = it }
        Field("E-mail", email) { email = it }
        Field("Senha", p1, password = true) { p1 = it }
        Field("Confirmar senha", p2, password = true) { p2 = it }
        Row(Modifier.fillMaxWidth().toggleable(value = terms, role = Role.Checkbox, onValueChange = { terms = it }), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = terms, onCheckedChange = null); Spacer(Modifier.width(8.dp)); Text("Li e aceito os termos de uso")
        }
        FormError(f)
        Primary("Criar minha conta", !f.busy) {
            f.submit(scope) {
                check(name.trim().length >= 3, "Informe seu nome."); check(email.contains('@'), "Informe um e-mail válido.")
                check(p1.length >= 8, "A senha precisa ter ao menos 8 caracteres."); check(p1 == p2, "As senhas não são iguais.")
                check(terms, "Aceite os termos para continuar.")
                FakeApi.call("POST", "/v2/auth/signup", json("name" to name, "email" to email, "password" to p1))
                Draft.welcomeName = name.trim(); nav.reset("welcome")
            }
        }
    }
}

// ---------- home & booking ----------

@Composable
fun HomeScreen(nav: Nav) {
    Page(nav, "Início") {
        Loaded("home", { FakeApi.call("GET", "/v2/me/summary") }) { d, _ ->
            Text("Olá, ${d.optString("name").substringBefore(' ')}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Você tem ${d.optInt("points")} pontos")
            d.optJSONObject("next")?.let { n -> ItemCard("Próxima viagem: ${n.optString("title")}", n.optString("detail")) { nav.go("trip/${n.optString("id")}") } }
            Row2("Voos" to { nav.go("flights") }, "Hotéis" to { nav.go("hotels") })
            Row2("Carros" to { nav.go("cars") }, "Passeios" to { nav.go("tours") })
            Row2("Ofertas" to { nav.go("offers") }, "Seguro viagem" to { nav.go("insurance") })
            Row2("Câmbio" to { nav.go("exchange") }, "Suporte" to { nav.go("support") })
        }
    }
}

@Composable
fun FlightSearchScreen(nav: Nav) {
    var from by remember { mutableStateOf(Draft.from) }; var to by remember { mutableStateOf(Draft.to) }; var date by remember { mutableStateOf(Draft.date) }
    var error by remember { mutableStateOf<String?>(null) }
    Page(nav, "Buscar voos") {
        Field("Origem (aeroporto)", from) { from = it.uppercase() }
        Field("Destino (aeroporto)", to) { to = it.uppercase() }
        Field("Data da ida", date) { date = it }
        Text("Rotas com voos: GRU → LIS, SSA, SCL · GIG → MIA", style = MaterialTheme.typography.bodySmall)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Primary("Buscar voos") {
            if (from.length != 3 || to.length != 3) error = "Use o código de 3 letras do aeroporto."
            else { Draft.from = from; Draft.to = to; Draft.date = date; nav.go("flight-results") }
        }
    }
}

@Composable
fun FlightResultsScreen(nav: Nav) {
    Page(nav, "${Draft.from} → ${Draft.to}") {
        Loaded("results", { FakeApi.call("GET", "/v2/flights?from=${Draft.from}&to=${Draft.to}") }) { d, _ ->
            val items = d.getJSONArray("items").rows()
            if (items.isEmpty()) { Text("Nenhum voo encontrado para esta rota."); OutlinedButton(onClick = { nav.back() }) { Text("Mudar busca") } }
            Text("${items.size} voos em ${Draft.date}")
            items.forEach { fl -> ItemCard("${fl.optString("airline")} · ${fl.optString("time")}", money(fl.optInt("price"))) { nav.go("flight/${fl.optString("id")}") } }
        }
    }
}

@Composable
fun FlightScreen(nav: Nav, id: String) {
    Page(nav, "Detalhes do voo") {
        Loaded(id, { FakeApi.call("GET", "/v2/flights/$id") }) { f, _ ->
            Text("${f.optString("from")} → ${f.optString("to")}", style = MaterialTheme.typography.headlineSmall)
            Text("${f.optString("airline")} · saída ${f.optString("time")} · ${Draft.date}")
            Text("Bagagem de mão inclusa. Marcação de assento gratuita.")
            Text(money(f.optInt("price")), fontWeight = FontWeight.Bold)
            Primary("Escolher assento") { nav.go("seat/$id") }
        }
    }
}

@Composable
fun SeatScreen(nav: Nav, id: String) {
    var chosen by remember { mutableStateOf("") }
    Page(nav, "Escolha seu assento") {
        Loaded(id, { FakeApi.call("GET", "/v2/flights/$id/seats") }) { d, _ ->
            val seats = d.getJSONArray("seats").rows()
            seats.chunked(4).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { s ->
                        val name = s.optString("seat"); val free = s.optBoolean("free")
                        FilterChip(selected = chosen == name, onClick = { chosen = name }, enabled = free, label = { Text(if (free) name else "$name ocupado") }, modifier = Modifier.weight(1f))
                    }
                }
            }
            Text(if (chosen.isEmpty()) "Nenhum assento escolhido" else "Assento $chosen")
            Primary("Continuar para pagamento", chosen.isNotEmpty()) {
                scopeCheckout("Voo", "${Draft.from} → ${Draft.to}", "Voo $id · ${Draft.date} · assento $chosen", null, id)
                nav.go("payment")
            }
        }
    }
}

private val flightPrices = mapOf("F100" to 389000, "F101" to 352000, "F200" to 79000, "F201" to 64000, "F300" to 142000, "F400" to 298000)
fun scopeCheckout(kind: String, title: String, detail: String, total: Int?, flightId: String? = null) {
    Draft.checkoutKind = kind; Draft.checkoutTitle = title; Draft.checkoutDetail = detail
    Draft.checkoutTotal = total ?: flightPrices[flightId] ?: 0
}

@Composable
fun PaymentScreen(nav: Nav) {
    var method by remember { mutableStateOf("card") }; val f = rememberForm(); val scope = rememberCoroutineScope()
    Page(nav, "Pagamento") {
        Text(Draft.checkoutTitle, style = MaterialTheme.typography.titleLarge)
        Text(Draft.checkoutDetail)
        Text("Total: ${money(Draft.checkoutTotal)}", fontWeight = FontWeight.Bold)
        listOf("card" to "Cartão de crédito final 4242", "pix" to "Pix", "points" to "Pontos (${Draft.checkoutTotal / 10} pontos)").forEach { (key, label) ->
            Row(Modifier.fillMaxWidth().selectable(selected = method == key, role = Role.RadioButton, onClick = { method = key }), verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = method == key, onClick = null); Spacer(Modifier.width(8.dp)); Text(label)
            }
        }
        FormError(f)
        Primary("Pagar ${money(Draft.checkoutTotal)}", !f.busy) {
            f.submit(scope) {
                val b = FakeApi.call("POST", "/v2/bookings", json("kind" to Draft.checkoutKind, "title" to Draft.checkoutTitle, "detail" to Draft.checkoutDetail, "total" to Draft.checkoutTotal, "payment" to method))
                nav.reset("home", "booking-done/${b.optString("id")}")
            }
        }
    }
}

@Composable
fun HotelsScreen(nav: Nav) {
    Page(nav, "Hotéis") {
        Loaded("hotels", { FakeApi.call("GET", "/v2/hotels") }) { d, _ ->
            d.getJSONArray("items").rows().forEach { h -> ItemCard(h.optString("name"), "${h.optString("city")} · ${"★".repeat(h.optInt("stars"))} · ${money(h.optInt("night"))}/noite") { nav.go("hotel/${h.optString("id")}") } }
        }
    }
}

@Composable
fun HotelScreen(nav: Nav, id: String) {
    Page(nav, "Hotel") {
        Loaded(id, { FakeApi.call("GET", "/v2/hotels/$id") }) { h, _ ->
            Text(h.optString("name"), style = MaterialTheme.typography.headlineSmall)
            Text("${h.optString("city")} · ${"★".repeat(h.optInt("stars"))}")
            Text("Café da manhã incluso · Wi-Fi · Cancelamento grátis até 48 h antes.")
            Text("${money(h.optInt("night"))} por noite", fontWeight = FontWeight.Bold)
            Primary("Reservar quarto") { nav.go("hotel-book/$id") }
        }
    }
}

@Composable
fun HotelBookScreen(nav: Nav, id: String) {
    var nights by remember { mutableIntStateOf(2) }; var guests by remember { mutableIntStateOf(2) }
    Page(nav, "Sua estadia") {
        Loaded(id, { FakeApi.call("GET", "/v2/hotels/$id") }) { h, _ ->
            Text(h.optString("name"), style = MaterialTheme.typography.titleLarge)
            Stepper("Noites", nights, 1..14) { nights = it }
            Stepper("Hóspedes", guests, 1..4) { guests = it }
            val total = h.optInt("night") * nights + (guests - 2).coerceAtLeast(0) * 8000 * nights
            Text("Total: ${money(total)}", fontWeight = FontWeight.Bold)
            Primary("Continuar") { scopeCheckout("Hotel", h.optString("name"), "$nights noites · $guests hóspedes", total); nav.go("payment") }
        }
    }
}

@Composable
fun CarsScreen(nav: Nav) {
    Page(nav, "Carros") {
        Loaded("cars", { FakeApi.call("GET", "/v2/cars") }) { d, _ ->
            d.getJSONArray("items").rows().forEach { c -> ItemCard(c.optString("model"), "${c.optString("category")} · ${money(c.optInt("day"))}/dia") { nav.go("car/${c.optString("id")}") } }
        }
    }
}

@Composable
fun CarScreen(nav: Nav, id: String) {
    var days by remember { mutableIntStateOf(3) }
    Page(nav, "Aluguel de carro") {
        Loaded(id, { FakeApi.call("GET", "/v2/cars/$id") }) { c, _ ->
            Text(c.optString("model"), style = MaterialTheme.typography.headlineSmall)
            Text("${c.optString("category")} · seguro básico incluso · retirada no aeroporto")
            Stepper("Dias", days, 1..30) { days = it }
            Text("Total: ${money(c.optInt("day") * days)}", fontWeight = FontWeight.Bold)
            Primary("Reservar carro") { scopeCheckout("Carro", c.optString("model"), "$days dias", c.optInt("day") * days); nav.go("payment") }
        }
    }
}

@Composable
fun ToursScreen(nav: Nav) {
    Page(nav, "Passeios") {
        Loaded("tours", { FakeApi.call("GET", "/v2/tours") }) { d, reload ->
            val scope = rememberCoroutineScope()
            d.getJSONArray("items").rows().forEach { t ->
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(t.optString("name"), fontWeight = FontWeight.SemiBold); Text("${t.optString("city")} · ${money(t.optInt("price"))}", style = MaterialTheme.typography.bodySmall) }
                        if (t.optBoolean("saved")) Text("Na sua lista")
                        else TextButton(onClick = { scope.launch { runCatching { FakeApi.call("POST", "/v2/wishlist", json("id" to t.optString("id"))) }; reload() } }) { Text("Quero ir") }
                    }
                }
            }
        }
    }
}

@Composable
fun OffersScreen(nav: Nav) {
    Page(nav, "Ofertas") {
        Loaded("offers", { FakeApi.call("GET", "/v2/offers") }) { d, _ ->
            Text("Ofertas da semana", fontWeight = FontWeight.Bold)
            d.getJSONArray("items").rows().forEach { o -> ItemCard(o.optString("title"), o.optString("tag")) { nav.go(o.optString("target")) } }
        }
    }
}

@Composable
fun InsuranceScreen(nav: Nav) {
    var days by remember { mutableStateOf("7") }; var people by remember { mutableStateOf("1") }; val f = rememberForm(); val scope = rememberCoroutineScope()
    Page(nav, "Seguro viagem") {
        Text("Cobertura médica, bagagem e cancelamento.")
        Field("Dias de viagem", days, number = true) { days = it }
        Field("Viajantes", people, number = true) { people = it }
        FormError(f)
        Primary("Cotar seguro", !f.busy) {
            f.submit(scope) {
                val r = FakeApi.call("POST", "/v2/insurance/quote", json("days" to (days.toIntOrNull() ?: 0), "travelers" to (people.toIntOrNull() ?: 0)))
                Draft.insuranceTotal = r.optInt("total"); Draft.insurancePlan = r.optString("plan"); Draft.insuranceDetail = "$days dias · $people viajante(s)"
                nav.go("insurance-quote")
            }
        }
    }
}

@Composable
fun ExchangeScreen(nav: Nav) {
    var reais by remember { mutableStateOf("1000") }; var currency by remember { mutableStateOf("USD") }; var result by remember { mutableStateOf<String?>(null) }
    Page(nav, "Câmbio") {
        Loaded("fx", { FakeApi.call("GET", "/v2/fx/rates") }) { d, _ ->
            val rates = d.getJSONObject("rates")
            Field("Valor em reais", reais, number = true) { reais = it; result = null }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FakeApi.ratesList().forEach { c -> FilterChip(selected = currency == c, onClick = { currency = c; result = null }, label = { Text(c) }) }
            }
            Text("Cotação: 1 $currency = R$ ${"%.2f".format(rates.optDouble(currency)).replace('.', ',')}")
            Primary("Converter") {
                val v = reais.replace(',', '.').toDoubleOrNull()
                result = if (v == null || v <= 0) "Informe um valor válido." else "Você recebe ${"%.2f".format(v / rates.optDouble(currency)).replace('.', ',')} $currency"
            }
            result?.let { Text(it, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
fun SupportScreen(nav: Nav) {
    var open by remember { mutableStateOf(-1) }
    Page(nav, "Suporte") {
        Loaded("faq", { FakeApi.call("GET", "/v2/support/faq") }) { d, _ ->
            Text("Perguntas frequentes", fontWeight = FontWeight.Bold)
            d.getJSONArray("items").rows().forEachIndexed { i, q ->
                Card(onClick = { open = if (open == i) -1 else i }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) { Text(q.optString("q"), fontWeight = FontWeight.Medium); if (open == i) Text(q.optString("a")) }
                }
            }
            Primary("Abrir chamado") { nav.go("support-ticket") }
        }
    }
}

@Composable
fun TicketScreen(nav: Nav) {
    var subject by remember { mutableStateOf("") }; var message by remember { mutableStateOf("") }; val f = rememberForm(); val scope = rememberCoroutineScope()
    Page(nav, "Novo chamado") {
        Field("Assunto", subject) { subject = it }
        Field("Mensagem", message) { message = it }
        FormError(f)
        Primary("Enviar chamado", !f.busy) {
            f.submit(scope) { val r = FakeApi.call("POST", "/v2/support/tickets", json("subject" to subject, "message" to message)); nav.go("ticket-done/${r.optString("protocol")}") }
        }
    }
}

// ---------- tabs ----------

@Composable
fun TripsScreen(nav: Nav) {
    Page(nav, "Minhas viagens") {
        Loaded("trips", { FakeApi.call("GET", "/v2/trips") }) { d, _ ->
            val items = d.getJSONArray("items").rows()
            if (items.isEmpty()) Text("Você ainda não tem viagens.")
            items.forEach { b -> ItemCard("${b.optString("kind")} · ${b.optString("title")}", "${b.optString("status")} · ${b.optString("id")}") { nav.go("trip/${b.optString("id")}") } }
        }
    }
}

@Composable
fun TripScreen(nav: Nav, id: String) {
    var ask by remember { mutableStateOf(false) }; val f = rememberForm(); val scope = rememberCoroutineScope()
    Page(nav, "Reserva") {
        Loaded(id, { FakeApi.call("GET", "/v2/trips/$id") }) { b, reload ->
            Text(b.optString("title"), style = MaterialTheme.typography.headlineSmall)
            Text("${b.optString("kind")} · ${b.optString("detail")}")
            Text("Código ${b.optString("id")} · ${money(b.optInt("total"))}")
            Text("Situação: ${b.optString("status")}", fontWeight = FontWeight.Bold)
            FormError(f)
            if (b.optString("status") == "Confirmada") OutlinedButton(onClick = { ask = true }, Modifier.fillMaxWidth()) { Text("Cancelar reserva") }
            OutlinedButton(onClick = { nav.go("support") }, Modifier.fillMaxWidth()) { Text("Falar com o suporte") }
            if (ask) AlertDialog(onDismissRequest = { ask = false }, title = { Text("Cancelar esta reserva?") }, text = { Text("O valor volta para a forma de pagamento em até 7 dias.") },
                confirmButton = { TextButton(onClick = { ask = false; f.submit(scope) { FakeApi.call("POST", "/v2/trips/$id/cancel"); reload() } }) { Text("Sim, cancelar") } },
                dismissButton = { TextButton(onClick = { ask = false }) { Text("Manter reserva") } })
        }
    }
}

@Composable
fun ExploreScreen(nav: Nav) {
    Page(nav, "Explorar") {
        Loaded("dest", { FakeApi.call("GET", "/v2/destinations") }) { d, _ ->
            Text("Para onde vamos?", style = MaterialTheme.typography.titleLarge)
            d.getJSONArray("items").rows().forEach { x -> ItemCard(x.optString("city"), x.optString("country")) { nav.go("destination/${x.optString("id")}") } }
        }
    }
}

@Composable
fun DestinationScreen(nav: Nav, id: String) {
    Page(nav, "Destino") {
        Loaded(id, { FakeApi.call("GET", "/v2/destinations/$id") }) { x, _ ->
            Text(x.optString("city"), style = MaterialTheme.typography.headlineSmall)
            Text(x.optString("country")); Text(x.optString("blurb"))
            Primary("Ver voos para ${x.optString("city")}") { Draft.to = x.optString("airport"); nav.go("flights") }
        }
    }
}

@Composable
fun ProfileScreen(nav: Nav) {
    var ask by remember { mutableStateOf(false) }; val scope = rememberCoroutineScope()
    Page(nav, "Perfil") {
        Loaded("me", { FakeApi.call("GET", "/v2/me") }) { me, _ ->
            Text(me.optString("name"), style = MaterialTheme.typography.headlineSmall)
            Text(me.optString("email")); Text("${me.optInt("points")} pontos")
            ItemCard("Editar perfil", "Nome e telefone") { nav.go("profile-edit") }
            ItemCard("Alterar senha", "Troque sua senha de acesso") { nav.go("password") }
            ItemCard("Notificações", "Escolha o que receber") { nav.go("notifications") }
            ItemCard("Ajuda", "Perguntas e chamados") { nav.go("support") }
            OutlinedButton(onClick = { ask = true }, Modifier.fillMaxWidth()) { Text("Sair da conta") }
            if (ask) AlertDialog(onDismissRequest = { ask = false }, title = { Text("Sair da conta?") },
                confirmButton = { TextButton(onClick = { ask = false; scope.launch { runCatching { FakeApi.call("POST", "/v2/auth/logout") }; nav.reset("login") } }) { Text("Sair") } },
                dismissButton = { TextButton(onClick = { ask = false }) { Text("Ficar") } })
        }
    }
}

@Composable
fun ProfileEditScreen(nav: Nav) {
    Page(nav, "Editar perfil") {
        Loaded("me-edit", { FakeApi.call("GET", "/v2/me") }) { me, _ ->
            var name by remember { mutableStateOf(me.optString("name")) }; var phone by remember { mutableStateOf(me.optString("phone")) }
            var saved by remember { mutableStateOf(false) }; val f = rememberForm(); val scope = rememberCoroutineScope()
            Field("Nome", name) { name = it; saved = false }
            Field("Telefone", phone, number = true) { phone = it; saved = false }
            FormError(f)
            if (saved) Text("Dados salvos.", color = MaterialTheme.colorScheme.primary)
            Primary("Salvar alterações", !f.busy) { f.submit(scope) { FakeApi.call("PUT", "/v2/me", json("name" to name, "phone" to phone)); saved = true } }
        }
    }
}

@Composable
fun PasswordScreen(nav: Nav) {
    var current by remember { mutableStateOf("") }; var p1 by remember { mutableStateOf("") }; var p2 by remember { mutableStateOf("") }
    var done by remember { mutableStateOf(false) }; val f = rememberForm(); val scope = rememberCoroutineScope()
    Page(nav, "Alterar senha") {
        if (done) { Text("Senha alterada com sucesso.", style = MaterialTheme.typography.titleMedium); Primary("Voltar ao perfil") { nav.back() } }
        else {
            Field("Senha atual", current, password = true) { current = it }
            Field("Nova senha", p1, password = true) { p1 = it }
            Field("Confirmar nova senha", p2, password = true) { p2 = it }
            FormError(f)
            Primary("Alterar senha", !f.busy) {
                f.submit(scope) {
                    check(p1.length >= 8, "A senha precisa ter ao menos 8 caracteres."); check(p1 == p2, "As senhas não são iguais.")
                    FakeApi.call("POST", "/v2/me/password", json("current" to current, "password" to p1)); done = true
                }
            }
        }
    }
}

@Composable
fun NotificationsScreen(nav: Nav) {
    Page(nav, "Notificações") {
        Loaded("notif", { FakeApi.call("GET", "/v2/me/notifications") }) { d, _ ->
            val scope = rememberCoroutineScope()
            d.getJSONArray("items").rows().forEach { item ->
                var on by remember { mutableStateOf(item.optBoolean("on")) }
                Row(Modifier.fillMaxWidth().toggleable(value = on, role = Role.Switch, onValueChange = { v -> on = v; scope.launch { FakeApi.call("PUT", "/v2/me/notifications", json("name" to item.optString("name"), "on" to v)) } }),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(item.optString("name"), Modifier.weight(1f)); Switch(checked = on, onCheckedChange = null)
                }
            }
        }
    }
}
