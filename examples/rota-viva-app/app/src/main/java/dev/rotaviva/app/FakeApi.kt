package dev.rotaviva.app

import android.util.Log
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale
import kotlin.random.Random

class ApiError(val status: Int, message: String) : Exception(message)

fun json(vararg pairs: Pair<String, Any?>): JSONObject = JSONObject().apply { pairs.forEach { put(it.first, it.second) } }
fun JSONArray.rows(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
fun money(cents: Int): String = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR")).format(cents / 100.0)

/**
 * In-process fake backend. Nothing leaves the device. Every call waits a little, like a network, and writes one
 * log line in the app's own format (tag RotaViva):
 *   [rv-net] id=7 begin
 *   [rv-net] id=7 verb=GET route=/v2/hotels status=200 took=412ms
 * Data lives as long as the process: a force-stop restores the seed.
 */
object FakeApi {
    data class User(var name: String, val email: String, var password: String, var phone: String)
    data class Flight(val id: String, val from: String, val to: String, val time: String, val airline: String, val price: Int)
    data class Hotel(val id: String, val name: String, val city: String, val stars: Int, val night: Int)
    data class Car(val id: String, val model: String, val category: String, val day: Int)
    data class Tour(val id: String, val name: String, val city: String, val price: Int)
    data class Destination(val id: String, val city: String, val country: String, val airport: String, val blurb: String)
    data class Booking(val id: String, val kind: String, val title: String, val detail: String, val total: Int, var status: String)

    private val users = mutableListOf(User("Ana Souza", "ana@rotaviva.test", "Viagem123!", "11 98888-0000"))
    private var session: User? = null
    private var seq = 0
    private var offersCalls = 0
    private var resetEmail = ""
    private var resetCode = ""
    private var points = 12480
    private var bookingSeq = 1002
    private var ticketSeq = 5001
    private val wishlist = mutableSetOf<String>()
    private val notifications = linkedMapOf("Promoções" to true, "Lembretes de viagem" to true, "Novidades do app" to false)

    private val flights = listOf(
        Flight("F100", "GRU", "LIS", "22:10", "Aurora Air", 389000),
        Flight("F101", "GRU", "LIS", "08:45", "Atlântica", 352000),
        Flight("F200", "GRU", "SSA", "07:30", "Aurora Air", 79000),
        Flight("F201", "GRU", "SSA", "18:05", "Céu Azul", 64000),
        Flight("F300", "GRU", "SCL", "11:20", "Andes Jet", 142000),
        Flight("F400", "GIG", "MIA", "23:55", "Atlântica", 298000),
    )
    private val hotels = listOf(
        Hotel("H1", "Pousada Mar Azul", "Salvador", 4, 42000),
        Hotel("H2", "Hotel Alfama", "Lisboa", 5, 89000),
        Hotel("H3", "Cordillera Inn", "Santiago", 3, 31000),
        Hotel("H4", "Ocean Drive Suites", "Miami", 4, 120000),
    )
    private val cars = listOf(Car("C1", "Onix 1.0", "Econômico", 11000), Car("C2", "Compass", "SUV", 26000), Car("C3", "Corolla", "Sedã", 19000))
    private val tours = listOf(Tour("T1", "Pelourinho a pé", "Salvador", 9000), Tour("T2", "Vinícolas do Maipo", "Santiago", 35000), Tour("T3", "Sintra e Cascais", "Lisboa", 48000))
    private val destinations = listOf(
        Destination("lisboa", "Lisboa", "Portugal", "LIS", "Bondes, miradouros e pastéis de nata."),
        Destination("salvador", "Salvador", "Brasil", "SSA", "Praias, Pelourinho e acarajé."),
        Destination("santiago", "Santiago", "Chile", "SCL", "Cordilheira, vinhos e museus."),
        Destination("miami", "Miami", "Estados Unidos", "MIA", "Praias e compras."),
    )
    private val bookings = mutableListOf(
        Booking("RV1001", "Voo", "São Paulo → Lisboa", "12 dez · GRU 22:10 · Aurora Air", 389000, "Confirmada"),
        Booking("RV0998", "Hotel", "Pousada Mar Azul", "3 noites · 2 hóspedes", 126000, "Concluída"),
    )
    private val rates = linkedMapOf("USD" to 5.42, "EUR" to 5.88, "GBP" to 6.91)

    suspend fun call(method: String, path: String, body: JSONObject = JSONObject()): JSONObject {
        val id = ++seq
        Log.d("RotaViva", "[rv-net] id=$id begin")
        val started = System.currentTimeMillis()
        var status = 200
        try {
            delay(Random.nextLong(220, 650))
            return handle(method, path, body)
        } catch (e: ApiError) {
            status = e.status; throw e
        } finally {
            Log.i("RotaViva", "[rv-net] id=$id verb=$method route=$path status=$status took=${System.currentTimeMillis() - started}ms")
        }
    }

    private fun me(): User = session ?: throw ApiError(401, "Sua sessão expirou. Entre novamente.")
    private fun bookingJson(b: Booking) = json("id" to b.id, "kind" to b.kind, "title" to b.title, "detail" to b.detail, "total" to b.total, "status" to b.status)

    private fun handle(method: String, fullPath: String, body: JSONObject): JSONObject {
        val path = fullPath.substringBefore('?')
        val query = fullPath.substringAfter('?', "").split('&').filter { it.contains('=') }.associate { it.substringBefore('=') to it.substringAfter('=') }
        val p = path.trim('/').split('/')
        fun s(key: String) = body.optString(key).trim()
        return when {
            method == "POST" && path == "/v2/auth/login" -> {
                val u = users.firstOrNull { it.email.equals(s("email"), true) && it.password == body.optString("password") }
                    ?: throw ApiError(401, "E-mail ou senha incorretos.")
                session = u; json("name" to u.name)
            }
            method == "POST" && path == "/v2/auth/signup" -> {
                if (users.any { it.email.equals(s("email"), true) }) throw ApiError(409, "Já existe uma conta com este e-mail.")
                val u = User(s("name"), s("email"), body.optString("password"), ""); users += u; session = u; json("name" to u.name)
            }
            method == "POST" && path == "/v2/auth/forgot" -> {
                users.firstOrNull { it.email.equals(s("email"), true) } ?: throw ApiError(404, "Não encontramos uma conta com este e-mail.")
                resetEmail = s("email"); resetCode = (1000 + Random.nextInt(9000)).toString(); json("demoCode" to resetCode)
            }
            method == "POST" && path == "/v2/auth/forgot/verify" -> {
                if (s("code") != resetCode || resetCode.isEmpty()) throw ApiError(422, "Código inválido. Confira e tente de novo.")
                json("ok" to true)
            }
            method == "POST" && path == "/v2/auth/forgot/reset" -> {
                val u = users.first { it.email.equals(resetEmail, true) }; u.password = body.optString("password"); resetCode = ""; json("ok" to true)
            }
            method == "POST" && path == "/v2/auth/logout" -> { session = null; json("ok" to true) }
            method == "GET" && path == "/v2/me/summary" -> {
                val u = me(); val next = bookings.firstOrNull { it.status == "Confirmada" }
                json("name" to u.name, "points" to points, "next" to next?.let { bookingJson(it) })
            }
            method == "GET" && path == "/v2/me" -> { val u = me(); json("name" to u.name, "email" to u.email, "phone" to u.phone, "points" to points) }
            method == "PUT" && path == "/v2/me" -> {
                val u = me(); if (s("name").length < 3) throw ApiError(422, "Informe seu nome completo.")
                u.name = s("name"); u.phone = s("phone"); json("ok" to true)
            }
            method == "POST" && path == "/v2/me/password" -> {
                val u = me(); if (body.optString("current") != u.password) throw ApiError(403, "A senha atual não confere.")
                u.password = body.optString("password"); json("ok" to true)
            }
            method == "GET" && path == "/v2/me/notifications" -> { me(); json("items" to JSONArray(notifications.map { json("name" to it.key, "on" to it.value) })) }
            method == "PUT" && path == "/v2/me/notifications" -> { me(); notifications[s("name")] = body.optBoolean("on"); json("ok" to true) }
            method == "GET" && path == "/v2/flights" && p.size == 2 -> {
                me(); val list = flights.filter { it.from.equals(query["from"] ?: "", true) && it.to.equals(query["to"] ?: "", true) }
                json("items" to JSONArray(list.map { json("id" to it.id, "from" to it.from, "to" to it.to, "time" to it.time, "airline" to it.airline, "price" to it.price) }))
            }
            method == "GET" && p.size == 3 && p[1] == "flights" -> {
                me(); val f = flights.firstOrNull { it.id == p[2] } ?: throw ApiError(404, "Voo não encontrado.")
                json("id" to f.id, "from" to f.from, "to" to f.to, "time" to f.time, "airline" to f.airline, "price" to f.price)
            }
            method == "GET" && p.size == 4 && p[1] == "flights" && p[3] == "seats" -> {
                me(); val taken = setOf("1B", "2A", "3D", "4C")
                json("seats" to JSONArray((1..4).flatMap { r -> listOf("A", "B", "C", "D").map { c -> json("seat" to "$r$c", "free" to ("$r$c" !in taken)) } }))
            }
            method == "POST" && path == "/v2/bookings" -> {
                me(); val total = body.optInt("total"); val pay = s("payment")
                if (pay == "points" && total / 10 > points) throw ApiError(402, "Pontos insuficientes para esta reserva.")
                if (pay == "points") points -= total / 10 else points += total / 1000
                val b = Booking("RV${bookingSeq++}", s("kind"), s("title"), s("detail"), total, "Confirmada"); bookings.add(0, b); bookingJson(b)
            }
            method == "GET" && path == "/v2/hotels" -> { me(); json("items" to JSONArray(hotels.map { json("id" to it.id, "name" to it.name, "city" to it.city, "stars" to it.stars, "night" to it.night) })) }
            method == "GET" && p.size == 3 && p[1] == "hotels" -> {
                me(); val h = hotels.firstOrNull { it.id == p[2] } ?: throw ApiError(404, "Hotel não encontrado.")
                json("id" to h.id, "name" to h.name, "city" to h.city, "stars" to h.stars, "night" to h.night)
            }
            method == "GET" && path == "/v2/cars" -> { me(); json("items" to JSONArray(cars.map { json("id" to it.id, "model" to it.model, "category" to it.category, "day" to it.day) })) }
            method == "GET" && p.size == 3 && p[1] == "cars" -> {
                me(); val c = cars.firstOrNull { it.id == p[2] } ?: throw ApiError(404, "Carro não encontrado.")
                json("id" to c.id, "model" to c.model, "category" to c.category, "day" to c.day)
            }
            method == "GET" && path == "/v2/tours" -> { me(); json("items" to JSONArray(tours.map { json("id" to it.id, "name" to it.name, "city" to it.city, "price" to it.price, "saved" to (it.id in wishlist)) })) }
            method == "POST" && path == "/v2/wishlist" -> { me(); wishlist += s("id"); json("ok" to true) }
            method == "GET" && path == "/v2/offers" -> {
                me(); offersCalls++
                // Every third read fails, like a flaky partner service.
                if (offersCalls % 3 == 0) throw ApiError(503, "Ofertas indisponíveis no momento.")
                json("items" to JSONArray(listOf(
                    json("title" to "Lisboa com 15% off", "target" to "hotel/H2", "tag" to "Hotel"),
                    json("title" to "Salvador a partir de R$ 640", "target" to "flights-to/SSA", "tag" to "Voo"),
                    json("title" to "SUV pelo preço de sedã", "target" to "car/C2", "tag" to "Carro"),
                )))
            }
            method == "POST" && path == "/v2/insurance/quote" -> {
                me(); val days = body.optInt("days"); val people = body.optInt("travelers")
                if (days !in 1..90) throw ApiError(422, "Informe entre 1 e 90 dias.")
                if (people !in 1..9) throw ApiError(422, "Informe entre 1 e 9 viajantes.")
                json("total" to days * people * 1890, "plan" to if (days > 15) "Viagem longa" else "Essencial")
            }
            method == "GET" && path == "/v2/fx/rates" -> { me(); json("rates" to JSONObject(rates as Map<*, *>)) }
            method == "GET" && path == "/v2/support/faq" -> {
                json("items" to JSONArray(listOf(
                    json("q" to "Como remarcar um voo?", "a" to "Abra a reserva em Viagens e fale com o suporte."),
                    json("q" to "Posso cancelar sem multa?", "a" to "Sim, até 24 horas depois da compra."),
                    json("q" to "Como uso meus pontos?", "a" to "Escolha Pontos na hora de pagar."),
                )))
            }
            method == "POST" && path == "/v2/support/tickets" -> {
                me(); if (s("subject").length < 4) throw ApiError(422, "Descreva o assunto.")
                json("protocol" to "SP${ticketSeq++}")
            }
            method == "GET" && path == "/v2/trips" -> { me(); json("items" to JSONArray(bookings.map { bookingJson(it) })) }
            method == "GET" && p.size == 3 && p[1] == "trips" -> { me(); bookingJson(bookings.firstOrNull { it.id == p[2] } ?: throw ApiError(404, "Reserva não encontrada.")) }
            method == "POST" && p.size == 4 && p[1] == "trips" && p[3] == "cancel" -> {
                me(); val b = bookings.firstOrNull { it.id == p[2] } ?: throw ApiError(404, "Reserva não encontrada.")
                if (b.status != "Confirmada") throw ApiError(409, "Esta reserva não pode ser cancelada.")
                b.status = "Cancelada"; bookingJson(b)
            }
            method == "GET" && path == "/v2/destinations" -> { me(); json("items" to JSONArray(destinations.map { json("id" to it.id, "city" to it.city, "country" to it.country) })) }
            method == "GET" && p.size == 3 && p[1] == "destinations" -> {
                me(); val d = destinations.firstOrNull { it.id == p[2] } ?: throw ApiError(404, "Destino não encontrado.")
                json("id" to d.id, "city" to d.city, "country" to d.country, "airport" to d.airport, "blurb" to d.blurb)
            }
            else -> throw ApiError(404, "Rota desconhecida.")
        }
    }

    fun signedIn() = session != null
    fun ratesList() = rates.keys.toList()
}
