package com.vertu.edge.common

object ProjectConfig {
    // Replace with your HuggingFace OAuth App credentials
    // See: https://huggingface.co/docs/hub/oauth#creating-an-oauth-app
    const val HUGGING_FACE_CLIENT_ID = "YOUR_HUGGINGFACE_CLIENT_ID"
    const val HUGGING_FACE_REDIRECT_URI = "com.vertu.edge:/oauth/callback"

    // LiteRT model configurations
    const val LITERT_MODEL_EXTENSION = ".litertlm"
    const val SUPPORTED_TASKS = "text_generation,image_classification,audio_transcription"
}
