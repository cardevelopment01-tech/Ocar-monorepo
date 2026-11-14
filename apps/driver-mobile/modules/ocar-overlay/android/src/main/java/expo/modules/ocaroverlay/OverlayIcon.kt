package expo.modules.ocaroverlay

import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.graphics.Outline
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.ImageView
import android.widget.FrameLayout
import android.widget.TextView

/**
 * The floating Ocar icon: a small draggable circle drawn over other apps while the driver is online and Ocar is not in front.
 * Tap brings Ocar back to the screen the driver left. It is a process-wide singleton so a JS reload does not leave a second icon
 * behind. Everything touching a View runs on the main thread. Needs the "display over other apps" permission; without it
 * [show] does nothing and returns false.
 */
object OverlayIcon {
  private const val PREFS = "ocar_overlay"
  private const val KEY_Y = "icon_y"
  private const val SIZE_DP = 52
  private const val MARGIN_DP = 4
  // A request waits about 50 s. If the app side can never clear the alert (the screen was swiped away while the process lives on),
  // the dot and pulse end by themselves a little after that instead of running forever.
  private const val ALERT_TTL_MS = 60_000L

  private val main = Handler(Looper.getMainLooper())
  private var view: FrameLayout? = null
  private var badge: View? = null
  private var params: WindowManager.LayoutParams? = null
  // A request is waiting: the icon shows a red dot and keeps pulsing until the app clears it. Kept here (not on the view) so an icon
  // that is hidden and shown again, for example around an app-state change, comes back in the same state.
  private var alertOn = false
  private var alertAnimator: ValueAnimator? = null
  private var alertTimeout: Runnable? = null

  // Drag-to-close: while the icon is being dragged a round "X" target appears at the bottom centre. Dropping the icon on it closes
  // the icon, the app and the location service. It does NOT take the driver offline: the server ends a silent session by itself
  // after the offline period, and reopening Ocar picks the driver up again.
  private const val CLOSE_BOTTOM_DP = 56
  private const val CLOSE_SIZE_DP = 64
  private const val CLOSE_RADIUS_DP = 84 // how near the icon's centre must come to the target's centre to "catch" it
  // If the app side has not stopped the location service and called exitApp by then, the native side closes everything itself.
  private const val EXIT_FALLBACK_MS = 2_500L
  private var closeTarget: FrameLayout? = null
  private var closeTargetParams: WindowManager.LayoutParams? = null
  private var closeArmed = false
  private var exitFallback: Runnable? = null
  /** Off while the driver is on a ride: closing the app mid-ride would stop the ride's tracking, so no target is offered then. */
  @Volatile var dismissEnabled = true
  /** Set by the module while the JS side is alive. It stops the location service and then calls [exitApp]. */
  @Volatile var onDismissed: (() -> Unit)? = null

  fun hasPermission(context: Context): Boolean = Settings.canDrawOverlays(context)

  val isShowing: Boolean get() = view != null

  /** Returns false when the permission is missing; true when the icon is (or is about to be) on screen. */
  fun show(context: Context): Boolean {
    val app = context.applicationContext
    if (!hasPermission(app)) return false
    main.post { if (view == null) add(app) }
    return true
  }

  fun hide(context: Context) {
    val app = context.applicationContext
    main.post { remove(app) }
  }

  /**
   * A request is waiting (true) or no longer is (false). While true the icon wears a red dot that pulses steadily, so a driver
   * switching between several driver apps can see which one has a request after the notification banner is gone.
   */
  fun setAlert(on: Boolean) {
    main.post {
      alertOn = on
      alertTimeout?.let { main.removeCallbacks(it) }
      alertTimeout = null
      if (on) {
        val expire = Runnable { alertOn = false; alertTimeout = null; applyAlert() }
        alertTimeout = expire
        main.postDelayed(expire, ALERT_TTL_MS)
      }
      applyAlert()
    }
  }

  private fun applyAlert() {
    val v = view
    val dot = badge
    alertAnimator?.cancel()
    alertAnimator = null
    dot?.scaleX = 1f
    dot?.scaleY = 1f
    dot?.alpha = 1f
    dot?.visibility = if (alertOn && v != null) View.VISIBLE else View.GONE
    v?.contentDescription = if (alertOn) "Return to Ocar, ride request waiting" else "Return to Ocar"
    if (!alertOn || v == null || dot == null) return
    // Only the red dot pulses; the icon itself stays still. The dot shrinks and dims, then returns: it sits in the window's corner, so
    // growing past its size would be clipped at the window edge.
    alertAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 600
      repeatMode = ValueAnimator.REVERSE
      repeatCount = ValueAnimator.INFINITE
      addUpdateListener { a ->
        val t = a.animatedValue as Float
        val s = 1f - 0.4f * t
        dot.scaleX = s
        dot.scaleY = s
        dot.alpha = 1f - 0.65f * t
      }
      start()
    }
  }

  /** Bring Ocar's existing task to the front without restarting it. Works because the app holds the overlay permission. */
  fun bringToFront(context: Context): Boolean {
    val app = context.applicationContext
    val intent = app.packageManager.getLaunchIntentForPackage(app.packageName) ?: return false
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return try {
      app.startActivity(intent)
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun dp(context: Context, value: Int): Int = (value * context.resources.displayMetrics.density).toInt()

  private fun add(app: Context) {
    val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val size = dp(app, SIZE_DP)

    val icon = ImageView(app).apply {
      setImageDrawable(app.packageManager.getApplicationIcon(app.packageName))
      scaleType = ImageView.ScaleType.CENTER_CROP
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO // the container below carries the label and the action
    }
    val circle = FrameLayout(app).apply {
      background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0xFFFFFFFF.toInt()) }
      elevation = dp(app, 6).toFloat()
      clipToOutline = true
      outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(v: View, outline: Outline) { outline.setOval(0, 0, v.width, v.height) }
      }
      val pad = dp(app, 4)
      setPadding(pad, pad, pad, pad)
      addView(icon, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    }
    // The red "request waiting" dot sits on the circle's top-right edge. It lives outside the clipped circle so it is not cut off.
    val dot = View(app).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(0xFFE5252A.toInt())
        setStroke(dp(app, 2), 0xFFFFFFFF.toInt())
      }
      elevation = dp(app, 8).toFloat()
      visibility = View.GONE
    }
    val container = FrameLayout(app).apply {
      addView(circle, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
      addView(dot, FrameLayout.LayoutParams(dp(app, 16), dp(app, 16), Gravity.TOP or Gravity.END))
      contentDescription = "Return to Ocar"
      // Real touches are handled by the drag listener below, which consumes them. This click is what TalkBack and switch access call.
      setOnClickListener { bringToFront(app) }
    }

    val lp = WindowManager.LayoutParams(
      size, size,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      // Never takes focus or the keyboard, and lets touches outside the icon reach the app underneath.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = screenWidth(app) - size - dp(app, MARGIN_DP)
      // The saved height is clamped to today's screen: after a rotation or a fold it could otherwise sit off-screen and be unreachable.
      y = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_Y, screenHeight(app) / 3)
        .coerceIn(0, maxOf(0, screenHeight(app) - size))
    }

    attachDrag(app, wm, container, lp, size)
    try {
      wm.addView(container, lp)
      view = container
      badge = dot
      params = lp
      applyAlert() // an icon re-added while a request is still waiting comes back wearing the dot
    } catch (_: Exception) {
      // Permission revoked between the check and the add, or the window token was refused: stay hidden.
      view = null
      badge = null
      params = null
    }
  }

  private fun remove(app: Context) {
    val v = view ?: return
    val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    alertAnimator?.cancel()
    alertAnimator = null
    alertTimeout?.let { main.removeCallbacks(it) }
    alertTimeout = null
    try { wm.removeView(v) } catch (_: Exception) {}
    view = null
    badge = null
    params = null
    hideCloseTarget(app)
  }

  private fun showCloseTarget(app: Context, wm: WindowManager) {
    if (closeTarget != null || !dismissEnabled) return
    val size = dp(app, CLOSE_SIZE_DP)
    val x = TextView(app).apply {
      text = "✕"
      setTextColor(0xFFFFFFFF.toInt())
      textSize = 24f
      gravity = Gravity.CENTER
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    val circle = FrameLayout(app).apply {
      background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0xCC14171A.toInt()) }
      elevation = dp(app, 8).toFloat()
      alpha = 0f
      scaleX = 0.8f
      scaleY = 0.8f
      addView(x, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    }
    val lp = WindowManager.LayoutParams(
      size, size,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      // Display only: it never takes a touch, so the drag keeps going to the icon underneath the finger.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      this.x = screenWidth(app) / 2 - size / 2
      this.y = closeCenterY(app) - size / 2
    }
    try {
      wm.addView(circle, lp)
      closeTarget = circle
      closeTargetParams = lp
      closeArmed = false
      circle.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(160).setInterpolator(DecelerateInterpolator()).start()
    } catch (_: Exception) {
      closeTarget = null
      closeTargetParams = null
    }
  }

  private fun hideCloseTarget(app: Context) {
    val t = closeTarget ?: return
    closeTarget = null
    closeTargetParams = null
    closeArmed = false
    val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    t.animate().cancel()
    try { wm.removeView(t) } catch (_: Exception) {}
  }

  private fun setCloseArmed(armed: Boolean, haptic: View) {
    if (armed == closeArmed) return
    closeArmed = armed
    val t = closeTarget ?: return
    (t.background as? GradientDrawable)?.setColor(if (armed) 0xFFE5252A.toInt() else 0xCC14171A.toInt())
    val s = if (armed) 1.25f else 1f
    t.animate().scaleX(s).scaleY(s).setDuration(120).start()
    if (armed) haptic.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
  }

  private fun closeCenterY(app: Context): Int = screenHeight(app) - dp(app, CLOSE_BOTTOM_DP) - dp(app, CLOSE_SIZE_DP) / 2

  /** The driver dropped the icon on the X. */
  private fun dismiss(app: Context) {
    remove(app) // icon, any alert and the target go
    val listener = onDismissed
    if (listener == null) { exitApp(app); return }
    // The app side is alive: let it stop the location service cleanly, then it calls exitApp. If it does not (the JS thread is stuck),
    // close from here after a short wait so the driver's drag is never ignored.
    val fallback = Runnable { exitApp(app) }
    exitFallback?.let { main.removeCallbacks(it) }
    exitFallback = fallback
    main.postDelayed(fallback, EXIT_FALLBACK_MS)
    try { listener() } catch (_: Exception) {}
  }

  /** Stop the location service and end the app's process. The service is stopped first: it asks Android to restart it after a kill. */
  fun exitApp(context: Context) {
    val app = context.applicationContext
    exitFallback?.let { main.removeCallbacks(it) }
    exitFallback = null
    try {
      val service = Class.forName("expo.modules.location.services.LocationTaskService")
      app.stopService(Intent(app, service))
    } catch (_: Exception) {}
    // Take Ocar's card out of the Recents list too. Killing the process alone leaves the card there, and tapping it cold-starts the app.
    try {
      (app.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager).appTasks.forEach { it.finishAndRemoveTask() }
    } catch (_: Exception) {}
    android.os.Process.killProcess(android.os.Process.myPid())
  }

  /** Drag anywhere; a short, still touch is a tap. On release the icon snaps to the nearer screen edge and remembers its height. */
  private fun attachDrag(app: Context, wm: WindowManager, v: View, lp: WindowManager.LayoutParams, size: Int) {
    val slop = ViewConfiguration.get(app).scaledTouchSlop
    var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var moved = false
    v.setOnTouchListener { _, e ->
      when (e.action) {
        MotionEvent.ACTION_DOWN -> {
          downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y; moved = false; true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = (e.rawX - downX).toInt(); val dy = (e.rawY - downY).toInt()
          if (!moved && (kotlin.math.abs(dx) > slop || kotlin.math.abs(dy) > slop)) moved = true
          if (moved) {
            if (dismissEnabled) showCloseTarget(app, wm) else hideCloseTarget(app) // a ride started mid-drag: take the X away
            val fingerX = startX + dx
            val fingerY = (startY + dy).coerceIn(0, screenHeight(app) - size)
            // Within reach of the X the icon is pulled onto it and the X grows and turns red, so the driver can feel it will close.
            val tx = screenWidth(app) / 2
            val ty = closeCenterY(app)
            val ddx = (fingerX + size / 2 - tx).toDouble(); val ddy = (fingerY + size / 2 - ty).toDouble()
            val near = closeTarget != null && kotlin.math.sqrt(ddx * ddx + ddy * ddy) <= dp(app, CLOSE_RADIUS_DP)
            setCloseArmed(near, v)
            lp.x = if (near) tx - size / 2 else fingerX
            lp.y = if (near) ty - size / 2 else fingerY
            try { wm.updateViewLayout(v, lp) } catch (_: Exception) {}
          }
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          // A system gesture or another window took the touch: settle the icon like a normal release so it is never left mid-screen.
          hideCloseTarget(app)
          if (moved) settle(app, wm, v, lp, size)
          true
        }
        MotionEvent.ACTION_UP -> {
          // dismissEnabled is checked again here: a ride may have been accepted while the icon was being dragged.
          if (moved && closeArmed && dismissEnabled) {
            dismiss(app)
            return@setOnTouchListener true
          }
          hideCloseTarget(app)
          if (!moved) bringToFront(app) else settle(app, wm, v, lp, size)
          true
        }
        else -> false
      }
    }
  }

  /** Snap to the nearer screen edge and remember the height. */
  private fun settle(app: Context, wm: WindowManager, v: View, lp: WindowManager.LayoutParams, size: Int) {
    val target = if (lp.x + size / 2 < screenWidth(app) / 2) dp(app, MARGIN_DP) else screenWidth(app) - size - dp(app, MARGIN_DP)
    ValueAnimator.ofInt(lp.x, target).apply {
      duration = 150
      addUpdateListener { a -> lp.x = a.animatedValue as Int; try { wm.updateViewLayout(v, lp) } catch (_: Exception) {} }
      start()
    }
    app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_Y, lp.y).apply()
  }

  private fun screenWidth(app: Context): Int = app.resources.displayMetrics.widthPixels
  private fun screenHeight(app: Context): Int = app.resources.displayMetrics.heightPixels
}
