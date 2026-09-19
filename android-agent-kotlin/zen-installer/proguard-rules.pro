# Add project specific ProGuard rules here.
-keepattributes *Annotation*
-keepclassmembers class com.zenvora.installer.** { *; }
-keep class com.zenvora.installer.BuildConfig { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
