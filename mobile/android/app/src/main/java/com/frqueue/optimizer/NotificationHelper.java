package com.frqueue.optimizer;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

public class NotificationHelper {

    public static final String CHANNEL_ALERTS = "fr_queue_alerts";
    public static final String CHANNEL_URGENT = "fr_queue_urgent";

    private static boolean channelsReady = false;

    public static void ensureChannels(Context context) {
        if (channelsReady || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            channelsReady = true;
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel alerts = new NotificationChannel(
            CHANNEL_ALERTS,
            "Queue Plan Reminders",
            NotificationManager.IMPORTANCE_HIGH
        );
        alerts.setDescription("Start time and drop reminders for your bot plan");
        alerts.enableVibration(true);
        alerts.enableLights(true);
        manager.createNotificationChannel(alerts);

        NotificationChannel urgent = new NotificationChannel(
            CHANNEL_URGENT,
            "Drop Now Alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        urgent.setDescription("Urgent alerts when it is time to change your delay");
        urgent.enableVibration(true);
        urgent.enableLights(true);
        manager.createNotificationChannel(urgent);

        channelsReady = true;
    }

    public static void show(Context context, int id, String title, String body, String channelId) {
        ensureChannels(context);
        if (channelId == null || channelId.isEmpty()) {
            channelId = CHANNEL_ALERTS;
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title != null ? title : "FR Queue Optimizer")
            .setContentText(body != null ? body : "")
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body != null ? body : ""))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setDefaults(NotificationCompat.DEFAULT_ALL);

        NotificationManagerCompat.from(context).notify(id, builder.build());
    }
}
