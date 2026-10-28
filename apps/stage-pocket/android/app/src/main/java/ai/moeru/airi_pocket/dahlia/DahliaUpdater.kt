// Dahlia: updates the Android app with as few taps as Android allows. This file is Dahlia's (AIRI has no such
// file); DahliaPlugin calls it, and scripts/apply_avatar_branding.sh adds its receiver and permissions to the
// manifest.
//
// The web app finds a newer release (src/dahlia-updater.ts) and asks for it here. The APK is downloaded in the
// app, checked to be Dahlia at the expected version, and handed to Android's PackageInstaller:
// - On Android 12 and later, once Dahlia installed the version that runs (she is its "installer"), Android
//   installs her updates without asking. That happens when the app leaves the screen, so it never closes
//   while in use.
// - Otherwise (an older Android, or the first update of a copy installed from the browser) Android asks once
//   with its "Update this app?" dialog. Updates after that one install by themselves.
package ai.moeru.airi_pocket.dahlia

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object DahliaUpdater {
    const val ACTION_INSTALL_STATUS = "moe.aleytia.dahlia.UPDATE_INSTALL_STATUS"
    const val UPDATE_NOTIFICATION_ID = 4103
    private const val CHANNEL_UPDATES = "dahlia-updates"
    private const val DIR = "dahlia-update"
    private const val TAG = "DahliaUpdate"

    /** A downloaded update that installs by itself when the app leaves the screen. */
    @Volatile
    var pendingSilentInstall: File? = null

    private fun dir(context: Context) = File(context.filesDir, DIR).apply { mkdirs() }

    private fun apkFile(context: Context, version: String) =
        File(dir(context), "dahlia-${version.replace(Regex("[^A-Za-z0-9._-]"), "_")}.apk")

    /** The downloaded APK of this version, when it is complete and is Dahlia at that version. */
    fun downloaded(context: Context, version: String): File? =
        apkFile(context, version).takeIf { it.isFile && isDahliaApk(context, it, version) }

    /**
     * Downloads the APK of a release, unless it is already here. Runs on the calling thread; call it off the
     * main thread. Throws when the download fails or the file is not Dahlia at that version.
     */
    fun download(context: Context, url: String, version: String): File {
        downloaded(context, version)?.let { return it }

        // Only one update is kept.
        dir(context).listFiles()?.forEach { it.delete() }
        val part = File(dir(context), "download.part")
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 30_000
        connection.readTimeout = 60_000
        connection.instanceFollowRedirects = true
        try {
            if (connection.responseCode !in 200..299)
                throw IllegalStateException("The server answered ${connection.responseCode}.")
            connection.inputStream.use { input -> part.outputStream().use { output -> input.copyTo(output, 1 shl 16) } }
        } finally {
            connection.disconnect()
        }

        val apk = apkFile(context, version)
        if (!isDahliaApk(context, part, version)) {
            part.delete()
            throw IllegalStateException("The download is not Dahlia $version.")
        }
        if (!part.renameTo(apk))
            throw IllegalStateException("The update could not be saved.")
        return apk
    }

    private fun isDahliaApk(context: Context, file: File, version: String): Boolean {
        @Suppress("DEPRECATION")
        val info = context.packageManager.getPackageArchiveInfo(file.path, 0) ?: return false
        return info.packageName == context.packageName && info.versionName == version
    }

    /**
     * Whether Android installs updates without asking: Android 12 or later, and the running copy was installed by
     * Dahlia herself.
     */
    fun canInstallSilently(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S)
            return false
        return try {
            context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName == context.packageName
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
    }

    /**
     * Hands the APK to Android. Android installs it without asking when it can, and otherwise sends
     * STATUS_PENDING_USER_ACTION to DahliaUpdateReceiver, which shows Android's "Update this app?" dialog.
     */
    fun install(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("dahlia.apk", 0, apk.length()).use { output ->
                apk.inputStream().use { input -> input.copyTo(output, 1 shl 16) }
                session.fsync(output)
            }
            val status = Intent(context, DahliaUpdateReceiver::class.java).setAction(ACTION_INSTALL_STATUS)
            // Mutable: Android adds the result to the intent.
            val pending = PendingIntent.getBroadcast(
                context,
                sessionId,
                status,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(pending.intentSender)
        }
        Log.i(TAG, "installing ${apk.name}")
    }

    fun clear(context: Context) {
        pendingSilentInstall = null
        dir(context).listFiles()?.forEach { it.delete() }
    }

    /**
     * Removes what an earlier update left behind, a few hundred MB each: the APK of this version or an older one
     * (installed some other way, or its "updated" broadcast was missed), and a download that was abandoned (untouched
     * for 10 minutes, so one that is running stays). A downloaded newer version stays for its install.
     */
    fun clearStale(context: Context) {
        val installed = versionCodeOf(context.packageManager.getPackageInfo(context.packageName, 0))
        val abandonedBefore = System.currentTimeMillis() - 10 * 60 * 1000L
        dir(context).listFiles()?.forEach { file ->
            val stale = if (file.name.endsWith(".apk")) {
                @Suppress("DEPRECATION")
                val archive = context.packageManager.getPackageArchiveInfo(file.path, 0)
                archive == null || archive.packageName != context.packageName || versionCodeOf(archive) <= installed
            } else {
                file.lastModified() < abandonedBefore
            }
            if (stale && file.delete())
                Log.i(TAG, "removed ${file.name}")
        }
    }

    @Suppress("DEPRECATION")
    private fun versionCodeOf(info: android.content.pm.PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

    /** A notification that opens [intent]; for when the app is not on the screen to show it itself. */
    fun notify(context: Context, title: String, text: String, intent: Intent) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_UPDATES, "Dahlia updates", NotificationManager.IMPORTANCE_DEFAULT),
        )
        val open = PendingIntent.getActivity(
            context,
            UPDATE_NOTIFICATION_ID,
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification: Notification = NotificationCompat.Builder(context, CHANNEL_UPDATES)
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            manager.notify(UPDATE_NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "no permission to show the update notification", e)
        }
    }
}

/** The result of an install, and the app having been updated (MY_PACKAGE_REPLACED). */
class DahliaUpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            DahliaUpdater.ACTION_INSTALL_STATUS -> onInstallStatus(context, intent)
            Intent.ACTION_MY_PACKAGE_REPLACED -> onUpdated(context)
        }
    }

    private fun onInstallStatus(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status != PackageInstaller.STATUS_PENDING_USER_ACTION) {
            if (status != PackageInstaller.STATUS_SUCCESS)
                Log.w("DahliaUpdate", "install failed ($status): ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)}")
            return
        }

        @Suppress("DEPRECATION")
        val confirm = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        else
            intent.getParcelableExtra(Intent.EXTRA_INTENT)) ?: return

        // Android lets the app open the dialog only while it is on the screen.
        if (DahliaListenService.appInFront) {
            context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } else {
            DahliaUpdater.notify(context, "Dahlia update ready", "Tap to install the new version.", confirm)
        }
    }

    private fun onUpdated(context: Context) {
        DahliaUpdater.clear(context)
        if (!DahliaListenService.isEnabled(context))
            return

        // Listening was on: start it again. Android may refuse a microphone service from the background (the
        // service then stops itself); a few seconds later a notification brings her back with one tap.
        DahliaListenService.start(context)
        val result = goAsync()
        Handler(Looper.getMainLooper()).postDelayed({
            try {
                val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
                if (!DahliaListenService.running && open != null)
                    DahliaUpdater.notify(context, "Dahlia was updated", "Open her to keep listening for her name.", open)
            } finally {
                result.finish()
            }
        }, 4_000)
    }
}
