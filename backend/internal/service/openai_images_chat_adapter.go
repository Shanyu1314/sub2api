package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/Wei-Shaw/sub2api/internal/util/responseheaders"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

var (
	openAIImagesChatDataURLPattern = regexp.MustCompile(`data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+`)
	openAIImagesChatURLPattern     = regexp.MustCompile(`https?://[^\s"'<>),]+`)
)

func openAIImagesViaChatCompletions(account *Account) bool {
	if account == nil {
		return false
	}
	for _, key := range []string{"openai_images_via_chat_completions", "images_via_chat_completions"} {
		if parseOpenAIImagesExtraBool(account.Extra[key]) {
			return true
		}
	}
	return false
}

func parseOpenAIImagesExtraBool(raw any) bool {
	switch value := raw.(type) {
	case bool:
		return value
	case string:
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "1", "true", "yes", "on", "enabled":
			return true
		}
	case json.Number:
		parsed, _ := value.Int64()
		return parsed != 0
	case float64:
		return value != 0
	case int:
		return value != 0
	case int64:
		return value != 0
	}
	return false
}

func (s *OpenAIGatewayService) forwardOpenAIImagesViaChatCompletions(
	ctx context.Context,
	c *gin.Context,
	account *Account,
	parsed *OpenAIImagesRequest,
	requestModel string,
	upstreamModel string,
	startTime time.Time,
) (*OpenAIForwardResult, error) {
	logger.LegacyPrintf(
		"service.openai_gateway",
		"[OpenAI] Images via chat/completions routing request_model=%s upstream_model=%s endpoint=%s account_id=%d",
		requestModel,
		upstreamModel,
		parsed.Endpoint,
		account.ID,
	)

	upstreamCtx, releaseUpstreamCtx := detachStreamUpstreamContext(ctx, false)
	defer releaseUpstreamCtx()

	token, _, err := s.GetAccessToken(upstreamCtx, account)
	if err != nil {
		return nil, err
	}
	chatBody, err := buildOpenAIImagesChatCompletionsBody(account, parsed, upstreamModel)
	if err != nil {
		return nil, err
	}
	upstreamReq, err := s.buildOpenAIImagesChatCompletionsRequest(upstreamCtx, c, account, chatBody, token)
	if err != nil {
		return nil, err
	}

	proxyURL := ""
	if account.ProxyID != nil && account.Proxy != nil {
		proxyURL = account.Proxy.URL()
	}
	upstreamStart := time.Now()
	resp, err := s.httpUpstream.Do(upstreamReq, proxyURL, account.ID, account.Concurrency)
	SetOpsLatencyMs(c, OpsUpstreamLatencyMsKey, time.Since(upstreamStart).Milliseconds())
	if err != nil {
		safeErr := sanitizeUpstreamErrorMessage(err.Error())
		setOpsUpstreamError(c, 0, safeErr, "")
		appendOpsUpstreamError(c, OpsUpstreamErrorEvent{
			Platform:           account.Platform,
			AccountID:          account.ID,
			AccountName:        account.Name,
			UpstreamStatusCode: 0,
			UpstreamURL:        safeUpstreamURL(upstreamReq.URL.String()),
			Kind:               "request_error",
			Message:            safeErr,
		})
		return nil, fmt.Errorf("upstream request failed: %s", safeErr)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		respBody := s.readUpstreamErrorBody(resp)
		_ = resp.Body.Close()
		respBody = s.redactAgentIdentitySensitiveBody(upstreamCtx, account, respBody)
		resp.Body = io.NopCloser(bytes.NewReader(respBody))
		upstreamMsg := sanitizeUpstreamErrorMessage(strings.TrimSpace(extractUpstreamErrorMessage(respBody)))
		if s.shouldFailoverOpenAIUpstreamResponse(resp.StatusCode, upstreamMsg, respBody) {
			appendOpsUpstreamError(c, OpsUpstreamErrorEvent{
				Platform:           account.Platform,
				AccountID:          account.ID,
				AccountName:        account.Name,
				UpstreamStatusCode: resp.StatusCode,
				UpstreamRequestID:  resp.Header.Get("x-request-id"),
				UpstreamURL:        safeUpstreamURL(upstreamReq.URL.String()),
				Kind:               "failover",
				Message:            upstreamMsg,
			})
			shouldDisable := s.handleFailoverSideEffects(upstreamCtx, resp, account, respBody, upstreamModel)
			return nil, &UpstreamFailoverError{
				StatusCode:             resp.StatusCode,
				ResponseBody:           respBody,
				RetryableOnSameAccount: !shouldDisable && account.IsPoolMode() && account.IsPoolModeRetryableStatus(resp.StatusCode),
			}
		}
		return s.handleErrorResponse(upstreamCtx, resp, c, account, chatBody, upstreamModel)
	}
	defer func() { _ = resp.Body.Close() }()

	usage, imageCount, err := s.handleOpenAIImagesChatCompletionsResponse(resp, c)
	if err != nil {
		return nil, err
	}
	return &OpenAIForwardResult{
		RequestID:        resp.Header.Get("x-request-id"),
		Usage:            usage,
		Model:            requestModel,
		UpstreamModel:    upstreamModel,
		UpstreamEndpoint: "/v1/chat/completions",
		Stream:           false,
		ResponseHeaders:  resp.Header.Clone(),
		Duration:         time.Since(startTime),
		ImageCount:       imageCount,
		ImageSize:        parsed.SizeTier,
		ImageInputSize:   parsed.Size,
	}, nil
}

func buildOpenAIImagesChatCompletionsBody(account *Account, parsed *OpenAIImagesRequest, upstreamModel string) ([]byte, error) {
	if parsed == nil {
		return nil, fmt.Errorf("parsed images request is required")
	}
	prompt := strings.TrimSpace(parsed.Prompt)
	if prompt == "" {
		prompt = "Generate an image."
	}
	if template := strings.TrimSpace(account.GetExtraString("openai_images_prompt_template")); template != "" {
		prompt = strings.ReplaceAll(template, "{{prompt}}", prompt)
	}
	payload := map[string]any{
		"model": upstreamModel,
		"messages": []map[string]any{{
			"role":    "user",
			"content": buildOpenAIImagesChatMessageContent(parsed, prompt),
		}},
		"stream": false,
	}
	return json.Marshal(payload)
}

func buildOpenAIImagesChatMessageContent(parsed *OpenAIImagesRequest, prompt string) any {
	if parsed == nil || (!parsed.IsEdits() && len(parsed.InputImageURLs) == 0 && len(parsed.Uploads) == 0) {
		return prompt
	}
	parts := []map[string]any{{"type": "text", "text": prompt}}
	for _, imageURL := range parsed.InputImageURLs {
		if value := strings.TrimSpace(imageURL); value != "" {
			parts = append(parts, openAIImagesChatImagePart(value))
		}
	}
	for _, upload := range parsed.Uploads {
		if len(upload.Data) == 0 {
			continue
		}
		contentType := strings.TrimSpace(upload.ContentType)
		if contentType == "" {
			contentType = "image/png"
		}
		dataURL := "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(upload.Data)
		parts = append(parts, openAIImagesChatImagePart(dataURL))
	}
	return parts
}

func openAIImagesChatImagePart(url string) map[string]any {
	return map[string]any{
		"type":      "image_url",
		"image_url": map[string]any{"url": url},
	}
}

func (s *OpenAIGatewayService) buildOpenAIImagesChatCompletionsRequest(
	ctx context.Context,
	c *gin.Context,
	account *Account,
	body []byte,
	token string,
) (*http.Request, error) {
	baseURL := account.GetOpenAIBaseURL()
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	validatedURL, err := s.validateUpstreamBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	targetURL := buildOpenAIChatCompletionsURL(validatedURL)
	if path := strings.TrimSpace(account.GetExtraString("openai_images_chat_path")); path != "" {
		targetURL = buildOpenAIImagesChatCompletionsURLWithPath(validatedURL, path)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req = req.WithContext(WithHTTPUpstreamProfile(req.Context(), HTTPUpstreamProfileOpenAI))
	authHeaders, err := s.buildOpenAIAuthenticationHeaders(ctx, account, token)
	if err != nil {
		return nil, fmt.Errorf("build openai authentication headers: %w", err)
	}
	for key, values := range authHeaders {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	for key, values := range c.Request.Header {
		if !openaiPassthroughAllowedHeaders[strings.ToLower(key)] || strings.EqualFold(key, "Content-Type") {
			continue
		}
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	if customUA := account.GetOpenAIUserAgent(); customUA != "" {
		req.Header.Set("User-Agent", customUA)
	}
	req.Header.Set("Content-Type", "application/json")
	account.ApplyHeaderOverrides(req.Header)
	return req, nil
}

func buildOpenAIImagesChatCompletionsURLWithPath(base string, path string) string {
	trimmedPath := strings.TrimSpace(path)
	if strings.HasPrefix(trimmedPath, "http://") || strings.HasPrefix(trimmedPath, "https://") {
		return strings.TrimRight(trimmedPath, "/")
	}
	if trimmedPath == "" || trimmedPath == "/v1/chat/completions" {
		return buildOpenAIChatCompletionsURL(base)
	}
	normalizedBase := strings.TrimRight(strings.TrimSpace(base), "/")
	if strings.HasPrefix(trimmedPath, "/") {
		normalizedBase = strings.TrimSuffix(normalizedBase, "/v1")
		return normalizedBase + trimmedPath
	}
	return normalizedBase + "/" + trimmedPath
}

func (s *OpenAIGatewayService) handleOpenAIImagesChatCompletionsResponse(
	resp *http.Response,
	c *gin.Context,
) (OpenAIUsage, int, error) {
	body, err := ReadUpstreamResponseBody(resp.Body, s.cfg, c, openAITooLargeError)
	if err != nil {
		return OpenAIUsage{}, 0, err
	}
	responseheaders.WriteFilteredHeaders(c.Writer.Header(), resp.Header, s.responseHeaderFilter)
	usage := extractOpenAIImagesChatUsage(body)
	images := extractOpenAIImagesFromChatCompletionsBody(body)
	if len(images) == 0 {
		return usage, 0, fmt.Errorf("chat completions image adapter found no image URL or base64 in upstream response")
	}
	output := map[string]any{"created": time.Now().Unix(), "data": images}
	if created := gjson.GetBytes(body, "created"); created.Exists() && created.Int() > 0 {
		output["created"] = created.Int()
	}
	outputBody, err := json.Marshal(output)
	if err != nil {
		return usage, 0, err
	}
	c.Data(http.StatusOK, "application/json", outputBody)
	return usage, len(images), nil
}

func extractOpenAIImagesChatUsage(body []byte) OpenAIUsage {
	if len(body) == 0 || !gjson.ValidBytes(body) {
		return OpenAIUsage{}
	}
	usage := OpenAIUsage{
		InputTokens:          int(gjson.GetBytes(body, "usage.input_tokens").Int()),
		OutputTokens:         int(gjson.GetBytes(body, "usage.output_tokens").Int()),
		CacheReadInputTokens: int(gjson.GetBytes(body, "usage.input_tokens_details.cached_tokens").Int()),
		ImageOutputTokens:    int(gjson.GetBytes(body, "usage.output_tokens_details.image_tokens").Int()),
	}
	if usage.InputTokens == 0 {
		usage.InputTokens = int(gjson.GetBytes(body, "usage.prompt_tokens").Int())
	}
	if usage.OutputTokens == 0 {
		usage.OutputTokens = int(gjson.GetBytes(body, "usage.completion_tokens").Int())
	}
	return usage
}

func extractOpenAIImagesFromChatCompletionsBody(body []byte) []gin.H {
	if len(body) == 0 || !gjson.ValidBytes(body) {
		return nil
	}
	var output []gin.H
	addImage := func(value string) {
		value = strings.TrimSpace(value)
		switch {
		case value == "":
			return
		case strings.HasPrefix(value, "data:image/"):
			if comma := strings.Index(value, ","); comma > 0 && comma+1 < len(value) {
				output = append(output, gin.H{"b64_json": value[comma+1:]})
			}
		case strings.HasPrefix(value, "http://"), strings.HasPrefix(value, "https://"):
			output = append(output, gin.H{"url": value})
		default:
			output = append(output, gin.H{"b64_json": value})
		}
	}
	for _, path := range []string{"data.0.url", "data.0.b64_json", "url", "b64_json", "image_url"} {
		if value := strings.TrimSpace(gjson.GetBytes(body, path).String()); value != "" {
			addImage(value)
		}
	}
	for _, choice := range gjson.GetBytes(body, "choices").Array() {
		collectOpenAIImagesFromChatContent(choice.Get("message.content"), addImage)
	}
	return dedupeOpenAIImagesChatData(output)
}

func collectOpenAIImagesFromChatContent(content gjson.Result, addImage func(string)) {
	if content.IsArray() {
		for _, item := range content.Array() {
			for _, path := range []string{"image_url.url", "image_url", "url", "b64_json", "text"} {
				collectOpenAIImagesFromChatText(item.Get(path).String(), addImage)
			}
		}
		return
	}
	if content.Type == gjson.String {
		collectOpenAIImagesFromChatText(content.String(), addImage)
	}
}

func collectOpenAIImagesFromChatText(text string, addImage func(string)) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	if gjson.Valid(text) {
		for _, path := range []string{"data.0.url", "data.0.b64_json", "url", "b64_json", "image_url"} {
			if value := strings.TrimSpace(gjson.Get(text, path).String()); value != "" {
				addImage(value)
			}
		}
	}
	for _, match := range openAIImagesChatDataURLPattern.FindAllString(text, -1) {
		addImage(match)
	}
	for _, match := range openAIImagesChatURLPattern.FindAllString(text, -1) {
		addImage(strings.TrimRight(match, ".,;"))
	}
	if isLikelyOpenAIImagesChatBase64(text) {
		addImage(text)
	}
}

func isLikelyOpenAIImagesChatBase64(text string) bool {
	if len(text) < 64 || strings.ContainsAny(text, " \n\r\t") {
		return false
	}
	_, err := base64.StdEncoding.DecodeString(text)
	return err == nil
}

func dedupeOpenAIImagesChatData(items []gin.H) []gin.H {
	seen := make(map[string]struct{}, len(items))
	output := make([]gin.H, 0, len(items))
	for _, item := range items {
		key := ""
		if value, _ := item["url"].(string); value != "" {
			key = "url:" + value
		} else if value, _ := item["b64_json"].(string); value != "" {
			key = "b64:" + value
		}
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		output = append(output, item)
	}
	return output
}
