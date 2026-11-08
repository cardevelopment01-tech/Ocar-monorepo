package expo.modules.ocaroverlay

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

    /** A brief pulse on the icon, for an incoming request while the app is in the background. */
    Function("pulseIcon") { OverlayIcon.pulse() }

    /** A request is waiting (true) or no longer is (false): the icon wears a red dot and pulses while true. */
    Function("setAlert") { on: Boolean -> OverlayIcon.setAlert(on) }

    /** Bring Ocar's existing task to the front. Returns false if the launch was refused. */
    Function("bringToFront") { OverlayIcon.bringToFront(context) }
  }
}
