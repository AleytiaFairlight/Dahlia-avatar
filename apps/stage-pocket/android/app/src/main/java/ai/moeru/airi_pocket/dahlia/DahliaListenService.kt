// Dahlia: listens for her name while the app isn't in front, and brings the app to the front to listen to
// what follows. This file is Dahlia's (AIRI has no such file); DahliaPlugin starts and stops it.
//
// It spots "Dahlia" with sherpa-onnx and the same wake word model as the web app (assets/dahlia-kws,
// fetched by scripts/fetch-dahlia-kws.sh). Nothing is recorded or sent: the audio goes only to the spotter.
// Android shows a notification for as long as it listens, and stops listening while the app is in front,
// where the web app listens itself.
package ai.moeru.airi_pocket.dahlia

import ai.moeru.airi_pocket.MainActivity
import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig

class DahliaListenService : Service() {
    companion object {
        const val ACTION_WAKE = "moe.aleytia.dahlia.WAKE"
        const val ACTION_STOP = "moe.aleytia.dahlia.STOP_LISTENING"
        const val NOTIFICATION_ID = 4101
        const val WAKE_NOTIFICATION_ID = 4102
        private const val CHANNEL_LISTENING = "dahlia-listening"
        private const val CHANNEL_WAKE = "dahlia-wake"
        private const val PREFS = "dahlia"
        private const val KEY_ENABLED = "background_listening"
        private const val TAG = "DahliaListen"
        private const val SAMPLE_RATE = 16000
        private const val MODEL_DIR = "dahlia-kws"

        /** The web app's wake word search settings (packages/stage-ui/src/libs/voice/kws-model.ts). */
        private const val MAX_ACTIVE_PATHS = 16
        private const val KEYWORDS_SCORE = 1.5f
        private const val KEYWORDS_THRESHOLD = 0.1f

        /** A second "Dahlia" this soon after the first opens nothing new. */
        private const val WAKE_PAUSE_MS = 4000L

        @Volatile
        var running = false
            private set

        /** The app is in front: it listens itself, so this service lets go of the microphone. */
        @Volatile
        var appInFront = false

        fun isEnabled(context: Context) =
            context.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

        fun setEnabled(context: Context, enabled: Boolean) {
            context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
        }

        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, DahliaListenService::class.java))
            } catch (error: Exception) {
                // Android refuses a microphone service that starts while the app isn't in front.
                Log.w(TAG, "Could not start listening", error)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, DahliaListenService::class.java))
        }
    }

    @Volatile
    private var stopping = false
    private var worker: Thread? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastWake = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_LISTENING, "Listening for Dahlia", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while Dahlia listens for her name in the background."
                setShowBadge(false)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_WAKE, "Dahlia heard you", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Opens Dahlia when she hears her name."
            },
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            setEnabled(this, false)
            stopSelf()
            return START_NOT_STICKY
        }

        try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                listeningNotification(),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0,
            )
        } catch (error: Exception) {
            Log.w(TAG, "Android didn't allow listening now", error)
            stopSelf()
            return START_NOT_STICKY
        }

        if (worker == null) {
            stopping = false
            worker = Thread(::listen, "dahlia-listen").also { it.start() }
        }
        running = true
        return START_STICKY
    }

    override fun onDestroy() {
        stopping = true
        worker?.join(2000)
        worker = null
        running = false
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    private fun listeningNotification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, DahliaListenService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_LISTENING)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("Dahlia is listening for her name")
            .setContentText("Say \"Dahlia\" to talk to her.")
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(open)
            .addAction(0, "Stop listening", stop)
            .build()
    }

    @SuppressLint("MissingPermission")
    private fun listen() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "No microphone permission")
            stopSelf()
            return
        }

        val spotter = try {
            KeywordSpotter(
                assets,
                KeywordSpotterConfig(
                    featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
                    modelConfig = OnlineModelConfig(
                        transducer = OnlineTransducerModelConfig(
                            encoder = "$MODEL_DIR/encoder.onnx",
                            decoder = "$MODEL_DIR/decoder.onnx",
                            joiner = "$MODEL_DIR/joiner.onnx",
                        ),
                        tokens = "$MODEL_DIR/tokens.txt",
                        numThreads = 1,
                        provider = "cpu",
                        modelType = "zipformer2",
                    ),
                    maxActivePaths = MAX_ACTIVE_PATHS,
                    keywordsFile = "$MODEL_DIR/keywords.txt",
                    keywordsScore = KEYWORDS_SCORE,
                    keywordsThreshold = KEYWORDS_THRESHOLD,
                ),
            )
        } catch (error: Throwable) {
            Log.e(TAG, "Could not load the wake word model", error)
            stopSelf()
            return
        }

        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Dahlia:listening")
            .also { it.acquire() }

        val chunk = SAMPLE_RATE / 10
        val bufferSize = maxOf(
            AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT),
            chunk * 2 * 4,
        )
        val samples = ShortArray(chunk)
        val floats = FloatArray(chunk)
        var record: AudioRecord? = null
        var stream = spotter.createStream()
        try {
            while (!stopping) {
                if (appInFront) {
                    // The web app listens while it is in front.
                    record?.let { it.stop(); it.release() }
                    record = null
                    Thread.sleep(300)
                    continue
                }
                if (record == null) {
                    record = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferSize)
                    if (record.state != AudioRecord.STATE_INITIALIZED) {
                        record.release()
                        record = null
                        Thread.sleep(1000)
                        continue
                    }
                    record.startRecording()
                    // Audio from before the pause can't finish her name.
                    stream.release()
                    stream = spotter.createStream()
                }

                val read = record.read(samples, 0, chunk)
                if (read <= 0) {
                    Thread.sleep(50)
                    continue
                }
                for (i in 0 until read)
                    floats[i] = samples[i] / 32768f
                stream.acceptWaveform(if (read == chunk) floats else floats.copyOf(read), SAMPLE_RATE)
                while (spotter.isReady(stream)) {
                    spotter.decode(stream)
                    if (spotter.getResult(stream).keyword.isNotBlank()) {
                        spotter.reset(stream)
                        onWake()
                    }
                }
            }
        } catch (error: InterruptedException) {
            // Stopping.
        } catch (error: Throwable) {
            Log.e(TAG, "Listening stopped", error)
        } finally {
            record?.let { it.stop(); it.release() }
            stream.release()
            spotter.release()
            wakeLock?.let { if (it.isHeld) it.release() }
        }
    }

    private fun onWake() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastWake < WAKE_PAUSE_MS)
            return
        lastWake = now
        Log.i(TAG, "Heard Dahlia")

        DahliaPlugin.pendingWake = true
        vibrate()
        val intent = Intent(this, MainActivity::class.java)
            .setAction(ACTION_WAKE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)

        // Android lets an app come to the front from the background only with "display over other apps".
        // Otherwise a notification opens it: full screen on the lock screen, a banner on top of other apps.
        try {
            startActivity(intent)
        } catch (error: Exception) {
            Log.w(TAG, "Could not bring the app to the front", error)
        }
        val open = PendingIntent.getActivity(this, 2, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(this, CHANNEL_WAKE)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("Dahlia heard you")
            .setContentText("Tap to talk to her.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setTimeoutAfter(15_000)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .build()
        try {
            getSystemService(NotificationManager::class.java).notify(WAKE_NOTIFICATION_ID, notification)
        } catch (error: SecurityException) {
            Log.w(TAG, "Could not show the notification", error)
        }
    }

    private fun vibrate() {
        val vibrator = getSystemService(Vibrator::class.java) ?: return
        if (vibrator.hasVibrator())
            vibrator.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE))
    }
}
