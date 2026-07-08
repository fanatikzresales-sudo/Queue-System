package com.frqueue.optimizer;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "AppSettings")
public class AppSettingsPlugin extends Plugin {

    private boolean launchIntent(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Context ctx = getContext();
        if (getActivity() != null) {
            getActivity().startActivity(intent);
            return true;
        }
        if (ctx != null) {
            ctx.startActivity(intent);
            return true;
        }
        return false;
    }

    private List<Intent> notificationSettingIntents(String pkg) {
        List<Intent> intents = new ArrayList<>();
        Context ctx = getContext();
        int uid = ctx.getApplicationInfo().uid;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent o = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            o.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
            o.putExtra("app_package", pkg);
            o.putExtra("app_uid", uid);
            o.putExtra("android.provider.extra.APP_PACKAGE", pkg);
            intents.add(o);
        }

        Intent legacy = new Intent();
        legacy.setAction("android.settings.APP_NOTIFICATION_SETTINGS");
        legacy.putExtra("app_package", pkg);
        legacy.putExtra("app_uid", uid);
        intents.add(legacy);

        Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        details.setData(Uri.parse("package:" + pkg));
        intents.add(details);

        intents.add(new Intent(Settings.ACTION_SETTINGS));
        return intents;
    }

    private void openFirstWorking(PluginCall call, List<Intent> intents, String failMessage) {
        Exception lastError = null;
        for (Intent intent : intents) {
            try {
                if (launchIntent(intent)) {
                    JSObject ret = new JSObject();
                    ret.put("opened", true);
                    call.resolve(ret);
                    return;
                }
            } catch (ActivityNotFoundException e) {
                lastError = e;
            } catch (Exception e) {
                lastError = e;
            }
        }
        if (lastError != null) {
            call.reject(failMessage, lastError);
        } else {
            call.reject(failMessage);
        }
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        openFirstWorking(call, notificationSettingIntents(pkg), "Could not open notification settings");
    }

    @PluginMethod
    public void openAppDetails(PluginCall call) {
        String pkg = getContext().getPackageName();
        List<Intent> intents = new ArrayList<>();
        Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        details.setData(Uri.parse("package:" + pkg));
        intents.add(details);
        intents.add(new Intent(Settings.ACTION_SETTINGS));
        openFirstWorking(call, intents, "Could not open app settings");
    }

    @PluginMethod
    public void checkNotificationEnabled(PluginCall call) {
        boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        List<Intent> intents = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent exact = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            exact.setData(Uri.parse("package:" + pkg));
            intents.add(exact);
        }
        Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        details.setData(Uri.parse("package:" + pkg));
        intents.add(details);
        intents.add(new Intent(Settings.ACTION_SETTINGS));
        openFirstWorking(call, intents, "Could not open alarm settings");
    }
}
