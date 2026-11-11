package com.familymonitor.parent

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.window.OnBackInvokedDispatcher
import java.util.concurrent.atomic.AtomicInteger

/**
 * Parent app: the Family Monitor dashboard in a locked-down WebView.
 *
 * - Navigation is restricted to the configured server; other links open in the browser.
 * - Live screen viewing uses the WebView's built-in WebRTC (receive-only; camera and
 *   microphone requests are always denied).
 * - The dashboard calls FamilyMonitorApp.notify(...) for each alert; it is shown as an Android
 *   notification while the app is in the background.
 */
class MainActivity : Activity() {
  private lateinit var root: FrameLayout
  private lateinit var web: WebView
  private var fullscreenView: View? = null
  private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
  @Volatile private var inForeground = false
  private val notificationIds = AtomicInteger(1000)
  private val serverUrl = BuildConfig.SERVER_URL
  private val serverOrigin by lazy { Uri.parse(serverUrl).let { "${it.scheme}://${it.authority}" } }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    createNotificationChannel()
    if (Build.VERSION.SDK_INT >= 33 &&
      checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
    }

    root = FrameLayout(this)
    web = WebView(this)
    root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    root.setBackgroundColor(Color.parseColor("#f5f6f4"))
    setContentView(root)
    // Keep content clear of the status and navigation bars (edge-to-edge is enforced on Android 15+).
    root.setOnApplyWindowInsetsListener { v, insets ->
      val bars = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
      else null
      if (bars != null) v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }

    web.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true // the dashboard keeps its login token in localStorage
      mediaPlaybackRequiresUserGesture = false // live screen video autoplays (muted)
      allowFileAccess = false
      allowContentAccess = false
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      setSupportMultipleWindows(false)
    }
    web.addJavascriptInterface(Bridge(), "FamilyMonitorApp")
    web.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url
        if (url.toString().startsWith(serverOrigin)) return false
        startActivity(Intent(Intent.ACTION_VIEW, url))
        return true
      }

      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) showOfflinePage(error.description?.toString() ?: "")
      }
    }
    web.webChromeClient = object : WebChromeClient() {
      override fun onPermissionRequest(request: PermissionRequest) {
        request.deny() // never camera or microphone
      }

      override fun onShowCustomView(view: View, callback: CustomViewCallback) {
        fullscreenView = view
        fullscreenCallback = callback
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        web.visibility = View.GONE
      }

      override fun onHideCustomView() = exitFullscreen()
    }

    if (Build.VERSION.SDK_INT >= 33) {
      onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { handleBack() }
    }

    if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
      web.loadUrl(serverUrl)
    }
  }

  private fun showOfflinePage(detail: String) {
    val safeDetail = detail.replace("<", "&lt;")
    val html = """
      <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family:sans-serif;padding:24px;background:#f5f6f4;color:#0b0b0b">
        <h2>Cannot reach Family Monitor</h2>
        <p>Check your internet connection and try again.</p>
        <p style="color:#6b6a66;font-size:13px">$safeDetail</p>
        <button style="font-size:16px;padding:10px 18px" onclick="location.href='$serverUrl'">Try again</button>
      </body></html>
    """.trimIndent()
    web.loadDataWithBaseURL(serverUrl, html, "text/html", "utf-8", serverUrl)
  }

  private fun exitFullscreen() {
    fullscreenView?.let { root.removeView(it) }
    fullscreenView = null
    fullscreenCallback?.onCustomViewHidden()
    fullscreenCallback = null
    web.visibility = View.VISIBLE
  }

  private fun handleBack() {
    when {
      fullscreenView != null -> exitFullscreen()
      web.canGoBack() -> web.goBack()
      else -> finish()
    }
  }

  @Deprecated("Used on Android 12 and earlier")
  override fun onBackPressed() = handleBack()

  override fun onResume() {
    super.onResume()
    inForeground = true
    getSystemService(NotificationManager::class.java).cancelAll()
  }

  override fun onPause() {
    inForeground = false
    super.onPause()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    web.saveState(outState)
  }

  override fun onDestroy() {
    web.destroy()
    super.onDestroy()
  }

  private fun createNotificationChannel() {
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL, "Family Monitor alerts", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Screen-sharing responses and device status changes"
      }
    )
  }

  /** Exposed to the dashboard as window.FamilyMonitorApp. */
  inner class Bridge {
    @JavascriptInterface
    fun notify(title: String, body: String) {
      if (inForeground) return // the dashboard shows its own in-app alert
      if (Build.VERSION.SDK_INT >= 33 &&
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
      val open = PendingIntent.getActivity(
        this@MainActivity, 0,
        Intent(this@MainActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      val n = Notification.Builder(this@MainActivity, CHANNEL)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(title.take(80))
        .setContentText(body.take(300))
        .setStyle(Notification.BigTextStyle().bigText(body.take(300)))
        .setAutoCancel(true)
        .setContentIntent(open)
        .build()
      getSystemService(NotificationManager::class.java).notify(notificationIds.incrementAndGet(), n)
    }

    @JavascriptInterface
    fun isApp(): Boolean = true
  }

  companion object {
    private const val CHANNEL = "alerts"
  }
}
