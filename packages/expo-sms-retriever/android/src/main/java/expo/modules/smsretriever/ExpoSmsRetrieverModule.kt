package expo.modules.smsretriever

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Base64
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest

// Thin wrapper over Google's SMS Retriever API. One listening session at a time; Google Play services ends it after 5 minutes by itself.
// start() resolves true when the session is open (the SMS may arrive after that); the message, if it comes, is sent as an "onSms" event
// and the session is over. Nothing here reads any other SMS: Retriever only delivers a message that ends with this app's hash.
class ExpoSmsRetrieverModule : Module() {
  private var receiver: BroadcastReceiver? = null

  private fun stopReceiver() {
    val r = receiver ?: return
    receiver = null
    runCatching { appContext.reactContext?.unregisterReceiver(r) }
  }

  // The same 11 characters Google Play services matches the SMS against: SHA-256 of "<package> <signing certificate as hex>",
  // base64, first 11. It depends on the key that SIGNED this install (a Play App Signing install: Google's key, not the upload key).
  // Exposed so the hash can be read from a real signed build and set on the server; never used to build the SMS on the device.
  private fun appHash(ctx: Context): String? {
    return try {
      val pm = ctx.packageManager
      val sigs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
      } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNATURES).signatures
      } ?: return null
      val sig = sigs.firstOrNull() ?: return null
      val hex = sig.toByteArray().joinToString("") { "%02x".format(it) }
      val digest = MessageDigest.getInstance("SHA-256").digest("${ctx.packageName} $hex".toByteArray(Charsets.UTF_8))
      Base64.encodeToString(digest, Base64.NO_PADDING or Base64.NO_WRAP).substring(0, 11)
    } catch (e: Exception) {
      null
    }
  }

  override fun definition() = ModuleDefinition {
    Name("ExpoSmsRetriever")

    Events("onSms", "onTimeout")

    AsyncFunction("start") { promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      stopReceiver() // a new request replaces the previous listening session
      val r = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
          if (SmsRetriever.SMS_RETRIEVED_ACTION != intent.action) return
          val extras = intent.extras ?: return
          val status = extras.get(SmsRetriever.EXTRA_STATUS) as? Status ?: return
          when (status.statusCode) {
            CommonStatusCodes.SUCCESS -> {
              val message = extras.getString(SmsRetriever.EXTRA_SMS_MESSAGE)
              if (message != null) sendEvent("onSms", Bundle().apply { putString("message", message) })
            }
            else -> sendEvent("onTimeout", Bundle()) // timeout or any other end: the session is over either way
          }
          stopReceiver()
        }
      }
      try {
        val filter = IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION)
        // The broadcast comes from Google Play services, outside this app: it must be exported, and it is guarded by the permission below.
        if (Build.VERSION.SDK_INT >= 34) {
          ctx.registerReceiver(r, filter, SmsRetriever.SEND_PERMISSION, null, Context.RECEIVER_EXPORTED)
        } else {
          @Suppress("UnspecifiedRegisterReceiverFlag")
          ctx.registerReceiver(r, filter, SmsRetriever.SEND_PERMISSION, null)
        }
        receiver = r
        SmsRetriever.getClient(ctx).startSmsRetriever()
          .addOnSuccessListener { promise.resolve(true) }
          .addOnFailureListener { stopReceiver(); promise.resolve(false) } // no Play services, or too old: the caller keeps manual entry
      } catch (e: Exception) {
        stopReceiver()
        promise.resolve(false)
      }
    }

    Function("stop") { stopReceiver() }

    // The 11-character hash of the key this install is signed with, or null. For setting ANDROID_SMS_HASH_* on the server.
    Function("getAppHash") { appContext.reactContext?.let { appHash(it) } }

    OnDestroy { stopReceiver() }
  }
}
