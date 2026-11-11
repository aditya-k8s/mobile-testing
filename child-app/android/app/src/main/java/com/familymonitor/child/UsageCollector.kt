package com.familymonitor.child

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Process
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Computes per-app foreground time from Android's UsageEvents (requires the user-granted
 * "Usage access" permission). Intervals are split at local midnight, so daily totals match the
 * child's own calendar day. Only apps that appear in the launcher are reported; the home screen
 * itself is excluded.
 */
object UsageCollector {
  // UsageEvents.Event constants, as literals so they resolve on every API level we support.
  private const val ACTIVITY_RESUMED = 1 // MOVE_TO_FOREGROUND
  private const val ACTIVITY_PAUSED = 2 // MOVE_TO_BACKGROUND
  private const val SCREEN_NON_INTERACTIVE = 16
  private const val KEYGUARD_SHOWN = 17
  private const val DEVICE_SHUTDOWN = 26

  private class AppDay(var ms: Long = 0, var lastUsed: Long = 0)

  class Snapshot(
    val days: LinkedHashMap<String, MutableMap<String, Long>>,
    val lastUsed: Map<String, Map<String, Long>>,
    val currentPackage: String?,
    val currentSince: Long,
  )

  fun hasAccess(context: Context): Boolean {
    val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    } else {
      @Suppress("DEPRECATION")
      ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  private fun dayKey(t: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(t)

  private fun isoTime(t: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(t)

  private fun startOfDay(t: Long): Long = Calendar.getInstance().apply {
    timeInMillis = t
    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
  }.timeInMillis

  private fun nextDay(dayStart: Long): Long = Calendar.getInstance().apply {
    timeInMillis = dayStart
    add(Calendar.DAY_OF_MONTH, 1)
  }.timeInMillis

  private fun launchablePackages(pm: PackageManager): Set<String> {
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    val homePkg = pm.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
    return pm.queryIntentActivities(launcher, 0).map { it.activityInfo.packageName }.toSet() - setOfNotNull(homePkg)
  }

  fun collect(context: Context, days: Int): Snapshot {
    val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val now = System.currentTimeMillis()
    val rangeStart = Calendar.getInstance().apply {
      timeInMillis = startOfDay(now)
      add(Calendar.DAY_OF_MONTH, -(days - 1))
    }.timeInMillis

    val buckets = LinkedHashMap<String, MutableMap<String, AppDay>>()
    var d = rangeStart
    while (d <= now) {
      buckets[dayKey(d)] = HashMap()
      d = nextDay(d)
    }

    fun add(pkg: String, start: Long, end: Long) {
      var s = start
      while (s < end) {
        val dayEnd = nextDay(startOfDay(s))
        val e = minOf(end, dayEnd)
        buckets[dayKey(s)]?.getOrPut(pkg) { AppDay() }?.let {
          it.ms += e - s
          it.lastUsed = e
        }
        s = e
      }
    }

    var current: String? = null
    var currentStart = 0L
    fun close(end: Long) {
      current?.let { add(it, currentStart, end) }
      current = null
    }

    val events = usm.queryEvents(rangeStart, now)
    val e = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(e)
      when (e.eventType) {
        ACTIVITY_RESUMED -> if (current != e.packageName) {
          close(e.timeStamp)
          current = e.packageName
          currentStart = e.timeStamp
        }
        ACTIVITY_PAUSED -> if (e.packageName == current) close(e.timeStamp)
        SCREEN_NON_INTERACTIVE, KEYGUARD_SHOWN, DEVICE_SHUTDOWN -> close(e.timeStamp)
      }
    }
    val foreground = current
    val since = currentStart
    close(now)

    val allowed = launchablePackages(context.packageManager)
    val days2 = LinkedHashMap<String, MutableMap<String, Long>>()
    val last = HashMap<String, Map<String, Long>>()
    for ((day, apps) in buckets) {
      val kept = apps.filterKeys { it in allowed }.filterValues { it.ms >= 1000 }
      days2[day] = kept.mapValues { it.value.ms }.toMutableMap()
      last[day] = kept.mapValues { it.value.lastUsed }
    }
    return Snapshot(days2, last, foreground?.takeIf { it in allowed }, since)
  }

  fun label(pm: PackageManager, pkg: String): String = try {
    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
  } catch (_: PackageManager.NameNotFoundException) {
    pkg
  }

  /** Body for POST /api/device/sync. */
  fun syncJson(context: Context, days: Int): JSONObject {
    val body = JSONObject()
    val access = hasAccess(context)
    body.put("usage_permission", access)
    if (!access) return body
    val pm = context.packageManager
    val snap = collect(context, days)
    val labels = HashMap<String, String>()
    fun name(pkg: String) = labels.getOrPut(pkg) { label(pm, pkg) }

    val dayArray = JSONArray()
    for ((day, apps) in snap.days) {
      val appArray = JSONArray()
      for ((pkg, ms) in apps) {
        appArray.put(JSONObject()
          .put("package", pkg)
          .put("name", name(pkg))
          .put("foreground_ms", ms)
          .put("last_used_at", snap.lastUsed[day]?.get(pkg)?.let { isoTime(it) } ?: JSONObject.NULL))
      }
      dayArray.put(JSONObject().put("date", day).put("apps", appArray))
    }
    body.put("days", dayArray)
    snap.currentPackage?.let {
      body.put("current_app", JSONObject().put("package", it).put("name", name(it)).put("since", isoTime(snap.currentSince)))
    }
    return body
  }

  fun iconPngBase64(pm: PackageManager, pkg: String, size: Int = 96): String? = try {
    val drawable = pm.getApplicationIcon(pkg)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    drawable.setBounds(0, 0, size, size)
    drawable.draw(canvas)
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
    Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  } catch (_: Exception) {
    null
  }
}
