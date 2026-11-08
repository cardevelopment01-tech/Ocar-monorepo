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
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.widget.ImageView
import android.widget.FrameLayout

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
   * A request is waiting (true) or no longer is (false). While true the icon wears a red dot and pulses steadily, so a driver
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
    alertAnimator?.cancel()
    alertAnimator = null
    v?.scaleX = 1f
    v?.scaleY = 1f
    badge?.visibility = if (alertOn && v != null) View.VISIBLE else View.GONE
    v?.contentDescription = if (alertOn) "Return to Ocar, ride request waiting" else "Return to Ocar"
    if (!alertOn || v == null) return
    // Breathes inward: the window is exactly the icon's size, so growing past 1x would be clipped at its edge.
    alertAnimator = ValueAnimator.ofFloat(1f, 0.8f).apply {
      duration = 600
      repeatMode = ValueAnimator.REVERSE
      repeatCount = ValueAnimator.INFINITE
      addUpdateListener { a -> val s = a.animatedValue as Float; v.scaleX = s; v.scaleY = s }
      start()
    }
  }

  /** A short scale pulse so a waiting driver notices an incoming request. */
  fun pulse() {
    main.post {
      if (alertOn) return@post // the steady alert pulse is already running
      val v = view ?: return@post
      v.animate().scaleX(0.75f).scaleY(0.75f).setDuration(150).withEndAction {
        v.animate().scaleX(1f).scaleY(1f).setDuration(150).start()
      }.start()
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
            lp.x = startX + dx
            lp.y = (startY + dy).coerceIn(0, screenHeight(app) - size)
            try { wm.updateViewLayout(v, lp) } catch (_: Exception) {}
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          if (!moved) {
            bringToFront(app)
          } else {
            val target = if (lp.x + size / 2 < screenWidth(app) / 2) dp(app, MARGIN_DP) else screenWidth(app) - size - dp(app, MARGIN_DP)
            ValueAnimator.ofInt(lp.x, target).apply {
              duration = 150
              addUpdateListener { a -> lp.x = a.animatedValue as Int; try { wm.updateViewLayout(v, lp) } catch (_: Exception) {} }
              start()
            }
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_Y, lp.y).apply()
          }
          true
        }
        else -> false
      }
    }
  }

  private fun screenWidth(app: Context): Int = app.resources.displayMetrics.widthPixels
  private fun screenHeight(app: Context): Int = app.resources.displayMetrics.heightPixels
}
