  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: unknown }; thoughtSignature?: string }
  | {
      functionResponse: {
        name: string;
        response: unknown;
        parts?: Array<GoogleGenerativeAIFunctionResponsePart>;
      };
    }
  | { fileData: { mimeType: string; fileUri: string } }
  | {
      toolCall: {
        toolType: string;
        args?: unknown;
        id: string;
      };
      thoughtSignature?: string;
    }
  | {
      toolResponse: {
        toolType: string;
        response?: unknown;
        id: string;
      };
      thoughtSignature?: string;
    };

export type GoogleGenerativeAIFunctionResponsePart = {
  inlineData: { mimeType: string; data: string };
};

export type GoogleGenerativeAIGroundingMetadata = GroundingMetadataSchema;

export type GoogleGenerativeAIUrlContextMetadata = UrlContextMetadataSchema;

export type GoogleGenerativeAISafetyRating = SafetyRatingSchema;

export type GoogleGenerativeAIPromptFeedback = PromptFeedbackSchema;

export type GoogleGenerativeAIUsageMetadata = UsageMetadataSchema;

export interface GoogleGenerativeAIProviderMetadata {
  promptFeedback: GoogleGenerativeAIPromptFeedback | null;
  groundingMetadata: GoogleGenerativeAIGroundingMetadata | null;
  urlContextMetadata: GoogleGenerativeAIUrlContextMetadata | null;
