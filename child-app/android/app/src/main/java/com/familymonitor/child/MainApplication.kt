package com.familymonitor.child

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.oney.WebRTCModule.WebRTCModuleOptions

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(MonitorPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Screen capture on Android 10+ must run inside a foreground service of type mediaProjection.
    // react-native-webrtc starts it only after the user accepts the system capture prompt, and its
    // ongoing notification is the visible "your screen is being shared" indicator.
    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true
    MonitorModule.createChannels(this)
    loadReactNative(this)
  }
}
