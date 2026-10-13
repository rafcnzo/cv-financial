package id.biz.kangcatat

import android.app.Application
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import java.io.File
import java.security.MessageDigest

class MainViewModel(application: Application) : AndroidViewModel(application) {
    val api = ApiClient(TokenStore(application))
    var loggedIn by mutableStateOf(api.tokens != null)
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var notice by mutableStateOf<String?>(null)
    var accounts by mutableStateOf(emptyList<Account>())
    var contacts by mutableStateOf(emptyList<Contact>())
    var entries by mutableStateOf(emptyList<Entry>())
    var drafts by mutableStateOf(emptyList<Draft>())
    var documents by mutableStateOf(emptyList<Document>())
    var reports by mutableStateOf(emptyList<Report>())
    var hasMoreEntries by mutableStateOf(false)
    private var entryOffset = 0
    private var deviceRegistered = false
    init { if (loggedIn) reload() }
    fun action(block: suspend () -> Unit) {
        if (busy) return
        viewModelScope.launch {
            busy = true; error = null; notice = null
            try { block() } catch (e: Exception) { error = e.message ?: "Koneksi gagal. Coba lagi."; loggedIn = api.tokens != null } finally { busy = false }
        }
    }
    suspend fun loadData() {
        accounts = api.json.decodeFromString(api.request("/v1/accounts"))
        contacts = api.json.decodeFromString(api.request("/v1/contacts"))
        val firstPage = api.json.decodeFromString<List<Entry>>(api.request("/v1/transactions?limit=$PAGE_SIZE"))
        entries = firstPage; entryOffset = firstPage.size; hasMoreEntries = firstPage.size == PAGE_SIZE
        drafts = api.json.decodeFromString(api.request("/v1/drafts"))
        documents = api.json.decodeFromString(api.request("/v1/documents"))
        val start = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Jakarta")).withDayOfMonth(1).atStartOfDay(java.time.ZoneId.of("Asia/Jakarta"))
        reports = api.json.decodeFromString(api.request("/v1/reports?from=${Uri.encode(start.toInstant().toString())}&to=${Uri.encode(start.plusMonths(1).toInstant().toString())}"))
        registerDevice() // retries a registration that failed at login; no-op once registered
    }
    fun loadMoreEntries() = action {
        val page = api.json.decodeFromString<List<Entry>>(api.request("/v1/transactions?limit=$PAGE_SIZE&offset=$entryOffset"))
        val known = entries.map { it.id }.toSet()
        entries = entries + page.filter { it.id !in known }
        entryOffset += page.size; hasMoreEntries = page.size == PAGE_SIZE
    }
    fun reload() = action { loadData() }
    suspend fun registerDevice() {
        if (deviceRegistered || FirebaseApp.getApps(getApplication()).isEmpty()) return
        try {
            val token = FirebaseMessaging.getInstance().token.await()
            api.request("/v1/devices", "POST", api.json.encodeToString(DeviceRequest(token)))
            deviceRegistered = true
        } catch (e: CancellationException) { throw e } catch (e: Exception) {
            android.util.Log.w("KangCatat", "Registrasi token FCM gagal, dicoba lagi saat data dimuat: ${e.message}")
        }
    }
    private suspend fun unregisterDevice() {
        if (FirebaseApp.getApps(getApplication()).isEmpty()) return
        try { api.request("/v1/devices/remove", "POST", api.json.encodeToString(DeviceRequest(FirebaseMessaging.getInstance().token.await()))) }
        catch (e: CancellationException) { throw e } catch (_: Exception) { }
    }
    private suspend fun finishLogin(response: String) {
        api.saveTokens(api.json.decodeFromString(response)); loggedIn = true
        registerDevice(); loadData()
    }
    fun googleLogin(token: String) = action { finishLogin(api.request("/v1/auth/google", "POST", api.json.encodeToString(GoogleLogin(token)), false)) }
    fun requestOtp(email: String) = action { api.request("/v1/auth/otp/request", "POST", api.json.encodeToString(EmailRequest(email)), false); notice = "Jika email Anda mendapat undangan, kode login dikirim." }
    fun verifyOtp(email: String, code: String) = action { finishLogin(api.request("/v1/auth/otp/verify", "POST", api.json.encodeToString(OtpLogin(email, code)), false)) }
    fun logout() = action { try { unregisterDevice(); deviceRegistered = false; api.request("/v1/auth/logout", "POST") } finally { api.clear(); loggedIn = false; accounts = emptyList(); contacts = emptyList(); drafts = emptyList(); entries = emptyList(); documents = emptyList(); hasMoreEntries = false } }
    fun account(name: String, subtype: String) = action { api.request("/v1/accounts", "POST", api.json.encodeToString(AccountRequest(name, subtype = subtype))); loadData() }
    fun contact(name: String) = action { api.request("/v1/contacts", "POST", api.json.encodeToString(ContactRequest(name))); loadData() }
    fun save(transaction: Transaction, draft: Draft?, done: () -> Unit) = action {
        if (draft == null) api.request("/v1/transactions", "POST", api.json.encodeToString(transaction))
        else api.request("/v1/drafts/${draft.id}/confirm", "POST", api.json.encodeToString(Confirm(draft.version, transaction)))
        done(); notice = "Transaksi tercatat."; loadData()
    }
    fun saveDraft(transaction: Transaction, draft: Draft) = action { api.request("/v1/drafts/${draft.id}", "PATCH", api.json.encodeToString(Confirm(draft.version, transaction))); loadData(); notice = "Koreksi draft disimpan." }
    fun ignore(draft: Draft) = action { api.request("/v1/drafts/${draft.id}/ignore", "POST"); loadData() }
    fun reverse(entry: Entry) = action { api.request("/v1/transactions/${entry.id}/reverse", "POST"); loadData(); notice = "Entri pembalik tercatat. Buat transaksi baru untuk koreksi." }
    fun documentUrl(id: String, open: (String) -> Unit) = action { open(api.json.decodeFromString<UrlResponse>(api.request("/v1/documents/$id/url")).url) }
    fun upload(uri: Uri, preferredMime: String? = null) = action {
        val app = getApplication<Application>()
        val mime = preferredMime ?: app.contentResolver.getType(uri) ?: "image/jpeg"
        require(mime in listOf("image/jpeg", "image/png", "application/pdf")) { "Pilih JPEG, PNG, atau PDF." }
        val (bytes, pages) = withContext(Dispatchers.IO) {
            val data = app.contentResolver.openInputStream(uri)?.use { stream ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    require(output.size() + count <= 10 * 1024 * 1024) { "Ukuran maksimal 10 MB." }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: error("File tidak bisa dibaca")
            require(data.isNotEmpty() && data.size <= 10 * 1024 * 1024) { "Ukuran maksimal 10 MB." }
            val count = if (mime == "application/pdf") {
                val temp = File.createTempFile("scan", ".pdf", app.cacheDir)
                try { temp.writeBytes(data); PdfRenderer(ParcelFileDescriptor.open(temp, ParcelFileDescriptor.MODE_READ_ONLY)).use { it.pageCount } } finally { temp.delete() }
            } else 1
            require(count in 1..10) { "PDF maksimal 10 halaman." }
            data to count
        }
        val hash = withContext(Dispatchers.Default) { MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) } }
        val input = UploadRequest("document", mime, bytes.size, hash, pages)
        val ticket = api.json.decodeFromString<UploadTicket>(api.request("/v1/uploads", "POST", api.json.encodeToString(input)))
        if (!ticket.duplicate) { api.upload(ticket, bytes, mime); api.request("/v1/uploads/${ticket.id}/complete", "POST") }
        loadData(); notice = if (ticket.duplicate) "Dokumen sudah pernah diunggah. Periksa inbox atau status dokumen." else "Dokumen masuk antrean. Anda mendapat notifikasi saat draft siap."
    }
    private companion object { const val PAGE_SIZE = 100 }
}
