plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.polychat.app"
    compileSdk = 36

    // Single committed signing key for BOTH debug and release. This makes every
    // APK (local debug, CI release, Android Studio) share the same signature so
    // new builds can be installed over previous ones. See android-app/polychat.keystore.
    signingConfigs {
        create("polychat") {
            storeFile = file("../polychat.keystore")
            storePassword = "polychat-app-keystore"
            keyAlias = "polychat"
            keyPassword = "polychat-app-keystore"
        }
    }

    defaultConfig {
        applicationId = "com.polychat.app"
        minSdk = 24
        targetSdk = 36
        // Must only ever increase — do not go backwards (that blocks overwrite installs).
        versionCode = 2
        versionName = "1.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("polychat")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("polychat")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.hilt.android)
    implementation(libs.hilt.navigation.compose)
    ksp(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.datastore.preferences)
    implementation(libs.coil.compose)
    implementation(libs.markdown.renderer)
    testImplementation(libs.junit)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
