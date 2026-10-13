package id.biz.kangcatat

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

class ApiClient(val store: TokenStore) {
    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }
    private val client = OkHttpClient.Builder().callTimeout(100, TimeUnit.SECONDS).build()
    private val refreshLock = Mutex()
    var tokens: Tokens? = store.read("tokens")?.let { runCatching { json.decodeFromString<Tokens>(it) }.getOrNull() }
        private set
    fun saveTokens(value: Tokens) { tokens = value; store.save("tokens", json.encodeToString(value)) }
    fun clear() { tokens = null; store.clear() }
    suspend fun request(path: String, method: String = "GET", body: String? = null, authenticated: Boolean = true): String = withContext(Dispatchers.IO) {
        val identity = MessageDigest.getInstance("SHA-256").digest("$method:$path:$body".toByteArray()).joinToString("") { "%02x".format(it) }
        val pending = "mutation_$identity"
        val mutationKey = if (authenticated && method != "GET") store.read(pending) ?: UUID.randomUUID().toString().also { store.save(pending, it) } else null
        fun send(): Pair<Int, String> {
            val builder = Request.Builder().url(BuildConfig.API_BASE_URL.trimEnd('/') + path)
            if (authenticated) builder.header("Authorization", "Bearer ${tokens?.accessToken.orEmpty()}")
            mutationKey?.let { builder.header("Idempotency-Key", it) }
            builder.method(method, if (method == "GET") null else (body ?: "{}").toRequestBody("application/json".toMediaType()))
            return client.newCall(builder.build()).execute().use { it.code to (it.body?.string() ?: "{}") }
        }
        var response = try { send() } catch (_: IOException) { send() }
        if (response.first == 401 && authenticated) {
            val used = tokens?.accessToken
            refreshLock.withLock {
                // Another ApiClient (e.g. the FCM service) may already have rotated the refresh token in storage;
                // reusing a stale refresh token would trip reuse detection and revoke the whole session.
                store.read("tokens")?.let { runCatching { json.decodeFromString<Tokens>(it) }.getOrNull() }?.let { tokens = it }
                val current = tokens ?: throw IOException("Sesi berakhir. Silakan login kembali.")
                if (current.accessToken == used) {
                val refresh = request("/v1/auth/refresh", "POST", json.encodeToString(RefreshRequest(current.refreshToken)), false)
                saveTokens(json.decodeFromString(refresh))
                }
            }
            response = send()
        }
        if (response.first !in 200..299) {
            if (response.first in 400..499 && response.first != 429) mutationKey?.let { store.remove(pending) }
            val code = runCatching { json.parseToJsonElement(response.second).jsonObject["error"]!!.jsonObject["code"]!!.jsonPrimitive.content }.getOrDefault("HTTP_${response.first}")
            if (response.first == 401) clear()
            throw IOException(code)
        }
        mutationKey?.let { store.remove(pending) }
        response.second
    }
    suspend fun upload(ticket: UploadTicket, bytes: ByteArray, mime: String) = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(ticket.uploadUrl ?: throw IOException("URL unggah tidak tersedia")).put(bytes.toRequestBody(mime.toMediaType()))
        ticket.headers.forEach { (k, v) -> builder.header(k, v) }
        client.newCall(builder.build()).execute().use { if (!it.isSuccessful) throw IOException("Unggah gagal (${it.code}); coba lagi.") }
    }
}
