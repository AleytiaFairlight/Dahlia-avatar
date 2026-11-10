// Dahlia: the app's crashes, for the error log on Dahlia's server. An uncaught error is written to the app's own
// files before Android ends the app; on the next start the web app takes the saved crashes (DahliaPlugin
// takeCrashReports) and sends them to Dahlia's server (stage-ui libs/dahlia-error-reports.ts). Nothing goes to
// Sentry. This file is Dahlia's (AIRI has no such file).

package ai.moeru.airi_pocket.dahlia

import android.content.Context
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import java.io.File

object DahliaCrashLog {
    private const val DIR = "dahlia-crashes"
    private const val MAX_FILES = 10
    private const val MAX_STACK = 16000

    @Volatile
    private var installed = false

    /** Saves each uncaught error, then lets Android's own handling end the app as before. */
    fun install(context: Context) {
        if (installed)
            return
        installed = true
        val appContext = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                save(appContext, thread.name, error)
            } catch (_: Throwable) {
                // Nowhere to report a failed report.
            }
            previous?.uncaughtException(thread, error)
        }
    }

    private fun save(context: Context, thread: String, error: Throwable) {
        val dir = File(context.filesDir, DIR).apply { mkdirs() }
        val saved = dir.listFiles()?.sortedBy { it.name } ?: emptyList()
        if (saved.size >= MAX_FILES)
            saved.take(saved.size - MAX_FILES + 1).forEach { it.delete() }

        val stack = android.util.Log.getStackTraceString(error).take(MAX_STACK)
        val report = JSObject()
            .put("kind", "android-crash")
            .put("source", "android")
            .put("message", "The app crashed on thread $thread: ${error.javaClass.name}: ${error.message ?: ""}".trim())
            .put("stack", stack)
            .put("time", System.currentTimeMillis())
        File(dir, "${System.currentTimeMillis()}.json").writeText(report.toString())
    }

    /** The crashes saved since the last call; taking them deletes them. */
    fun take(context: Context): JSArray {
        val reports = JSArray()
        val files = File(context.filesDir, DIR).listFiles()?.sortedBy { it.name } ?: return reports
        for (file in files) {
            try {
                reports.put(JSObject(file.readText()))
            } catch (_: Exception) {
                // A file cut short by the crash itself.
            }
            file.delete()
        }
        return reports
    }
}
