package id.biz.kangcatat

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString

class DraftMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val api = ApiClient(TokenStore(this))
        if (api.tokens != null) CoroutineScope(Dispatchers.IO).launch { runCatching { api.request("/v1/devices", "POST", api.json.encodeToString(DeviceRequest(token))) } }
    }
    override fun onMessageReceived(message: RemoteMessage) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("drafts", "Draft transaksi", NotificationManager.IMPORTANCE_DEFAULT))
        if (android.os.Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val intent = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).putExtra("screen", "Inbox"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        manager.notify(1, NotificationCompat.Builder(this, "drafts").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(message.notification?.title ?: "Draft siap diperiksa").setContentText(message.notification?.body ?: "Buka inbox KangCatat").setContentIntent(intent).setAutoCancel(true).build())
    }
}
