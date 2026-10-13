package id.biz.kangcatat

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.CustomCredential
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val kinds = linkedMapOf("expense" to "Pengeluaran", "income" to "Pemasukan", "transfer" to "Transfer sendiri", "advance" to "Talangan", "reimbursement" to "Penggantian talangan", "borrow" to "Terima pinjaman", "repayment" to "Bayar utang", "refund" to "Cashback/refund", "opening" to "Saldo awal", "split" to "Split pengeluaran")
private fun rupiah(value: String) = "Rp " + runCatching { NumberFormat.getIntegerInstance(Locale("id", "ID")).format(value.toBigInteger()) }.getOrDefault(value)
private val dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
private val wib = ZoneId.of("Asia/Jakarta")
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF176D5B), secondary = Color(0xFF56776E))) { Surface(Modifier.fillMaxSize()) { KangCatat(this) } } }
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun KangCatat(activity: MainActivity, vm: MainViewModel = viewModel()) {
    var tab by remember { mutableStateOf(activity.intent.getStringExtra("screen") ?: "Riwayat") }
    var form by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf<Draft?>(null) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) { if (android.os.Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS) }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) vm.upload(uri) }
    val scanResult = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            val scan = GmsDocumentScanningResult.fromActivityResultIntent(result.data)
            val pages = scan?.pages
            if (pages != null && pages.size == 1) vm.upload(pages[0].imageUri, "image/jpeg")
            else scan?.pdf?.uri?.let { vm.upload(it, "application/pdf") }
        }
    }
    fun scanner() {
        val options = GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(10).setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG, GmsDocumentScannerOptions.RESULT_FORMAT_PDF).setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build()
        GmsDocumentScanning.getClient(options).getStartScanIntent(activity).addOnSuccessListener { scanResult.launch(IntentSenderRequest.Builder(it).build()) }.addOnFailureListener { vm.error = "Pemindai belum tersedia. Gunakan Unggah file atau coba lagi: ${it.message}" }
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("KangCatat", style = MaterialTheme.typography.headlineMedium)
        Text("Catat, periksa, lalu konfirmasi.", style = MaterialTheme.typography.bodyMedium)
        if (vm.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        vm.notice?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        if (!vm.loggedIn) { Login(activity, vm); return@Column }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = { vm.reload() }, enabled = !vm.busy) { Text("Muat ulang") }
            TextButton(onClick = { vm.logout() }, enabled = !vm.busy) { Text("Keluar") }
        }
        if (form) {
            TransactionForm(vm, draft, { form = false; draft = null })
        } else {
            ScrollableTabRow(selectedTabIndex = listOf("Riwayat", "Inbox", "Akun", "Kontak").indexOf(tab).coerceAtLeast(0), edgePadding = 0.dp) {
                listOf("Riwayat", "Inbox", "Akun", "Kontak").forEach { name -> Tab(selected = tab == name, onClick = { tab = name }, text = { Text(name) }) }
            }
            when (tab) {
                "Riwayat" -> History(vm) { draft = null; form = true }
                "Inbox" -> Inbox(vm, { scanner() }, { filePicker.launch(arrayOf("image/jpeg", "image/png", "application/pdf")) }, { draft = it; form = true }, { url -> activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) })
                "Akun" -> Accounts(vm)
                else -> Contacts(vm)
            }
        }
    }
}
@Composable private fun Login(activity: MainActivity, vm: MainViewModel) {
    var email by remember { mutableStateOf("") }; var code by remember { mutableStateOf("") }
    Text("Uji tertutup: gunakan email yang mendapat undangan.")
    Button(onClick = {
        if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank()) { vm.error = "Login Google belum dikonfigurasi."; return@Button }
        vm.action {
            val option = GetGoogleIdOption.Builder().setFilterByAuthorizedAccounts(false).setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID).build()
            val result = CredentialManager.create(activity).getCredential(activity, GetCredentialRequest.Builder().addCredentialOption(option).build())
            val credential = result.credential
            require(credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) { "Kredensial Google tidak valid." }
            val token = GoogleIdTokenCredential.createFrom(credential.data).idToken
            // Complete in this coroutine; action() prevents starting a nested action.
            val response = vm.api.request("/v1/auth/google", "POST", vm.api.json.encodeToString(GoogleLogin.serializer(), GoogleLogin(token)), false)
            vm.api.saveTokens(vm.api.json.decodeFromString(Tokens.serializer(), response)); vm.loggedIn = true; vm.loadData(); vm.registerDevice()
        }
    }, enabled = !vm.busy) { Text("Masuk dengan Google") }
    OutlinedTextField(email, { email = it }, label = { Text("Email undangan") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
    OutlinedButton(onClick = { vm.requestOtp(email) }, enabled = !vm.busy && email.isNotBlank()) { Text("Kirim kode login") }
    OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, label = { Text("Kode 6 digit") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
    Button(onClick = { vm.verifyOtp(email, code) }, enabled = !vm.busy && code.length == 6) { Text("Masuk dengan kode") }
}
@Composable private fun History(vm: MainViewModel, create: () -> Unit) {
    var reversing by remember { mutableStateOf<Entry?>(null) }
    Button(onClick = create) { Text("Catat manual") }
    Text("Bulan ini • Pengeluaran ${rupiah(vm.reports.filter { it.type == "expense" }.fold(java.math.BigInteger.ZERO) { sum, r -> sum + r.amount.toBigInteger() }.toString())} • Pemasukan ${rupiah(vm.reports.filter { it.type == "income" }.fold(java.math.BigInteger.ZERO) { sum, r -> sum - r.amount.toBigInteger() }.toString())}")
    if (vm.entries.isEmpty()) Text("Belum ada transaksi. Tambahkan akun dan saldo awal, lalu catat transaksi pertama.")
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(vm.entries, key = { it.id }) { entry -> Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) {
            Text(kinds[entry.entry_type] ?: "Pembalik", style = MaterialTheme.typography.titleMedium)
            Text(entry.description)
            Text(runCatching { Instant.parse(entry.occurred_at).atZone(wib).format(dateFormat) + " WIB" }.getOrDefault(entry.occurred_at))
            entry.lines.forEach { Text("${it.accountName}: ${rupiah(it.amount)}") }
            if (entry.reverses_entry_id == null) TextButton(onClick = { reversing = entry }, enabled = !vm.busy) { Text("Buat pembalik") }
        } } }
    }
    reversing?.let { entry -> AlertDialog(onDismissRequest = { reversing = null }, title = { Text("Balik transaksi ini?") }, text = { Text("Saldo transaksi ini dikembalikan. Riwayat asli tetap ada; buat transaksi baru untuk koreksi.") }, confirmButton = { TextButton(onClick = { vm.reverse(entry); reversing = null }) { Text("Buat pembalik") } }, dismissButton = { TextButton(onClick = { reversing = null }) { Text("Batal") } }) }
}
@Composable private fun Inbox(vm: MainViewModel, scan: () -> Unit, upload: () -> Unit, edit: (Draft) -> Unit, open: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Button(onClick = scan, enabled = !vm.busy) { Text("Foto / pindai") }; OutlinedButton(onClick = upload, enabled = !vm.busy) { Text("Unggah file") } }
    Text("AI membuat saran. Periksa nominal, akun, dan tanggal sebelum konfirmasi.")
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (vm.drafts.isEmpty()) item { Text("Belum ada draft menunggu konfirmasi.") }
        items(vm.drafts, key = { it.id }) { d -> Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) {
            Text(d.suggested.description, style = MaterialTheme.typography.titleMedium); Text("${rupiah(d.suggested.amount)} • ${d.suggested.counterparty}")
            d.possible_duplicate_of?.let { Text("Kemungkinan duplikat. Cocokkan dengan riwayat.", color = MaterialTheme.colorScheme.error) }
            Row { TextButton(onClick = { edit(d) }) { Text("Periksa") }; TextButton(onClick = { vm.ignore(d) }, enabled = !vm.busy) { Text("Abaikan") }; TextButton(onClick = { vm.documentUrl(d.document_id, open) }) { Text("Bukti") } }
        } } }
        item { Text("Status dokumen", style = MaterialTheme.typography.titleMedium) }
        items(vm.documents, key = { "doc_${it.id}" }) { doc -> Text("${doc.source}: ${doc.status}${doc.error_code?.let { " — $it; gunakan input manual" } ?: ""}") }
    }
}
@Composable private fun Accounts(vm: MainViewModel) {
    var name by remember { mutableStateOf("") }; var subtype by remember { mutableStateOf("bank") }
    OutlinedTextField(name, { name = it }, label = { Text("Nama rekening / dompet") }, modifier = Modifier.fillMaxWidth())
    Choice("Jenis akun", listOf("bank" to "Bank", "ewallet" to "Dompet digital", "cash" to "Tunai"), subtype, { subtype = it })
    Button(onClick = { vm.account(name, subtype); name = "" }, enabled = !vm.busy && name.isNotBlank()) { Text("Tambah akun") }
    LazyColumn { items(vm.accounts) { Text("${it.name}: ${rupiah(if (it.type in listOf("liability", "income")) (-it.balance.toBigInteger()).toString() else it.balance)}", Modifier.padding(vertical = 6.dp)) } }
}
@Composable private fun Contacts(vm: MainViewModel) {
    var name by remember { mutableStateOf("") }
    OutlinedTextField(name, { name = it }, label = { Text("Nama kontak") }, modifier = Modifier.fillMaxWidth())
    Button(onClick = { vm.contact(name); name = "" }, enabled = !vm.busy && name.isNotBlank()) { Text("Tambah kontak") }
    LazyColumn { items(vm.contacts) { Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) { Column(Modifier.padding(12.dp)) { Text(it.name); Text("Piutang ${rupiah(it.receivable)} • Utang ${rupiah(it.payable)}") } } } }
}
@Composable private fun Choice(label: String, options: List<Pair<String, String>>, value: String, change: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box { OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) { Text("$label: ${options.find { it.first == value }?.second ?: "Pilih"}") }; DropdownMenu(expanded, { expanded = false }) { options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { change(id); expanded = false }) } } }
}
@Composable private fun TransactionForm(vm: MainViewModel, draft: Draft?, close: () -> Unit) {
    val corrected = draft?.corrected
    var kind by remember(draft?.id) { mutableStateOf(corrected?.kind ?: draft?.suggested?.kind ?: "expense") }
    var amount by remember(draft?.id) { mutableStateOf(corrected?.amount ?: draft?.suggested?.amount ?: "") }
    var account by remember(draft?.id) { mutableStateOf(corrected?.accountId ?: "") }
    var other by remember(draft?.id) { mutableStateOf(corrected?.counterpartAccountId ?: "") }
    var description by remember(draft?.id) { mutableStateOf(corrected?.description ?: draft?.suggested?.description ?: "") }
    var date by remember(draft?.id) { mutableStateOf(runCatching { Instant.parse(corrected?.occurredAt ?: draft?.suggested?.occurredAt ?: Instant.now().toString()).atZone(wib).format(dateFormat) }.getOrDefault("")) }
    var allocations by remember(draft?.id) { mutableStateOf(corrected?.allocations ?: listOf(Allocation("", ""), Allocation("", ""))) }
    var settlement by remember(draft?.id) { mutableStateOf(corrected?.settlesEntryId ?: "") }
    fun transaction(): Transaction {
        require(amount.matches(Regex("[1-9][0-9]*")) && account.isNotBlank()) { "Isi nominal rupiah dan pilih akun pembayaran." }
        val time = LocalDateTime.parse(date, dateFormat).atZone(wib).toInstant().toString()
        return Transaction(kind, amount, account, if (kind == "split") null else other.ifBlank { null }, if (kind == "split") allocations else null, time, description, settlement.ifBlank { null })
    }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(if (draft == null) "Catat transaksi" else "Periksa draft", style = MaterialTheme.typography.titleLarge)
        Choice("Jenis", kinds.toList(), kind, { kind = it; other = ""; settlement = "" })
        OutlinedTextField(amount, { amount = it.filter(Char::isDigit) }, label = { Text("Nominal rupiah") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
        Choice("Akun pembayaran", vm.accounts.filter { it.type == "asset" && it.subtype != "receivable" }.map { it.id to it.name }, account, { account = it })
        val counterparts = vm.accounts.filter { a -> when (kind) { "expense" -> a.type == "expense"; "income" -> a.type == "income"; "transfer" -> a.type == "asset" && a.subtype != "receivable" && a.id != account; "advance", "reimbursement" -> a.subtype == "receivable"; "borrow", "repayment" -> a.type == "liability"; "refund" -> a.type == "expense"; "opening" -> a.type == "equity"; else -> false } }
        if (kind == "split") {
            allocations.forEachIndexed { index, allocation ->
                Choice("Bagian ${index + 1}", vm.accounts.filter { it.type == "expense" || it.subtype == "receivable" }.map { it.id to it.name }, allocation.accountId, { value -> allocations = allocations.toMutableList().apply { set(index, allocation.copy(accountId = value)) } })
                OutlinedTextField(allocation.amount, { value -> allocations = allocations.toMutableList().apply { set(index, allocation.copy(amount = value.filter(Char::isDigit))) } }, label = { Text("Nominal bagian ${index + 1}") }, modifier = Modifier.fillMaxWidth())
            }
            Row { TextButton(onClick = { allocations = allocations + Allocation("", "") }, enabled = allocations.size < 30) { Text("Tambah bagian") }; TextButton(onClick = { allocations = allocations.dropLast(1) }, enabled = allocations.size > 1) { Text("Hapus bagian terakhir") } }
        } else Choice("Kategori / tujuan", counterparts.map { it.id to it.name }, other, { other = it })
        if (kind in listOf("reimbursement", "repayment", "refund")) Choice("Tautkan transaksi", listOf("" to "Tanpa tautan") + vm.entries.filter { it.entry_type in listOf("advance", "split", "borrow", "expense") }.map { it.id to (it.description.ifBlank { kinds[it.entry_type].orEmpty() } + " — " + it.occurred_at.take(10)) }, settlement, { settlement = it })
        OutlinedTextField(date, { date = it }, label = { Text("Tanggal WIB: yyyy-MM-dd HH:mm") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(description, { description = it }, label = { Text("Keterangan") }, modifier = Modifier.fillMaxWidth())
        if (draft?.possible_duplicate_of != null) Text("Ada transaksi serupa. Periksa riwayat sebelum melanjutkan.", color = MaterialTheme.colorScheme.error)
        Button(onClick = { runCatching { transaction() }.onSuccess { vm.save(it, draft, close) }.onFailure { vm.error = "Periksa nominal, akun, dan format tanggal." } }, enabled = !vm.busy, modifier = Modifier.fillMaxWidth()) { Text(if (draft == null) "Simpan transaksi" else "Konfirmasi dan catat") }
        if (draft != null) OutlinedButton(onClick = { runCatching { transaction() }.onSuccess { vm.saveDraft(it, draft) }.onFailure { vm.error = "Lengkapi data sebelum menyimpan koreksi." } }, enabled = !vm.busy) { Text("Simpan koreksi draft") }
        TextButton(onClick = close) { Text("Kembali") }
    }
}
