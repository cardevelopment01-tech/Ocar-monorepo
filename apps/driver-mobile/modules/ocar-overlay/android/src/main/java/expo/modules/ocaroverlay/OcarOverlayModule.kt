package expo.modules.ocaroverlay

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for the floating Ocar icon (see OverlayIcon). All calls are cheap and safe to repeat: showIcon when it is already
 * showing and hideIcon when it is hidden are no-ops. The module never throws on a missing permission; it reports it.
 */
class OcarOverlayModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OcarOverlay")

    /** The driver dropped the icon on the X. The app stops the location service, then calls exitApp. */
    Events("onIconDismissed")

    // On a JS reload the new module instance can be created before the old one is destroyed: clear the listener only if it is still ours.
    val dismissListener: () -> Unit = { sendEvent("onIconDismissed") }
    OnCreate { OverlayIcon.onDismissed = dismissListener }
    OnDestroy { if (OverlayIcon.onDismissed === dismissListener) OverlayIcon.onDismissed = null }

    /** Turns the drag-to-close X on or off (it is off while the driver is on a ride). */
    Function("setDismissEnabled") { on: Boolean -> OverlayIcon.dismissEnabled = on }

    /** Stop the location service and end the app's process. Used after the app has stopped its own location tracking. */
    Function("exitApp") { OverlayIcon.exitApp(context) }

    /** The driver has allowed Ocar to display over other apps. */
    Function("hasPermission") { OverlayIcon.hasPermission(context) }

    /** Open this app's "Display over other apps" screen in system settings. */
    Function("openPermissionSettings") {
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /** Show the floating icon. Returns false (and shows nothing) when the permission is missing. */
    Function("showIcon") { OverlayIcon.show(context) }

    Function("hideIcon") { OverlayIcon.hide(context) }

    Function("isIconShowing") { OverlayIcon.isShowing }

    /** A request is waiting (true) or no longer is (false): the icon wears a red dot that pulses while true. */
    Function("setAlert") { on: Boolean -> OverlayIcon.setAlert(on) }

    /**
     * Remove a delivered notification by its tag. Used when Ocar opens itself for a ride request: the push notification's channel
     * sound is already ringing, and the in-app ring starts as soon as Ocar is in front, so leaving it would ring twice.
     * A push notification message shown by the system is posted with id 0 and the message's tag; cancelling it also stops its sound.
     */
    Function("dismissNotification") { tag: String ->
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.cancel(tag, 0)
    }

    /** Bring Ocar's existing task to the front. Returns false if the launch was refused. */
    Function("bringToFront") { OverlayIcon.bringToFront(context) }
  }
}
