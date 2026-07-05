package com.frqueue.optimizer;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "PlanAlarm")
public class PlanAlarmPlugin extends Plugin {

    private AlarmManager alarmManager() {
        return (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
    }

    private PendingIntent alarmIntent(int id, String title, String body, String channel) {
        Intent intent = new Intent(getContext(), PlanAlarmReceiver.class);
        intent.putExtra("id", id);
        intent.putExtra("title", title);
        intent.putExtra("body", body);
        intent.putExtra("channel", channel);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(getContext(), id, intent, flags);
    }

    private void scheduleOne(int id, long atMs, String title, String body, String channel) {
        AlarmManager am = alarmManager();
        if (am == null) return;
        PendingIntent pi = alarmIntent(id, title, body, channel);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi);
        } else {
            am.setExact(AlarmManager.RTC_WAKEUP, atMs, pi);
        }
    }

    private void cancelOne(int id) {
        AlarmManager am = alarmManager();
        if (am == null) return;
        Intent intent = new Intent(getContext(), PlanAlarmReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getBroadcast(getContext(), id, intent, flags);
        am.cancel(pi);
    }

    @PluginMethod
    public void scheduleAlarms(PluginCall call) {
        NotificationHelper.ensureChannels(getContext());
        JSArray alarms = call.getArray("alarms");
        if (alarms == null) {
            call.reject("Missing alarms array");
            return;
        }
        int scheduled = 0;
        long now = System.currentTimeMillis();
        try {
            for (int i = 0; i < alarms.length(); i++) {
                JSONObject a = alarms.getJSONObject(i);
                int id = a.getInt("id");
                long atMs = a.getLong("atMs");
                if (atMs <= now + 500) continue;
                String title = a.optString("title", "FR Queue Optimizer");
                String body = a.optString("body", "");
                String channel = a.optString("channel", NotificationHelper.CHANNEL_ALERTS);
                scheduleOne(id, atMs, title, body, channel);
                scheduled++;
            }
            JSObject ret = new JSObject();
            ret.put("scheduled", scheduled);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to schedule alarms", e);
        }
    }

    @PluginMethod
    public void cancelAlarms(PluginCall call) {
        JSArray ids = call.getArray("ids");
        if (ids == null) {
            call.reject("Missing ids array");
            return;
        }
        try {
            for (int i = 0; i < ids.length(); i++) {
                cancelOne(ids.getInt(i));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to cancel alarms", e);
        }
    }

    @PluginMethod
    public void showNow(PluginCall call) {
        int id = call.getInt("id", (int) (System.currentTimeMillis() % 100000));
        String title = call.getString("title", "FR Queue Optimizer");
        String body = call.getString("body", "");
        String channel = call.getString("channel", NotificationHelper.CHANNEL_ALERTS);
        NotificationHelper.show(getContext(), id, title, body, channel);
        call.resolve();
    }
}
