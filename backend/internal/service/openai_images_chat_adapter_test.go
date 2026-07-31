package service

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestOpenAIImagesViaChatCompletionsRequiresExplicitOptIn(t *testing.T) {
	require.False(t, openAIImagesViaChatCompletions(&Account{Extra: map[string]any{}}))
	require.True(t, openAIImagesViaChatCompletions(&Account{
		Extra: map[string]any{"openai_images_via_chat_completions": true},
	}))
	require.True(t, openAIImagesViaChatCompletions(&Account{
		Extra: map[string]any{"images_via_chat_completions": "1"},
	}))
}

func TestBuildOpenAIImagesChatCompletionsBodyIncludesMultipleUploads(t *testing.T) {
	parsed := &OpenAIImagesRequest{
		Endpoint: openAIImagesEditsEndpoint,
		Prompt:   "dress the person",
		Uploads: []OpenAIImagesUpload{
			{ContentType: "image/png", Data: []byte("person")},
			{ContentType: "image/jpeg", Data: []byte("garment")},
		},
	}
	body, err := buildOpenAIImagesChatCompletionsBody(&Account{}, parsed, "image-2")
	require.NoError(t, err)
	require.Equal(t, "image-2", gjson.GetBytes(body, "model").String())
	content := gjson.GetBytes(body, "messages.0.content").Array()
	require.Len(t, content, 3)
	require.Equal(t, "text", content[0].Get("type").String())
	require.True(t, strings.HasPrefix(content[1].Get("image_url.url").String(), "data:image/png;base64,"))
	require.True(t, strings.HasPrefix(content[2].Get("image_url.url").String(), "data:image/jpeg;base64,"))
}

func TestBuildOpenAIImagesChatCompletionsURLWithPath(t *testing.T) {
	require.Equal(
		t,
		"https://example.com/v1/chat/completions",
		buildOpenAIImagesChatCompletionsURLWithPath("https://example.com/v1", "/v1/chat/completions"),
	)
	require.Equal(
		t,
		"https://example.com/api/chat",
		buildOpenAIImagesChatCompletionsURLWithPath("https://example.com/v1", "/api/chat"),
	)
}

func TestExtractOpenAIImagesFromChatCompletionsBody(t *testing.T) {
	body := []byte(`{
		"choices":[{"message":{"content":"{\"data\":[{\"url\":\"https://cdn.example/image.png\"}]}"}}],
		"usage":{"prompt_tokens":12,"completion_tokens":7}
	}`)
	images := extractOpenAIImagesFromChatCompletionsBody(body)
	require.Equal(t, []gin.H{{"url": "https://cdn.example/image.png"}}, images)
	usage := extractOpenAIImagesChatUsage(body)
	require.Equal(t, 12, usage.InputTokens)
	require.Equal(t, 7, usage.OutputTokens)
}

func TestForwardOpenAIImagesViaChatCompletionsEdits(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	require.NoError(t, writer.WriteField("model", "gpt-image-2"))
	require.NoError(t, writer.WriteField("prompt", "replace the clothes"))
	for _, file := range []string{"person.png", "garment.png"} {
		part, err := writer.CreateFormFile("image", file)
		require.NoError(t, err)
		_, err = part.Write([]byte(file))
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(requestBody.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = req

	svc := &OpenAIGatewayService{
		cfg: &config.Config{},
		httpUpstream: &httpUpstreamRecorder{resp: &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(`{
				"created":1710000008,
				"choices":[{"message":{"content":"https://cdn.example/edited.png"}}],
				"usage":{"prompt_tokens":10,"completion_tokens":5}
			}`)),
		}},
	}
	parsed, err := svc.ParseOpenAIImagesRequest(c, requestBody.Bytes())
	require.NoError(t, err)
	account := &Account{
		ID:       77,
		Platform: PlatformOpenAI,
		Type:     AccountTypeAPIKey,
		Credentials: map[string]any{
			"api_key":  "secret",
			"base_url": "https://upstream.example/v1",
			"model_mapping": map[string]any{
				"gpt-image-2": "image-2",
			},
		},
		Extra: map[string]any{"openai_images_via_chat_completions": true},
	}

	result, err := svc.ForwardImages(context.Background(), c, account, requestBody.Bytes(), parsed, "")
	require.NoError(t, err)
	require.Equal(t, "image-2", result.UpstreamModel)
	require.Equal(t, "/v1/chat/completions", result.UpstreamEndpoint)
	require.Equal(t, 1, result.ImageCount)
	require.Equal(t, "https://cdn.example/edited.png", gjson.Get(recorder.Body.String(), "data.0.url").String())

	upstream, ok := svc.httpUpstream.(*httpUpstreamRecorder)
	require.True(t, ok)
	require.Equal(t, "https://upstream.example/v1/chat/completions", upstream.lastReq.URL.String())
	require.Equal(t, "Bearer secret", upstream.lastReq.Header.Get("Authorization"))
	require.Equal(t, "image-2", gjson.GetBytes(upstream.lastBody, "model").String())
	require.Len(t, gjson.GetBytes(upstream.lastBody, "messages.0.content").Array(), 3)
}
