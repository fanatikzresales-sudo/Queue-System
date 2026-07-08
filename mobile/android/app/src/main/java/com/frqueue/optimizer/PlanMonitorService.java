package com.frqueue.optimizer;

import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONObject;

public class PlanMonitorService extends Service {

    private static final int FG_ID = 88001;
    private static final String PREFS = "plan_monitor_state";
    private static final long TICK_MS = 15000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable ticker;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationHelper.ensureChannels(this);
        String planName = intent != null ? intent.getStringExtra("planName") : "Queue plan";
        String alertsJson = intent != null ? intent.getStringExtra("alerts") : null;

        if (alertsJson != null) {
            getPrefs().edit().putString("alerts", alertsJson).putString("planName", planName).apply();
        } else {
            alertsJson = getPrefs().getString("alerts", "[]");
            if (planName == null) planName = getPrefs().getString("planName", "Queue plan");
        }

        startForeground(FG_ID, buildForegroundNotification(planName));
        startTicker();
        return START_STICKY;
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private Notification buildForegroundNotification(String planName) {
        return new NotificationCompat.Builder(this, NotificationHelper.CHANNEL_ALERTS)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("FR Queue Optimizer — alerts active")
            .setContentText("Monitoring \"" + planName + "\". Keep LDPlayer running.")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    private void startTicker() {
        if (ticker != null) handler.removeCallbacks(ticker);
        ticker = this::checkAlerts;
        handler.post(ticker);
    }

    private void checkAlerts() {
        String raw = getPrefs().getString("alerts", "[]");
        long now = System.currentTimeMillis();
        boolean anyPending = false;

        try {
            JSONArray arr = new JSONArray(raw);
            JSONArray updated = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject a = arr.getJSONObject(i);
                boolean fired = a.optBoolean("fired", false);
                long atMs = a.getLong("atMs");
                if (fired) {
                    updated.put(a);
                    continue;
                }
                if (now >= atMs) {
                    int id = a.getInt("id");
                    String title = a.optString("title", "FR Queue Optimizer");
                    String body = a.optString("body", "");
                    String channel = a.optString("channel", NotificationHelper.CHANNEL_ALERTS);
                    NotificationHelper.show(this, id, title, body, channel);
                    a.put("fired", true);
                    updated.put(a);
                } else {
                    anyPending = true;
                    updated.put(a);
                }
            }
            getPrefs().edit().putString("alerts", updated.toString()).apply();
            if (!anyPending) {
                stopSelf();
                return;
            }
        } catch (Exception ignored) {}

        handler.postDelayed(ticker, TICK_MS);
    }

    @Override
    public void onDestroy() {
        if (ticker != null) handler.removeCallbacks(ticker);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
