package com.vertu.edge.huggingface

import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Path
import retrofit2.http.Query

data class HfModelInfo(
    val id: String,
    val modelId: String? = null,
    val author: String? = null,
    val downloads: Int? = null,
    val tags: List<String> = emptyList(),
    val cardData: Map<String, Any?>? = null
)

interface HuggingFaceApi {
    @GET("models")
    suspend fun searchModels(
        @Query("search") query: String,
        @Query("filter") filter: String = "litertlm",
        @Query("sort") sort: String = "downloads",
        @Query("limit") limit: Int = 20,
        @Header("Authorization") token: String? = null
    ): List<HfModelInfo>

    @GET("models/{modelId}")
    suspend fun getModel(
        @Path("modelId", encoded = true) modelId: String,
        @Header("Authorization") token: String? = null
    ): HfModelInfo
}
