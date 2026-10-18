package expo.modules.playupdate

import android.app.Activity
import android.os.Bundle
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val REQUEST_CODE = 7421

// Thin wrapper over Google Play In-App Updates. Deliberately does NOT call completeUpdate() by itself:
// that restarts the app, which would kill a driver's live ride. JS calls complete() only on the user's tap.
class ExpoPlayUpdateModule : Module() {
  private var manager: AppUpdateManager? = null
  private var pending: Promise? = null
  private var listener: InstallStateUpdatedListener? = null

  private fun mgr(): AppUpdateManager {
    manager?.let { return it }
    val ctx = appContext.reactContext ?: throw IllegalStateException("No context")
    return AppUpdateManagerFactory.create(ctx).also { manager = it }
  }

  private fun infoBundle(info: AppUpdateInfo): Bundle = Bundle().apply {
    putBoolean("available", info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE)
    putBoolean("flexibleAllowed", info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE))
    putBoolean("immediateAllowed", info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE))
    putBoolean("inProgress", info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS)
    putInt("stalenessDays", info.clientVersionStalenessDays() ?: -1)
    putInt("installStatus", info.installStatus())
    putDouble("totalBytes", info.totalBytesToDownload().toDouble())
  }

  private fun registerListener() {
    if (listener != null) return
    val l = InstallStateUpdatedListener { state ->
      sendEvent("onState", Bundle().apply {
        putInt("status", state.installStatus())
        putDouble("bytesDownloaded", state.bytesDownloaded().toDouble())
        putDouble("totalBytes", state.totalBytesToDownload().toDouble())
      })
      val s = state.installStatus()
      if (s == InstallStatus.INSTALLED || s == InstallStatus.FAILED || s == InstallStatus.CANCELED) {
        unregisterListener()
      }
    }
    listener = l
    mgr().registerListener(l)
  }

  private fun unregisterListener() {
    listener?.let { runCatching { mgr().unregisterListener(it) } }
    listener = null
  }

  override fun definition() = ModuleDefinition {
    Name("ExpoPlayUpdate")

    Events("onState")

    // Not installed from Play (sideloaded APK, emulator without Play) => the task fails => { available: false }.
    AsyncFunction("getInfo") { promise: Promise ->
      try {
        mgr().appUpdateInfo
          .addOnSuccessListener { info -> promise.resolve(infoBundle(info)) }
          .addOnFailureListener { promise.resolve(Bundle().apply { putBoolean("available", false) }) }
      } catch (e: Exception) {
        promise.resolve(Bundle().apply { putBoolean("available", false) })
      }
    }

    // Resolves 'ok' | 'canceled' | 'failed'. A FLEXIBLE 'ok' only means the user accepted the download.
    AsyncFunction("start") { type: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || pending != null) {
        promise.resolve("failed")
        return@AsyncFunction
      }
      val updateType = if (type == "immediate") AppUpdateType.IMMEDIATE else AppUpdateType.FLEXIBLE
      mgr().appUpdateInfo
        .addOnSuccessListener { info ->
          val resuming = info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
          if (!resuming && !info.isUpdateTypeAllowed(updateType)) {
            promise.resolve("failed")
            return@addOnSuccessListener
          }
          try {
            if (updateType == AppUpdateType.FLEXIBLE) registerListener()
            pending = promise
            mgr().startUpdateFlowForResult(info, activity, AppUpdateOptions.newBuilder(updateType).build(), REQUEST_CODE)
          } catch (e: Exception) {
            pending = null
            promise.resolve("failed")
          }
        }
        .addOnFailureListener { promise.resolve("failed") }
    }

    // Installs the downloaded update and restarts the app. JS calls this only from the user's Restart tap.
    AsyncFunction("complete") { promise: Promise ->
      try {
        mgr().completeUpdate().addOnCompleteListener { promise.resolve(null) }
      } catch (e: Exception) {
        promise.resolve(null)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == REQUEST_CODE) {
        pending?.resolve(
          when (payload.resultCode) {
            Activity.RESULT_OK -> "ok"
            Activity.RESULT_CANCELED -> "canceled"
            else -> "failed"
          }
        )
        pending = null
      }
    }

    OnDestroy {
      unregisterListener()
    }
  }
}
