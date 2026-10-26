package com.majlisk.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * خدمة أمامية تُبقي المحادثة الصوتية تعمل والتطبيق في الخلفية (شاشة مقفلة أو تطبيق آخر):
 * بدونها يوقف Android الميكروفون ويُنهي التطبيق بعد قليل. تظهر كإشعار ثابت "المحادثة الصوتية تعمل".
 */
public class VoiceService extends Service {

    private static final String CHANNEL = "voice";
    private static final int ID = 7001;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        boolean mic = intent != null && intent.getBooleanExtra("mic", false)
            && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        Notification n = notification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK | (mic ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0);
                startForeground(ID, n, type);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(ID, n);
            }
        } catch (Exception e) {
            // النظام رفض (بدأت والتطبيق في الخلفية): الصوت يعمل ما دام التطبيق ظاهراً فقط
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private Notification notification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "المحادثة الصوتية", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("يظهر أثناء المحادثة الصوتية حتى تستمر والتطبيق في الخلفية");
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("مجلسك — المحادثة الصوتية تعمل")
            .setContentText("اضغط للعودة إلى الطاولة")
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    /** أُغلق التطبيق من قائمة التطبيقات الأخيرة: تنتهي المحادثة معه */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
