package com.familymonitor.child

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.util.TimeZone
import java.util.concurrent.Executors

/** JS bridge: usage access, usage data, pairing credentials and the share-request notification. */
class MonitorModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  private val io = Executors.newSingleThreadExecutor()

  override fun getName() = "FamilyMonitor"

  @ReactMethod
  fun hasUsageAccess(promise: Promise) = promise.resolve(UsageCollector.hasAccess(ctx))

  @ReactMethod
  fun openUsageAccessSettings(promise: Promise) {
    val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
      // Some devices support jumping straight to this app's entry.
      data = Uri.fromParts("package", ctx.packageName, null)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    try {
      ctx.startActivity(intent)
    } catch (_: Exception) {
      ctx.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    promise.resolve(null)
  }

  /** Returns the JSON body for /api/device/sync as a string. */
  @ReactMethod
  fun getSyncPayload(days: Double, promise: Promise) {
    io.execute {
      try {
        promise.resolve(UsageCollector.syncJson(ctx, days.toInt().coerceIn(1, 8)).toString())
      } catch (e: Exception) {
        promise.reject("usage_error", e)
      }
    }
  }

  @ReactMethod
  fun getIcons(packages: ReadableArray, promise: Promise) {
    io.execute {
      val out = Arguments.createArray()
      for (i in 0 until minOf(packages.size(), 60)) {
        val pkg = packages.getString(i) ?: continue
        UsageCollector.iconPngBase64(ctx.packageManager, pkg)?.let {
          out.pushMap(Arguments.createMap().apply { putString("package", pkg); putString("png_base64", it) })
        }
      }
      promise.resolve(out)
    }
  }

  @ReactMethod
  fun getDeviceInfo(promise: Promise) {
    promise.resolve(Arguments.createMap().apply {
      putString("model", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
      putString("osVersion", Build.VERSION.RELEASE)
      putString("timezone", TimeZone.getDefault().id)
    })
  }

  @ReactMethod
  fun saveCredentials(serverUrl: String, deviceToken: String, deviceId: String, parentName: String, promise: Promise) {
    Credentials.save(ctx, Credentials(serverUrl, deviceToken, deviceId, parentName))
    UsageSyncWorker.schedule(ctx)
    promise.resolve(null)
  }

  @ReactMethod
  fun getCredentials(promise: Promise) {
    val c = Credentials.load(ctx)
    if (c == null) {
      promise.resolve(null)
      return
    }
    UsageSyncWorker.schedule(ctx) // idempotent; restores the schedule after an app update
    promise.resolve(Arguments.createMap().apply {
      putString("serverUrl", c.serverUrl)
      putString("deviceToken", c.deviceToken)
      putString("deviceId", c.deviceId)
      putString("parentName", c.parentName)
    })
  }

  @ReactMethod
  fun clearCredentials(promise: Promise) {
    UsageSyncWorker.cancel(ctx)
    Credentials.clear(ctx)
    promise.resolve(null)
  }

  @ReactMethod
  fun showShareRequestNotification(parentName: String, promise: Promise) {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      promise.resolve(false)
      return
    }
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    val pending = PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val n = NotificationCompat.Builder(ctx, CHANNEL_REQUESTS)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle("Screen-sharing request")
      .setContentText("$parentName would like to view your screen. Tap to accept or decline.")
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setTimeoutAfter(90_000)
      .setContentIntent(pending)
      .build()
    NotificationManagerCompat.from(ctx).notify(NOTIFICATION_REQUEST, n)
    promise.resolve(true)
  }

  @ReactMethod
  fun cancelShareRequestNotification(promise: Promise) {
    NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_REQUEST)
    promise.resolve(null)
  }

  companion object {
    const val CHANNEL_REQUESTS = "share_requests"
    private const val NOTIFICATION_REQUEST = 4101

    fun createChannels(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val nm = context.getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_REQUESTS, "Screen-sharing requests", NotificationManager.IMPORTANCE_HIGH)
          .apply { description = "Requests from your parent to view your screen" }
      )
    }
  }
}
