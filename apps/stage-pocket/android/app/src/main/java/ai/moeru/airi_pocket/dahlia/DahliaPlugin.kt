// Dahlia: the Android side of Dahlia's phone features. This file is Dahlia's (AIRI has no such file);
// scripts/apply_avatar_branding.sh registers the plugin in MainActivity.
//
// - Dahlia as the phone's assistant: Android opens the app with ASSIST (the power button or the corner
//   swipe, once Dahlia is the default digital assistant app) or VOICE_COMMAND, and the app starts
//   listening at once, as if it heard her name.
// - Listening in the background: DahliaListenService hears "Dahlia" while the app isn't in front and
//   brings it to the front the same way.
package ai.moeru.airi_pocket.dahlia

import android.Manifest
import android.app.NotificationManager
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "Dahlia")
class DahliaPlugin : Plugin() {
    companion object {
        /** Set when Android or the listening service opened the app to listen; the web app takes it. */
        @Volatile
        var pendingWake = false

        private val WAKE_ACTIONS = setOf(
            Intent.ACTION_ASSIST,
            Intent.ACTION_VOICE_COMMAND,
            DahliaListenService.ACTION_WAKE,
        )
    }

    override fun load() {
        handleWakeIntent(activity.intent)
        // Listening was on before the app closed; a microphone service may only start while the app is in front.
        if (DahliaListenService.isEnabled(context) && hasMicrophone())
            DahliaListenService.start(context)
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        handleWakeIntent(intent)
    }

    override fun handleOnResume() {
        super.handleOnResume()
        DahliaListenService.appInFront = true
        context.getSystemService(NotificationManager::class.java)?.cancel(DahliaListenService.WAKE_NOTIFICATION_ID)
    }

    override fun handleOnPause() {
        super.handleOnPause()
        DahliaListenService.appInFront = false
    }

    private fun handleWakeIntent(intent: Intent?) {
        if (intent?.action !in WAKE_ACTIONS)
            return
        // Handled once: a configuration change re-delivers the same intent.
        intent?.action = Intent.ACTION_MAIN
        pendingWake = true
        notifyListeners("wake", JSObject())
    }

    /** Whether Android or the listening service asked the app to listen; asking takes the request. */
    @PluginMethod
    fun consumeWake(call: PluginCall) {
        val wake = pendingWake
        pendingWake = false
        call.resolve(JSObject().apply { put("wake", wake) })
    }

    /** The phone's name as set in Android's settings (About phone), or its maker and model. */
    @PluginMethod
    fun getDeviceName(call: PluginCall) {
        val set = Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
            ?: Settings.Secure.getString(context.contentResolver, "bluetooth_name")
        val name = set?.trim()?.takeIf { it.isNotEmpty() }
            ?: "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}".trim()
        call.resolve(JSObject().put("name", name))
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(status())
    }

    /** Turns listening in the background on or off. It stays on across restarts until turned off. */
    @PluginMethod
    fun setBackgroundListening(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: false
        DahliaListenService.setEnabled(context, enabled)
        if (enabled) {
            if (!hasMicrophone()) {
                DahliaListenService.setEnabled(context, false)
                call.reject("Dahlia needs the microphone permission to listen.")
                return
            }
            // Without it the "listening" notification is hidden, though listening works.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4711)
            }
            DahliaListenService.start(context)
        } else {
            DahliaListenService.stop(context)
        }
        call.resolve(status())
    }

    /** Opens Android's choice of the digital assistant app. */
    @PluginMethod
    fun openAssistantSettings(call: PluginCall) {
        val intents = listOf(
            Intent(Settings.ACTION_VOICE_INPUT_SETTINGS),
            Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS),
            Intent(Settings.ACTION_SETTINGS),
        )
        open(intents, call)
    }

    /** Opens the "display over other apps" switch, which lets a heard "Dahlia" bring the app to the front. */
    @PluginMethod
    fun openOverlaySettings(call: PluginCall) {
        open(listOf(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))), call)
    }

    /** Opens the battery settings, so the phone doesn't stop listening to save power. */
    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        open(
            listOf(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")),
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            ),
            call,
        )
    }

    private fun open(intents: List<Intent>, call: PluginCall) {
        for (intent in intents) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (intent.resolveActivity(context.packageManager) != null) {
                context.startActivity(intent)
                call.resolve()
                return
            }
        }
        call.reject("Android has no settings page for this.")
    }

    private fun hasMicrophone() =
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun status() = JSObject().apply {
        put("backgroundListening", DahliaListenService.isEnabled(context))
        put("listening", DahliaListenService.running)
        put("assistant", isAssistant())
        put("overlay", Settings.canDrawOverlays(context))
        put("microphone", hasMicrophone())
        put(
            "notifications",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
        )
    }

    private fun isAssistant(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val roles = context.getSystemService(RoleManager::class.java)
            if (roles?.isRoleAvailable(RoleManager.ROLE_ASSISTANT) == true)
                return roles.isRoleHeld(RoleManager.ROLE_ASSISTANT)
        }
        // Before Android 10 the choice is in a secure setting.
        val assistant = Settings.Secure.getString(context.contentResolver, "assistant") ?: return false
        return assistant.startsWith(context.packageName + "/")
    }
}
