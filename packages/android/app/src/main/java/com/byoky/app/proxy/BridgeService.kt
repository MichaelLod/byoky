package com.byoky.app.proxy

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.byoky.app.R

/**
 * Foreground service that keeps the bridge proxy alive.
 * Shows a persistent notification while the bridge is running.
 */
class BridgeService : Service() {
    companion object {
        const val CHANNEL_ID = "byoky_bridge"
        const val NOTIFICATION_ID = 1
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Byoky Bridge Active")
            .setContentText("Proxying API requests through your wallet")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .build()

        startForeground(NOTIFICATION_ID, notification)
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Byoky Bridge",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Shows when the bridge proxy is active"
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }
}
