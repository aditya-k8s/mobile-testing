package com.familymonitor.child

import android.content.Context

/** Pairing credentials, kept in app-private storage so both JS and the background worker can use them. */
data class Credentials(val serverUrl: String, val deviceToken: String, val deviceId: String, val parentName: String) {
  companion object {
    private const val PREFS = "family_monitor"

    fun load(context: Context): Credentials? {
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val server = p.getString("server_url", null) ?: return null
      val token = p.getString("device_token", null) ?: return null
      return Credentials(server, token, p.getString("device_id", "") ?: "", p.getString("parent_name", "") ?: "")
    }

    fun save(context: Context, c: Credentials) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("server_url", c.serverUrl)
        .putString("device_token", c.deviceToken)
        .putString("device_id", c.deviceId)
        .putString("parent_name", c.parentName)
        .apply()
    }

    fun clear(context: Context) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
  }
}
