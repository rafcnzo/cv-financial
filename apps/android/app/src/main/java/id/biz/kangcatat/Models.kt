package id.biz.kangcatat

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable data class Tokens(val accessToken: String, val refreshToken: String, val userId: String, val expiresIn: Int = 900)
@Serializable data class Account(val id: String, val name: String, val type: String, val subtype: String, val balance: String = "0", val contact_id: String? = null)
@Serializable data class Contact(val id: String, val name: String, val receivable: String = "0", val payable: String = "0")
@Serializable data class JournalLine(val accountId: String, val accountName: String, val amount: String)
@Serializable data class Entry(val id: String, val entry_type: String, val occurred_at: String, val description: String, val lines: List<JournalLine> = emptyList(), val reverses_entry_id: String? = null)
@Serializable data class Suggestion(val kind: String, val amount: String, val occurredAt: String? = null, val counterparty: String = "", val description: String = "", val confidence: Double = 0.0)
@Serializable data class Draft(val id: String, val version: Int, val suggested: Suggestion, val corrected: Transaction? = null, val possible_duplicate_of: String? = null, val document_id: String)
@Serializable data class Document(val id: String, val source: String, val status: String, val error_code: String? = null)
@Serializable data class Allocation(val accountId: String, val amount: String)
@Serializable data class Transaction(val kind: String, val amount: String, val accountId: String, val counterpartAccountId: String? = null, val allocations: List<Allocation>? = null, val occurredAt: String, val description: String = "", val settlesEntryId: String? = null)
@Serializable data class Confirm(val version: Int, val transaction: Transaction)
@Serializable data class UploadRequest(val fileName: String, val contentType: String, val sizeBytes: Int, val contentHash: String, val pageCount: Int)
@Serializable data class UploadTicket(val id: String, val duplicate: Boolean, val uploadUrl: String? = null, val headers: Map<String, String> = emptyMap())
@Serializable data class UrlResponse(val url: String)
@Serializable data class Report(val id: String, val name: String, val type: String, val amount: String)
@Serializable data class EmailRequest(val email: String)
@Serializable data class OtpLogin(val email: String, val code: String, val deviceName: String = android.os.Build.MODEL)
@Serializable data class GoogleLogin(val idToken: String, val deviceName: String = android.os.Build.MODEL)
@Serializable data class RefreshRequest(val refreshToken: String)
@Serializable data class ContactRequest(val name: String)
@Serializable data class AccountRequest(val name: String, val type: String = "asset", val subtype: String = "bank")
@Serializable data class DeviceRequest(val token: String)
