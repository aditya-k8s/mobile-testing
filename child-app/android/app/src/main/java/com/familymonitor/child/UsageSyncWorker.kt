package com.familymonitor.child

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * Uploads today's and yesterday's usage every 15 minutes (WorkManager's minimum) while the app is
 * closed. This is also the device's background heartbeat for online/offline status.
 */
class UsageSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

  override fun doWork(): Result {
    val creds = Credentials.load(applicationContext) ?: return Result.success()
    return try {
      val body = UsageCollector.syncJson(applicationContext, days = 2).toString()
      val code = post("${creds.serverUrl.trimEnd('/')}/api/device/sync", creds.deviceToken, body)
      when {
        code in 200..299 -> Result.success()
        code == 401 -> {
          // Access was revoked by the parent or the device was removed: stop syncing.
          Credentials.clear(applicationContext)
          cancel(applicationContext)
          Result.success()
        }
        else -> Result.retry()
      }
    } catch (e: Exception) {
      Log.w(TAG, "Usage sync failed", e)
      Result.retry()
    }
  }

  private fun post(url: String, token: String, json: String): Int {
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
      conn.requestMethod = "POST"
      conn.connectTimeout = 15000
      conn.readTimeout = 15000
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/json")
      conn.setRequestProperty("Authorization", "Bearer $token")
      conn.outputStream.use { it.write(json.toByteArray()) }
      return conn.responseCode
    } finally {
      conn.disconnect()
    }
  }

  companion object {
    private const val TAG = "UsageSyncWorker"
    private const val WORK_NAME = "usage-sync"

    fun schedule(context: Context) {
      val request = PeriodicWorkRequestBuilder<UsageSyncWorker>(15, TimeUnit.MINUTES)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .build()
      WorkManager.getInstance(context)
        .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun cancel(context: Context) {
      WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }
  }
}
