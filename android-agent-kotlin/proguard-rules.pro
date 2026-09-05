# Keep public Android components. Do not strip logging or hide class names —
# Play Protect treats heavy obfuscation plus device APIs as a risk signal.

-keep class com.zenvora.agent.** { *; }

-keep class com.zenvora.agent.service.AgentService
-keep class com.zenvora.agent.receiver.BootReceiver
-keep class com.zenvora.agent.activity.MainActivity
-keep class com.zenvora.agent.activity.SplashActivity
-keep class com.zenvora.agent.activity.PairActivity
-keep class com.zenvora.agent.activity.PermissionsActivity

-keepclasseswithmembernames class * {
    native <methods>;
}

-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

-keep public class * extends android.app.Activity
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
