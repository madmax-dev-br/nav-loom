package dev.navloom.testapp

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat
import java.util.Locale

class MainActivity : ComponentActivity() {
    private var incoming by mutableStateOf("")
    private var incomingVersion by mutableIntStateOf(0)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        incoming = intent.data?.path?.trim('/') ?: ""
        setContent { MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF6550C8), secondary = Color(0xFF287B68), background = Color(0xFFF6F4FA), surface = Color.White)) { LabApp(incoming, incomingVersion) } }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); incoming = intent.data?.path?.trim('/') ?: ""; incomingVersion++ }
}

private fun money(value: Int): String = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR")).format(value / 100.0)
private fun amount(value: String): Int? = value.replace(',', '.').toBigDecimalOrNull()?.multiply(100.toBigDecimal())?.toInt()
private fun JSONArray.rows(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
private suspend fun request(base: String, path: String, token: String, method: String = "GET", body: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
    val connection = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
    try {
        connection.requestMethod = method; connection.connectTimeout = 8000; connection.readTimeout = 15000
        connection.setRequestProperty("Content-Type", "application/json")
        if (token.isNotBlank()) connection.setRequestProperty("Authorization", "Bearer $token")
        if (body != null) { connection.doOutput = true; connection.outputStream.use { it.write(body.toString().toByteArray()) } }
        val status = connection.responseCode
        val text = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
        val result = JSONObject(text)
        if (status !in 200..299) { android.util.Log.e("NavloomLab", "HTTP $status $path"); throw IllegalStateException(result.optString("error", "Falha HTTP $status")) }
        result
    } finally { connection.disconnect() }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
@Composable
private fun LabApp(incoming: String, incomingVersion: Int) {
    val base = "http://127.0.0.1:4791"
    var token by remember { mutableStateOf("") }
    var route by remember { mutableStateOf("login") }
    var pending by remember { mutableStateOf("") }
    var stack by remember { mutableStateOf(listOf<String>()) }
    var refresh by remember { mutableIntStateOf(0) }
    var data by remember { mutableStateOf(JSONObject()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var pixKey by remember { mutableStateOf("bruno@pix.test") }
    var pixAmount by remember { mutableStateOf("50,00") }
    var pixDescription by remember { mutableStateOf("") }
    var recipient by remember { mutableStateOf(JSONObject()) }
    val scope = rememberCoroutineScope()
    fun go(next: String, replace: Boolean = false) { if (!replace && next != route) stack = stack + route; route = next; error = null; message = null; data = JSONObject(); refresh++ }
    fun back() { if (stack.isNotEmpty()) { val next = stack.last(); stack = stack.dropLast(1); go(next, true) } else if (route != "home" && token.isNotEmpty()) go("home", true) }
    fun work(block: suspend () -> Unit) { if (busy) return; scope.launch { busy = true; error = null; message = null; try { block() } catch (e: Exception) { error = e.message ?: "Não foi possível concluir. Tente novamente." } finally { busy = false } } }
    fun endpoint(): String? = when {
        route == "home" -> "/api/home"
        route == "products" -> "/api/products"
        route == "favorites" -> "/api/favorites"
        route.startsWith("product/") -> "/api/products/${route.substringAfter('/')}"
        route == "cart" || route == "checkout" -> "/api/cart"
        route == "pix" -> "/api/pix"
        route == "cards" || route == "card-limit" -> "/api/cards"
        route.startsWith("receipt/") -> "/api/receipts/${route.substringAfter('/')}"
        else -> null
    }
    LaunchedEffect(incoming, incomingVersion) { if (incoming.isNotBlank()) { if (token.isBlank() && incoming !in listOf("login", "register")) pending = incoming else go(incoming) } }
    LaunchedEffect(route, refresh) { val path = endpoint(); if (path != null && token.isNotBlank()) { busy = true; error = null; try { data = request(base, path, token) } catch (e: Exception) { error = e.message } finally { busy = false } } }
    BackHandler(enabled = route != "login" && !busy) { back() }
    val screen = route.substringBefore('/')
    val state = if (busy) "loading" else if (error != null) "error" else if (route.startsWith("receipt/")) data.optString("status", "ready") else "ready"
    val title = when (screen) { "login" -> "Bem-vindo"; "register" -> "Criar conta"; "home" -> "Olá, ${data.optString("name", "Ana").substringBefore(' ')}"; "products" -> "Produtos"; "favorites" -> "Favoritos"; "product" -> "Detalhes do produto"; "cart" -> "Seu carrinho"; "checkout" -> "Confirmar compra"; "pix" -> "Transferir Pix"; "pix-confirm" -> "Confirmar Pix"; "receipt" -> "Comprovante"; "cards" -> "Meus cartões"; "card-limit" -> "Aumentar limite"; else -> "Página não encontrada" }
    Scaffold(
        modifier = Modifier.fillMaxSize().semantics { testTagsAsResourceId = true; contentDescription = "navloom:screen:$screen:state:$state" }.testTag("screen_$screen"),
        topBar = { TopAppBar(title = { Column { Text("NAVLOOM LAB", fontSize = 10.sp, color = MaterialTheme.colorScheme.primary); Text(title, fontSize = 21.sp, fontWeight = FontWeight.SemiBold) } }, navigationIcon = { if (route !in listOf("login", "home", "products", "favorites", "cards")) TextButton(onClick = { back() }, enabled = !busy, modifier = Modifier.testTag("back")) { Text("‹ Voltar") } }, actions = { if (token.isNotBlank()) TextButton(onClick = { work { request(base, "/api/auth/logout", token, "POST", JSONObject()); token = ""; stack = emptyList(); go("login", true) } }, enabled = !busy, modifier = Modifier.testTag("logout")) { Text("Sair") } }) },
        bottomBar = { if (token.isNotBlank()) NavigationBar { listOf("home" to "Início", "products" to "Produtos", "favorites" to "Favoritos", "cards" to "Cartões").forEach { (id, label) -> NavigationBarItem(selected = route == id, onClick = { if (!busy) { stack = emptyList(); go(id, true) } }, enabled = !busy, icon = { Text(when(id) { "home" -> "⌂"; "products" -> "▦"; "favorites" -> "♡"; else -> "▤" }, fontSize = 21.sp) }, label = { Text(label) }, modifier = Modifier.testTag("tab_$id")) } } }
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (busy) { LinearProgressIndicator(Modifier.fillMaxWidth().testTag("loading")); Text("Carregando…", color = MaterialTheme.colorScheme.primary, modifier = Modifier.testTag("loading_text")) }
            error?.let { text -> Panel { Text("Não foi possível continuar", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error); Text(text, modifier = Modifier.testTag("error_message")); if (endpoint() != null) TextButton(onClick = { refresh++ }, enabled = !busy, modifier = Modifier.testTag("retry")) { Text("Tentar novamente") } } }
            message?.let { Text(it, color = MaterialTheme.colorScheme.secondary, modifier = Modifier.testTag("success_message")) }
            when {
                route == "login" || route == "register" -> {
                    var email by remember(route) { mutableStateOf(if (route == "login") "ana@navloom.test" else "") }
                    var password by remember(route) { mutableStateOf(if (route == "login") "Teste123!" else "") }
                    var name by remember(route) { mutableStateOf("") }
                    Text("Sua loja e seu dinheiro, em um app de teste.", color = Color.Gray)
                    Panel {
                        if (route == "register") Field("Nome", name, "register_name", !busy) { name = it }
                        Field("E-mail", email, "auth_email", !busy) { email = it }
                        Field("Senha", password, "auth_password", !busy, password = true) { password = it }
                        Action(if (route == "login") "Entrar" else "Criar minha conta", "auth_submit", !busy) { work { val result = request(base, if (route == "login") "/api/auth/login" else "/api/auth/register", "", "POST", JSONObject().put("name", name).put("email", email).put("password", password)); token = result.getString("token"); stack = emptyList(); val next = pending.ifBlank { "home" }; pending = ""; go(next, true) } }
                        TextButton(onClick = { go(if (route == "login") "register" else "login") }, enabled = !busy, modifier = Modifier.testTag("auth_switch")) { Text(if (route == "login") "Ainda não tem conta? Criar conta" else "Já tenho conta") }
                    }
                }
                route == "home" -> {
                    Panel { Text("Saldo disponível", color = Color.Gray); Text(money(data.optInt("balance")), fontSize = 32.sp, fontWeight = FontWeight.Bold); Action("Transferir Pix", "home_pix", !busy) { go("pix") } }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { OutlinedButton(onClick = { go("cart") }, enabled = !busy, modifier = Modifier.weight(1f).testTag("home_cart")) { Text("Carrinho (${data.optInt("cartCount")})") }; OutlinedButton(onClick = { go("cards") }, enabled = !busy, modifier = Modifier.weight(1f).testTag("home_cards")) { Text("Meus cartões") } }
                    Panel { Text("Encontre algo para seu dia", fontSize = 20.sp, fontWeight = FontWeight.SemiBold); Text("Produtos selecionados, checkout simples e entrega de faz de conta."); Action("Explorar produtos", "home_products", !busy) { go("products") } }
                    Text("Atividade recente", fontWeight = FontWeight.Bold)
                    val recent = data.optJSONArray("recentTransfers")?.rows().orEmpty()
                    if (recent.isEmpty()) Text("Nenhuma transferência ainda.", color = Color.Gray)
                    recent.forEach { receipt -> ReceiptRow(receipt) { go("receipt/${receipt.getString("id")}") } }
                    Text("Ambiente local • Nenhuma transação real", fontSize = 12.sp, color = Color.Gray)
                }
                route == "products" || route == "favorites" -> {
                    OutlinedButton(onClick = { go("cart") }, enabled = !busy, modifier = Modifier.testTag("open_cart")) { Text("Ver carrinho →") }
                    val list = data.optJSONArray("items")?.rows().orEmpty()
                    if (!busy && error == null && list.isEmpty()) Panel { Text("Nenhum favorito ainda", fontWeight = FontWeight.Bold); Text("Toque no coração de um produto para salvar aqui."); Action("Explorar produtos", "empty_favorites_products") { go("products") } }
                    list.forEach { product -> ProductCard(product, !busy, onOpen = { go("product/${product.getString("id")}") }, onFavorite = { work { request(base, "/api/favorites/${product.getString("id")}", token, if (product.optBoolean("favorite")) "DELETE" else "POST", JSONObject()); refresh++ } }) }
                }
                route.startsWith("product/") -> {
                    Text(data.optString("emoji", "▦"), fontSize = 74.sp, modifier = Modifier.fillMaxWidth().background(Color(0xFFEAE4F8), RoundedCornerShape(20.dp)).padding(32.dp))
                    Text(data.optString("category"), color = MaterialTheme.colorScheme.primary)
                    Text(data.optString("name", "Produto"), fontSize = 25.sp, fontWeight = FontWeight.Bold)
                    Text(money(data.optInt("price")), fontSize = 23.sp)
                    Text(data.optString("description"))
                    val available = data.optInt("stock") > 0
                    Text(if (available) "${data.optInt("stock")} unidades disponíveis" else "Produto esgotado", color = if (available) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.error)
                    Action(if (available) "Adicionar ao carrinho" else "Indisponível", "product_add_cart", !busy && available) { work { request(base, "/api/cart/items", token, "POST", JSONObject().put("productId", route.substringAfter('/')).put("quantity", 1)); go("cart") } }
                    OutlinedButton(onClick = { work { request(base, "/api/favorites/${route.substringAfter('/')}", token, if (data.optBoolean("favorite")) "DELETE" else "POST", JSONObject()); refresh++ } }, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("product_favorite")) { Text(if (data.optBoolean("favorite")) "♥ Remover dos favoritos" else "♡ Salvar nos favoritos") }
                    Text("Entrega grátis • Troca em 30 dias • Produto de demonstração", fontSize = 12.sp, color = Color.Gray)
                }
                route == "cart" || route == "checkout" -> {
                    val items = data.optJSONArray("items")?.rows().orEmpty()
                    if (!busy && error == null && items.isEmpty()) Panel { Text("Seu carrinho está vazio", fontSize = 21.sp); Text("Que tal conhecer os produtos?"); Action("Ver produtos", "empty_cart_products") { go("products") } }
                    items.forEach { product -> Panel { Text(product.optString("name"), fontWeight = FontWeight.Bold); Text("${product.optInt("quantity")} × ${money(product.optInt("price"))}"); if (route == "cart") TextButton(onClick = { work { data = request(base, "/api/cart/items/${product.getString("id")}", token, "DELETE"); } }, enabled = !busy, modifier = Modifier.testTag("remove_${product.getString("id")}")) { Text("Remover") } } }
                    if (items.isNotEmpty()) {
                        Panel { Text("Total", color = Color.Gray); Text(money(data.optInt("total")), fontSize = 28.sp, fontWeight = FontWeight.Bold); Text("Entrega grátis • Endereço demo: Rua Local, 123") }
                        if (route == "cart") Action("Continuar para pagamento", "cart_checkout", !busy) { go("checkout") }
                        else { Panel { Text("Forma de pagamento", fontWeight = FontWeight.Bold); Text("Navloom Platinum •••• 4242"); Text("A compra será simulada no servidor local.", fontSize = 12.sp) }; Action("Confirmar compra", "checkout_confirm", !busy) { work { val receipt = request(base, "/api/checkout", token, "POST", JSONObject()); go("receipt/${receipt.getString("id")}") } } }
                    }
                }
                route == "pix" -> {
                    Text("Saldo: ${money(data.optInt("balance"))}", fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                    Panel { Field("Chave Pix", pixKey, "pix_key", !busy) { pixKey = it }; Field("Valor em reais", pixAmount, "pix_amount", !busy) { pixAmount = it }; Field("Descrição (opcional)", pixDescription, "pix_description", !busy) { pixDescription = it }; Action("Revisar transferência", "pix_review", !busy) { work { if ((amount(pixAmount) ?: 0) <= 0) throw IllegalArgumentException("Informe um valor válido."); recipient = request(base, "/api/pix/recipient", token, "POST", JSONObject().put("key", pixKey)); go("pix-confirm") } } }
                    Text("Transferências anteriores", fontWeight = FontWeight.Bold)
                    val recent = data.optJSONArray("recent")?.rows().orEmpty()
                    if (recent.isEmpty()) Text("Nenhum Pix enviado ainda.", color = Color.Gray)
                    recent.forEach { receipt -> ReceiptRow(receipt) { go("receipt/${receipt.getString("id")}") } }
                }
                route == "pix-confirm" -> {
                    if (recipient.length() == 0) { Text("Prepare os dados da transferência primeiro."); Action("Preparar Pix", "pix_prepare", !busy) { go("pix", true) } } else {
                    Panel { Text("Você vai transferir", color = Color.Gray); Text(money(amount(pixAmount) ?: 0), fontSize = 32.sp, fontWeight = FontWeight.Bold); Text("Para ${recipient.optString("name", "Destinatário de teste")}", fontSize = 20.sp); Text("Chave: $pixKey"); Text(recipient.optString("bank", "Banco Local")); if (pixDescription.isNotBlank()) Text(pixDescription) }
                    Text("Confira os dados antes de confirmar. Esta é uma simulação local.")
                    Action("Confirmar Pix", "pix_confirm", !busy) { work { val receipt = request(base, "/api/pix/transfers", token, "POST", JSONObject().put("key", pixKey).put("amount", amount(pixAmount) ?: 0).put("description", pixDescription)); go("receipt/${receipt.getString("id")}") } }
                    OutlinedButton(onClick = { go("pix", true) }, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("pix_edit")) { Text("Editar dados") }
                    }
                }
                route == "cards" || route == "card-limit" -> {
                    val card = data.optJSONArray("items")?.optJSONObject(0) ?: JSONObject()
                    Panel { Text("NAVLOOM", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold); Text(card.optString("name", "Platinum"), fontSize = 23.sp); Text("••••  ••••  ••••  ${card.optString("last4", "4242")}", fontSize = 22.sp); Text("Limite total: ${money(card.optInt("limit"))}"); Text("Disponível: ${money(card.optInt("limit") - card.optInt("used"))}") }
                    if (route == "cards") { Action("Aumentar limite", "card_increase", !busy) { go("card-limit") }; Text("Solicitações", fontWeight = FontWeight.Bold); data.optJSONArray("requests")?.rows().orEmpty().forEach { receipt -> ReceiptRow(receipt) { go("receipt/${receipt.getString("id")}") } } }
                    else { var limit by remember { mutableStateOf("5000,00") }; Panel { Field("Novo limite em reais", limit, "limit_amount", !busy) { limit = it }; Text("Limites de até R$ 10.000,00 podem ser aprovados no cenário padrão.", fontSize = 12.sp, color = Color.Gray); Action("Solicitar aumento", "limit_submit", !busy) { work { val receipt = request(base, "/api/cards/card-demo/limit", token, "POST", JSONObject().put("limit", amount(limit) ?: 0)); go("receipt/${receipt.getString("id")}") } } } }
                }
                route.startsWith("receipt/") -> {
                    Panel { Text(if (data.optString("status") == "rejected") "○" else "✓", fontSize = 50.sp, color = MaterialTheme.colorScheme.secondary); Text(data.optString("title", "Comprovante"), fontSize = 24.sp, fontWeight = FontWeight.Bold); Text(money(data.optInt("amount")), fontSize = 32.sp, fontWeight = FontWeight.Bold); HorizontalDivider(); Text(data.optString("recipient")); if (data.has("key")) Text("Chave: ${data.optString("key")}"); Text("Status: ${data.optString("status")}"); Text("Identificador: ${data.optString("id")}", modifier = Modifier.testTag("receipt_id")); Text(data.optString("createdAt"), fontSize = 12.sp, color = Color.Gray); data.optJSONArray("items")?.rows().orEmpty().forEach { Text("${it.optInt("quantity")} × ${it.optString("name")}") }; Text("Comprovante de teste — sem valor financeiro.", fontSize = 12.sp) }
                    Action("Voltar ao início", "receipt_home", !busy) { stack = emptyList(); go("home", true) }
                    if (data.optString("kind") == "limit") OutlinedButton(onClick = { go("cards") }, modifier = Modifier.fillMaxWidth().testTag("receipt_cards")) { Text("Ver meus cartões") }
                }
                else -> { Text("Este caminho não existe no app."); Action("Ir para início", "unknown_home") { go("home") } }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable private fun Panel(content: @Composable ColumnScope.() -> Unit) { Surface(shape = RoundedCornerShape(18.dp), color = Color.White, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content) } }
@Composable private fun Action(label: String, id: String, enabled: Boolean = true, click: () -> Unit) { Button(onClick = click, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp).testTag(id), shape = RoundedCornerShape(12.dp)) { Text(label) } }
@Composable private fun Field(label: String, value: String, id: String, enabled: Boolean = true, password: Boolean = false, update: (String) -> Unit) { OutlinedTextField(value = value, onValueChange = update, label = { Text(label) }, enabled = enabled, singleLine = true, visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None, modifier = Modifier.fillMaxWidth().testTag(id), shape = RoundedCornerShape(12.dp)) }
@Composable private fun ProductCard(product: JSONObject, enabled: Boolean, onOpen: () -> Unit, onFavorite: () -> Unit) { Panel { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(product.optString("emoji"), fontSize = 40.sp); TextButton(onClick = onFavorite, enabled = enabled, modifier = Modifier.testTag("favorite_${product.getString("id")}")) { Text(if (product.optBoolean("favorite")) "♥ Salvo" else "♡ Salvar") } }; Text(product.optString("name"), fontSize = 19.sp, fontWeight = FontWeight.SemiBold); Text(product.optString("category"), color = Color.Gray); Text(money(product.optInt("price")), fontSize = 20.sp); if (product.optInt("stock") == 0) Text("Esgotado", color = MaterialTheme.colorScheme.error); Action("Ver detalhes", "product_${product.getString("id")}", enabled, onOpen) } }
@Composable private fun ReceiptRow(receipt: JSONObject, click: () -> Unit) { Surface(shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().testTag("receipt_${receipt.getString("id")}").clickable(onClick = click)) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { Text(receipt.optString("title"), fontWeight = FontWeight.SemiBold); Text("${money(receipt.optInt("amount"))} · ${receipt.optString("recipient")}"); Text("Ver comprovante →", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary) } } }
